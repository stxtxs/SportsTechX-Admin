'use client';

import { useMemo, useState } from 'react';
import useSWR from 'swr';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Receipt, RefreshCw, Save, Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader, StatCard, StatsPanel, Section, AsyncState, Pager, SortableTh } from '@/components/atoms';
import { FilterBar, FilterSelect } from '@/components/filters';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useUrlState, useUrlNumber } from '@/hooks/use-url-state';
import { aiProviderLabel, tidy, tierLabel } from '@/lib/labels';
import { ComboBarLine } from '@/components/charts';

/**
 * AI usage & cost ledger.
 *
 * Reads two admin endpoints:
 *   GET /api/admin/ai-usage/summary  → { totals, byFeature, byDay }
 *   GET /api/admin/ai-usage/recent   → recent ledger rows
 *
 * Every Anthropic + Voyage call writes a ledger row (see AiUsageService.record).
 * `credited` = the user's credits were charged; uncredited spend is company-borne
 * (admin/background jobs, embeddings, report generation).
 */

interface Totals {
	total_usd: string;
	calls: string;
	credited_usd: string;
	uncredited_usd: string;
	credits_charged: string;
}
interface FeatureRow {
	feature: string;
	label?: string;
	provider: string;
	calls: number;
	usd: string;
	tokens: string;
}
interface DayRow { day: string; usd: string }
interface ModelRow { provider: string; model: string; calls: number; usd: string; tokens: string }
interface UserRow {
	profile_id: string | null; profile_name: string | null; profile_email: string | null;
	profile_tier: string | null; profile_is_admin: boolean | null;
	calls: number; usd: string; credited_usd: string; uncredited_usd: string; credits_charged: string;
}
interface Summary {
	totals: Totals; byFeature: FeatureRow[]; byDay: DayRow[];
	byModel: ModelRow[]; byUser: UserRow[];
}

// The summary endpoint has always accepted from/to; the page just never sent them.
const RANGES = [
	{ key: '7d', label: '7 days', days: 7 },
	{ key: '30d', label: '30 days', days: 30 },
	{ key: '90d', label: '90 days', days: 90 },
	{ key: 'all', label: 'All time', days: 3650 },
] as const;
type RangeKey = (typeof RANGES)[number]['key'];

interface LedgerRow {
	id: string;
	feature: string;
	feature_label?: string;
	provider: string;
	model: string;
	input_tokens: number;
	output_tokens: number;
	cache_read_tokens: number;
	cache_write_tokens: number;
	usd_cost: string;
	profile_id: string | null;
	profile_name: string | null;
	profile_email: string | null;
	profile_tier: string | null;
	profile_is_admin: boolean | null;
	credited: boolean;
	credits_charged: number;
	ref_entity_type: string | null;
	ref_entity_id: string | null;
	created_at: string;
}

const usd = (v: string | number | undefined) =>
	`$${Number(v ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
const num = (v: string | number | undefined) => Number(v ?? 0).toLocaleString();

/** Client-side sort for the summary tables (every row is already loaded). "-key" = descending. */
function sortRows<T>(rows: T[], sort: string, get: Record<string, (r: T) => string | number>): T[] {
	const fn = get[sort.replace(/^-/, '')];
	if (!fn) return rows;
	const dir = sort.startsWith('-') ? -1 : 1;
	return [...rows].sort((a, b) => {
		const x = fn(a), y = fn(b);
		return dir * (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y)));
	});
}
const userName = (u: { profile_id: string | null; profile_name: string | null; profile_email: string | null }) =>
	u.profile_id ? (u.profile_name || u.profile_email || 'Deleted user') : 'system / background';

export default function AiUsagePage() {
	const router = useRouter();
	const [rangeRaw, setRange] = useUrlState('ai', 'range', '30d');
	const range = (RANGES.some((r) => r.key === rangeRaw) ? rangeRaw : '30d') as RangeKey;
	const days = RANGES.find((r) => r.key === range)?.days ?? 30;
	// Must be memoised on the range: Date.now() changes every render, so an inline
	// value makes a fresh SWR key each time and the request never settles.
	// Snapped to the hour so a remount inside the same hour still hits the cache.
	const from = useMemo(
		() => new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000 - days * 86_400_000).toISOString(),
		[days],
	);
	const { data: summary, mutate: mutateSummary, isLoading, error } = useSWR<Summary>(
		['/api/admin/ai-usage/summary', { from }],
		{ dedupingInterval: 30_000 },
	);
	const [recentQ, setRecentQ] = useUrlState('ai', 'q');
	const [credited, setCredited] = useUrlState('ai', 'credited');
	const [recentSort, setRecentSort] = useUrlState('ai', 'sort', '-when');
	const [recentPage, setRecentPage] = useUrlNumber('ai', 'page', 1);
	const recentDq = useDebouncedValue(recentQ.trim());
	const { data: recent, mutate: mutateRecent } = useSWR<{ data: LedgerRow[]; total: number; page: number; totalPages: number }>(
		['/api/admin/ai-usage/recent', { q: recentDq || undefined, credited, sort: recentSort, page: recentPage, limit: 25 }],
		{ dedupingInterval: 30_000 },
	);
	const recentRows = recent?.data ?? [];
	/** Set a recent-calls filter/sort and go back to page 1. */
	const rf = (set: (v: string) => void) => (v: string) => { set(v); setRecentPage(1); };
	const recentActive = (recentQ ? 1 : 0) + (credited ? 1 : 0);

	// Summary tables are small and fully loaded: sorted (and the user table searched) in the browser.
	const [featureSort, setFeatureSort] = useUrlState('ai', 'fsort', '-cost');
	const [modelSort, setModelSort] = useUrlState('ai', 'msort', '-cost');
	const [userSort, setUserSort] = useUrlState('ai', 'usort', '-cost');
	const [userQ, setUserQ] = useUrlState('ai', 'uq');

	const t = summary?.totals;
	const spendChart = (summary?.byDay ?? []).map((d) => {
		const v = Number(d.usd);
		return { label: new Date(d.day).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), amt: v, deals: v };
	});
	const byFeature = sortRows(summary?.byFeature ?? [], featureSort, {
		feature: (r) => (r.label ?? r.feature).toLowerCase(), calls: (r) => Number(r.calls), tokens: (r) => Number(r.tokens), cost: (r) => Number(r.usd),
	});
	const byModel = sortRows(summary?.byModel ?? [], modelSort, {
		model: (m) => m.model.toLowerCase(), calls: (m) => Number(m.calls), tokens: (m) => Number(m.tokens), cost: (m) => Number(m.usd),
	});
	const uq = userQ.trim().toLowerCase();
	const byUser = sortRows(
		(summary?.byUser ?? []).filter((u) => !uq || `${u.profile_name ?? ''} ${u.profile_email ?? ''}`.toLowerCase().includes(uq)),
		userSort,
		{ user: (u) => userName(u).toLowerCase(), calls: (u) => Number(u.calls), cost: (u) => Number(u.usd), unrecovered: (u) => Number(u.uncredited_usd) },
	);
	const refresh = () => { void mutateSummary(); void mutateRecent(); };

	return (
		<div>
			<PageHeader
				kicker={`Operations · last ${RANGES.find((r) => r.key === range)?.label.toLowerCase()}`}
				title="AI usage & cost ledger"
				subtitle="Token spend across every Anthropic + Voyage call. Credited = charged to the user's credits; uncredited = company-borne (embeddings, report generation, background jobs). Edit model pricing and the credit conversion rate below."
			/>

			<div className="filter-bar" style={{ marginBottom: 'var(--space-4)' }}>
				{RANGES.map((r) => (
					<button key={r.key} className={`chip ${range === r.key ? 'on' : ''}`} onClick={() => setRange(r.key)}>{r.label}</button>
				))}
				<div style={{ flex: 1 }} />
				<button className="btn ghost" onClick={refresh}><RefreshCw size={12} /> Refresh</button>
			</div>

			{/* Stat cards */}
			<StatsPanel>
				<div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 'var(--space-3)' }}>
					<StatCard label="Total spend" value={usd(t?.total_usd)} loading={isLoading} />
					<StatCard label="Credited (user-paid)" value={usd(t?.credited_usd)} loading={isLoading} />
					<StatCard label="Uncredited (company)" value={usd(t?.uncredited_usd)} urgent loading={isLoading}
						sub={t ? `${((Number(t.uncredited_usd) / Math.max(Number(t.total_usd), 1e-9)) * 100).toFixed(0)}% of spend not recovered` : undefined} />
					<StatCard label="AI calls" value={num(t?.calls)} loading={isLoading} />
					<StatCard label="Credits charged" value={num(t?.credits_charged)} loading={isLoading} />
				</div>
			</StatsPanel>

			{/* Cost configuration */}
			<PricingConfig />

			{/* byDay was already computed server-side and shipped to the client on every
			    load; nothing rendered it, so the cost trend was invisible. */}
			<div style={{ marginBottom: 'var(--space-4)' }}>
				<Section title="Spend over time" meta="USD per day">
					<AsyncState loading={isLoading} error={error} empty={spendChart.length === 0}
						emptyMsg="No AI spend recorded in this range." onRetry={() => void mutateSummary()}>
						<ComboBarLine data={spendChart} height={200} minBand={spendChart.length > 45 ? 14 : 0}
							valueFormatter={(v) => usd(v)} lineFormatter={(v) => usd(v)}
							barLabel="Spend" lineLabel="spend" />
					</AsyncState>
				</Section>
			</div>

			{/* By feature */}
			<div className="card" style={{ padding: 'var(--space-4)', marginBottom: 'var(--space-4)' }}>
				<div style={{ fontWeight: 700, marginBottom: 10 }}>Spend by feature</div>
				<table className="data-table">
					<thead>
						<tr>
							<SortableTh label="Feature" field="feature" sort={featureSort} onSort={setFeatureSort} />
							<th>Provider</th>
							<SortableTh label="Calls" field="calls" sort={featureSort} onSort={setFeatureSort} />
							<SortableTh label="Tokens" field="tokens" sort={featureSort} onSort={setFeatureSort} />
							<SortableTh label="Cost" field="cost" sort={featureSort} onSort={setFeatureSort} />
						</tr>
					</thead>
					<tbody>
						{byFeature.map((r) => (
							<tr key={`${r.feature}:${r.provider}`}>
								<td title={r.feature}>{r.label ?? tidy(r.feature)}</td>
								<td style={{ color: 'var(--fg-muted)' }}>{aiProviderLabel(r.provider)}</td>
								<td className="num">{num(r.calls)}</td>
								<td className="num">{num(r.tokens)}</td>
								<td className="num">{usd(r.usd)}</td>
							</tr>
						))}
						{(summary?.byFeature?.length ?? 0) === 0 && (
							<tr><td colSpan={5} style={{ color: 'var(--fg-muted)' }}>No AI usage recorded yet.</td></tr>
						)}
					</tbody>
				</table>
			</div>

			{/* Model pricing is editable above, but nothing showed what each model
			    actually costs — nor which users drive the uncredited majority. */}
			<div className="grid-2" style={{ marginBottom: 'var(--space-4)' }}>
				<Section title="Spend by model" meta="rates editable above" padded={false}>
					<AsyncState loading={isLoading} error={error} empty={byModel.length === 0} emptyMsg="No AI usage in this range." onRetry={() => void mutateSummary()}>
						<table className="data-table">
							<thead>
								<tr>
									<SortableTh label="Model" field="model" sort={modelSort} onSort={setModelSort} />
									<SortableTh label="Calls" field="calls" sort={modelSort} onSort={setModelSort} align="right" />
									<SortableTh label="Tokens" field="tokens" sort={modelSort} onSort={setModelSort} align="right" />
									<SortableTh label="Cost" field="cost" sort={modelSort} onSort={setModelSort} align="right" />
								</tr>
							</thead>
							<tbody>
								{byModel.map((m) => (
									<tr key={`${m.provider}:${m.model}`}>
										<td>
											<div style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{m.model}</div>
											<div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{aiProviderLabel(m.provider)}</div>
										</td>
										<td className="num" style={{ textAlign: 'right' }}>{num(m.calls)}</td>
										<td className="num" style={{ textAlign: 'right', color: 'var(--fg-muted)' }}>{num(m.tokens)}</td>
										<td className="num" style={{ textAlign: 'right', fontWeight: 600 }}>{usd(m.usd)}</td>
									</tr>
								))}
							</tbody>
						</table>
					</AsyncState>
				</Section>

				<Section title="Spend by user" meta="top 50 by cost · who drives the cost" padded={false}>
					<div style={{ padding: 'var(--space-3) var(--space-4)', borderBottom: '1px solid var(--border)' }}>
						<input className="search-input" style={{ height: 30, width: 240, maxWidth: '100%' }} placeholder="Search name or email (top 50)…"
							value={userQ} onChange={(e) => setUserQ(e.target.value)} aria-label="Search users by spend" />
					</div>
					<AsyncState loading={isLoading} error={error} empty={byUser.length === 0} emptyMsg={uq ? 'No user in the top 50 matches.' : 'No AI usage in this range.'} onRetry={() => void mutateSummary()}>
						<div className="table-scroll">
							<table className="data-table">
								<thead>
									<tr>
										<SortableTh label="User" field="user" sort={userSort} onSort={setUserSort} />
										<SortableTh label="Calls" field="calls" sort={userSort} onSort={setUserSort} align="right" />
										<SortableTh label="Cost" field="cost" sort={userSort} onSort={setUserSort} align="right" />
										<SortableTh label="Unrecovered" field="unrecovered" sort={userSort} onSort={setUserSort} align="right" />
									</tr>
								</thead>
								<tbody>
									{byUser.map((u) => (
										<tr key={u.profile_id ?? 'system'}>
											<td>
												{u.profile_id ? (
													<>
														<div>{userName(u)}</div>
														<div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
															{u.profile_is_admin ? 'Admin' : tierLabel(u.profile_tier ?? 'explore')}
														</div>
													</>
												) : <span style={{ color: 'var(--fg-muted)' }}>system / background</span>}
											</td>
											<td className="num" style={{ textAlign: 'right' }}>{num(u.calls)}</td>
											<td className="num" style={{ textAlign: 'right', fontWeight: 600 }}>{usd(u.usd)}</td>
											<td className="num" style={{ textAlign: 'right', color: Number(u.uncredited_usd) > 0 ? 'var(--accent)' : 'var(--fg-muted)' }}>
												{usd(u.uncredited_usd)}
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					</AsyncState>
				</Section>
			</div>

			{/* Recent rows — one per LLM call, the highest-velocity table here. */}
			<Section title="Recent calls" meta={`${(recent?.total ?? 0).toLocaleString()} call${recent?.total === 1 ? '' : 's'}${recentActive ? ' match' : ''} · all time`} padded={false}>
				<div style={{ padding: 'var(--space-3) var(--space-4) 0', borderBottom: '1px solid var(--border)' }}>
					<FilterBar>
						<input className="search-input" style={{ flex: '0 0 260px', height: 32, maxWidth: '100%' }} placeholder="Search feature, model, user name or email…"
							value={recentQ} onChange={(e) => rf(setRecentQ)(e.target.value)} aria-label="Search calls" />
						<FilterSelect ariaLabel="Credited" value={credited} onChange={rf(setCredited)} allLabel="Credited or not"
							options={[{ value: 'yes', label: 'Charged to the user' }, { value: 'no', label: 'Company-borne' }]} />
						{recentActive > 0 && <button className="btn ghost" onClick={() => { setRecentQ(''); setCredited(''); setRecentPage(1); }}>Clear {recentActive} filter{recentActive === 1 ? '' : 's'}</button>}
					</FilterBar>
				</div>
				<div style={{ overflowX: 'auto' }}>
					<table className="data-table">
						<thead>
							<tr>
								<SortableTh label="When" field="when" sort={recentSort} onSort={rf(setRecentSort)} />
								<SortableTh label="Feature" field="feature" sort={recentSort} onSort={rf(setRecentSort)} />
								<SortableTh label="Model" field="model" sort={recentSort} onSort={rf(setRecentSort)} />
								<SortableTh label="In" field="in" sort={recentSort} onSort={rf(setRecentSort)} />
								<SortableTh label="Out" field="out" sort={recentSort} onSort={rf(setRecentSort)} />
								<SortableTh label="Cost" field="cost" sort={recentSort} onSort={rf(setRecentSort)} />
								<SortableTh label="Credited" field="credits" sort={recentSort} onSort={rf(setRecentSort)} />
								<SortableTh label="User" field="user" sort={recentSort} onSort={rf(setRecentSort)} />
							</tr>
						</thead>
						<tbody>
							{recentRows.map((r) => (
								<tr key={r.id}>
									<td style={{ whiteSpace: 'nowrap', color: 'var(--fg-muted)', fontSize: 12 }}>
										{new Date(r.created_at).toLocaleString()}
									</td>
									<td title={r.feature}>{r.feature_label ?? tidy(r.feature)}</td>
									<td style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{r.model}</td>
									<td className="num">{num(r.input_tokens)}</td>
									<td className="num">{num(r.output_tokens)}</td>
									<td className="num">{usd(r.usd_cost)}</td>
									<td>
										{r.credited
											? <span className="chip on">{r.credits_charged} cr</span>
											: <span style={{ color: 'var(--fg-muted)' }}>—</span>}
									</td>
									<td>
										<UserCell row={r} router={router} />
									</td>
								</tr>
							))}
							{recentRows.length === 0 && (
								<tr><td colSpan={8} style={{ color: 'var(--fg-muted)' }}>{recentActive ? 'No calls match.' : 'No calls yet.'}</td></tr>
							)}
						</tbody>
					</table>
				</div>
				<div style={{ padding: '0 var(--space-4)' }}>
					<Pager page={recentPage} totalPages={recent?.totalPages} onPage={setRecentPage} />
				</div>
			</Section>
		</div>
	);
}

/**
 * User column: name + a badge (Admin, or plan tier — a "free" tier spending
 * credits is using top-up/granted credits). Clicking opens the user in the
 * admin Users page (filtered + expanded).
 */
function UserCell({ row, router }: { row: LedgerRow; router: ReturnType<typeof useRouter> }) {
	if (!row.profile_id) return <span style={{ color: 'var(--fg-muted)', fontSize: 12 }}>system</span>;

	const name = row.profile_name || row.profile_email || 'Deleted user';
	const isAdmin = !!row.profile_is_admin;
	const tier = (row.profile_tier ?? 'explore').toLowerCase();
	const badge = isAdmin ? 'Admin' : tier === 'explore' ? 'Explore · top-up/granted' : tierLabel(tier);
	const badgeColor = isAdmin ? 'var(--accent)' : tier === 'explore' ? 'var(--fg-muted)' : 'var(--fg-2)';

	const open = () => {
		const params = new URLSearchParams();
		params.set('q', row.profile_email ?? row.profile_id!);
		params.set('focus', row.profile_id!);
		router.push(`/users?${params.toString()}`);
	};

	return (
		<button
			onClick={open}
			title="Open in Users"
			style={{ background: 'transparent', border: 0, padding: 0, cursor: 'pointer', textAlign: 'left', maxWidth: 200 }}
		>
			<div style={{ fontSize: 12, color: 'var(--accent)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
			<div style={{ fontSize: 10, color: badgeColor, textTransform: 'capitalize' }}>{badge}</div>
		</button>
	);
}

// ─── Cost configuration: model pricing ($/MTok) + credit conversion rate ──────

interface PricingModel {
	id: string;
	provider: string;
	model: string;
	input_usd_per_mtok: string;
	output_usd_per_mtok: string;
	cache_read_usd_per_mtok: string;
	cache_write_usd_per_mtok: string;
	is_active: boolean;
}
interface PricingConfigResp { models: PricingModel[]; usd_per_credit: number }

const BLANK_MODEL: PricingModel = {
	id: '', provider: 'anthropic', model: '',
	input_usd_per_mtok: '0', output_usd_per_mtok: '0',
	cache_read_usd_per_mtok: '0', cache_write_usd_per_mtok: '0', is_active: true,
};

function PricingConfig() {
	const { data, mutate, isLoading } = useSWR<PricingConfigResp>(['/api/admin/ai-usage/pricing'], { dedupingInterval: 30_000 });
	const [rate, setRate] = useState('');
	const [savingRate, setSavingRate] = useState(false);
	const [adding, setAdding] = useState(false);

	const effectiveRate = rate !== '' ? rate : String(data?.usd_per_credit ?? '');

	const saveRate = async () => {
		const v = Number(effectiveRate);
		if (!Number.isFinite(v) || v <= 0) { toast.error('Enter a positive USD-per-credit value'); return; }
		setSavingRate(true);
		try { await api('PATCH', '/api/admin/ai-usage/credit-rate', { usd_per_credit: v }); toast.success('Credit rate saved'); setRate(''); void mutate(); }
		catch (e) { toast.error((e as Error).message); }
		finally { setSavingRate(false); }
	};

	return (
		<div className="card" style={{ padding: 'var(--space-4)', marginBottom: 'var(--space-4)' }}>
			<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
				<div style={{ fontWeight: 700 }}>Cost configuration</div>
				<button className="btn ghost" onClick={() => setAdding((a) => !a)}><Plus size={12} /> Add model</button>
			</div>

			{/* Credit conversion rate — the margin lever */}
			<div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
				<span style={{ fontSize: 13, color: 'var(--fg-2)' }}>USD per credit</span>
				<input
					className="search-input" style={{ width: 120, height: 30 }} type="number" step="0.0001" min="0"
					value={effectiveRate} onChange={(e) => setRate(e.target.value)} disabled={isLoading}
				/>
				<button className="btn" disabled={savingRate} onClick={() => void saveRate()}><Save size={12} /> Save rate</button>
				<span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
					Lower rate = more credits charged per $ of tokens (higher margin). Applies to new calls within ~minutes.
				</span>
			</div>

			<div style={{ overflowX: 'auto' }}>
				<table className="data-table">
					<thead>
						<tr>
							<th>Provider</th><th>Model</th>
							<th>Input $/M</th><th>Output $/M</th><th>Cache-read $/M</th><th>Cache-write $/M</th>
							<th>Active</th><th></th>
						</tr>
					</thead>
					<tbody>
						{adding && <ModelRow key="__new" initial={BLANK_MODEL} isNew onSaved={() => { setAdding(false); void mutate(); }} />}
						{(data?.models ?? []).map((m) => <ModelRow key={m.id} initial={m} onSaved={() => void mutate()} />)}
						{!isLoading && (data?.models?.length ?? 0) === 0 && !adding && (
							<tr><td colSpan={8} style={{ color: 'var(--fg-muted)' }}>No models priced yet.</td></tr>
						)}
					</tbody>
				</table>
			</div>
		</div>
	);
}

function ModelRow({ initial, isNew, onSaved }: { initial: PricingModel; isNew?: boolean; onSaved: () => void }) {
	const [m, setM] = useState<PricingModel>(initial);
	const [saving, setSaving] = useState(false);
	const set = (k: keyof PricingModel, v: string | boolean) => setM((p) => ({ ...p, [k]: v }));
	const numInput = (k: keyof PricingModel) => (
		<input
			className="search-input" style={{ width: 90, height: 28 }} type="number" step="0.01" min="0"
			value={m[k] as string} onChange={(e) => set(k, e.target.value)}
		/>
	);
	const save = async () => {
		if (!m.model.trim() || !m.provider.trim()) { toast.error('Provider and model are required'); return; }
		setSaving(true);
		try {
			await api('PATCH', '/api/admin/ai-usage/pricing/model', {
				provider: m.provider.trim(), model: m.model.trim(),
				input_usd_per_mtok: Number(m.input_usd_per_mtok), output_usd_per_mtok: Number(m.output_usd_per_mtok),
				cache_read_usd_per_mtok: Number(m.cache_read_usd_per_mtok), cache_write_usd_per_mtok: Number(m.cache_write_usd_per_mtok),
				is_active: m.is_active,
			});
			toast.success(isNew ? 'Model added' : 'Pricing saved');
			onSaved();
		} catch (e) { toast.error((e as Error).message); }
		finally { setSaving(false); }
	};
	return (
		<tr>
			<td>{isNew ? <input className="search-input" style={{ width: 100, height: 28 }} value={m.provider} onChange={(e) => set('provider', e.target.value)} /> : aiProviderLabel(m.provider)}</td>
			<td>{isNew ? <input className="search-input" style={{ width: 160, height: 28 }} placeholder="model id" value={m.model} onChange={(e) => set('model', e.target.value)} /> : <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{m.model}</span>}</td>
			<td>{numInput('input_usd_per_mtok')}</td>
			<td>{numInput('output_usd_per_mtok')}</td>
			<td>{numInput('cache_read_usd_per_mtok')}</td>
			<td>{numInput('cache_write_usd_per_mtok')}</td>
			<td><input type="checkbox" checked={m.is_active} onChange={(e) => set('is_active', e.target.checked)} /></td>
			<td><button className="btn" disabled={saving} onClick={() => void save()}><Save size={11} /> Save</button></td>
		</tr>
	);
}

