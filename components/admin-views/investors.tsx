'use client';

import { useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { toast } from 'sonner';
import { Plus, Save, Trash2, Banknote, BadgeCheck, Coins, Layers } from 'lucide-react';
import { api, fetchAllPages } from '@/lib/api';
import { Select } from '@/components/select';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useConfirm } from '@/components/confirm';
import { Modal } from '@/components/modal';
import { PageHeader, AsyncState, Loading, StatCard, RichStatCard, StatsPanel, Section, Pager, SortableTh } from '@/components/atoms';
import { PieDonut, PieLegend, toSegments, type Bucket } from '@/components/charts';
import { FilterBar, FilterSelect, StatStrip, BoolFilter, FilterRange, RefSlugFilter, SectorTierFilter } from '@/components/filters';
import { downloadCsv } from '@/components/csv-import';
import { TabbedForm, Field, useTabs, EnrichedFieldsProvider, EnrichedGroup } from '@/components/tabbed-form';
import {
	SectorCascade, SportsPicker, TechTagsPicker, RoundTypesPicker, LocationFields, SocialLinks, CurrencySelect,
	EMPTY_SOCIAL, EMPTY_LOCATION, type SocialValue, type LocationValue,
} from '@/components/entity-pickers';
import { YearSelect } from '@/components/year-select';
import { confirmDelete } from '@/lib/delete-impact';
import { MergeModal } from '@/components/merge-modal';
import { useUrlState, useUrlNumber } from '@/hooks/use-url-state';
import { useEditPayload } from '@/hooks/use-edit-payload';

interface Investor {
	id: string;
	name: string;
	slug?: string;
	website?: string | null;
	category?: string | null;
	year_launched?: number | null;
	status?: string | null;
	is_verified?: boolean | null;
}

interface InvestorsResponse { data: Investor[]; total: number; totalPages: number }
interface InvestorStats { total: number; verified: number; active: number; total_rows?: number; this_year?: number; last_year?: number; yoy_change?: number | null; by_category: Bucket[]; by_status: Bucket[] }

const CATEGORIES = [
	'venture_capital', 'private_equity', 'financial_services',
	'family_investment_office', 'sovereign_wealth_fund', 'angel', 'other',
] as const;
const STATUSES = ['active', 'inactive', 'paused'] as const;

export function InvestorsView({ embedded = false }: { embedded?: boolean }) {
	const { mutate } = useSWRConfig();
	const ask = useConfirm();
	const [search, setSearch] = useUrlState('inv', 'search', '');
	const debouncedSearch = useDebouncedValue(search);
	const [category, setCategory] = useUrlState('inv', 'category', '');
	const [status, setStatus] = useUrlState('inv', 'status', '');
	const [verified, setVerified] = useUrlState('inv', 'verified', '');
	const [sector, setSector] = useUrlState('inv', 'sector', '');
	const [sport, setSport] = useUrlState('inv', 'sport', '');
	const [country, setCountry] = useUrlState('inv', 'country', '');
	const [investing, setInvesting] = useUrlState('inv', 'investing', '');
	const [launchedMin, setLaunchedMin] = useUrlState('inv', 'launchedMin', '');
	const [launchedMax, setLaunchedMax] = useUrlState('inv', 'launchedMax', '');
	const [page, setPage] = useUrlNumber('inv', 'page', 1);
	const [sort, setSort] = useUrlState('inv', 'sort', '-created_at');
	const onSort = (s: string) => { setSort(s); setPage(1); };
	const reset1 = () => setPage(1);
	const [creating, setCreating] = useState(false);
	const [editingId, setEditingId] = useState<string | null>(null);
	const [merging, setMerging] = useState<{ id: string; name: string } | null>(null);

	// Typed filters (country, min/max) wait for typing to pause, like search, instead of one request per key.
	const dCountry = useDebouncedValue(country);
	const dLaunchedMin = useDebouncedValue(launchedMin);
	const dLaunchedMax = useDebouncedValue(launchedMax);
	const { data, error, isLoading } = useSWR<InvestorsResponse>(
		['/api/investors', {
			q: debouncedSearch || undefined, category: category || undefined, status: status || undefined,
			is_verified: verified || undefined, sector_slug: sector || undefined, sport_slug: sport || undefined,
			country: dCountry.trim() || undefined, actively_investing: investing || undefined,
			year_launched_min: dLaunchedMin || undefined, year_launched_max: dLaunchedMax || undefined,
			page, limit: 30, sort,
		}],
		{ dedupingInterval: 30_000 },
	);
	const stats = useSWR<InvestorStats>(['/api/admin/stats/investors'], { dedupingInterval: 60_000 });
	const categorySegments = toSegments(stats.data?.by_category ?? []);
	const statusSegments = toSegments(stats.data?.by_status ?? []);

	const refresh = () => mutate((key) => Array.isArray(key) && key[0] === '/api/investors');

	// Export the full filtered result set (not just the current page) to CSV.
	const exportCsv = async () => {
		const params: Record<string, string> = { sort };
		const add = (k: string, v: string) => { if (v) params[k] = v; };
		add('q', search); add('category', category); add('status', status); add('is_verified', verified);
		add('sector_slug', sector); add('sport_slug', sport); add('country', country.trim());
		add('actively_investing', investing); add('year_launched_min', launchedMin); add('year_launched_max', launchedMax);
		try {
			const { rows, capped } = await fetchAllPages<InvestorsResponse['data'][number]>('/api/investors', params);
			const out = rows.map((i) => [i.name ?? '', i.website ?? '', i.category ?? '', i.year_launched ? String(i.year_launched) : '', i.status ?? '']);
			if (out.length === 0) { toast.error('No investors to export'); return; }
			if (capped) toast.warning('Export capped at 5000 rows — narrow the filters for a complete export.');
			downloadCsv('investors.csv', ['name', 'website', 'category', 'year_launched', 'status'], out);
		} catch (e) { toast.error((e as Error).message); }
	};

	const remove = async (id: string, name: string) => {
		// Says how many deals lose the link (they keep the name as text; nothing re-links them).
		if (!(await confirmDelete(ask, 'investor', id, name))) return;
		try {
			await api('DELETE', `/api/admin/investors/${id}`);
			toast.success('Deleted');
			void refresh();
		} catch (e) {
			toast.error((e as Error).message);
		}
	};

	const rows = data?.data ?? [];
	return (
		<div>
			{!embedded && <PageHeader kicker={`Capital · ${(stats.data?.total ?? data?.total ?? 0).toLocaleString()} investors`} title="Investors" />}

			{!embedded && (
				<StatsPanel>
					<StatStrip cols={4}>
						<RichStatCard label="Total Investors" Icon={Banknote} loading={stats.isLoading} value={(stats.data?.total ?? 0).toLocaleString()}
							thisYear={stats.data?.this_year} lastYear={stats.data?.last_year} yoy={stats.data?.yoy_change} />
						<RichStatCard label="Verified" Icon={BadgeCheck} loading={stats.isLoading} value={(stats.data?.verified ?? 0).toLocaleString()} />
						<RichStatCard label="Actively investing" Icon={Coins} loading={stats.isLoading} value={(stats.data?.active ?? 0).toLocaleString()} />
						<RichStatCard label="Categories" Icon={Layers} loading={stats.isLoading} value={(stats.data?.by_category?.length ?? 0).toLocaleString()} />
					</StatStrip>
				</StatsPanel>
			)}

			{!embedded && (
				<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)', marginBottom: 'var(--space-5)' }}>
					<Section title="By category" meta="investors" center>
						<AsyncState loading={stats.isLoading} error={stats.error} empty={categorySegments.length === 0} emptyMsg="No data" onRetry={() => void stats.mutate()}>
							<div style={{ display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
								<PieDonut segments={categorySegments} size={170} mode="donut" />
								<div style={{ flex: 1, minWidth: 160 }}><PieLegend segments={categorySegments} /></div>
							</div>
						</AsyncState>
					</Section>
					<Section title="By status" meta="investors" center>
						<AsyncState loading={stats.isLoading} error={stats.error} empty={statusSegments.length === 0} emptyMsg="No data" onRetry={() => void stats.mutate()}>
							<PieDonut segments={statusSegments} mode="bar" />
						</AsyncState>
					</Section>
				</div>
			)}

			<FilterBar>
				<input
					className="search-input"
					style={{ flex: '0 0 260px', height: 32 }}
					placeholder="Search investors…"
					value={search}
					onChange={(e) => { setSearch(e.target.value); setPage(1); }}
				/>
				<FilterSelect ariaLabel="Category" value={category} onChange={(v) => { setCategory(v); reset1(); }} options={[...CATEGORIES]} allLabel="All categories" />
				<FilterSelect ariaLabel="Status" value={status} onChange={(v) => { setStatus(v); reset1(); }} options={[...STATUSES]} allLabel="All statuses" />
				<FilterSelect ariaLabel="Verified" value={verified} onChange={(v) => { setVerified(v); reset1(); }} options={[{ value: 'true', label: 'Verified' }, { value: 'false', label: 'Unverified' }]} allLabel="Any verification" />
				<SectorTierFilter value={sector} onChange={(v) => { setSector(v); reset1(); }} allTopLabel="Any sector" />
				<RefSlugFilter kind="sports" ariaLabel="Thesis sport" value={sport} onChange={(v) => { setSport(v); reset1(); }} allLabel="Any sport" />
				<input className="search-input" style={{ height: 32, width: 130 }} placeholder="Country" value={country} onChange={(e) => { setCountry(e.target.value); reset1(); }} />
				<BoolFilter ariaLabel="Actively investing" value={investing} onChange={(v) => { setInvesting(v); reset1(); }} yesLabel="Investing" noLabel="Not investing" allLabel="Any activity" />
				<FilterRange label="Launched" min={launchedMin} max={launchedMax} onMin={(v) => { setLaunchedMin(v); reset1(); }} onMax={(v) => { setLaunchedMax(v); reset1(); }} width={64} />
				<div style={{ flex: 1 }} />
				<button className="btn ghost" onClick={() => void exportCsv()}>Export CSV</button>
				<button className="btn" onClick={() => setCreating(true)}><Plus size={12} /> Add investor</button>
			</FilterBar>

			{(creating || editingId) && (
				<InvestorModal
					id={editingId}
					onClose={() => { setCreating(false); setEditingId(null); }}
					onSaved={() => { setCreating(false); setEditingId(null); void refresh(); }}
				/>
			)}
			{merging && <MergeModal kind="investor" id={merging.id} name={merging.name} onClose={() => setMerging(null)} onMerged={() => { setMerging(null); void refresh(); }} />}

			<div className="card" style={{ padding: 0, overflow: 'hidden' }}>
				<AsyncState loading={isLoading} error={error} empty={rows.length === 0} emptyMsg={search ? 'No investors match.' : 'No investors yet.'} onRetry={() => void refresh()}>
					<table className="data-table" style={{ width: '100%' }}>
						<thead>
							<tr><SortableTh label="Name" field="name" sort={sort} onSort={onSort} /><SortableTh label="Category" field="category" sort={sort} onSort={onSort} /><SortableTh label="Launched" field="year_launched" sort={sort} onSort={onSort} /><th>Status</th><th>Verified</th><th /></tr>
						</thead>
						<tbody>
							{rows.map((r) => (
								<tr key={r.id}>
									<td><div style={{ fontWeight: 600 }}>{r.name}</div>{r.website && <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{r.website}</div>}</td>
									<td>{r.category ?? '—'}</td>
									<td>{r.year_launched ?? '—'}</td>
									<td>{r.status ?? '—'}</td>
									<td>{r.is_verified ? '✓' : '—'}</td>
									<td style={{ textAlign: 'right', display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
										<button className="btn ghost" onClick={() => setEditingId(r.id)}>Edit</button>
										<button className="btn ghost" title="Merge this duplicate into another investor" onClick={() => setMerging({ id: r.id, name: r.name })}>Merge</button>
										<button className="btn ghost" style={{ color: 'var(--accent)' }} onClick={() => void remove(r.id, r.name)}><Trash2 size={12} /></button>
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

interface FundDraft { fund_name: string; announced_date: string; fund_value: string; currency_code: string; source_url: string }
const emptyFund = (): FundDraft => ({ fund_name: '', announced_date: '', fund_value: '', currency_code: '', source_url: '' });
interface GeoScope { scope_type: 'country' | 'region' | 'continent'; scope_value: string }
const GEO_SCOPES = ['country', 'region', 'continent'] as const;
const REVENUE_STAGES = ['pre_revenue', 'early_revenue', 'growth', 'profitable', 'other'] as const;

interface InvestorForm {
	name: string; slug: string; website: string; description: string;
	category: string; year_launched: string; status: string;
	is_verified: boolean; actively_investing: boolean;
	hq: LocationValue; social: SocialValue;
	keywords: string; logo_url: string;
	num_employees: string; num_investments: string; num_exits: string;
	total_funding: string; annual_revenue: string; analyst_notes: string;
	latest_funding: string; latest_funding_amount: string; last_raised_at: string;
	poc_name: string; poc_position: string; poc_email: string; poc_linkedin: string;
	thesis_sector_ids: string[]; thesis_sport_ids: string[];
	thesis_tech_tag_ids: string[]; thesis_round_type_ids: string[];
	thesis_amount_min: string; thesis_amount_max: string;
	thesis_revenue_stages: string[]; thesis_geo: GeoScope[];
	funds: FundDraft[];
}

const EMPTY_INVESTOR: InvestorForm = {
	name: '', slug: '', website: '', description: '', category: '', year_launched: '', status: 'active',
	is_verified: false, actively_investing: false, hq: { ...EMPTY_LOCATION }, social: { ...EMPTY_SOCIAL },
	keywords: '', logo_url: '', num_employees: '', num_investments: '', num_exits: '',
	total_funding: '', annual_revenue: '', analyst_notes: '',
	latest_funding: '', latest_funding_amount: '', last_raised_at: '',
	poc_name: '', poc_position: '', poc_email: '', poc_linkedin: '',
	thesis_sector_ids: [], thesis_sport_ids: [], thesis_tech_tag_ids: [], thesis_round_type_ids: [],
	thesis_amount_min: '', thesis_amount_max: '', thesis_revenue_stages: [], thesis_geo: [],
	funds: [],
};

interface InvestorEdit extends Investor {
	description?: string | null; hq_country?: string | null; hq_city?: string | null;
	hq_continent?: string | null; hq_region?: string | null; hq_state?: string | null;
	keywords?: string | null; logo_url?: string | null; analyst_notes?: string | null;
	num_employees?: number | null; num_investments?: number | null; num_exits?: number | null;
	total_funding?: string | null; annual_revenue?: string | null; actively_investing?: boolean | null;
	latest_funding?: string | null; latest_funding_amount?: string | null; last_raised_at?: string | null;
	poc_name?: string | null; poc_position?: string | null; poc_email?: string | null; poc_linkedin?: string | null;
	funds?: Array<{ fund_name?: string | null; announced_date?: string | null; fund_value?: string | null; currency_code?: string | null; source_url?: string | null }>;
	twitter_url?: string | null; instagram_url?: string | null; facebook_url?: string | null;
	linkedin_url?: string | null; youtube_url?: string | null; email?: string | null;
	thesis_sector_ids?: string[]; thesis_sport_ids?: string[]; thesis_tech_tag_ids?: string[]; thesis_round_type_ids?: string[];
	thesis_amount_min?: string | null; thesis_amount_max?: string | null;
	thesis_revenue_stages?: string[]; thesis_geo?: Array<{ scope_type: string; scope_value: string }>;
}

function toInvestorForm(h: InvestorEdit): InvestorForm {
	return {
		name: h.name ?? '', slug: h.slug ?? '', website: h.website ?? '', description: h.description ?? '',
		category: h.category ?? '', year_launched: h.year_launched ? String(h.year_launched) : '',
		status: h.status ?? 'active', is_verified: !!h.is_verified, actively_investing: !!h.actively_investing,
		hq: { country: h.hq_country ?? '', city: h.hq_city ?? '', continent: h.hq_continent ?? '', region: h.hq_region ?? '', state: h.hq_state ?? '' },
		social: {
			twitter_url: h.twitter_url ?? '', instagram_url: h.instagram_url ?? '', facebook_url: h.facebook_url ?? '',
			linkedin_url: h.linkedin_url ?? '', youtube_url: h.youtube_url ?? '', email: h.email ?? '',
		},
		keywords: h.keywords ?? '', logo_url: h.logo_url ?? '',
		num_employees: h.num_employees != null ? String(h.num_employees) : '',
		num_investments: h.num_investments != null ? String(h.num_investments) : '',
		num_exits: h.num_exits != null ? String(h.num_exits) : '',
		total_funding: h.total_funding ?? '', annual_revenue: h.annual_revenue ?? '', analyst_notes: h.analyst_notes ?? '',
		latest_funding: h.latest_funding ?? '', latest_funding_amount: h.latest_funding_amount ?? '',
		last_raised_at: h.last_raised_at ? String(h.last_raised_at).slice(0, 10) : '',
		poc_name: h.poc_name ?? '', poc_position: h.poc_position ?? '', poc_email: h.poc_email ?? '', poc_linkedin: h.poc_linkedin ?? '',
		thesis_sector_ids: h.thesis_sector_ids ?? [], thesis_sport_ids: h.thesis_sport_ids ?? [],
		thesis_tech_tag_ids: h.thesis_tech_tag_ids ?? [], thesis_round_type_ids: h.thesis_round_type_ids ?? [],
		thesis_amount_min: h.thesis_amount_min != null ? String(h.thesis_amount_min) : '',
		thesis_amount_max: h.thesis_amount_max != null ? String(h.thesis_amount_max) : '',
		thesis_revenue_stages: h.thesis_revenue_stages ?? [],
		thesis_geo: (h.thesis_geo ?? []).map((g) => ({ scope_type: g.scope_type as GeoScope['scope_type'], scope_value: g.scope_value })),
		funds: (h.funds ?? []).map((f) => ({
			fund_name: f.fund_name ?? '', announced_date: f.announced_date ? String(f.announced_date).slice(0, 10) : '',
			fund_value: f.fund_value != null ? String(f.fund_value) : '', currency_code: f.currency_code ?? '', source_url: f.source_url ?? '',
		})),
	};
}

export function InvestorModal({ id, onClose, onSaved, seed, promoteReviewId, enrichedFields }: { id: string | null; onClose: () => void; onSaved: (createdId?: string) => void; seed?: Partial<InvestorForm>; promoteReviewId?: string; enrichedFields?: string[] }) {
	const isEdit = !!id;
	const { data: hydrated } = useEditPayload<InvestorEdit>(isEdit ? `/api/admin/investors/${id}/edit` : null);
	if (isEdit && !hydrated) return <Modal title="Edit investor" onClose={onClose}><Loading msg="Loading investor…" /></Modal>;
	return <InvestorForm id={id} initial={hydrated ? toInvestorForm(hydrated) : { ...EMPTY_INVESTOR, ...seed }} onClose={onClose} onSaved={onSaved} promoteReviewId={promoteReviewId} enrichedFields={enrichedFields} />;
}

function InvestorForm({ id, initial, onClose, onSaved, promoteReviewId, enrichedFields }: { id: string | null; initial: InvestorForm; onClose: () => void; onSaved: (createdId?: string) => void; promoteReviewId?: string; enrichedFields?: string[] }) {
	const isEdit = !!id;
	const [tab, setTab] = useTabs('profile');
	const [form, setForm] = useState<InvestorForm>(initial);
	const [pending, setPending] = useState(false);

	const set = <K extends keyof InvestorForm>(k: K, v: InvestorForm[K]) => setForm((f) => ({ ...f, [k]: v }));
	const numOrNull = (s: string) => (s.trim() === '' ? null : Number(s));

	const submit = async () => {
		setPending(true);
		try {
			const body: Record<string, unknown> = {
				name: form.name.trim(),
				slug: form.slug.trim() || undefined,
				website: form.website.trim() || null,
				description: form.description.trim() || null,
				category: form.category || null,
				year_launched: numOrNull(form.year_launched),
				status: form.status,
				is_verified: form.is_verified,
				actively_investing: form.actively_investing,
				// null (not undefined) so emptying the HQ clears it.
				hq_country: form.hq.country.trim() || null,
				hq_city: form.hq.city.trim() || null,
				hq_continent: form.hq.continent.trim() || null,
				hq_region: form.hq.region.trim() || null,
				hq_state: form.hq.state.trim() || null,
				keywords: form.keywords.trim() || null,
				logo_url: form.logo_url.trim() || null,
				num_employees: numOrNull(form.num_employees),
				num_investments: numOrNull(form.num_investments),
				num_exits: numOrNull(form.num_exits),
				total_funding: form.total_funding.trim() || null,
				annual_revenue: form.annual_revenue.trim() || null,
				analyst_notes: form.analyst_notes.trim() || null,
				latest_funding: form.latest_funding.trim() || null,
				latest_funding_amount: form.latest_funding_amount.trim() || null,
				last_raised_at: form.last_raised_at.trim() || null,
				poc_name: form.poc_name.trim() || null,
				poc_position: form.poc_position.trim() || null,
				poc_email: form.poc_email.trim() || null,
				poc_linkedin: form.poc_linkedin.trim() || null,
				social: form.social,
				thesis_sector_ids: form.thesis_sector_ids,
				thesis_sport_ids: form.thesis_sport_ids,
				thesis_tech_tag_ids: form.thesis_tech_tag_ids,
				thesis_round_type_ids: form.thesis_round_type_ids,
				thesis_amount_min: form.thesis_amount_min.trim() ? Number(form.thesis_amount_min) : null,
				thesis_amount_max: form.thesis_amount_max.trim() ? Number(form.thesis_amount_max) : null,
				thesis_revenue_stages: form.thesis_revenue_stages,
				thesis_geo: form.thesis_geo.filter((g) => g.scope_value.trim()).map((g) => ({ scope_type: g.scope_type, scope_value: g.scope_value.trim() })),
				funds: form.funds.filter((f) => f.fund_name.trim()).map((f) => ({
					fund_name: f.fund_name.trim(), announced_date: f.announced_date || undefined,
					fund_value: f.fund_value.trim() ? Number(f.fund_value) : undefined,
					currency_code: f.currency_code || undefined, source_url: f.source_url.trim() || undefined,
				})),
			};
			let createdId: string | undefined;
			if (isEdit) await api('PATCH', `/api/admin/investors/${id}`, body);
			else {
				// Promote-from-queue: link the review row in the same create tx.
				if (promoteReviewId) body.review_id = promoteReviewId;
				const created = await api<{ id: string }>('POST', '/api/admin/investors', body); createdId = created?.id;
			}
			toast.success(isEdit ? 'Saved' : 'Created');
			onSaved(createdId);
		} catch (e) {
			toast.error((e as Error).message);
		} finally {
			setPending(false);
		}
	};

	const thesisCount = form.thesis_sector_ids.length + form.thesis_sport_ids.length + form.thesis_tech_tag_ids.length + form.thesis_round_type_ids.length;

	return (
		<Modal
			title={isEdit ? 'Edit investor' : 'New investor'}
			onClose={onClose}
			width={680}
			footer={
				<>
					<button className="btn ghost" onClick={onClose}>Cancel</button>
					<button className="btn" disabled={!form.name.trim() || pending} onClick={() => void submit()}>
						<Save size={12} /> {pending ? 'Saving…' : 'Save'}
					</button>
				</>
			}
		>
			{(
				<EnrichedFieldsProvider value={new Set(enrichedFields ?? [])}>
					{!!enrichedFields?.length && (
						<div style={{ fontSize: 12, color: 'var(--info)', padding: '8px 10px', border: '1px solid color-mix(in oklab, var(--info) 30%, transparent)', background: 'color-mix(in oklab, var(--info) 6%, transparent)', borderRadius: 'var(--radius-sm)', marginBottom: 4 }}>Highlighted fields were auto-filled by enrichment — verify before saving.</div>
					)}
					<TabbedForm
					active={tab}
					onChange={setTab}
					tabs={[
						{
							key: 'profile', label: 'Profile', node: (
								<>
									<Field label="Name"><input className="search-input" value={form.name} onChange={(e) => set('name', e.target.value)} /></Field>
									<Field label={isEdit ? 'Slug' : 'Slug (optional — auto from name)'}><input className="search-input" style={{ fontFamily: 'var(--font-mono)' }} value={form.slug} onChange={(e) => set('slug', e.target.value)} disabled={isEdit} /></Field>
									<Field label="Website"><input className="search-input" value={form.website} onChange={(e) => set('website', e.target.value)} placeholder="https://" /></Field>
									<Field name="description" label="Description"><textarea className="search-input" style={{ minHeight: 70, resize: 'vertical' }} value={form.description} onChange={(e) => set('description', e.target.value)} /></Field>
									<div style={{ display: 'grid', gridTemplateColumns: '1fr 120px', gap: 12 }}>
										<Field label="Category">
											<Select value={form.category} onChange={(v) => set('category', v)} searchable width="100%" style={{ display: 'block', width: '100%' }} placeholder="—" options={[{ value: '', label: '—' }, ...CATEGORIES.map((c) => ({ value: c, label: c.replace(/_/g, ' ') }))]} />
										</Field>
										<Field name="year_launched" label="Launched"><YearSelect value={form.year_launched} onChange={(v) => set('year_launched', v)} /></Field>
									</div>
									<Field label="Status">
										<div style={{ display: 'flex', gap: 6 }}>
											{(['active', 'paused', 'inactive'] as const).map((s) => (
												<button key={s} type="button" className={`chip ${form.status === s ? 'on' : ''}`} onClick={() => set('status', s)}>{s}</button>
											))}
										</div>
									</Field>
									<div style={{ display: 'flex', gap: 16 }}>
										<label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
											<input type="checkbox" checked={form.is_verified} onChange={(e) => set('is_verified', e.target.checked)} /> Verified
										</label>
										<label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
											<input type="checkbox" checked={form.actively_investing} onChange={(e) => set('actively_investing', e.target.checked)} /> Actively investing
										</label>
									</div>
								</>
							),
						},
						{ key: 'locsocial', label: 'Location & Social', node: (
							<>
								<Field name="hq" label="Headquarters"><LocationFields value={form.hq} onChange={(v) => set('hq', v)} /></Field>
								<EnrichedGroup name="social"><SocialLinks value={form.social} onChange={(v) => set('social', v)} /></EnrichedGroup>
							</>
						) },
						{ key: 'thesis', label: 'Thesis', hint: thesisCount, node: (
							<>
								<Field label="Sectors"><SectorCascadeMulti value={form.thesis_sector_ids} onChange={(v) => set('thesis_sector_ids', v)} /></Field>
								<Field label="Sports"><SportsPicker value={form.thesis_sport_ids} onChange={(v) => set('thesis_sport_ids', v)} /></Field>
								<Field label="Tech tags"><TechTagsPicker value={form.thesis_tech_tag_ids} onChange={(v) => set('thesis_tech_tag_ids', v)} /></Field>
								<Field label="Preferred rounds"><RoundTypesPicker value={form.thesis_round_type_ids} onChange={(v) => set('thesis_round_type_ids', v)} /></Field>
								<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
									<Field label="Cheque min (USD)"><input className="search-input" type="number" value={form.thesis_amount_min} onChange={(e) => set('thesis_amount_min', e.target.value)} /></Field>
									<Field label="Cheque max (USD)"><input className="search-input" type="number" value={form.thesis_amount_max} onChange={(e) => set('thesis_amount_max', e.target.value)} /></Field>
								</div>
								<Field label="Revenue stages">
									<div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
										{REVENUE_STAGES.map((s) => (
											<label key={s} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
												<input type="checkbox" checked={form.thesis_revenue_stages.includes(s)} onChange={(e) => set('thesis_revenue_stages', e.target.checked ? [...form.thesis_revenue_stages, s] : form.thesis_revenue_stages.filter((x) => x !== s))} />
												{s.replace(/_/g, ' ')}
											</label>
										))}
									</div>
								</Field>
								<Field label="Geography focus" hint="countries / regions / continents the investor targets">
									<div style={{ display: 'grid', gap: 8 }}>
										{form.thesis_geo.map((g, i) => {
											const upd = (patch: Partial<GeoScope>) => set('thesis_geo', form.thesis_geo.map((x, j) => (j === i ? { ...x, ...patch } : x)));
											return (
												<div key={i} style={{ display: 'grid', gridTemplateColumns: '130px 1fr auto', gap: 8, alignItems: 'center' }}>
													<Select value={g.scope_type} onChange={(v) => upd({ scope_type: v as GeoScope['scope_type'] })} width={130} options={GEO_SCOPES.map((tp) => ({ value: tp, label: tp }))} />
													<input className="search-input" placeholder="e.g. United States / Europe" value={g.scope_value} onChange={(e) => upd({ scope_value: e.target.value })} />
													<button className="btn ghost" style={{ color: 'var(--accent)' }} onClick={() => set('thesis_geo', form.thesis_geo.filter((_, j) => j !== i))}><Trash2 size={12} /></button>
												</div>
											);
										})}
										<button className="btn ghost" style={{ justifySelf: 'start' }} onClick={() => set('thesis_geo', [...form.thesis_geo, { scope_type: 'country', scope_value: '' }])}><Plus size={12} /> Add geography</button>
									</div>
								</Field>
							</>
						) },
						{ key: 'stats', label: 'Stats & Notes', node: (
							<>
								<Field name="keywords" label="Keywords"><input className="search-input" value={form.keywords} onChange={(e) => set('keywords', e.target.value)} /></Field>
								<Field name="logo_url" label="Logo URL"><input className="search-input" value={form.logo_url} onChange={(e) => set('logo_url', e.target.value)} placeholder="https://" /></Field>
								<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
									<Field name="num_employees" label="Employees"><input className="search-input" type="number" value={form.num_employees} onChange={(e) => set('num_employees', e.target.value)} /></Field>
									<Field label="# Investments"><input className="search-input" type="number" value={form.num_investments} onChange={(e) => set('num_investments', e.target.value)} /></Field>
									<Field label="# Exits"><input className="search-input" type="number" value={form.num_exits} onChange={(e) => set('num_exits', e.target.value)} /></Field>
								</div>
								<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
									<Field name="total_funding" label="Total funding (USD)"><input className="search-input" value={form.total_funding} placeholder="e.g. 1,500,000 or 2.5M" onChange={(e) => set('total_funding', e.target.value)} /></Field>
									<Field name="annual_revenue" label="Annual revenue (USD)"><input className="search-input" value={form.annual_revenue} placeholder="e.g. 1,500,000 or 2.5M" onChange={(e) => set('annual_revenue', e.target.value)} /></Field>
								</div>
								<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
									<Field label="Latest fund / round"><input className="search-input" value={form.latest_funding} onChange={(e) => set('latest_funding', e.target.value)} placeholder="e.g. Fund III" /></Field>
									<Field label="Latest amount (USD)"><input className="search-input" value={form.latest_funding_amount} placeholder="e.g. 1,500,000 or 2.5M" onChange={(e) => set('latest_funding_amount', e.target.value)} /></Field>
									<Field name="last_raised_at" label="Last raised"><input className="search-input" type="date" value={form.last_raised_at} onChange={(e) => set('last_raised_at', e.target.value)} /></Field>
								</div>
								<Field label="Analyst notes"><textarea className="search-input" style={{ minHeight: 70, resize: 'vertical' }} value={form.analyst_notes} onChange={(e) => set('analyst_notes', e.target.value)} /></Field>
							</>
						) },
						{ key: 'contact', label: 'Contact', node: (
							<>
								<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
									<Field name="poc_name" label="POC name"><input className="search-input" value={form.poc_name} onChange={(e) => set('poc_name', e.target.value)} /></Field>
									<Field name="poc_position" label="POC position"><input className="search-input" value={form.poc_position} onChange={(e) => set('poc_position', e.target.value)} /></Field>
								</div>
								<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
									<Field label="POC email"><input className="search-input" value={form.poc_email} onChange={(e) => set('poc_email', e.target.value)} placeholder="name@fund.com" /></Field>
									<Field name="poc_linkedin" label="POC LinkedIn"><input className="search-input" value={form.poc_linkedin} onChange={(e) => set('poc_linkedin', e.target.value)} placeholder="https://linkedin.com/in/…" /></Field>
								</div>
							</>
						) },
						{ key: 'funds', label: 'Funds', hint: form.funds.length || undefined, node: (
							<div style={{ display: 'grid', gap: 10 }}>
								{form.funds.length === 0 && <div style={{ fontSize: 13, color: 'var(--fg-muted)' }}>No funds yet. Add the fund vehicles this investor has raised.</div>}
								{form.funds.map((f, i) => {
									const upd = (patch: Partial<FundDraft>) => set('funds', form.funds.map((x, j) => (j === i ? { ...x, ...patch } : x)));
									return (
										<div key={i} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 10, display: 'grid', gap: 8 }}>
											<div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 8 }}>
												<input className="search-input" placeholder="Fund name" value={f.fund_name} onChange={(e) => upd({ fund_name: e.target.value })} />
												<input className="search-input" type="date" value={f.announced_date} onChange={(e) => upd({ announced_date: e.target.value })} />
											</div>
											<div style={{ display: 'grid', gridTemplateColumns: '1fr 120px 2fr auto', gap: 8, alignItems: 'center' }}>
												<input className="search-input" type="number" placeholder="Value" value={f.fund_value} onChange={(e) => upd({ fund_value: e.target.value })} />
												<CurrencySelect value={f.currency_code} onChange={(v) => upd({ currency_code: v })} />
												<input className="search-input" placeholder="Source URL" value={f.source_url} onChange={(e) => upd({ source_url: e.target.value })} />
												<button className="btn ghost" style={{ color: 'var(--accent)' }} onClick={() => set('funds', form.funds.filter((_, j) => j !== i))}><Trash2 size={12} /></button>
											</div>
										</div>
									);
								})}
								<button className="btn ghost" style={{ justifySelf: 'start' }} onClick={() => set('funds', [...form.funds, emptyFund()])}><Plus size={12} /> Add fund</button>
							</div>
						) },
					]}
				/>
				</EnrichedFieldsProvider>
			)}
		</Modal>
	);
}

/**
 * Multi-select sector picker for investor thesis (legacy single-pick cascade
 * picks one node; thesis wants several). Renders the cascade once per chosen id
 * plus an empty cascade to add another.
 */
function SectorCascadeMulti({ value, onChange }: { value: string[]; onChange: (ids: string[]) => void }) {
	const setAt = (idx: number, id: string) => {
		const next = [...value];
		if (!id) next.splice(idx, 1);
		else next[idx] = id;
		onChange(Array.from(new Set(next)));
	};
	const addNew = (id: string) => { if (id && !value.includes(id)) onChange([...value, id]); };
	return (
		<div style={{ display: 'grid', gap: 8 }}>
			{value.map((id, idx) => <SectorCascade key={id} value={id} onChange={(v) => setAt(idx, v)} />)}
			<SectorCascade value="" onChange={addNew} />
		</div>
	);
}

