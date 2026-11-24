'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { PageHeader, Section, AsyncState, StatCard, StatsPanel, Tag } from '@/components/atoms';
import { ComboBarLine, PieDonut, PieLegend, HBarDrilldown, toSegments, CHART_COLORS, type HBarRow } from '@/components/charts';
import { claimTypeLabel, investorCategoryLabel, requestEntityLabel, tidy } from '@/lib/labels';

const fmtMoney = (n: number): string =>
	n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${Math.round(n).toLocaleString()}`;

interface AnnualRow { year: number; total_amount: number | string; deal_count: number }
interface InvestorTypeRow { category: string; count: number }
interface SectorTreeRow {
	sector_id: string;
	sector_name: string;
	deal_count: number;
	total_amount: number | string;
	children: Array<{ sector_id: string; sector_name: string; deal_count: number; total_amount: number | string }>;
}
interface DashStats {
	total_funding: number;
	total_deals: number;
	total_acquisitions: number;
	total_companies: number;
	total_investors: number;
	total_ecosystem_entities: number;
	actively_raising_new_this_month: number;
}
interface FundingTotals { median_amount: number; largest_amount: number; largest_round_company: string | null }
interface MaStats { count: number; largest_value: number; median_value: number; largest_target: string | null }
interface TopCompany { company_id: string; name: string; slug: string | null; total_raised: number; deal_count: number }
interface TopAcquirer { acquirer_name: string; acquirer_country: string | null; deal_count: number; total_value: number }

interface ClaimRow { id: string; claim_type: string; entity_type?: string | null; entity_name?: string | null; entity_id?: string | null; created_at: string }
interface ClaimsResponse { data: ClaimRow[]; total: number }
interface DcrRow { id: string; entity_type: string; target_name_snapshot?: string | null; field_change?: string | null; created_at: string }
interface DcrResponse { data: DcrRow[]; total: number }
interface CountResp { total: number }

/** A KPI tile with a value + optional secondary line (e.g. the company behind a
 *  "largest round"). Secondary line can be a deep-link to the source record. */
function MoneyStat({ label, value, sub, subHref, tone = 'var(--accent)', loading }: {
	label: string; value: string; sub?: string | null; subHref?: string; tone?: string; loading?: boolean;
}) {
	return (
		<div className="card" style={{ padding: 'var(--space-4)', borderTop: `2px solid ${tone}`, display: 'flex', flexDirection: 'column' }}>
			<div className="co-stat-label">{label}</div>
			{loading ? (
				<div className="skeleton-bar" style={{ width: 80, height: 26, marginTop: 8 }} />
			) : (
				<div style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 800, letterSpacing: '-0.02em', marginTop: 4 }}>{value}</div>
			)}
			{sub && (
				subHref
					? <Link href={subHref} style={{ fontSize: 12, color: 'var(--fg-2)', marginTop: 6, textDecoration: 'none' }} className="lnk-hover">{sub} →</Link>
					: <div style={{ fontSize: 12, color: 'var(--fg-muted)', marginTop: 6 }}>{sub}</div>
			)}
		</div>
	);
}

/**
 * Admin operations dashboard. One place to drain the queues, read the warehouse
 * at a glance, and jump to the source record behind any headline number. Every
 * recent-data / ranked row deep-links to its origin page (pre-filtered).
 */
export default function AdminDashboard() {
	const router = useRouter();

	// Queues to drain
	const claims   = useSWR<ClaimsResponse>(['/api/admin/claims', { status: 'pending', limit: 6 }]);
	const dcr      = useSWR<DcrResponse>(['/api/admin/data-change-requests', { status: 'open', limit: 6 }]);
	const pipeline = useSWR<CountResp>(['/api/admin/startups-pipeline', { status: 'new', limit: 1 }]);

	// Warehouse totals — one call covers companies/deals/investors/M&A/ecosystem/capital.
	const dash  = useSWR<DashStats>(['/api/analytics/dashboard-stats', { period: 'all' }]);
	const fund  = useSWR<FundingTotals>(['/api/analytics/funding-totals', { period: 'all' }]);
	const ma    = useSWR<MaStats>(['/api/analytics/ma-stats', { period: 'all' }]);
	const users = useSWR<CountResp>(['/api/admin/users', { limit: 1 }]);

	// Trends + mix
	const annualF    = useSWR<AnnualRow[]>(['/api/analytics/annual-funding']);
	const annualM    = useSWR<AnnualRow[]>(['/api/analytics/annual-ma']);
	const sectorTree = useSWR<SectorTreeRow[]>(['/api/analytics/sector-heat-tree', { period: 'all', limit: 8 }]);
	const invByType  = useSWR<InvestorTypeRow[]>(['/api/analytics/investors-by-type']);

	// Ranked "recent data" tables — each row links to origin
	const topFunded = useSWR<TopCompany[]>(['/api/analytics/top-funded-companies', { period: 'all', limit: 8 }]);
	const topAcq    = useSWR<TopAcquirer[]>(['/api/analytics/top-acquirers', { period: 'all', limit: 8 }]);

	const annualFChart = (annualF.data ?? []).map((r) => ({ year: r.year, amt: Number(r.total_amount), deals: r.deal_count }));
	const annualMChart = (annualM.data ?? []).map((r) => ({ year: r.year, amt: Number(r.total_amount), deals: r.deal_count }));
	const investorSegments = toSegments((invByType.data ?? []).map((r) => ({ label: investorCategoryLabel(r.category), value: r.count })));

	const tree = sectorTree.data ?? [];
	const sectorTotal = tree.reduce((s, r) => s + Number(r.total_amount), 0);
	const sectorRows: HBarRow[] = tree.map((s, i) => ({
		id: s.sector_id,
		label: s.sector_name,
		value: Number(s.total_amount),
		formatted: fmtMoney(Number(s.total_amount)),
		color: CHART_COLORS[i % CHART_COLORS.length]!,
		children: (s.children ?? []).map((c) => ({
			id: c.sector_id, label: c.sector_name, value: Number(c.total_amount), formatted: fmtMoney(Number(c.total_amount)),
		})),
	}));
	const sectorDealSegments = toSegments(tree.map((s) => ({ label: s.sector_name, value: s.deal_count })));

	const d = dash.data;
	const claimsTotal = claims.data?.total ?? 0;
	const dcrTotal = dcr.data?.total ?? 0;

	const queues = [
		{ label: 'Pending claims',     value: claimsTotal,               href: '/claims',            loading: claims.isLoading,   urgent: claimsTotal > 0 },
		{ label: 'Open data requests', value: dcrTotal,                  href: '/claims?tab=changes', loading: dcr.isLoading,      urgent: dcrTotal > 0 },
		{ label: 'Pipeline (new)',     value: pipeline.data?.total ?? 0, href: '/startups-pipeline', loading: pipeline.isLoading, urgent: (pipeline.data?.total ?? 0) > 0 },
	];

	const warehouse = [
		{ label: 'Companies', value: d?.total_companies,          href: '/companies',    tone: 'blue' },
		{ label: 'Deals',     value: d?.total_deals,              href: '/companies?tab=deals',        tone: 'green' },
		{ label: 'Investors', value: d?.total_investors,          href: '/ecosystem?tab=investors',    tone: 'purple' },
		{ label: 'M&A',       value: d?.total_acquisitions,       href: '/companies?tab=acquisitions', tone: 'amber' },
		{ label: 'Ecosystem', value: d?.total_ecosystem_entities, href: '/ecosystem',    tone: 'teal' },
		{ label: 'Users',     value: users.data?.total,           href: '/users',        tone: 'indigo' },
	] as const;

	// A clickable table row that navigates to the record's origin.
	const rowLink = (href: string) => ({
		onClick: () => router.push(href),
		style: { cursor: 'pointer' } as const,
	});

	return (
		<div>
			<PageHeader
				kicker="Internal · admin tools"
				title="Operations overview"
				subtitle="Drain the queues, read the warehouse at a glance, and jump straight to the record behind any number."
			/>

			{/* Queues that need draining */}
			<div className="grid-3" style={{ marginBottom: 'var(--space-5)' }}>
				{queues.map((q) => (
					<StatCard key={q.label} label={q.label} href={q.href} loading={q.loading} urgent={q.urgent} value={q.value.toLocaleString()} />
				))}
			</div>

			{/* Warehouse snapshot */}
			<StatsPanel title="Warehouse snapshot">
				<div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 'var(--space-3)' }}>
					{warehouse.map((s) => (
						<StatCard key={s.label} label={s.label} href={s.href} tone={s.tone} loading={dash.isLoading} value={(s.value ?? 0).toLocaleString()} />
					))}
				</div>
			</StatsPanel>

			{/* Capital headline numbers — each links to the source record */}
			<div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'var(--space-3)', marginBottom: 'var(--space-5)' }}>
				<MoneyStat label="Capital tracked" loading={dash.isLoading} value={fmtMoney(d?.total_funding ?? 0)} sub={`${(d?.total_deals ?? 0).toLocaleString()} rounds`} tone="var(--accent)" />
				<MoneyStat label="Median round" loading={fund.isLoading} value={fmtMoney(fund.data?.median_amount ?? 0)} tone="oklch(55% 0.18 250)" />
				<MoneyStat
					label="Largest round" loading={fund.isLoading} value={fmtMoney(fund.data?.largest_amount ?? 0)}
					sub={fund.data?.largest_round_company} subHref={fund.data?.largest_round_company ? `/companies?q=${encodeURIComponent(fund.data.largest_round_company)}` : undefined}
					tone="oklch(54% 0.15 155)"
				/>
				<MoneyStat
					label="Largest M&A" loading={ma.isLoading} value={fmtMoney(ma.data?.largest_value ?? 0)}
					sub={ma.data?.largest_target} subHref={ma.data?.largest_target ? `/companies?tab=acquisitions&q=${encodeURIComponent(ma.data.largest_target)}` : undefined}
					tone="oklch(57% 0.13 65)"
				/>
			</div>

			{/* Trend charts — equal-height combo charts, no dead space */}
			<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)', marginBottom: 'var(--space-5)' }}>
				<Section title="Funding by year" meta="capital · rounds" center>
					<AsyncState loading={annualF.isLoading} error={annualF.error} empty={annualFChart.length === 0} emptyMsg="No funding data" onRetry={() => void annualF.mutate()}>
						<ComboBarLine data={annualFChart} height={300} valueFormatter={fmtMoney} barLabel="Capital" lineLabel="rounds" />
					</AsyncState>
				</Section>
				<Section title="M&A by year" meta="value · deals" center>
					<AsyncState loading={annualM.isLoading} error={annualM.error} empty={annualMChart.length === 0} emptyMsg="No M&A data" onRetry={() => void annualM.mutate()}>
						<ComboBarLine data={annualMChart} height={300} valueFormatter={fmtMoney} barLabel="Value" lineLabel="deals" />
					</AsyncState>
				</Section>
			</div>

			{/* Mix charts — three balanced columns */}
			<div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr', gap: 'var(--space-4)', marginBottom: 'var(--space-5)' }}>
				<Section title="Top sectors" meta="by capital" center>
					<AsyncState loading={sectorTree.isLoading} error={sectorTree.error} empty={sectorRows.length === 0} emptyMsg="No sector data" onRetry={() => void sectorTree.mutate()}>
						<HBarDrilldown rows={sectorRows} total={sectorTotal} accordion />
					</AsyncState>
				</Section>
				<Section title="Investors by type" meta="count" center>
					<AsyncState loading={invByType.isLoading} error={invByType.error} empty={investorSegments.length === 0} emptyMsg="No investor data" onRetry={() => void invByType.mutate()}>
						<div style={{ display: 'grid', placeItems: 'center', gap: 12 }}>
							<PieDonut segments={investorSegments} size={170} mode="donut" />
							<div style={{ width: '100%' }}><PieLegend segments={investorSegments} /></div>
						</div>
					</AsyncState>
				</Section>
				<Section title="Deal share by sector" meta="rounds" center>
					<AsyncState loading={sectorTree.isLoading} error={sectorTree.error} empty={sectorDealSegments.length === 0} emptyMsg="No data" onRetry={() => void sectorTree.mutate()}>
						<PieDonut segments={sectorDealSegments} mode="bar" />
					</AsyncState>
				</Section>
			</div>

			{/* Ranked tables — rows deep-link to the origin record */}
			<div className="grid-2" style={{ marginBottom: 'var(--space-5)' }}>
				<Section title="Top funded companies" meta="all-time" padded={false}>
					<AsyncState loading={topFunded.isLoading} error={topFunded.error} empty={!topFunded.data?.length} emptyMsg="No companies" onRetry={() => void topFunded.mutate()}>
						<table className="data-table">
							<thead><tr><th>Company</th><th style={{ textAlign: 'right' }}>Raised</th><th style={{ textAlign: 'right' }}>Rounds</th></tr></thead>
							<tbody>
								{(topFunded.data ?? []).map((c) => (
									<tr key={c.company_id} {...rowLink(`/companies?q=${encodeURIComponent(c.name)}`)}>
										<td style={{ fontWeight: 600 }}>{c.name}</td>
										<td className="num" style={{ textAlign: 'right' }}>{fmtMoney(c.total_raised)}</td>
										<td className="num" style={{ textAlign: 'right', color: 'var(--fg-muted)' }}>{c.deal_count}</td>
									</tr>
								))}
							</tbody>
						</table>
					</AsyncState>
				</Section>

				<Section title="Top acquirers" meta="all-time" padded={false}>
					<AsyncState loading={topAcq.isLoading} error={topAcq.error} empty={!topAcq.data?.length} emptyMsg="No acquirers" onRetry={() => void topAcq.mutate()}>
						<table className="data-table">
							<thead><tr><th>Acquirer</th><th style={{ textAlign: 'right' }}>Value</th><th style={{ textAlign: 'right' }}>Deals</th></tr></thead>
							<tbody>
								{(topAcq.data ?? []).map((a, i) => (
									<tr key={`${a.acquirer_name}-${i}`} {...rowLink(`/companies?tab=acquisitions&q=${encodeURIComponent(a.acquirer_name)}`)}>
										<td style={{ fontWeight: 600 }}>{a.acquirer_name}{a.acquirer_country ? <span style={{ color: 'var(--fg-muted)', fontWeight: 400 }}> · {a.acquirer_country}</span> : null}</td>
										<td className="num" style={{ textAlign: 'right' }}>{fmtMoney(a.total_value)}</td>
										<td className="num" style={{ textAlign: 'right', color: 'var(--fg-muted)' }}>{a.deal_count}</td>
									</tr>
								))}
							</tbody>
						</table>
					</AsyncState>
				</Section>
			</div>

			{/* Recent queue activity — rows deep-link to the filtered origin queue */}
			<div className="grid-2" style={{ marginBottom: 'var(--space-5)' }}>
				<Section title="Recent pending claims" meta={`${claimsTotal} total`} padded={false}>
					<AsyncState loading={claims.isLoading} error={claims.error} empty={!claims.data?.data?.length} emptyMsg="No pending claims" onRetry={() => void claims.mutate()}>
						<table className="data-table">
							<thead><tr><th>Created</th><th>Type</th><th>Target</th></tr></thead>
							<tbody>
								{(claims.data?.data ?? []).map((c) => {
									const name = c.entity_name ?? '';
									return (
										<tr key={c.id} {...rowLink(name ? `/claims?q=${encodeURIComponent(name)}` : '/claims')}>
											<td className="num">{new Date(c.created_at).toLocaleDateString()}</td>
											<td>{claimTypeLabel(c.claim_type)}</td>
											<td>{name || '—'}</td>
										</tr>
									);
								})}
							</tbody>
						</table>
					</AsyncState>
				</Section>

				<Section title="Recent open requests" meta={`${dcrTotal} total`} padded={false}>
					<AsyncState loading={dcr.isLoading} error={dcr.error} empty={!dcr.data?.data?.length} emptyMsg="No open requests" onRetry={() => void dcr.mutate()}>
						<table className="data-table">
							<thead><tr><th>Created</th><th>Target</th><th>Change</th></tr></thead>
							<tbody>
								{(dcr.data?.data ?? []).map((r) => {
									const name = r.target_name_snapshot ?? '';
									return (
										<tr key={r.id} {...rowLink(name ? `/claims?tab=changes&q=${encodeURIComponent(name)}` : '/claims?tab=changes')}>
											<td className="num">{new Date(r.created_at).toLocaleDateString()}</td>
											<td>{name || requestEntityLabel(r.entity_type)}</td>
											<td style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.field_change ? tidy(r.field_change) : '—'}</td>
										</tr>
									);
								})}
							</tbody>
						</table>
					</AsyncState>
				</Section>
			</div>

			{/* Shortcuts */}
			<div className="card" style={{ padding: 'var(--space-4)' }}>
				<div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>
					Shortcuts
				</div>
				<div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
					<Link href="/jobs"><button className="btn ghost">Run integrations & jobs</button></Link>
					<Link href="/reports"><button className="btn ghost">Publish a report</button></Link>
					<Link href="/billing"><button className="btn ghost">Grant trial / credits</button></Link>
					<Link href="/sales"><button className="btn ghost">Sales pipeline</button></Link>
					<Link href="/analytics"><button className="btn ghost">Analytics</button></Link>
				</div>
				<div style={{ marginTop: 16, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-muted)' }}>
					<Tag>API</Tag> All endpoints are backed by the NestJS server. RLS keeps every admin table locked to <code>profiles.user_role = &apos;admin&apos;</code>.
				</div>
			</div>
		</div>
	);
}
