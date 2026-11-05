'use client';

import { useMemo, useState } from 'react';
import useSWR from 'swr';
import { Info } from 'lucide-react';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, type PieLabelRenderProps } from 'recharts';
import { api } from '@/lib/api';
import { AsyncState, StatCard } from '@/components/atoms';
import { StatStrip } from '@/components/filters';
import { Modal } from '@/components/modal';
import { CHART_COLORS } from '@/components/charts';

/**
 * Admin preview of the Monthly Funding / M&A roundup — structure and behaviour
 * of the old Intelligence Hub /analytics monthly roundup (IH labels, `$X.XM`
 * amounts, three full pies with per-chart Amount/Count, complete-breakdown
 * dialogs, the month's full deal table), styled with the admin tokens.
 * Numbers come from the same public endpoints the client /roundup uses.
 */

export type RoundupMode = 'funding' | 'ma';
export type Perspective = 'acquiree' | 'acquirer';
type Metric = 'amount' | 'count';

interface Grouping { label: string; deal_count: number; total_amount: number }
interface RoundupData {
	year: number; month: number;
	stats: {
		total_amount: number; count: number; disclosed_count?: number; avg_amount?: number;
		change?: { total_amount: number; avg_amount: number; count: number };
	};
	by_sector: Grouping[]; by_sub_sector?: Grouping[]; by_business_model: Grouping[]; by_geo: Grouping[];
}
interface DealRow {
	id: string; amount_usd?: number | string | null;
	company_name?: string | null; company_website?: string | null; company_custom_logo_url?: string | null; round_type_name?: string | null;
	hq_city?: string | null; hq_country?: string | null; // deals: the company's HQ; acquisitions: the acquiree's
	acquiree_name?: string | null; acquiree_website?: string | null; acquiree_website_snapshot?: string | null; acquiree_logo?: string | null;
	acquirer_name?: string | null; acquirer_website?: string | null; acquirer_logo?: string | null; acquirer_city?: string | null; acquirer_country?: string | null;
}
interface Country { name: string; iso2?: string | null }

const UNCLASSIFIED = 'Unclassified';
const UNCLASSIFIED_COLOR = '#B8BDC7';
const PAGE = 200;

/** IH style: always millions, one decimal. */
const fmtM = (n: number) => `$${(n / 1e6).toFixed(1)}M`;
const pad2 = (n: number) => String(n).padStart(2, '0');

/** Every funding round in [from, to] — the list endpoint caps a page at 200, so walk the offsets. */
async function fetchAllDeals(from: string, to: string): Promise<DealRow[]> {
	const out: DealRow[] = [];
	for (let offset = 0; ; offset += PAGE) {
		const qs = new URLSearchParams({ from, to, sort: '-amount_usd', limit: String(PAGE), offset: String(offset) });
		const page = await api<{ data: DealRow[]; total: number }>('GET', `/api/deals?${qs}`);
		out.push(...page.data);
		if (page.data.length < PAGE || out.length >= page.total) return out;
	}
}

export function RoundupPreview({ year, month, mode, perspective }: { year: number; month: number; mode: RoundupMode; perspective: Perspective }) {
	const { data, isLoading, error } = useSWR<RoundupData>(['/api/market/roundup', { year, month, mode, ...(mode === 'ma' ? { perspective } : {}) }], { dedupingInterval: 10_000 });
	const [sectorView, setSectorView] = useState<'sector' | 'sub'>('sector');

	const s = data?.stats;
	const noun = mode === 'ma' ? 'M&A' : 'Funding';
	const change = (pct?: number) => (pct == null ? null : (
		<span style={{ color: pct >= 0 ? 'var(--pos)' : 'var(--neg)' }}>{pct >= 0 ? '+' : ''}{pct.toFixed(1)}% vs prev month</span>
	));
	const sectorRows = (sectorView === 'sector' ? data?.by_sector : (data?.by_sub_sector ?? data?.by_sector)) ?? [];
	// Funding opens on Amount, M&A on Count (most M&A values are undisclosed) — IH defaults.
	const defMetric: Metric = mode === 'ma' ? 'count' : 'amount';

	return (
		<AsyncState loading={isLoading} error={error} empty={!!data && (s?.count ?? 0) === 0} emptyMsg="No deals recorded for this month.">
			{s && data && (
				<div style={{ display: 'grid', gap: 16 }}>
					<StatStrip cols={3}>
						<StatCard label={mode === 'ma' ? 'M&A Value (Disclosed)' : 'Total Funding'} value={fmtM(s.total_amount)} sub={change(s.change?.total_amount)} />
						<StatCard label={mode === 'ma' ? 'Avg M&A (Disclosed)' : 'Avg Funding'} value={fmtM(s.avg_amount ?? 0)} sub={change(s.change?.avg_amount)} />
						<StatCard
							label={mode === 'ma' ? 'M&A Deal Count' : 'Deal Count'}
							value={s.count.toLocaleString()}
							sub={<>{change(s.change?.count)}{s.disclosed_count != null && <span> · {s.disclosed_count.toLocaleString()} disclosed</span>}</>}
						/>
					</StatStrip>

					<div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
						<PieCard
							key={`${mode}-sector`} defaultMetric={defMetric}
							title={`${noun} by ${sectorView === 'sector' ? 'Sector' : 'Sub Sector'}`}
							dimension={sectorView === 'sector' ? 'Sector' : 'Sub Sector'} rows={sectorRows}
							extra={<Pills value={sectorView} onChange={setSectorView} options={[['sector', 'Sector'], ['sub', 'Sub Sector']]} />}
						/>
						<PieCard key={`${mode}-bm`} defaultMetric={defMetric} title={`${noun} by Business Model`} dimension="Business Model" rows={data.by_business_model} />
						<PieCard key={`${mode}-geo`} defaultMetric={defMetric} title={`${noun} by Country`} dimension="Country" rows={data.by_geo} top={10} />
					</div>

					<DealsTable year={year} month={month} mode={mode} />
				</div>
			)}
		</AsyncState>
	);
}

/** Small rounded segmented control for in-card toggles (admin `.pill-tabs` idiom). */
export function Pills<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: [T, string][] }) {
	return (
		<div className="pill-tabs" role="tablist" style={{ padding: 3, gap: 2 }}>
			{options.map(([k, l]) => (
				<button key={k} type="button" role="tab" aria-selected={value === k} className={`pill-tab${value === k ? ' on' : ''}`}
					style={{ padding: '4px 12px', fontSize: 11 }} onClick={() => onChange(k)}>
					{l}
				</button>
			))}
		</div>
	);
}

/** Split a label into ≤12-char lines for the outside-slice labels. */
function wrap(name: string): string[] {
	const lines: string[] = [];
	for (const w of name.split(' ')) {
		const last = lines[lines.length - 1];
		if (last && last.length + w.length + 1 <= 12) lines[lines.length - 1] = `${last} ${w}`;
		else lines.push(w);
	}
	return lines;
}

/** IH-style slice label: leader line + wrapped name, only for slices over 5%. */
function sliceLabel(p: PieLabelRenderProps) {
	if (Number(p.percent ?? 0) <= 0.05) return null;
	const r = Math.PI / 180, mid = Number(p.midAngle ?? 0);
	const cx = Number(p.cx), cy = Number(p.cy), or = Number(p.outerRadius);
	const cos = Math.cos(-mid * r), sin = Math.sin(-mid * r);
	const x = cx + (or + 16) * cos, y = cy + (or + 16) * sin;
	return (
		<g>
			<line x1={cx + (or + 3) * cos} y1={cy + (or + 3) * sin} x2={cx + (or + 12) * cos} y2={cy + (or + 12) * sin} stroke="var(--fg-muted)" strokeWidth={1} />
			<text x={x} y={y} fill="var(--fg-2)" fontSize={11} fontWeight={500} textAnchor={x > cx ? 'start' : 'end'} dominantBaseline="central">
				{wrap(String(p.name ?? '')).map((l, i) => <tspan key={i} x={x} dy={i === 0 ? 0 : '1.2em'}>{l}</tspan>)}
			</text>
		</g>
	);
}

function PieCard({ title, dimension, rows, defaultMetric, extra, top }: {
	title: string; dimension: string; rows: Grouping[]; defaultMetric: Metric; extra?: React.ReactNode; top?: number;
}) {
	const [metric, setMetric] = useState<Metric>(defaultMetric);
	const [open, setOpen] = useState(false);
	const val = (g: Grouping) => (metric === 'amount' ? g.total_amount : g.deal_count);
	const fmt = (n: number) => (metric === 'amount' ? fmtM(n) : n.toLocaleString());
	const sorted = [...rows].sort((a, b) => val(b) - val(a));
	const sum = sorted.reduce((a, x) => a + val(x), 0);
	const pct = (n: number) => (sum > 0 ? `${((n / sum) * 100).toFixed(1)}%` : '—');

	// Country shows the top N; the remainder folds into "Others" so the pie stays the whole month.
	const head = top && sorted.length > top ? sorted.slice(0, top) : sorted;
	const rest = sorted.slice(head.length).reduce((a, x) => a + val(x), 0);
	let ci = 0;
	const out = head.map((x) => ({ name: x.label, value: val(x), color: x.label === UNCLASSIFIED ? UNCLASSIFIED_COLOR : CHART_COLORS[ci++ % CHART_COLORS.length]! }));
	if (rest > 0) out.push({ name: 'Others', value: rest, color: CHART_COLORS[ci % CHART_COLORS.length]! });
	const slices = out.filter((x) => x.value > 0);

	return (
		<div className="card" style={{ padding: 16 }}>
			<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
				<Pills value={metric} onChange={setMetric} options={[['amount', 'Amount'], ['count', 'Count']]} />
				{extra}
			</div>
			<div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
				<div style={{ fontWeight: 700, fontSize: 14 }}>{title}</div>
				{rows.length > 0 && (
					<button type="button" className="btn ghost" aria-label={`${title} — complete breakdown`} title="Complete breakdown"
						style={{ height: 22, width: 22, padding: 0, justifyContent: 'center' }} onClick={() => setOpen(true)}>
						<Info size={13} />
					</button>
				)}
			</div>
			{rows.length === 0 ? <div style={{ fontSize: 13, color: 'var(--fg-muted)', padding: '24px 0' }}>No data.</div> : sum === 0 ? (
				<div style={{ fontSize: 13, color: 'var(--fg-muted)', padding: '24px 0' }}>
					No disclosed values for these deals.{' '}
					<button type="button" className="btn ghost" style={{ padding: 0, height: 'auto' }} onClick={() => setMetric('count')}>View by count</button>
				</div>
			) : (
				<ResponsiveContainer width="100%" height={280}>
					<PieChart>
						<Pie data={slices} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={sliceLabel} labelLine={false} isAnimationActive={false} stroke="var(--surface)">
							{slices.map((x) => <Cell key={x.name} fill={x.color} />)}
						</Pie>
						<Tooltip
							formatter={(v) => `${fmt(Number(v))} (${pct(Number(v))})`}
							contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}
							itemStyle={{ color: 'var(--fg)' }}
						/>
					</PieChart>
				</ResponsiveContainer>
			)}

			{open && (
				<Modal title={`${title} - Complete Breakdown`} onClose={() => setOpen(false)} width={560}>
					<table className="data-table" style={{ width: '100%' }}>
						<thead><tr><th>{dimension}</th><th style={{ textAlign: 'right' }}>{metric === 'amount' ? 'Amount' : 'Deal Count'}</th><th style={{ textAlign: 'right' }}>Percentage</th></tr></thead>
						<tbody>
							{sorted.map((x) => (
								<tr key={x.label}>
									<td>{x.label}</td>
									<td className="num" style={{ textAlign: 'right' }}>{fmt(val(x))}</td>
									<td className="num" style={{ textAlign: 'right' }}>{pct(val(x))}</td>
								</tr>
							))}
						</tbody>
					</table>
				</Modal>
			)}
		</div>
	);
}

/** ISO-2 → flag emoji (regional-indicator pair). */
const flag = (iso?: string | null) => (iso && /^[A-Za-z]{2}$/.test(iso)
	? String.fromCodePoint(...[...iso.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65))
	: '');

function DealsTable({ year, month, mode }: { year: number; month: number; mode: RoundupMode }) {
	const from = `${year}-${pad2(month)}-01`;
	// `to` is inclusive server-side → last day of the month.
	const to = `${year}-${pad2(month)}-${pad2(new Date(Date.UTC(year, month, 0)).getUTCDate())}`;
	// Funding: every round of the month (IH lists them all). M&A: largest 50, like IH.
	const funding = useSWR<DealRow[]>(mode === 'funding' ? ['roundup:all-rounds', from, to] : null, () => fetchAllDeals(from, to), { dedupingInterval: 10_000 });
	const ma = useSWR<{ data: DealRow[] }>(mode === 'ma' ? ['/api/acquisitions', { from, to, sort: '-amount_usd', limit: 50 }] : null, { dedupingInterval: 10_000 });
	const countries = useSWR<Country[] | { data: Country[] }>('/api/countries');
	const iso = useMemo(() => {
		const list = Array.isArray(countries.data) ? countries.data : (countries.data?.data ?? []);
		return new Map(list.map((c) => [c.name.toLowerCase(), c.iso2 ?? null]));
	}, [countries.data]);

	const rows = (mode === 'funding' ? funding.data : ma.data?.data) ?? [];
	const loading = mode === 'funding' ? funding.isLoading : ma.isLoading;
	const err = mode === 'funding' ? funding.error : ma.error;
	const place = (city?: string | null, country?: string | null) => {
		const f = flag(country ? iso.get(country.toLowerCase()) : null);
		const txt = city || country;
		return txt ? <span style={{ whiteSpace: 'nowrap' }}>{f && <span style={{ marginRight: 6 }}>{f}</span>}{txt}</span> : '—';
	};
	const amount = (r: DealRow) => (Number(r.amount_usd ?? 0) > 0 ? fmtM(Number(r.amount_usd)) : 'Undisclosed');

	return (
		<div className="card" style={{ padding: 'var(--space-4)' }}>
			<div style={{ fontWeight: 700, fontSize: 15 }}>{mode === 'ma' ? 'M&A - Disclosed & Undisclosed' : 'Funding Rounds'}</div>
			<div style={{ fontSize: 12, color: 'var(--fg-muted)', margin: '2px 0 12px' }}>
				{mode === 'ma' ? 'Largest acquisitions for the selected month, sorted by amount' : 'All funding rounds for the selected month, sorted by amount'}
				{rows.length > 0 && ` · ${rows.length.toLocaleString()}`}
			</div>
			<AsyncState loading={loading} error={err} empty={rows.length === 0} emptyMsg={mode === 'ma' ? 'No acquisitions this month.' : 'No funding rounds this month.'}>
				<div className="table-scroll">
					<table className="data-table">
						<thead>
							{mode === 'ma'
								? <tr><th style={{ width: 32 }}>#</th><th>Acquiree</th><th>Location</th><th>Acquirer</th><th>Location</th><th style={{ textAlign: 'right' }}>Amount</th></tr>
								: <tr><th style={{ width: 32 }}>#</th><th>Company</th><th>Location</th><th>Round</th><th style={{ textAlign: 'right' }}>Amount</th></tr>}
						</thead>
						<tbody>
							{rows.map((r, i) => mode === 'ma' ? (
								<tr key={r.id}>
									<td className="num" style={{ color: 'var(--fg-muted)' }}>{i + 1}</td>
									<td><Party name={r.acquiree_name} website={r.acquiree_website ?? r.acquiree_website_snapshot} logo={r.acquiree_logo} /></td>
									<td>{place(r.hq_city, r.hq_country)}</td>
									<td><Party name={r.acquirer_name} website={r.acquirer_website} logo={r.acquirer_logo} /></td>
									<td>{place(r.acquirer_city, r.acquirer_country)}</td>
									<td className="num" style={{ textAlign: 'right' }}>{amount(r)}</td>
								</tr>
							) : (
								<tr key={r.id}>
									<td className="num" style={{ color: 'var(--fg-muted)' }}>{i + 1}</td>
									<td><Party name={r.company_name} website={r.company_website} logo={r.company_custom_logo_url} /></td>
									<td>{place(r.hq_city, r.hq_country)}</td>
									<td>{r.round_type_name ?? '—'}</td>
									<td className="num" style={{ textAlign: 'right' }}>{amount(r)}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</AsyncState>
		</div>
	);
}

/** A company cell: logo (custom, else the site favicon — like the old roundup) + name linked to its website. */
function Party({ name, website, logo }: { name?: string | null; website?: string | null; logo?: string | null }) {
	const host = website ? website.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0] : null;
	const src = logo || (host ? `https://www.google.com/s2/favicons?sz=64&domain=${host}` : null);
	return (
		<span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
			{/* eslint-disable-next-line @next/next/no-img-element */}
			{src && <img src={src} alt="" width={18} height={18} style={{ objectFit: 'contain', borderRadius: 4 }} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />}
			{host ? <a href={`https://${host}`} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit' }}>{name ?? host}</a> : <span>{name ?? '—'}</span>}
		</span>
	);
}
