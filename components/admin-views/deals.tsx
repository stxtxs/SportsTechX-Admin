'use client';

import { useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { toast } from 'sonner';
import { Plus, Save, Trash2, CircleDollarSign, Banknote, TrendingUp } from 'lucide-react';
import { api } from '@/lib/api';
import { Select } from '@/components/select';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useConfirm } from '@/components/confirm';
import { Modal } from '@/components/modal';
import { PageHeader, AsyncState, Loading, StatCard, RichStatCard, StatsPanel, Section, Pager, SortableTh } from '@/components/atoms';
import { ComboBarLine, PieDonut, PieLegend, toSegments, type Bucket } from '@/components/charts';
import { FilterBar, FilterSelect, StatStrip, FilterRange, RefSlugFilter, SectorTierFilter } from '@/components/filters';
import { CsvImportButton, CsvTemplateButton, CsvCheckButton } from '@/components/csv-import';
import { Field } from '@/components/tabbed-form';
import { useUrlState, useUrlNumber } from '@/hooks/use-url-state';
import { useEditPayload } from '@/hooks/use-edit-payload';
import {
	CompanySelectOne, RoundTypeSelect, CurrencySelect, InvestorPicker, SectorCascade,
	type DealInvestor,
} from '@/components/entity-pickers';

interface Deal {
	id: string;
	company_name?: string | null;
	round_type_name?: string | null;
	announced_year?: number | null;
	announced_date?: string | null;
	amount_usd?: string | null;
	currency_code?: string | null;
	status?: string | null;
	primary_sector?: string | null;
}
interface DealsResponse { data: Deal[]; total: number; totalPages: number }
interface DealStats { total: number; total_amount: number; total_rows?: number; this_year?: number; last_year?: number; yoy_change?: number | null; by_year: Array<{ year: number; deals: number; amt: number }>; by_round_type: Bucket[]; by_size_bucket: Bucket[] }

const STATUSES = ['active', 'inactive', 'not_sportstech', 'website_error'] as const;
// d2c/b2g/other dropped - unused across all records (verified) and not wanted.
const BUSINESS_MODELS = ['b2b', 'b2c', 'b2b2c'] as const;
const SIZE_BUCKETS = ['under_1m', 'from_1m_to_10m', 'from_10m_to_100m', 'over_100m'] as const;

function fmtAmount(v?: string | null): string {
	if (!v) return '—';
	const n = Number(v);
	if (!Number.isFinite(n) || n <= 0) return 'Undisclosed';
	if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
	if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
	if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
	return `$${n}`;
}
const fmtMoney = (n: number): string => n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : `$${(n / 1e6).toFixed(1)}M`;

export function DealsView({ embedded = false }: { embedded?: boolean }) {
	const { mutate } = useSWRConfig();
	const ask = useConfirm();
	const [search, setSearch] = useUrlState('deal', 'search', '');
	const debouncedSearch = useDebouncedValue(search);
	const [status, setStatus] = useUrlState('deal', 'status', '');
	const [businessModel, setBusinessModel] = useUrlState('deal', 'businessModel', '');
	const [sizeBucket, setSizeBucket] = useUrlState('deal', 'sizeBucket', '');
	const [year, setYear] = useUrlState('deal', 'year', '');
	const [sector, setSector] = useUrlState('deal', 'sector', '');
	const [sport, setSport] = useUrlState('deal', 'sport', '');
	const [roundType, setRoundType] = useUrlState('deal', 'roundType', '');
	const [amountMin, setAmountMin] = useUrlState('deal', 'amountMin', '');
	const [amountMax, setAmountMax] = useUrlState('deal', 'amountMax', '');
	const [disclosed, setDisclosed] = useUrlState('deal', 'disclosed', '');
	const [page, setPage] = useUrlNumber('deal', 'page', 1);
	const [sort, setSort] = useUrlState('deal', 'sort', '-announced_date');
	const onSort = (s: string) => { setSort(s); setPage(1); };
	const reset1 = () => setPage(1);
	const [creating, setCreating] = useState(false);
	const [editingId, setEditingId] = useState<string | null>(null);

	// Typed filters (country, min/max) wait for typing to pause, like search, instead of one request per key.
	const dAmountMin = useDebouncedValue(amountMin);
	const dAmountMax = useDebouncedValue(amountMax);
	const { data, error, isLoading } = useSWR<DealsResponse>(
		['/api/deals', {
			q: debouncedSearch || undefined, status: status || undefined, business_model: businessModel || undefined,
			deal_size_bucket: sizeBucket || undefined, year: year || undefined,
			sector_slug: sector || undefined, sport_slug: sport || undefined, round_type_slug: roundType || undefined,
			amount_usd_min: dAmountMin || undefined, amount_usd_max: dAmountMax || undefined, disclosed_only: disclosed || undefined,
			page, limit: 30, sort,
		}],
		{ dedupingInterval: 30_000 },
	);
	const stats = useSWR<DealStats>(['/api/admin/stats/deals'], { dedupingInterval: 60_000 });
	const yearChart = (stats.data?.by_year ?? []).map((r) => ({ year: r.year, amt: Number(r.amt), deals: Number(r.deals) }));
	const sizeSegments = toSegments(stats.data?.by_size_bucket ?? []);
	const yearOpts = (stats.data?.by_year ?? []).map((r) => String(r.year)).reverse();
	const refresh = () => mutate((key) => Array.isArray(key) && key[0] === '/api/deals');

	const remove = async (id: string) => {
		if (!(await ask('Delete this deal?'))) return;
		try {
			await api('DELETE', `/api/admin/deals/${id}`);
			toast.success('Deleted');
			void refresh();
		} catch (e) { toast.error((e as Error).message); }
	};

	const deals = data?.data ?? [];
	return (
		<div>
			{!embedded && <PageHeader kicker={`Funding · ${(stats.data?.total ?? data?.total ?? 0).toLocaleString()} deals`} title="Deals" />}

			{!embedded && (
				<StatsPanel>
					<StatStrip cols={3}>
						<RichStatCard label="Total Funding Deals" Icon={CircleDollarSign} loading={stats.isLoading} value={(stats.data?.total ?? 0).toLocaleString()}
							totalRows={stats.data?.total_rows} thisYear={stats.data?.this_year} lastYear={stats.data?.last_year} yoy={stats.data?.yoy_change} />
						<RichStatCard label="Total funding (disclosed)" Icon={Banknote} loading={stats.isLoading} value={fmtMoney(stats.data?.total_amount ?? 0)} />
						<RichStatCard label="Latest year deals" Icon={TrendingUp} loading={stats.isLoading} value={(yearChart[yearChart.length - 1]?.deals ?? 0).toLocaleString()} />
					</StatStrip>
				</StatsPanel>
			)}

			{!embedded && (
				<div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 'var(--space-4)', marginBottom: 'var(--space-5)' }}>
					<Section title="Funding by year" meta="amount · deals" center>
						<AsyncState loading={stats.isLoading} error={stats.error} empty={yearChart.length === 0} emptyMsg="No data" onRetry={() => void stats.mutate()}>
							<ComboBarLine data={yearChart} height={240} valueFormatter={fmtMoney} barLabel="Funding" lineLabel="deals" />
						</AsyncState>
					</Section>
					<Section title="By deal size" meta="deals" center>
						<AsyncState loading={stats.isLoading} error={stats.error} empty={sizeSegments.length === 0} emptyMsg="No data" onRetry={() => void stats.mutate()}>
							<div style={{ display: 'grid', placeItems: 'center', gap: 12 }}>
								<PieDonut segments={sizeSegments} size={170} mode="donut" />
								<PieLegend segments={sizeSegments} />
							</div>
						</AsyncState>
					</Section>
				</div>
			)}

			<FilterBar>
				<input className="search-input" style={{ flex: '0 0 260px', height: 32 }} placeholder="Search by company…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
				<FilterSelect ariaLabel="Status" value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={[...STATUSES]} allLabel="All statuses" />
				<FilterSelect ariaLabel="Business model" value={businessModel} onChange={(v) => { setBusinessModel(v); setPage(1); }} options={[...BUSINESS_MODELS]} allLabel="All models" />
				<FilterSelect ariaLabel="Deal size" value={sizeBucket} onChange={(v) => { setSizeBucket(v); setPage(1); }} options={SIZE_BUCKETS.map((s) => ({ value: s, label: s.replace(/_/g, ' ').replace('from ', '').replace('to', '–') }))} allLabel="Any size" />
				<FilterSelect ariaLabel="Year" value={year} onChange={(v) => { setYear(v); reset1(); }} options={yearOpts} allLabel="All years" />
				<SectorTierFilter value={sector} onChange={(v) => { setSector(v); reset1(); }} allTopLabel="All sectors" />
				<RefSlugFilter kind="sports" ariaLabel="Sport" value={sport} onChange={(v) => { setSport(v); reset1(); }} allLabel="All sports" />
				<RefSlugFilter kind="round-types" ariaLabel="Round" value={roundType} onChange={(v) => { setRoundType(v); reset1(); }} allLabel="All rounds" />
				<FilterRange label="Amount $" min={amountMin} max={amountMax} onMin={(v) => { setAmountMin(v); reset1(); }} onMax={(v) => { setAmountMax(v); reset1(); }} />
				<FilterSelect ariaLabel="Disclosed" value={disclosed} onChange={(v) => { setDisclosed(v); reset1(); }} options={[{ value: 'true', label: 'Disclosed only' }]} allLabel="Any amount" />
				<div style={{ flex: 1 }} />
				<CsvImportButton entity="deals" onDone={() => void refresh()} />
				<CsvTemplateButton entity="deals" />
				<CsvCheckButton entity="deals" />
				<button className="btn" onClick={() => setCreating(true)}><Plus size={12} /> Add deal</button>
			</FilterBar>

			{(creating || editingId) && (
				<DealModal id={editingId} onClose={() => { setCreating(false); setEditingId(null); }} onSaved={() => { setCreating(false); setEditingId(null); void refresh(); }} />
			)}

			<div className="card">
				<AsyncState loading={isLoading} error={error} empty={deals.length === 0} emptyMsg={search ? 'No deals match.' : 'No deals yet.'} onRetry={() => void refresh()}>
					<table className="data-table">
						<thead><tr><th>Company</th><th>Round</th><SortableTh label="Year" field="announced_date" sort={sort} onSort={onSort} /><SortableTh label="Amount" field="amount_usd" sort={sort} onSort={onSort} /><th>Status</th><th style={{ textAlign: 'right' }} /></tr></thead>
						<tbody>
							{deals.map((d) => (
								<tr key={d.id}>
									<td>{d.company_name ?? '—'}</td>
									<td>{d.round_type_name ?? '—'}</td>
									<td className="num">{d.announced_year ?? '—'}</td>
									<td className="num">{fmtAmount(d.amount_usd)}</td>
									<td>{d.status ?? '—'}</td>
									<td style={{ textAlign: 'right', display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
										<button className="btn ghost" onClick={() => setEditingId(d.id)}>Edit</button>
										<button className="btn ghost" style={{ color: 'var(--accent)' }} onClick={() => void remove(d.id)}><Trash2 size={12} /></button>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</AsyncState>
			</div>
			<Pager page={page} totalPages={data?.totalPages} onPage={setPage} />
		</div>
	);
}

interface DealForm {
	company_id: string; round_type_id: string; announced_date: string; amount: string;
	currency_code: string; deal_size_bucket: string; status: string;
	source_url: string; transaction_url: string; investors: DealInvestor[];
	sector_id: string; business_model: string;
}
const EMPTY_DEAL: DealForm = {
	company_id: '', round_type_id: '', announced_date: '', amount: '', currency_code: '',
	deal_size_bucket: '', status: 'active', source_url: '', transaction_url: '',
	investors: [], sector_id: '', business_model: '',
};

interface DealEdit {
	company_id?: string; round_type_id?: string | null; announced_date?: string | null; amount?: string | null; amount_usd?: string | null;
	currency_code?: string | null; deal_size_bucket?: string | null; status?: string | null; sector_id?: string | null;
	business_model?: string | null; source_url?: string | null; transaction_url?: string | null;
	hq_country?: string | null; hq_city?: string | null; hq_continent?: string | null; hq_region?: string | null; hq_state?: string | null; sport_ids?: string[]; investors?: DealInvestor[];
}

function toDealForm(h: DealEdit): DealForm {
	return {
		company_id: h.company_id ?? '', round_type_id: h.round_type_id ?? '',
		announced_date: h.announced_date ? String(h.announced_date).slice(0, 10) : '',
		// Only a USD figure stored (imports): show it as USD, or saving would convert it again.
		amount: h.amount ?? h.amount_usd ?? '', currency_code: h.amount == null && h.amount_usd != null ? 'USD' : (h.currency_code ?? ''),
		deal_size_bucket: h.deal_size_bucket ?? '', status: h.status ?? 'active',
		source_url: h.source_url ?? '', transaction_url: h.transaction_url ?? '',
		investors: h.investors ?? [],
		sector_id: h.sector_id ?? '', business_model: h.business_model ?? '',
	};
}

// A staged draft = the POST body for a deal, minus company_id, plus a tiny
// label snapshot so the parent can render the row before the deal exists.
export interface StagedDeal { body: Record<string, unknown>; label: { round?: string; amount?: string; year?: string } }

export function DealModal({ id, onClose, onSaved, lockedCompanyId, onStage }: { id: string | null; onClose: () => void; onSaved: () => void; lockedCompanyId?: string; onStage?: (d: StagedDeal) => void }) {
	const isEdit = !!id;
	const { data: hydrated } = useEditPayload<DealEdit>(isEdit ? `/api/admin/deals/${id}/edit` : null);
	if (isEdit && !hydrated) return <Modal title="Edit deal" onClose={onClose}><Loading msg="Loading deal…" /></Modal>;
	const initial = hydrated ? toDealForm(hydrated) : { ...EMPTY_DEAL, company_id: lockedCompanyId ?? '' };
	return <DealForm id={id} initial={initial} onClose={onClose} onSaved={onSaved} onStage={onStage} />;
}

function DealForm({ id, initial, onClose, onSaved, onStage }: { id: string | null; initial: DealForm; onClose: () => void; onSaved: () => void; onStage?: (d: StagedDeal) => void }) {
	const isEdit = !!id;
	const stageMode = !!onStage;
	const [form, setForm] = useState<DealForm>(initial);
	const [pending, setPending] = useState(false);

	const set = <K extends keyof DealForm>(k: K, v: DealForm[K]) => setForm((f) => ({ ...f, [k]: v }));

	// On edit an emptied field is sent as null so it clears; undefined would keep the old value.
	const blank = isEdit ? null : undefined;
	const submit = async () => {
		setPending(true);
		try {
			const body: Record<string, unknown> = {
				company_id: form.company_id,
				round_type_id: form.round_type_id || blank,
				// Left blank = not sent: a new deal takes the company's; an existing one keeps its own.
				sector_id: form.sector_id || undefined,
				business_model: form.business_model || undefined,
				announced_date: form.announced_date || blank,
				amount: form.amount.trim() ? Number(form.amount) : blank,
				currency_code: form.currency_code || blank,
				// Only an explicit pick is sent; otherwise the server derives the band from the USD amount
				// (sending back the loaded band kept stale ones, e.g. "under 1m" on a $25M round).
				deal_size_bucket: (form.deal_size_bucket !== initial.deal_size_bucket && form.deal_size_bucket) || undefined,
				status: form.status,
				source_url: form.source_url.trim() || blank,
				transaction_url: form.transaction_url.trim() || blank,
				investors: form.investors,
			};
			if (onStage) {
				// New (unsaved) company: hand the draft back to the parent instead of
				// POSTing. company_id is omitted — the server fills it on save.
				const { company_id, ...rest } = body;
				void company_id;
				onStage({ body: rest, label: { amount: fmtAmount(form.amount || null), year: form.announced_date ? form.announced_date.slice(0, 4) : undefined } });
				onSaved();
				return;
			}
			if (isEdit) await api('PATCH', `/api/admin/deals/${id}`, body);
			else await api('POST', '/api/admin/deals', body);
			toast.success(isEdit ? 'Saved' : 'Created');
			onSaved();
		} catch (e) { toast.error((e as Error).message); } finally { setPending(false); }
	};

	return (
		<Modal
			title={isEdit ? 'Edit deal' : stageMode ? 'Add funding round' : 'New deal'}
			onClose={onClose}
			width={780}
			footer={
				<>
					<button className="btn ghost" onClick={onClose}>Cancel</button>
					<button className="btn" disabled={pending || (!stageMode && !form.company_id) || (!isEdit && !form.announced_date)} onClick={() => void submit()}>
						<Save size={12} /> {pending ? 'Saving…' : stageMode ? 'Add round' : 'Save'}
					</button>
				</>
			}
		>
			{/* One flat form (no tabs), investors inline with the rest — mirrors the
			    old IH "New Funding Round" form. Location / sports are company attributes
			    the deal inherits. Sector and business model are copied from the company
			    and follow it, but can be set here for a deal that differs. */}
			<div style={{ display: 'grid', gap: 12 }}>
				{stageMode ? (
					<div style={{ fontSize: 13, color: 'var(--fg-muted)', marginBottom: 4 }}>This round will be linked to the new company when you save it.</div>
				) : (
					<Field label="Company"><CompanySelectOne value={form.company_id} onChange={(v) => set('company_id', v)} /></Field>
				)}
				<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
					<Field label="Round type"><RoundTypeSelect value={form.round_type_id} onChange={(v) => set('round_type_id', v)} /></Field>
					<Field label="Announced date *" hint="required — sets the year, sort order and the FX rate used to convert the amount to USD"><input className="search-input" type="date" value={form.announced_date} onChange={(e) => set('announced_date', e.target.value)} /></Field>
				</div>
				<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
					<Field label="Sector" hint="leave blank to use the company's"><SectorCascade value={form.sector_id} onChange={(v) => set('sector_id', v)} /></Field>
					<Field label="Business model" hint="leave blank to use the company's">
						<Select value={form.business_model} onChange={(v) => set('business_model', v)} placeholder="—" width="100%" style={{ display: 'block', width: '100%' }} options={[{ value: '', label: '— company\'s —' }, ...BUSINESS_MODELS.map((b) => ({ value: b, label: b.toUpperCase() }))]} />
					</Field>
				</div>
				<div style={{ display: 'grid', gridTemplateColumns: isEdit ? '1fr 120px 1fr' : '1fr 120px', gap: 12 }}>
					<Field label="Amount" hint="in the currency at right — converted to USD automatically"><input className="search-input" type="number" value={form.amount} onChange={(e) => set('amount', e.target.value)} placeholder="e.g. 5000000" /></Field>
					<Field label="Currency" hint="of the amount"><CurrencySelect value={form.currency_code} onChange={(v) => set('currency_code', v)} /></Field>
					{isEdit && (
						<Field label="Size bucket" hint="leave blank — auto-derived from the USD amount">
							<Select value={form.deal_size_bucket} onChange={(v) => set('deal_size_bucket', v)} placeholder="—" width="100%" style={{ display: 'block', width: '100%' }} options={[{ value: '', label: '—' }, ...SIZE_BUCKETS.map((b) => ({ value: b, label: b.replace(/_/g, ' ') }))]} />
						</Field>
					)}
				</div>
				<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
					<Field label="Source URL"><input className="search-input" value={form.source_url} onChange={(e) => set('source_url', e.target.value)} placeholder="https://" /></Field>
					<Field label="Transaction URL"><input className="search-input" value={form.transaction_url} onChange={(e) => set('transaction_url', e.target.value)} placeholder="https://" /></Field>
				</div>
				{/* Status defaults to "active" for a new round; only exposed on edit. */}
				{isEdit && (
					<Field label="Status">
						<Select value={form.status} onChange={(v) => set('status', v)} width="100%" style={{ display: 'block', width: '100%' }} options={STATUSES.map((s) => ({ value: s, label: s.replace(/_/g, ' ') }))} />
					</Field>
				)}
				<Field label="Investors" hint="star marks the lead"><InvestorPicker value={form.investors} onChange={(v) => set('investors', v)} /></Field>
			</div>
		</Modal>
	);
}

