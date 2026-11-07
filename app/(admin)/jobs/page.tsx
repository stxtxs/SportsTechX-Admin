'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { InvestorSelectOne } from '@/components/entity-pickers';
import { PageHeader, Section, StatCard, AsyncState, Tag, Pager } from '@/components/atoms';
import { StatStrip } from '@/components/filters';
import { useDebouncedValue } from '@/hooks/use-debounced-value';

interface JobRow {
	id: string; queue_name: string; job_name: string | null; status: string;
	attempt: number; max_attempts: number;
	enqueued_at: string | null; started_at: string | null; completed_at: string | null;
	entity_type: string | null; entity_id: string | null;
	last_error: string | null; created_at: string; duration_s: number | null;
}
interface QueueRow {
	queue_name: string; total: number; completed: number; failed: number;
	open: number; last_run: string | null; avg_s: number | null;
}
interface HistoryResp {
	rows: JobRow[];
	by_status: Array<{ status: string; count: number }>;
	by_queue: QueueRow[];
	page: number;
	total: number;
	totalPages: number;
}

const STATUS_TONE: Record<string, '' | 'pos' | 'neg' | 'warn'> = {
	completed: 'pos', failed: 'neg', stuck: 'neg', pending: 'warn', running: '',
};
const secs = (n: number | null): string => {
	if (n == null) return '—';
	if (n < 60) return `${n}s`;
	if (n < 3600) return `${Math.round(n / 60)}m`;
	return `${(n / 3600).toFixed(1)}h`;
};
const when = (v: string | null): string => (v ? new Date(v).toLocaleString() : '—');

type EndpointKey = 'apolloBatch' | 'attioSync' | 'recommendations' | 'apolloEnrich' | 'digestEmail' | 'slackDigest' | 'sweepStuck' | 'embedReports' | 'companySignals';

const ENDPOINTS: Array<{ key: EndpointKey; label: string; desc: string; path: string; needsId?: boolean }> = [
	{
		key: 'apolloBatch',
		label: 'Apollo nightly batch',
		desc: 'Kick the Apollo enrichment batch sweep.',
		path: '/api/admin/integrations/apollo/batch',
	},
	{
		key: 'apolloEnrich',
		label: 'Apollo enrich investor',
		desc: 'Manually enrich a single investor — search and pick below.',
		path: '/api/admin/integrations/apollo/enrich',
		needsId: true,
	},
	{
		key: 'attioSync',
		label: 'Attio CRM sync',
		desc: 'Sync companies, investors, deals to Attio CRM now.',
		path: '/api/admin/integrations/attio/sync',
	},
	{
		key: 'recommendations',
		label: 'Recompute recommendations',
		desc: 'Re-score the recommendation engine immediately.',
		path: '/api/admin/jobs/recommendations/score',
	},
	{
		key: 'digestEmail',
		label: 'Send digest emails',
		desc: 'Run the digest-email job now (otherwise daily at 09:00 UTC).',
		path: '/api/admin/jobs/digest-email',
	},
	{
		key: 'slackDigest',
		label: 'Post Slack digest',
		desc: 'Post the signups + activity digest to #atlas-updates now (otherwise daily at 09:00 Berlin).',
		path: '/api/admin/jobs/slack-digest',
	},
	{
		// POST /api/admin/embeddings/backfill-reports had no UI anywhere in the panel.
		key: 'embedReports',
		label: 'Backfill report embeddings',
		desc: 'Re-embed every published report so semantic search and chat can find them.',
		path: '/api/admin/embeddings/backfill-reports',
	},
	{
		// Same shape as the jobs above and simply missed. Worth a manual trigger
		// because the first run over ~7,400 deals is the one that makes the
		// Scout Signals feed non-empty — otherwise it stays blank for an hour.
		key: 'companySignals',
		label: 'Derive company signals',
		desc: 'Rebuild the Scout signals feed now (otherwise hourly at :40).',
		path: '/api/admin/jobs/company-signals',
	},
	{
		key: 'sweepStuck',
		label: 'Sweep stuck jobs',
		desc: 'Re-queue jobs stuck past their timeout (otherwise every 5 min).',
		path: '/api/admin/jobs/sweep-stuck',
	},
];

export default function JobsPage() {
	const [enrichId, setEnrichId] = useState('');
	const [runningKey, setRunningKey] = useState<EndpointKey | null>(null);
	const [status, setStatus] = useState<string>('');
	const [q, setQ] = useState('');
	const [page, setPage] = useState(1);
	const dq = useDebouncedValue(q);

	const history = useSWR<HistoryResp>(
		['/api/admin/jobs/history', { status: status || undefined, q: dq || undefined, page, limit: 50 }],
		{ dedupingInterval: 15_000, refreshInterval: 60_000 },
	);
	const rows = history.data?.rows ?? [];
	const byStatus = history.data?.by_status ?? [];
	const byQueue = history.data?.by_queue ?? [];
	const openCount = byStatus.filter((b) => b.status !== 'completed').reduce((n, b) => n + b.count, 0);
	const total = byStatus.reduce((n, b) => n + b.count, 0);
	const lastActivity = byQueue.reduce<string | null>(
		(max, q) => (q.last_run && (!max || q.last_run > max) ? q.last_run : max), null);

	const run = async (endpoint: typeof ENDPOINTS[number]) => {
		setRunningKey(endpoint.key);
		try {
			const path = endpoint.needsId ? `${endpoint.path}/${enrichId}` : endpoint.path;
			// Not every job endpoint returns a job-log id — the embeddings backfill
			// reports a count instead, and blind .slice() on it would throw.
			const res = await api<{ jobLogId?: string; bullJobId?: string | null; enqueued?: number }>('POST', path);
			const detail = res.jobLogId ? `job ${res.jobLogId.slice(0, 8)}`
				: res.enqueued != null ? `${res.enqueued} queued`
				: 'queued';
			toast.success(`${endpoint.label}: ${detail}`);
			void history.mutate();
		} catch (e) {
			toast.error((e as Error).message);
		} finally {
			setRunningKey(null);
		}
	};

	return (
		<div>
			<PageHeader
				kicker={`Operations · ${ENDPOINTS.length} manual jobs`}
				title="Jobs & integrations"
				subtitle="Trigger background work on demand, and see what every queue has actually been doing."
			/>

			<StatStrip cols={4}>
				<StatCard label="Job runs recorded" loading={history.isLoading} value={total.toLocaleString()} />
				<StatCard label="Not completed" loading={history.isLoading} value={openCount.toLocaleString()}
					urgent={openCount > 0} sub="pending, running or stuck" />
				<StatCard label="Queues seen" loading={history.isLoading} value={byQueue.length.toLocaleString()} />
				{/* From the unfiltered per-queue rollup — rows[] is status-filtered, so
				    using it made this KPI jump when a status chip was clicked. */}
				<StatCard label="Last activity" loading={history.isLoading}
					value={lastActivity ? new Date(lastActivity).toLocaleDateString() : '—'} />
			</StatStrip>

			<div className="grid-2">
				{ENDPOINTS.map((e) => (
					<div key={e.key} className="card" style={{ padding: 'var(--space-4)' }}>
						<div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>{e.label}</div>
						<div style={{ fontSize: 13, color: 'var(--fg-2)', marginBottom: 14 }}>{e.desc}</div>
						{e.needsId && (
							<div style={{ marginBottom: 10 }}>
								<InvestorSelectOne value={enrichId} onChange={setEnrichId} />
							</div>
						)}
						<button
							className="btn"
							disabled={runningKey === e.key || (e.needsId && !enrichId)}
							onClick={() => void run(e)}
						>
							{runningKey === e.key ? 'Queuing…' : 'Run now'}
						</button>
					</div>
				))}
			</div>

			{/* job_log already recorded every run; the page just never showed it, so
			    jobs sitting pending for weeks were invisible. */}
			<div style={{ marginTop: 'var(--space-5)', marginBottom: 'var(--space-4)' }}>
				<Section title="Queue health" meta="all recorded runs per queue" padded={false}>
					<AsyncState loading={history.isLoading} error={history.error} empty={byQueue.length === 0}
						emptyMsg="No job runs recorded yet." onRetry={() => void history.mutate()}>
						<div className="table-scroll">
							<table className="data-table">
								<thead><tr>
									<th>Queue</th>
									<th style={{ textAlign: 'right' }}>Runs</th>
									<th style={{ textAlign: 'right' }}>Completed</th>
									<th style={{ textAlign: 'right' }}>Open</th>
									<th style={{ textAlign: 'right' }}>Avg time</th>
									<th>Last run</th>
								</tr></thead>
								<tbody>
									{byQueue.map((q) => (
										<tr key={q.queue_name}>
											<td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{q.queue_name}</td>
											<td className="num" style={{ textAlign: 'right' }}>{q.total.toLocaleString()}</td>
											<td className="num" style={{ textAlign: 'right', color: 'var(--pos)' }}>{q.completed.toLocaleString()}</td>
											<td className="num" style={{ textAlign: 'right', color: q.open > 0 ? 'var(--accent)' : 'var(--fg-muted)' }}>
												{q.open > 0 ? q.open.toLocaleString() : '—'}
											</td>
											<td className="num" style={{ textAlign: 'right', color: 'var(--fg-muted)' }}>{secs(q.avg_s == null ? null : Math.round(q.avg_s))}</td>
											<td className="num">{when(q.last_run)}</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					</AsyncState>
				</Section>
			</div>

			<Section title="Recent runs" meta={`${history.data?.total ?? 0} runs · refreshes every 30s`} padded={false}>
				<div style={{ padding: 'var(--space-3) var(--space-4)', borderBottom: '1px solid var(--border)', display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
					<input className="search-input" style={{ flex: '0 0 220px', height: 30 }} placeholder="Search queue, job or entity id…"
						value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
					<span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>Status</span>
					<button className={`chip ${status === '' ? 'on' : ''}`} onClick={() => { setStatus(''); setPage(1); }}>All</button>
					{byStatus.map((b) => (
						<button key={b.status} className={`chip ${status === b.status ? 'on' : ''}`} onClick={() => { setStatus(b.status); setPage(1); }}>
							{b.status}: {b.count}
						</button>
					))}
				</div>
				<AsyncState loading={history.isLoading} error={history.error} empty={rows.length === 0}
					emptyMsg={status ? `No ${status} jobs.` : 'No job runs recorded yet.'} onRetry={() => void history.mutate()}>
					<div className="table-scroll">
						<table className="data-table">
							<thead><tr>
								<th>Queue</th><th>Status</th><th style={{ textAlign: 'right' }}>Attempt</th>
								<th style={{ textAlign: 'right' }}>Duration</th><th>Queued</th><th>Error</th>
							</tr></thead>
							<tbody>
								{rows.map((r) => (
									<tr key={r.id}>
										<td>
											<div style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{r.queue_name}</div>
											{r.entity_type && (
												<div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
													{r.entity_type}{r.entity_id ? ` · ${r.entity_id.slice(0, 8)}` : ''}
												</div>
											)}
										</td>
										<td><Tag variant={STATUS_TONE[r.status] ?? ''}>{r.status}</Tag></td>
										<td className="num" style={{ textAlign: 'right', color: r.attempt > 1 ? 'var(--warn)' : 'var(--fg-muted)' }}>
											{r.attempt}/{r.max_attempts}
										</td>
										<td className="num" style={{ textAlign: 'right' }}>{secs(r.duration_s)}</td>
										<td className="num" style={{ whiteSpace: 'nowrap' }}>{when(r.created_at)}</td>
										<td style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: r.last_error ? 'var(--neg)' : 'var(--fg-muted)' }}
											title={r.last_error ?? ''}>
											{r.last_error ?? '—'}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</AsyncState>
				<Pager page={page} totalPages={history.data?.totalPages} onPage={setPage} />
			</Section>
		</div>
	);
}
