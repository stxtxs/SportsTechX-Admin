'use client';

import { useMemo, useState } from 'react';
import useSWR from 'swr';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { StatCard, StatsPanel, AsyncState, Section, Tag, SortableTh, Pager } from '@/components/atoms';
import { FilterSelect } from '@/components/filters';
import { useUrlState, useUrlNumber } from '@/hooks/use-url-state';
import { stripeStatusLabel, tierLabel } from '@/lib/labels';
import { ComboBarLine, PieDonut, PieLegend, Funnel, toSegments, type PieSegment } from '@/components/charts';
import { useTableColumns } from '@/hooks/use-table-columns';

/**
 * Stripe — live revenue dashboard (MRR/ARR, volume, churn, trial conversion),
 * pulled straight from Stripe. Rendered as the Stripe sub-tab of the Sales page.
 */
interface Sale {
	id: string;
	profile_id: string | null;
	email: string | null;
	display_name: string | null;
	plan: string | null;
	amount_cents: number | null;
	currency: string | null;
	status: string | null;
	created_at: string;
}
interface SalesResponse { data: Sale[]; total: number; totalPages: number }
const PLANS = ['explore', 'raise', 'scout'] as const;

interface RevenueByProduct { name: string; mrr: number; activeCount: number }
interface DailyVolume { date: string; gross: number; net: number; count: number }
interface StripeAnalytics {
	currency?: string;
	unavailable?: boolean;
	payments: Record<'succeeded' | 'uncaptured' | 'refunded' | 'blocked' | 'failed', { count: number; amount: number }>;
	grossVolume: number; netVolume: number; mrr: number; arr: number; activeSubscribers: number;
	revenueByProduct: RevenueByProduct[];
	churnedSubscribers: number; churnedMrr: number;
	outstandingInvoices: { total: number; count: number; aging: Record<string, number> };
	topCustomers: Array<{ email: string; name: string; amount: number; count: number }>;
	failedPayments: { count: number; amount: number };
	newCustomers: number; dailyVolume: DailyVolume[];
	trialConversion: { trialsStarted: number; trialsConverted: number; currentlyTrialing: number; conversionRate: number; dailyTrend?: Array<{ date: string; started: number; conversions: number }> };
	previousPeriod: { grossVolume: number; failedPayments: number; newCustomers: number };
	period: { start: string; end: string };
}

const PRESETS = [
	{ key: '7d', label: '7 days', days: 7 },
	{ key: '30d', label: '30 days', days: 30 },
	{ key: '90d', label: '90 days', days: 90 },
	{ key: '365d', label: '12 months', days: 365 },
] as const;

const PRODUCT_COLORS = ['#79CABD', '#6CA8FF', '#FFB36C', '#D99CFF', '#FF9CA8', '#9CE0C0'];
const fmtMoney = (n: number, currency = 'eur', fractionDigits = 0) => {
	try {
		return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency.toUpperCase(), maximumFractionDigits: fractionDigits, minimumFractionDigits: fractionDigits }).format(n);
	} catch { return `${n.toLocaleString(undefined, { maximumFractionDigits: fractionDigits })} ${currency.toUpperCase()}`; }
};
const pctChange = (cur: number, prev: number): number | null => (prev > 0 ? ((cur - prev) / prev) * 100 : null);

export function SalesStripe() {
	const [preset, setPreset] = useState<(typeof PRESETS)[number]['key']>('30d');

	const startDate = useMemo(() => {
		const days = PRESETS.find((p) => p.key === preset)!.days;
		const d = new Date();
		d.setDate(d.getDate() - days);
		return d.toISOString().slice(0, 10);
	}, [preset]);

	const { data: a, error: aError, isLoading: aLoading, mutate: mutateA } = useSWR<StripeAnalytics>(
		['/api/admin/sales/stripe-analytics', { start_date: startDate }],
		{ dedupingInterval: 60_000 },
	);

	const money = (n: number) => fmtMoney(n, a?.currency ?? 'eur');
	const dailyChart = (a?.dailyVolume ?? []).map((d) => ({
		label: new Date(d.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
		amt: d.gross,
		deals: d.count,
	}));
	const productSegments: PieSegment[] = (a?.revenueByProduct ?? []).map((p, i) => ({
		name: p.name, v: p.mrr, color: PRODUCT_COLORS[i % PRODUCT_COLORS.length], label: money(p.mrr),
	}));
	const aging = a?.outstandingInvoices.aging ?? {};
	const agingRows: Array<[string, string]> = [
		['Not yet due', 'notYetDue'], ['1–30 days', 'days1_30'], ['31–60 days', 'days31_60'],
		['61–90 days', 'days61_90'], ['91+ days', 'days91Plus'],
	];
	const agingSegments = toSegments(agingRows.map(([label, key]) => ({ label, value: aging[key] ?? 0 })), { format: money });
	const paymentSegments = a
		? toSegments((['succeeded', 'refunded', 'failed', 'uncaptured', 'blocked'] as const).map((k) => ({ label: k, value: a.payments[k].count })))
		: [];

	return (
		<div>
			<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-3)', flexWrap: 'wrap', gap: 8 }}>
				<span style={{ fontSize: 12, color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Revenue · live from Stripe</span>
			</div>

			{a?.unavailable && (
				<div className="card" style={{ padding: 12, marginBottom: 'var(--space-4)', borderTop: '2px solid var(--accent)', color: 'var(--accent)', fontSize: 13 }}>
					Stripe is currently unreachable — figures below show zero, not actual revenue. Retry shortly.
				</div>
			)}

			<div className="filter-bar" style={{ marginBottom: 'var(--space-4)' }}>
				{PRESETS.map((p) => (
					<button key={p.key} className={`chip ${preset === p.key ? 'on' : ''}`} onClick={() => setPreset(p.key)}>{p.label}</button>
				))}
				<div style={{ flex: 1 }} />
				<button className="btn ghost" onClick={() => void mutateA()}>Refresh</button>
			</div>

			<StatsPanel>
				<div className="grid-4" style={{ marginBottom: 'var(--space-4)' }}>
					<StatCard label="MRR" loading={aLoading} value={money(a?.mrr ?? 0)} />
					<StatCard label="ARR" loading={aLoading} value={money(a?.arr ?? 0)} />
					<StatCard label="Active subscribers" loading={aLoading} value={(a?.activeSubscribers ?? 0).toLocaleString()} />
					<StatCard label="Gross volume (period)" loading={aLoading} value={money(a?.grossVolume ?? 0)} delta={a ? pctChange(a.grossVolume, a.previousPeriod.grossVolume) : null} />
				</div>
				<div className="grid-4">
					<StatCard label="Net volume" loading={aLoading} value={money(a?.netVolume ?? 0)} />
					<StatCard label="Churned MRR" loading={aLoading} value={money(a?.churnedMrr ?? 0)} urgent={(a?.churnedMrr ?? 0) > 0} />
					<StatCard label="Trial → paid" loading={aLoading} value={`${(a?.trialConversion.conversionRate ?? 0).toFixed(1)}%`} />
					<StatCard label="New customers" loading={aLoading} value={(a?.newCustomers ?? 0).toLocaleString()} delta={a ? pctChange(a.newCustomers, a.previousPeriod.newCustomers) : null} />
				</div>
			</StatsPanel>

			<AsyncState loading={aLoading} error={aError} empty={false} onRetry={() => void mutateA()}>
				<div className="grid-2" style={{ marginBottom: 'var(--space-5)' }}>
					<div className="card">
						<div style={{ padding: 'var(--space-4)', borderBottom: '1px solid var(--border)', fontWeight: 700 }}>Daily volume <span style={{ fontWeight: 400, color: 'var(--fg-muted)', fontSize: 12 }}>· bars = gross · line = charges</span></div>
						<div style={{ padding: 'var(--space-4)' }}>
							{dailyChart.length === 0 ? <div style={{ color: 'var(--fg-muted)', fontSize: 13 }}>No charges in this period.</div>
								: <ComboBarLine data={dailyChart} height={260} barLabel="Gross" lineLabel="charges" valueFormatter={money} />}
						</div>
					</div>
					<div className="card">
						<div style={{ padding: 'var(--space-4)', borderBottom: '1px solid var(--border)', fontWeight: 700 }}>MRR by product</div>
						<div style={{ padding: 'var(--space-4)', display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
							{productSegments.length === 0 ? <div style={{ color: 'var(--fg-muted)', fontSize: 13 }}>No active subscriptions.</div> : (
								<>
									<PieDonut segments={productSegments} size={200} mode="donut" />
									<div style={{ flex: 1, minWidth: 180 }}><PieLegend segments={productSegments} /></div>
								</>
							)}
						</div>
					</div>
				</div>

				<div className="grid-2" style={{ marginBottom: 'var(--space-5)' }}>
					<Section title="Trial funnel" meta={`${(a?.trialConversion.conversionRate ?? 0).toFixed(1)}% conversion`}>
						<Funnel stages={[
							{ label: 'Trials started', value: a?.trialConversion.trialsStarted ?? 0 },
							{ label: 'Currently trialing', value: a?.trialConversion.currentlyTrialing ?? 0 },
							{ label: 'Converted to paid', value: a?.trialConversion.trialsConverted ?? 0, color: 'var(--pos)' },
						]} />
						{(a?.trialConversion.dailyTrend?.length ?? 0) > 0 && (
							<div style={{ marginTop: 16 }}>
								<div className="co-stat-label" style={{ marginBottom: 6 }}>Daily trend · started vs converted</div>
								<ComboBarLine
									data={(a?.trialConversion.dailyTrend ?? []).map((d) => ({
										label: new Date(d.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
										amt: d.started, deals: d.conversions,
									}))}
									height={180}
									valueFormatter={(v) => String(Math.round(v))}
									barLabel="Started" lineLabel="converted"
								/>
							</div>
						)}
					</Section>
					<Section title={`Outstanding invoices · ${money(a?.outstandingInvoices.total ?? 0)} (${a?.outstandingInvoices.count ?? 0})`}>
						{agingSegments.length === 0
							? <div style={{ color: 'var(--fg-muted)', fontSize: 13 }}>No outstanding invoices.</div>
							: <PieDonut segments={agingSegments} mode="bar" />}
					</Section>
				</div>

				<div className="grid-2" style={{ marginBottom: 'var(--space-5)' }}>
					<Section title="Payments breakdown" meta="by outcome count">
						{paymentSegments.length === 0
							? <div style={{ color: 'var(--fg-muted)', fontSize: 13 }}>No payments in this period.</div>
							: (
								<div style={{ display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
									<PieDonut segments={paymentSegments} size={170} mode="donut" />
									<div style={{ flex: 1, minWidth: 160 }}><PieLegend segments={paymentSegments} /></div>
								</div>
							)}
					</Section>
					<Section title="Top customers">
						<table className="data-table">
							<thead><tr><th>Customer</th><th>Spend</th><th>Charges</th></tr></thead>
							<tbody>
								{(a?.topCustomers ?? []).map((c) => (
									<tr key={c.email}><td>{c.name}</td><td className="num">{money(c.amount)}</td><td className="num">{c.count}</td></tr>
								))}
								{(a?.topCustomers ?? []).length === 0 && <tr><td colSpan={3} style={{ color: 'var(--fg-muted)' }}>No charges in this period.</td></tr>}
							</tbody>
						</table>
					</Section>
				</div>
			</AsyncState>

			<BillingLog />
		</div>
	);
}

function BillingLog() {
	const cols = useTableColumns('sales');
	const [search, setSearch] = useUrlState('sale', 'q');
	const [plan, setPlan] = useUrlState('sale', 'plan');
	const [since, setSince] = useUrlState('sale', 'since');
	const [sort, setSort] = useUrlState('sale', 'sort', '-started');
	const [page, setPage] = useUrlNumber('sale', 'page', 1);
	const debouncedSearch = useDebouncedValue(search);
	const activeFilters = (search ? 1 : 0) + (plan ? 1 : 0) + (since ? 1 : 0);
	/** Change a filter or the sort and go back to page 1. */
	const f = (set: (v: string) => void) => (v: string) => { set(v); setPage(1); };
	const clearFilters = () => { for (const set of [setSearch, setPlan, setSince]) set(''); setPage(1); };
	const { data, error, isLoading, mutate } = useSWR<SalesResponse>(
		['/api/admin/sales', { q: debouncedSearch || undefined, plan: plan || undefined, since: since || undefined, sort, page, limit: 50 }],
		{ dedupingInterval: 30_000 },
	);
	const rows = data?.data ?? [];
	return (
		<div className="card" ref={cols.ref}>
			<div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', padding: '12px var(--space-4)', borderBottom: '1px solid var(--border)', gap: 8 }}>
				<div style={{ fontWeight: 700 }}>Subscriptions <span style={{ fontWeight: 400, color: 'var(--fg-muted)', fontSize: 12 }}>· {(data?.total ?? 0).toLocaleString()}{activeFilters ? ' match these filters' : ' total'} · click a column header to sort</span></div>
				<div style={{ flex: 1 }} />
				<input className="search-input" style={{ flex: '0 0 240px', height: 30 }} placeholder="Search by email or name…" aria-label="Search subscriptions" value={search} onChange={(e) => f(setSearch)(e.target.value)} />
				<FilterSelect ariaLabel="Plan" value={plan} onChange={f(setPlan)} allLabel="All plans" options={PLANS.map((p) => ({ value: p, label: tierLabel(p) }))} />
				<span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>Started since</span>
				<input className="search-input" type="date" style={{ height: 30, width: 140 }} value={since} onChange={(e) => f(setSince)(e.target.value)} aria-label="Started since" title="Started since" />
				{activeFilters > 0 && <button className="btn ghost" onClick={clearFilters}>Clear {activeFilters} filter{activeFilters === 1 ? '' : 's'}</button>}
				{cols.menu}
			</div>
			<AsyncState loading={isLoading} error={error} empty={rows.length === 0} emptyMsg={activeFilters ? 'No matching subscriptions' : 'No subscriptions yet'} onRetry={() => void mutate()}>
				<table className="data-table">
					<thead><tr>
						<SortableTh label="Started" field="started" sort={sort} onSort={f(setSort)} />
						<SortableTh label="Customer" field="customer" sort={sort} onSort={f(setSort)} />
						<SortableTh label="Plan" field="plan" sort={sort} onSort={f(setSort)} />
						<SortableTh label="Amount" field="amount" sort={sort} onSort={f(setSort)} />
						<SortableTh label="Status" field="status" sort={sort} onSort={f(setSort)} />
					</tr></thead>
					<tbody>
						{rows.map((r) => (
							<tr key={r.id}>
								<td className="num">{new Date(r.created_at).toLocaleDateString()}</td>
								<td>{r.email ?? r.display_name ?? (r.profile_id ? `${r.profile_id.slice(0, 8)}…` : '—')}</td>
								<td>{r.plan ? tierLabel(r.plan) : '—'}</td>
								<td className="num">{r.amount_cents != null ? fmtMoney(r.amount_cents / 100, r.currency ?? 'eur', 2) : '—'}</td>
								<td><Tag variant={r.status === 'active' || r.status === 'trialing' ? 'pos' : r.status === 'canceled' || r.status === 'unpaid' || r.status === 'past_due' ? 'neg' : ''}>{stripeStatusLabel(r.status)}</Tag></td>
							</tr>
						))}
					</tbody>
				</table>
			</AsyncState>
			<div style={{ padding: '0 var(--space-4) var(--space-3)' }}><Pager page={page} totalPages={data?.totalPages} onPage={setPage} /></div>
		</div>
	);
}
