'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { ExternalLink } from 'lucide-react';
import { Modal } from '@/components/modal';
import { PageHeader, StatCard, StatsPanel, AsyncState, Section } from '@/components/atoms';
import { HBarDrilldown, ComboBarLine, type HBarRow } from '@/components/charts';
import { tidy } from '@/lib/labels';

const QUEUE_COLORS = ['#79CABD', '#6CA8FF', '#FFB36C', '#D99CFF', '#FF9CA8', '#9CE0C0', '#C0F4DE'];

// ── HTTP request metrics ──
interface HttpSummary { total: number; avg_ms: number; p95_ms: number; p99_ms: number; max_ms: number; errors: number; client_errors: number }
interface ByRoute { route: string; method: string; total: number; avg_ms: number; p95_ms: number; p99_ms: number; max_ms: number; errors: number; client_errors: number }
interface TimelinePoint { label: string; total: number; errors: number; avg_ms: number; p95_ms: number }
interface HttpResponse { summary: HttpSummary; byRoute: ByRoute[]; timeline: TimelinePoint[]; range: string }

// Endpoint table sort keys. Sorting client-side keeps every route in one table
// rather than needing a separate "slowest endpoints" view like the legacy page.
type SortKey = 'total' | 'avg_ms' | 'p95_ms' | 'p99_ms' | 'max_ms' | 'errors';
const SORT_LABELS: Record<SortKey, string> = {
	total: 'Requests', avg_ms: 'Avg', p95_ms: 'p95', p99_ms: 'p99', max_ms: 'Max', errors: 'Errors',
};
interface ErrorRow { method: string; route: string; status_code: number; error_message: string | null; created_at: string }

// ── Background job metrics (existing) ──
interface SummaryRow { metric_type: string; total_requests: string; avg_duration_ms: string; p95_duration_ms: string; max_duration_ms: number; success_count: string; error_count: string }
interface SlowestRow { metric_type: string; queue_name: string; entity_type: string | null; entity_id: string | null; entity_name?: string | null; duration_ms: number; completed_at: string }
interface PerfResponse { summary: SummaryRow[]; slowest: SlowestRow[]; range: string }

const RANGES = ['1h', '6h', '24h', '7d', '30d'] as const;
type Range = (typeof RANGES)[number];
const OBSERVABILITY_URL = 'https://supabase.com/dashboard/project/lipxxbmiusdluagossxa/advisors/performance';

type Health = { tone: 'unknown' | 'ok' | 'warn' | 'crit'; label: string; detail: string };
const HEALTH_TONE: Record<Health['tone'], { color: string; text: string }> = {
	unknown: { color: 'var(--fg-muted)', text: 'Unknown' },
	ok: { color: 'var(--pos)', text: 'Healthy' },
	warn: { color: 'var(--warn)', text: 'Degraded' },
	crit: { color: 'var(--neg)', text: 'Unhealthy' },
};
/** Roll error rate + tail latency into one verdict against the stated targets. */
function health(errRate: number, p95: number, total: number): Health {
	if (!total) return { tone: 'ok', label: 'No traffic', detail: 'Nothing recorded in this range yet.' };
	if (errRate > 1 || p95 > 2000) {
		return { tone: 'crit', label: 'Unhealthy', detail: errRate > 1 ? `5xx rate ${errRate.toFixed(2)}% is over the 1% ceiling` : `p95 ${Math.round(p95)}ms is over the 2s ceiling` };
	}
	if (errRate > 0.1 || p95 > 800) {
		return { tone: 'warn', label: 'Degraded', detail: errRate > 0.1 ? `5xx rate ${errRate.toFixed(2)}% is above the 0.1% target` : `p95 ${Math.round(p95)}ms is above the 800ms target` };
	}
	return { tone: 'ok', label: 'Healthy', detail: `5xx rate ${errRate.toFixed(2)}% and p95 ${Math.round(p95)}ms are both within target` };
}

// Method colours mirror common API-tool conventions so the verb reads at a glance.
const METHOD_TONE: Record<string, string> = {
	GET: 'var(--pos)', POST: '#6CA8FF', PATCH: 'var(--warn)', PUT: 'var(--warn)', DELETE: 'var(--neg)',
};

function ms(v: string | number | null): string {
	const n = typeof v === 'string' ? Number(v) : v;
	if (n == null || Number.isNaN(n)) return '—';
	if (n >= 1000) return `${(n / 1000).toFixed(2)}s`;
	return `${Math.round(n)}ms`;
}
// Latency benchmark coloring (generic HTTP targets).
function latColor(n: number, warn: number, crit: number): string | undefined {
	if (n >= crit) return 'var(--neg)';
	if (n >= warn) return 'var(--warn)';
	return 'var(--pos)';
}

export default function PerformancePage() {
	const [range, setRange] = useState<Range>('24h');
	const [errRoute, setErrRoute] = useState<string | 'all' | null>(null);
	const [routeQ, setRouteQ] = useState('');
	const [sortKey, setSortKey] = useState<SortKey>('total');

	// 60s refresh: this page re-renders two heavy payloads + hand-drawn charts +
	// a large route table each tick; 30s was needless churn for a monitoring view.
	const http = useSWR<HttpResponse>(['/api/admin/performance/http', { range }], { dedupingInterval: 15_000, refreshInterval: 60_000 });
	const { data, error, isLoading, mutate } = useSWR<PerfResponse>(['/api/admin/performance', { range }], { dedupingInterval: 15_000, refreshInterval: 60_000 });

	const h = http.data?.summary;
	const httpErrRate = h && h.total > 0 ? (h.errors / h.total) * 100 : 0;
	// A failed metrics query is not "no traffic": say we don't know.
	const hp: Health = http.error ? { tone: 'unknown', label: 'Unknown', detail: 'Could not load request metrics — retry, or check the API.' }
		: health(httpErrRate, h?.p95_ms ?? 0, h?.total ?? 0);
	const timelineChart = (http.data?.timeline ?? []).map((t) => ({ label: t.label, amt: t.total, deals: t.errors }));
	// Latency over time — bars are the average, the line traces p95 so a spike in
	// tail latency is visible even when the average stays flat.
	const latencyChart = (http.data?.timeline ?? []).map((t) => ({ label: t.label, amt: t.avg_ms, deals: t.p95_ms }));

	// Search + sort client-side over the routes the API returns (top 300 by volume).
	const allRoutes = http.data?.byRoute ?? [];
	// Scale the inline latency bars against the slowest route currently shown.
	const routes = allRoutes
		.filter((r) => !routeQ || r.route.toLowerCase().includes(routeQ.toLowerCase()) || r.method.toLowerCase() === routeQ.toLowerCase())
		.slice()
		.sort((a, b) => b[sortKey] - a[sortKey]);
	const worstP95 = routes.reduce((m, r) => Math.max(m, r.p95_ms), 0);

	const summary = data?.summary ?? [];
	const slowest = data?.slowest ?? [];
	const totalReq = summary.reduce((s, r) => s + Number(r.total_requests), 0);
	const totalSucc = summary.reduce((s, r) => s + Number(r.success_count), 0);
	const totalErr = summary.reduce((s, r) => s + Number(r.error_count), 0);
	const successRate = totalSucc + totalErr > 0 ? (totalSucc / (totalSucc + totalErr)) * 100 : 0;
	const weightedAvg = totalReq > 0 ? summary.reduce((s, r) => s + Number(r.avg_duration_ms) * Number(r.total_requests), 0) / totalReq : 0;
	const maxP95 = summary.reduce((m, r) => Math.max(m, Number(r.p95_duration_ms)), 0);

	const reqRows: HBarRow[] = summary.map((s, i) => ({ id: s.metric_type, label: s.metric_type, value: Number(s.total_requests), formatted: Number(s.total_requests).toLocaleString(), color: QUEUE_COLORS[i % QUEUE_COLORS.length] }));
	const p95Rows: HBarRow[] = [...summary].sort((a, b) => Number(b.p95_duration_ms) - Number(a.p95_duration_ms)).map((s, i) => ({ id: s.metric_type, label: s.metric_type, value: Number(s.p95_duration_ms), formatted: ms(s.p95_duration_ms), color: QUEUE_COLORS[i % QUEUE_COLORS.length] }));

	return (
		<div>
			<PageHeader kicker={`Operations · last ${range}`} title="Performance" subtitle="HTTP endpoint latency + background job throughput, refreshed every 60s." />

			<div className="filter-bar" style={{ marginBottom: 'var(--space-4)' }}>
				{RANGES.map((r) => (<button key={r} className={`chip ${range === r ? 'on' : ''}`} onClick={() => setRange(r)}>{r}</button>))}
				<div style={{ flex: 1 }} />
				<a className="btn ghost" href={OBSERVABILITY_URL} target="_blank" rel="noopener noreferrer"><ExternalLink size={12} /> Supabase observability</a>
			</div>

			{/* One-line verdict so the page answers "is anything wrong?" before the
			    reader has to compare four numbers against remembered thresholds. */}
			<div className="card" style={{
				marginBottom: 'var(--space-4)', padding: 'var(--space-4)',
				display: 'flex', alignItems: 'center', gap: 14,
				borderLeft: `3px solid ${HEALTH_TONE[hp.tone].color}`,
			}}>
				<span style={{ width: 10, height: 10, borderRadius: '50%', background: HEALTH_TONE[hp.tone].color, flex: '0 0 auto' }} />
				<div style={{ minWidth: 0 }}>
					<div style={{ fontWeight: 700, color: HEALTH_TONE[hp.tone].color }}>{hp.label}</div>
					<div style={{ fontSize: 12, color: 'var(--fg-muted)' }}>{hp.detail}</div>
				</div>
				<div style={{ flex: 1 }} />
				<div style={{ fontSize: 11, color: 'var(--fg-muted)', textAlign: 'right', lineHeight: 1.6 }}>
					Targets · avg &lt;300ms · p95 &lt;800ms · 5xx &lt;0.1%<br />
					Health probes and streaming routes excluded
				</div>
			</div>

			{/* ── HTTP requests ── */}
			<StatsPanel title="HTTP requests">
				<div className="grid-4">
					<StatCard label="Total requests" loading={http.isLoading} value={(h?.total ?? 0).toLocaleString()}
						sub={`${allRoutes.length}${allRoutes.length >= 300 ? '+' : ''} distinct endpoints`} />
					<StatCard label="Error rate (5xx)" loading={http.isLoading} value={`${httpErrRate.toFixed(2)}%`} urgent={httpErrRate > 1}
						sub={`${(h?.errors ?? 0).toLocaleString()} server · ${(h?.client_errors ?? 0).toLocaleString()} client (4xx)`} />
					<StatCard label="Avg latency" loading={http.isLoading} value={ms(h?.avg_ms ?? 0)} sub="target under 300ms" />
					<StatCard label="p95 / p99 latency" loading={http.isLoading} value={ms(h?.p95_ms ?? 0)}
						sub={`p99 ${ms(h?.p99_ms ?? 0)} · max ${ms(h?.max_ms ?? 0)}`} />
				</div>
			</StatsPanel>

{/* Side by side so a traffic spike and the latency spike it caused line up.
			    The legacy page selected avg latency per bucket but never plotted it. */}
			<div className="grid-2" style={{ marginBottom: 'var(--space-5)' }}>
				<Section title="Request volume & errors" meta={`bars = requests · line = 5xx`}>
					<AsyncState loading={http.isLoading} error={http.error} empty={timelineChart.length === 0} emptyMsg="No requests recorded in this range." onRetry={() => void http.mutate()}>
						<ComboBarLine data={timelineChart} height={210} valueFormatter={(v) => String(Math.round(v))} barLabel="Requests" lineLabel="errors" />
					</AsyncState>
				</Section>
				<Section title="Latency over time" meta={`bars = average · line = p95`}>
					<AsyncState loading={http.isLoading} error={http.error} empty={latencyChart.length === 0} emptyMsg="No requests recorded in this range." onRetry={() => void http.mutate()}>
						<ComboBarLine data={latencyChart} height={210} valueFormatter={(v) => ms(v)} lineFormatter={(v) => ms(v)} barLabel="Avg latency" lineLabel="p95" />
					</AsyncState>
				</Section>
			</div>

			<div className="card" style={{ marginTop: 'var(--space-4)', marginBottom: 'var(--space-5)' }}>
				<div style={{ padding: 'var(--space-4)', borderBottom: '1px solid var(--border)', fontWeight: 700, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
					<span>Endpoints <span style={{ fontWeight: 400, color: 'var(--fg-muted)', fontSize: 12 }}>
						· {routes.length} of {allRoutes.length} · sorted by {SORT_LABELS[sortKey].toLowerCase()} · green/amber/red = latency health</span></span>
					{(h?.errors ?? 0) > 0 && <button className="btn ghost" onClick={() => setErrRoute('all')}>View {h!.errors} errors</button>}
				</div>
				{/* Sorting by p95/p99 replaces the legacy "slowest endpoints" table: slow
				    low-traffic routes were invisible when this was capped at the top 50 by volume. */}
				<div style={{ padding: 'var(--space-3) var(--space-4)', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
					<input className="search-input" style={{ flex: '0 0 260px', height: 30 }} placeholder="Filter by route or method…"
						value={routeQ} onChange={(e) => setRouteQ(e.target.value)} />
					<span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>Sort</span>
					{(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
						<button key={k} className={`chip ${sortKey === k ? 'on' : ''}`} onClick={() => setSortKey(k)}>{SORT_LABELS[k]}</button>
					))}
				</div>
				<AsyncState loading={http.isLoading} error={http.error} empty={routes.length === 0} emptyMsg={routeQ ? 'No endpoints match that filter.' : 'No requests in this range.'} onRetry={() => void http.mutate()}>
					<table className="data-table">
						<thead><tr><th>Method</th><th>Route</th><th>Requests</th><th>Avg</th><th>p95</th><th>p99</th><th>Max</th><th>4xx</th><th>Errors</th></tr></thead>
						<tbody>
							{routes.map((r) => (
								<tr key={`${r.method}-${r.route}`}>
									<td><span className="tag" style={{ color: METHOD_TONE[r.method] ?? 'var(--fg-muted)', borderColor: 'currentColor' }}>{r.method}</span></td>
									<td style={{ fontFamily: 'var(--font-mono)', fontSize: 12, minWidth: 220 }}>
										<div>{r.route}</div>
										{/* p95 relative to the slowest route in view — turns the table
										    into a ranking you can scan without reading numbers. */}
										<div style={{ height: 3, borderRadius: 2, marginTop: 4, background: 'var(--grid-line)' }}>
											<div style={{
												width: `${Math.max(2, Math.min(100, (r.p95_ms / Math.max(1, worstP95)) * 100))}%`,
												height: '100%', borderRadius: 2,
												background: latColor(r.p95_ms, 800, 2000) ?? 'var(--pos)',
												transition: 'width .3s ease',
											}} />
										</div>
									</td>
									<td className="num">{r.total.toLocaleString()}</td>
									<td className="num" style={{ color: latColor(r.avg_ms, 300, 800) }}>{ms(r.avg_ms)}</td>
									<td className="num" style={{ color: latColor(r.p95_ms, 800, 2000) }}>{ms(r.p95_ms)}</td>
									<td className="num" style={{ color: latColor(r.p99_ms, 1500, 3000) }}>{ms(r.p99_ms)}</td>
									<td className="num">{ms(r.max_ms)}</td>
									<td className="num" style={{ color: 'var(--fg-muted)' }}>{r.client_errors > 0 ? r.client_errors.toLocaleString() : '—'}</td>
									<td className="num">{r.errors > 0 ? <button className="tag neg" style={{ border: 'none', cursor: 'pointer' }} onClick={() => setErrRoute(r.route)}>{r.errors}</button> : '—'}</td>
								</tr>
							))}
						</tbody>
					</table>
				</AsyncState>
			</div>

			{errRoute && <ErrorsModal range={range} route={errRoute === 'all' ? undefined : errRoute} onClose={() => setErrRoute(null)} />}

			{/* ── Background jobs ── */}
			<StatsPanel title="Background jobs">
				<div className="grid-4">
					<StatCard label="Total jobs" loading={isLoading} value={totalReq.toLocaleString()} />
					<StatCard label="Success rate" loading={isLoading} value={`${successRate.toFixed(1)}%`} urgent={successRate < 95 && totalReq > 0} />
					<StatCard label="Avg latency" loading={isLoading} value={ms(weightedAvg)} />
					<StatCard label="Worst p95" loading={isLoading} value={ms(maxP95)} />
				</div>
			</StatsPanel>

			<div className="grid-2" style={{ marginBottom: 'var(--space-5)' }}>
				<Section title="Throughput by queue" meta="jobs processed">
					<AsyncState loading={isLoading} error={error} empty={reqRows.length === 0} emptyMsg="No jobs in this range" onRetry={() => void mutate()}><HBarDrilldown rows={reqRows} /></AsyncState>
				</Section>
				<Section title="p95 latency by queue" meta="slowest queues first">
					<AsyncState loading={isLoading} error={error} empty={p95Rows.length === 0} emptyMsg="No jobs in this range" onRetry={() => void mutate()}><HBarDrilldown rows={p95Rows} /></AsyncState>
				</Section>
			</div>

			<div style={{ marginBottom: 'var(--space-4)' }}>
			<Section title="Job queues" meta={`${summary.length} active · last ${range}`} padded={false}>
				<AsyncState loading={isLoading} error={error} empty={summary.length === 0} emptyMsg="No jobs in this range" onRetry={() => void mutate()}>
					<table className="data-table">
						<thead><tr><th>Queue</th><th>Total</th><th>Succeeded</th><th>Errored</th><th>Avg</th><th>p95</th><th>Max</th></tr></thead>
						<tbody>
							{summary.map((s) => {
								const errors = Number(s.error_count);
								return (
									<tr key={s.metric_type}>
										<td>{s.metric_type}</td>
										<td className="num">{Number(s.total_requests).toLocaleString()}</td>
										<td className="num"><span className="tag pos">{Number(s.success_count).toLocaleString()}</span></td>
										<td className="num">{errors > 0 ? <span className="tag neg">{errors.toLocaleString()}</span> : '—'}</td>
										<td className="num">{ms(s.avg_duration_ms)}</td>
										<td className="num">{ms(s.p95_duration_ms)}</td>
										<td className="num">{ms(s.max_duration_ms)}</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</AsyncState>
			</Section>
			</div>

			<Section title="Slowest jobs" meta="longest single runs" padded={false}>
				<AsyncState loading={isLoading} error={error} empty={slowest.length === 0} emptyMsg="No completed jobs in this range" onRetry={() => void mutate()}>
					<table className="data-table">
						<thead><tr><th>Queue</th><th>Entity</th><th>Duration</th><th>Completed</th></tr></thead>
						<tbody>
							{slowest.map((r, i) => (
								<tr key={`${r.queue_name}-${i}`}>
									<td>{r.queue_name}</td>
									<td>{r.entity_type ? `${tidy(r.entity_type)}${r.entity_name ? ` · ${r.entity_name}` : r.entity_id ? ` · ${r.entity_id.slice(0, 8)}` : ''}` : '—'}</td>
									<td className="num">{ms(r.duration_ms)}</td>
									<td>{r.completed_at ? new Date(r.completed_at).toLocaleString() : '—'}</td>
								</tr>
							))}
						</tbody>
					</table>
				</AsyncState>
			</Section>
		</div>
	);
}

function ErrorsModal({ range, route, onClose }: { range: string; route?: string; onClose: () => void }) {
	const { data, isLoading, error, mutate } = useSWR<{ errors: ErrorRow[] }>(
		['/api/admin/performance/http/errors', { range, route }],
		{ dedupingInterval: 10_000 },
	);
	const errors = data?.errors ?? [];
	return (
		<Modal title={route ? `5xx errors · ${route}` : '5xx errors'} onClose={onClose} width={680} footer={<button className="btn ghost" onClick={onClose}>Close</button>}>
			<AsyncState loading={isLoading} error={error} empty={errors.length === 0} emptyMsg="No 5xx errors in this range." onRetry={() => void mutate()}>
				<table className="data-table">
					<thead><tr><th>When</th><th>Method</th><th>Route</th><th>Status</th><th>Message</th></tr></thead>
					<tbody>
						{errors.map((e, i) => (
							<tr key={i}>
								<td className="num">{new Date(e.created_at).toLocaleString()}</td>
								<td>{e.method}</td>
								<td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{e.route}</td>
								<td className="num"><span className="tag neg">{e.status_code}</span></td>
								<td style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={e.error_message ?? ''}>{e.error_message ?? '—'}</td>
							</tr>
						))}
					</tbody>
				</table>
			</AsyncState>
		</Modal>
	);
}
