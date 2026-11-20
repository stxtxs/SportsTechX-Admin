'use client';

import { useState, type CSSProperties } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import useSWR, { useSWRConfig } from 'swr';
import { toast } from 'sonner';
import { Plus, Save, Trash2, Building2, BadgeCheck, Rocket, Coins, Layers, CircleDollarSign, GitMerge } from 'lucide-react';
import { api } from '@/lib/api';
import { Select } from '@/components/select';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useInitialQuery } from '@/hooks/use-initial-query';
import { useConfirm } from '@/components/confirm';
import { Modal } from '@/components/modal';
import { PageHeader, AsyncState, Loading, ErrorState, StatCard, RichStatCard, StatsPanel, PillTabs, Section, Pager, SortableTh } from '@/components/atoms';
import { PieDonut, PieLegend, toSegments, type Bucket } from '@/components/charts';
import { FilterBar, FilterSelect, StatStrip, BoolFilter, FilterRange, RefSlugFilter, SectorTierFilter } from '@/components/filters';
import { CsvImportButton, CsvTemplateButton, CsvCheckButton } from '@/components/csv-import';
import { YearSelect } from '@/components/year-select';
import { ImageInput } from '@/components/image-input';
import { TabbedForm, Field, useTabs, EnrichedFieldsProvider, EnrichedGroup } from '@/components/tabbed-form';
import {
	SectorCascade, SportsPicker, TechTagsPicker, LocationFields, SocialLinks,
	RoundTypeSelect, CurrencySelect, InvestorPicker, CompanySelectOne,
	EMPTY_SOCIAL, EMPTY_LOCATION, type SocialValue, type LocationValue, type DealInvestor,
} from '@/components/entity-pickers';
import { DealModal, DealsView, type StagedDeal } from '@/components/admin-views/deals';
import { AcquisitionModal, AcquisitionsView, type StagedAcq } from '@/components/admin-views/acquisitions';
import { ClaimsView } from '@/components/admin-views/claims';
import { DataRequestsView } from '@/components/admin-views/data-requests';
import { DateRangePicker, type RangeValue } from '@/components/date-range-picker';
import { confirmDelete } from '@/lib/delete-impact';
import { MergeModal } from '@/components/merge-modal';

interface Company {
	id: string;
	name: string;
	is_hidden?: boolean;
	slug?: string;
	website?: string | null;
	description?: string | null;
	primary_sector?: string | null;
	sector_id?: string | null;
	hq_country?: string | null;
	hq_city?: string | null;
	founded_year?: number | null;
	status?: string | null;
}
interface CompaniesResponse { data: Company[]; total: number; totalPages: number }
interface CompanyStats { total: number; verified: number; unicorn: number; raising: number; total_rows?: number; this_year?: number | null; last_year?: number | null; yoy_change?: number | null; verified_this_month?: number; verified_last_month?: number; verified_mom?: number | null; by_status: Bucket[]; by_sector: Bucket[]; by_business_model: Bucket[] }

const STATUSES = ['active', 'inactive', 'needs_review', 'dead', 'acquired', 'ipo', 'not_sportstech'] as const;
// d2c/b2g/other dropped - unused across all records (verified) and not wanted.
const BUSINESS_MODELS = ['b2b', 'b2c', 'b2b2c'] as const;

export function CompaniesView({ embedded = false }: { embedded?: boolean }) {
	const { mutate } = useSWRConfig();
	const ask = useConfirm();
	const [search, setSearch] = useState(useInitialQuery());
	const debouncedSearch = useDebouncedValue(search);
	const [status, setStatus] = useState('');
	const [sector, setSector] = useState('');
	const [verified, setVerified] = useState('');
	const [sport, setSport] = useState('');
	const [country, setCountry] = useState('');
	const [raising, setRaising] = useState('');
	const [unicorn, setUnicorn] = useState('');
	const [foundedMin, setFoundedMin] = useState('');
	const [foundedMax, setFoundedMax] = useState('');
	const [fundingMin, setFundingMin] = useState('');
	const [fundingMax, setFundingMax] = useState('');
	const [page, setPage] = useState(1);
	const [sort, setSort] = useState('-created_at');
	const onSort = (s: string) => { setSort(s); setPage(1); };
	const reset1 = () => setPage(1);
	const [creating, setCreating] = useState(false);
	const [editingId, setEditingId] = useState<string | null>(null);
	const [removePending, setRemovePending] = useState(false);
	const [merging, setMerging] = useState<{ id: string; name: string } | null>(null);

	const { data, error, isLoading } = useSWR<CompaniesResponse>(
		['/api/companies', {
			search: debouncedSearch || undefined, status: status || undefined, sector: sector || undefined,
			is_verified: verified || undefined, sport: sport || undefined, country: country.trim() || undefined,
			is_actively_raising: raising || undefined, is_unicorn: unicorn || undefined,
			founded_year_min: foundedMin || undefined, founded_year_max: foundedMax || undefined,
			min_funding: fundingMin || undefined, max_funding: fundingMax || undefined,
			page, limit: 30, sort, include_hidden: 1,   // admins see hidden (test) records; users never do
		}],
		{ dedupingInterval: 30_000 },
	);
	const stats = useSWR<CompanyStats>(['/api/admin/stats/companies'], { dedupingInterval: 60_000 });
	const statusSegments = toSegments(stats.data?.by_status ?? []);
	const sectorSegments = toSegments(stats.data?.by_sector ?? []);

	const refresh = () => mutate((key) => Array.isArray(key) && key[0] === '/api/companies');

	const remove = async (id: string, name: string) => {
		if (!(await confirmDelete(ask, 'company', id, name))) return;
		setRemovePending(true);
		try {
			await api('DELETE', `/api/admin/companies/${id}`);
			toast.success('Deleted');
			void refresh();
		} catch (e) {
			toast.error((e as Error).message);
		} finally {
			setRemovePending(false);
		}
	};

	const companies = data?.data ?? [];
	return (
		<div>
			{!embedded && <PageHeader kicker={`Database · ${(stats.data?.total ?? data?.total ?? 0).toLocaleString()} companies`} title="Companies" />}

			{!embedded && (
				<StatsPanel>
					<StatStrip cols={5}>
						<RichStatCard label="Total Companies" tone="blue" Icon={Building2} loading={stats.isLoading} value={(stats.data?.total ?? 0).toLocaleString()}
							totalRows={stats.data?.total_rows} thisYear={stats.data?.this_year} lastYear={stats.data?.last_year} yoy={stats.data?.yoy_change} />
						<RichStatCard label="Verified" tone="green" Icon={BadgeCheck} loading={stats.isLoading} value={(stats.data?.verified ?? 0).toLocaleString()} />
						<RichStatCard label="Unicorns" tone="purple" Icon={Rocket} loading={stats.isLoading} value={(stats.data?.unicorn ?? 0).toLocaleString()} />
						<RichStatCard label="Actively raising" tone="amber" Icon={Coins} loading={stats.isLoading} value={(stats.data?.raising ?? 0).toLocaleString()} />
						<RichStatCard label="Sectors covered" tone="teal" Icon={Layers} loading={stats.isLoading} value={(stats.data?.by_sector?.length ?? 0).toLocaleString()} />
					</StatStrip>
				</StatsPanel>
			)}

			{!embedded && (
				<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)', marginBottom: 'var(--space-5)' }}>
					<Section title="By status" meta="companies" center>
						<AsyncState loading={stats.isLoading} error={stats.error} empty={statusSegments.length === 0} emptyMsg="No data" onRetry={() => void stats.mutate()}>
							<div style={{ display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
								<PieDonut segments={statusSegments} size={170} mode="donut" />
								<div style={{ flex: 1, minWidth: 160 }}><PieLegend segments={statusSegments} /></div>
							</div>
						</AsyncState>
					</Section>
					<Section title="Top sectors" meta="companies" center>
						<AsyncState loading={stats.isLoading} error={stats.error} empty={sectorSegments.length === 0} emptyMsg="No data" onRetry={() => void stats.mutate()}>
							<PieDonut segments={sectorSegments} mode="bar" />
						</AsyncState>
					</Section>
				</div>
			)}

			<FilterBar>
				<input
					className="search-input"
					style={{ flex: '0 0 280px', height: 32 }}
					placeholder="Search…"
					value={search}
					onChange={(e) => { setSearch(e.target.value); setPage(1); }}
				/>
				<FilterSelect ariaLabel="Status" value={status} onChange={(v) => { setStatus(v); reset1(); }} options={[...STATUSES]} allLabel="All statuses" />
				<SectorTierFilter value={sector} onChange={(v) => { setSector(v); reset1(); }} allTopLabel="All sectors" />
				<RefSlugFilter kind="sports" ariaLabel="Sport" value={sport} onChange={(v) => { setSport(v); reset1(); }} allLabel="All sports" />
				<FilterSelect ariaLabel="Verified" value={verified} onChange={(v) => { setVerified(v); reset1(); }} options={[{ value: 'true', label: 'Verified' }, { value: 'false', label: 'Unverified' }]} allLabel="Any verification" />
				<input className="search-input" style={{ height: 32, width: 130 }} placeholder="Country" value={country} onChange={(e) => { setCountry(e.target.value); reset1(); }} />
				<BoolFilter ariaLabel="Actively raising" value={raising} onChange={(v) => { setRaising(v); reset1(); }} yesLabel="Raising" noLabel="Not raising" allLabel="Any raising" />
				<BoolFilter ariaLabel="Unicorn" value={unicorn} onChange={(v) => { setUnicorn(v); reset1(); }} yesLabel="Unicorn" noLabel="Non-unicorn" allLabel="Any size" />
				<FilterRange label="Founded" min={foundedMin} max={foundedMax} onMin={(v) => { setFoundedMin(v); reset1(); }} onMax={(v) => { setFoundedMax(v); reset1(); }} width={64} />
				<FilterRange label="Funding $" min={fundingMin} max={fundingMax} onMin={(v) => { setFundingMin(v); reset1(); }} onMax={(v) => { setFundingMax(v); reset1(); }} />
				<div style={{ flex: 1 }} />
				<CsvImportButton entity="companies" onDone={() => void refresh()} />
				<CsvTemplateButton entity="companies" />
				<CsvCheckButton entity="companies" />
				<button className="btn" onClick={() => setCreating(true)}><Plus size={12} /> Add company</button>
			</FilterBar>

			{(creating || editingId) && (
				<CompanyModal
					id={editingId}
					onClose={() => { setCreating(false); setEditingId(null); }}
					onSaved={() => { setCreating(false); setEditingId(null); void refresh(); }}
				/>
			)}
			{merging && <MergeModal kind="company" id={merging.id} name={merging.name} onClose={() => setMerging(null)} onMerged={() => { setMerging(null); void refresh(); }} />}

			<div className="card">
				<AsyncState loading={isLoading} error={error} empty={companies.length === 0} emptyMsg={search ? 'No companies match.' : 'No companies yet.'} onRetry={() => void refresh()}>
					<table className="data-table">
						<thead><tr><SortableTh label="Name" field="name" sort={sort} onSort={onSort} /><th>Slug</th><th>Sector</th><th>HQ</th><th>Status</th><th style={{ textAlign: 'right' }} /></tr></thead>
						<tbody>
							{companies.map((c) => (
								<tr key={c.id}>
									<td>{c.name}</td>
									<td className="num">{c.slug ?? '—'}</td>
									<td>{c.primary_sector ?? '—'}</td>
									<td>{c.hq_country ?? '—'}</td>
									<td>{c.status ?? '—'}{c.is_hidden && <span className="tag" style={{ marginLeft: 6 }} title="Hidden from users">Hidden</span>}</td>
									<td style={{ textAlign: 'right', display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
										<button className="btn ghost" onClick={() => setEditingId(c.id)}>Edit</button>
										<button className="btn ghost" title="Merge this duplicate into another company" onClick={() => setMerging({ id: c.id, name: c.name })}>Merge</button>
										<button className="btn ghost" style={{ color: 'var(--accent)' }} disabled={removePending} onClick={() => void remove(c.id, c.name)}>
											<Trash2 size={12} />
										</button>
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

interface CompanyForm {
	name: string;
	website: string;
	slug: string;
	description: string;
	custom_logo_url: string;
	sector_id: string;
	business_model: string;
	hq: LocationValue;
	founded_year: string;
	ipo_date: string;
	status: string;
	is_verified: boolean;
	is_unicorn: boolean;
	is_hidden: boolean;
	is_actively_raising: boolean;
	raising_amount: string; raising_round: string; raising_valuation: string; raising_pitch_deck_url: string;
	social: SocialValue;
	sport_ids: string[];
	tech_tag_ids: string[];
	poc_first_name: string; poc_last_name: string; poc_job_position: string; poc_email: string; poc_linkedin: string;
	poc_personal_email: string; poc_personal_linkedin: string;
	accelerator: string; cohort: string;
}

const EMPTY_COMPANY: CompanyForm = {
	name: '', website: '', slug: '', description: '', custom_logo_url: '',
	sector_id: '', business_model: '', hq: { ...EMPTY_LOCATION },
	founded_year: '', ipo_date: '', status: 'active',
	is_verified: false, is_unicorn: false, is_hidden: false, is_actively_raising: false,
	raising_amount: '', raising_round: '', raising_valuation: '', raising_pitch_deck_url: '',
	social: { ...EMPTY_SOCIAL }, sport_ids: [], tech_tag_ids: [],
	poc_first_name: '', poc_last_name: '', poc_job_position: '', poc_email: '', poc_linkedin: '', poc_personal_email: '', poc_personal_linkedin: '', accelerator: '', cohort: '',
};

interface CompanyEdit extends Company {
	custom_logo_url?: string | null;
	business_model?: string | null;
	ipo_date?: string | null;
	is_verified?: boolean;
	is_unicorn?: boolean;
	is_hidden?: boolean;
	is_actively_raising?: boolean;
	actively_raising_amount?: string | number | null; actively_raising_round?: string | null;
	actively_raising_valuation?: string | number | null; actively_raising_pitch_deck_url?: string | null;
	twitter_url?: string | null; instagram_url?: string | null; facebook_url?: string | null;
	linkedin_url?: string | null; youtube_url?: string | null; email?: string | null;
	hq_continent?: string | null; hq_region?: string | null; hq_state?: string | null; hq_report_region?: string | null;
	poc_first_name?: string | null; poc_last_name?: string | null; poc_job_position?: string | null; poc_email?: string | null; poc_linkedin?: string | null;
	poc_personal_email?: string | null; poc_personal_linkedin?: string | null;
	accelerator?: string | null; cohort?: string | null;
	sport_ids?: string[]; tech_tag_ids?: string[];
}

function toCompanyForm(h: CompanyEdit): CompanyForm {
	return {
		name: h.name ?? '', website: h.website ?? '', slug: h.slug ?? '', description: h.description ?? '',
		custom_logo_url: h.custom_logo_url ?? '', sector_id: h.sector_id ?? '', business_model: h.business_model ?? '',
		hq: { country: h.hq_country ?? '', city: h.hq_city ?? '', continent: h.hq_continent ?? '', region: h.hq_region ?? '', state: h.hq_state ?? '', report_region: h.hq_report_region ?? '' },
		founded_year: h.founded_year ? String(h.founded_year) : '',
		ipo_date: h.ipo_date ? String(h.ipo_date).slice(0, 10) : '',
		status: h.status ?? 'active', is_verified: !!h.is_verified, is_unicorn: !!h.is_unicorn, is_hidden: !!h.is_hidden, is_actively_raising: !!h.is_actively_raising,
		raising_amount: h.actively_raising_amount != null ? String(h.actively_raising_amount) : '',
		raising_round: h.actively_raising_round ?? '',
		raising_valuation: h.actively_raising_valuation != null ? String(h.actively_raising_valuation) : '',
		raising_pitch_deck_url: h.actively_raising_pitch_deck_url ?? '',
		social: {
			twitter_url: h.twitter_url ?? '', instagram_url: h.instagram_url ?? '', facebook_url: h.facebook_url ?? '',
			linkedin_url: h.linkedin_url ?? '', youtube_url: h.youtube_url ?? '', email: h.email ?? '',
		},
		sport_ids: h.sport_ids ?? [], tech_tag_ids: h.tech_tag_ids ?? [],
		poc_first_name: h.poc_first_name ?? '', poc_last_name: h.poc_last_name ?? '', poc_job_position: h.poc_job_position ?? '',
		poc_email: h.poc_email ?? '', poc_linkedin: h.poc_linkedin ?? '', poc_personal_email: h.poc_personal_email ?? '', poc_personal_linkedin: h.poc_personal_linkedin ?? '', accelerator: h.accelerator ?? '', cohort: h.cohort ?? '',
	};
}

// Outer modal fetches the edit payload (when editing) and only mounts the form
// once data is ready, so the form can seed useState from props directly — no
// setState-in-effect, no cascading renders.
export function CompanyModal({ id, onClose, onSaved, seed, promotePipelineId, enrichedFields }: { id: string | null; onClose: () => void; onSaved: (createdId?: string) => void; seed?: Partial<CompanyForm>; promotePipelineId?: string; enrichedFields?: string[] }) {
	const isEdit = !!id;
	const { data: hydrated } = useSWR<CompanyEdit>(isEdit ? [`/api/admin/companies/${id}/edit`] : null, { revalidateOnFocus: false });
	if (isEdit && !hydrated) return <Modal title="Edit company" onClose={onClose}><Loading msg="Loading company…" /></Modal>;
	return <CompanyForm id={id} initial={hydrated ? toCompanyForm(hydrated) : { ...EMPTY_COMPANY, ...seed }} onClose={onClose} onSaved={onSaved} promotePipelineId={promotePipelineId} enrichedFields={enrichedFields} />;
}

// ── Funding tab: a company's deals, managed inline via the shared DealModal ──
function CompanyFundingTab({ companyId }: { companyId: string }) {
	const { mutate } = useSWRConfig();
	const ask = useConfirm();
	const { data, isLoading, error } = useSWR<{ data: Array<{ id: string; round_type_name?: string | null; announced_year?: number | null; amount_usd?: string | null; status?: string | null }> }>(
		['/api/deals', { company_id: companyId, limit: 100, sort: '-announced_date' }], { dedupingInterval: 15_000 },
	);
	const [modal, setModal] = useState<{ id: string | null } | null>(null);
	const refresh = () => mutate((k) => Array.isArray(k) && k[0] === '/api/deals');
	const rows = data?.data ?? [];
	const remove = async (dealId: string) => {
		if (!(await ask('Delete this funding round?'))) return;
		try { await api('DELETE', `/api/admin/deals/${dealId}`); toast.success('Deleted'); refresh(); }
		catch (e) { toast.error((e as Error).message); }
	};
	const amt = (v?: string | null) => { const n = Number(v); return v && Number.isFinite(n) && n > 0 ? (n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${n.toLocaleString()}`) : 'Undisclosed'; };
	return (
		<div style={{ display: 'grid', gap: 10 }}>
			<div style={{ display: 'flex', justifyContent: 'flex-end' }}>
				<button className="btn" onClick={() => setModal({ id: null })}><Plus size={12} /> Add funding round</button>
			</div>
			<AsyncState loading={isLoading} error={error} empty={rows.length === 0} emptyMsg="No funding rounds yet." onRetry={() => void refresh()}>
				<table className="data-table">
					<thead><tr><th>Round</th><th>Year</th><th>Amount</th><th>Status</th><th /></tr></thead>
					<tbody>
						{rows.map((d) => (
							<tr key={d.id}>
								<td>{d.round_type_name ?? '—'}</td>
								<td className="num">{d.announced_year ?? '—'}</td>
								<td className="num">{amt(d.amount_usd)}</td>
								<td>{d.status ?? '—'}</td>
								<td style={{ textAlign: 'right', display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
									<button className="btn ghost" onClick={() => setModal({ id: d.id })}>Edit</button>
									<button className="btn ghost" style={{ color: 'var(--accent)' }} onClick={() => void remove(d.id)}><Trash2 size={12} /></button>
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</AsyncState>
			{modal && <DealModal id={modal.id} lockedCompanyId={companyId} onClose={() => setModal(null)} onSaved={() => { setModal(null); refresh(); }} />}
		</div>
	);
}

// ── M&A tab: acquisitions where this company is acquiree or acquirer ──
function CompanyMaTab({ companyId }: { companyId: string }) {
	const { mutate } = useSWRConfig();
	const ask = useConfirm();
	type Row = { id: string; acquiree_name?: string | null; acquirer_name?: string | null; acquiree_company_id?: string | null; acquisition_year?: number | null; acquisition_type?: string | null };
	const asTarget = useSWR<{ data: Row[] }>(['/api/acquisitions', { acquiree_company_id: companyId, limit: 50 }], { dedupingInterval: 15_000 });
	const asBuyer = useSWR<{ data: Row[] }>(['/api/acquisitions', { acquirer_company_id: companyId, limit: 50 }], { dedupingInterval: 15_000 });
	const [modal, setModal] = useState<{ id: string | null } | null>(null);
	const refresh = () => mutate((k) => Array.isArray(k) && k[0] === '/api/acquisitions');
	const seen = new Set<string>();
	const rows = [...(asTarget.data?.data ?? []), ...(asBuyer.data?.data ?? [])].filter((r) => (seen.has(r.id) ? false : seen.add(r.id)));
	const remove = async (acqId: string) => {
		if (!(await ask('Delete this acquisition?'))) return;
		try { await api('DELETE', `/api/admin/acquisitions/${acqId}`); toast.success('Deleted'); refresh(); }
		catch (e) { toast.error((e as Error).message); }
	};
	return (
		<div style={{ display: 'grid', gap: 10 }}>
			<div style={{ display: 'flex', justifyContent: 'flex-end' }}>
				<button className="btn" onClick={() => setModal({ id: null })}><Plus size={12} /> Add acquisition</button>
			</div>
			<AsyncState loading={asTarget.isLoading || asBuyer.isLoading} error={asTarget.error || asBuyer.error} empty={rows.length === 0} emptyMsg="No acquisitions involving this company." onRetry={() => void refresh()}>
				<table className="data-table">
					<thead><tr><th>Role</th><th>Acquiree</th><th>Acquirer</th><th>Year</th><th /></tr></thead>
					<tbody>
						{rows.map((a) => (
							<tr key={a.id}>
								<td>{a.acquiree_company_id === companyId ? 'Target' : 'Acquirer'}</td>
								<td>{a.acquiree_name ?? '—'}</td>
								<td>{a.acquirer_name ?? '—'}</td>
								<td className="num">{a.acquisition_year ?? '—'}</td>
								<td style={{ textAlign: 'right', display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
									<button className="btn ghost" onClick={() => setModal({ id: a.id })}>Edit</button>
									<button className="btn ghost" style={{ color: 'var(--accent)' }} onClick={() => void remove(a.id)}><Trash2 size={12} /></button>
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</AsyncState>
			{modal && <AcquisitionModal id={modal.id} subjectCompanyId={companyId} onClose={() => setModal(null)} onSaved={() => { setModal(null); refresh(); }} />}
		</div>
	);
}

// ── Claim tab: manage the company's ownership claim (view + create on behalf) ──
interface CompanyClaimRow {
	id: string;
	is_verified: boolean;
	shareable_token: string | null;
	created_at: string;
	profile_id: string | null;
	position_at_company: string | null;
	company_email: string | null;
	claimant_name: string | null;
	claimant_email: string | null;
	claimant_linkedin: string | null;
	claimant_city: string | null;
	claimant_country: string | null;
	picked_up_by_email: string | null;
	is_actively_raising: boolean | null;
	actively_raising_amount: string | number | null;
	actively_raising_round: string | null;
	actively_raising_valuation: string | number | null;
}

/** onFlags keeps the parent CompanyForm in sync when Verified / Actively-raising
 *  are changed here, so saving the modal (whose Status tab holds the same flags)
 *  never clobbers a change made on this tab. */
function CompanyClaimTab({ companyId, onFlags }: { companyId: string; onFlags?: (f: { is_verified?: boolean; is_actively_raising?: boolean }) => void }) {
	const { mutate } = useSWRConfig();
	const { data, isLoading, error } = useSWR<{ claims: CompanyClaimRow[] }>(
		[`/api/admin/companies/${companyId}/claim`], { dedupingInterval: 10_000 },
	);
	const refresh = () => mutate((k) => Array.isArray(k) && k[0] === `/api/admin/companies/${companyId}/claim`);
	const claims = data?.claims ?? [];
	const [busy, setBusy] = useState(false);
	const [adding, setAdding] = useState(false);

	const act = async (fn: () => Promise<unknown>, ok: string, after?: () => void) => {
		setBusy(true);
		try { await fn(); toast.success(ok); after?.(); refresh(); }
		catch (e) { toast.error((e as Error).message); }
		finally { setBusy(false); }
	};
	// Several people may be verified for one company. The public badge stays on
	// while anyone is (the server re-derives it on un-verify), so mirror that here.
	const setVerified = (cid: string, on: boolean) => act(
		() => api('POST', `/api/admin/claims/${cid}/${on ? 'verify' : 'unverify'}`, on ? { send_email: false } : undefined),
		on ? 'Claim verified' : 'Verification removed',
		() => onFlags?.({ is_verified: on || claims.some((c) => c.id !== cid && c.is_verified) }));
	// Actively raising is a COMPANY flag (same for every claimant); the endpoint just
	// needs any claim on the company to find it.
	const setRaising = (on: boolean) => claims[0] && act(
		() => api('POST', `/api/admin/claims/${claims[0].id}/toggle-active`, { active: on }),
		on ? 'Marked actively raising' : 'Marked not raising', () => onFlags?.({ is_actively_raising: on }));
	const sendEmail = (cid: string) => act(() => api('POST', `/api/admin/claims/${cid}/send-email`), 'Verified-claim email sent to claimant');
	const copyLink = (token: string) => { void navigator.clipboard.writeText(`${window.location.origin}/verified/${token}`); toast.success('Shareable link copied'); };
	const money = (v: string | number | null) => { const n = Number(v); return v != null && Number.isFinite(n) && n > 0 ? `$${n.toLocaleString()}` : '—'; };

	if (isLoading) return <Loading />;
	if (error) return <ErrorState error={error} onRetry={() => void refresh()} />;
	if (claims.length === 0) return <CreateClaimOnBehalf companyId={companyId} onDone={refresh} onFlags={onFlags} />;

	const co = claims[0]; // entity-level raise detail is identical on every row
	const verifiedCount = claims.filter((c) => c.is_verified).length;

	return (
		<div style={{ display: 'grid', gap: 14 }}>
			<div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
				<div style={{ fontWeight: 700, fontSize: 14 }}>People claiming this company</div>
				<span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>{claims.length} · {verifiedCount} verified — several people from the same company can be verified</span>
			</div>

			<div style={{ display: 'grid', gap: 10, padding: 12, border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg-2)' }}>
				<div className="co-stat-label">Company-level</div>
				<div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
					<button className={`tg ${co.is_actively_raising ? 'on' : ''}`} disabled={busy} onClick={() => void setRaising(!co.is_actively_raising)} aria-label="Toggle actively raising"><span className="tg-knob" /></button>
					<span><strong>Actively raising</strong> <span style={{ color: 'var(--fg-muted)' }}>— currently fundraising (applies to the company, not one person)</span></span>
				</div>
				{co.is_actively_raising && (
					<div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, fontSize: 13 }}>
						<div><div className="co-stat-label">Amount</div>{money(co.actively_raising_amount)}</div>
						<div><div className="co-stat-label">Round</div>{co.actively_raising_round || '—'}</div>
						<div><div className="co-stat-label">Valuation</div>{money(co.actively_raising_valuation)}</div>
						<div style={{ gridColumn: '1 / -1', fontSize: 11, color: 'var(--fg-muted)' }}>Edit these on the Status tab.</div>
					</div>
				)}
			</div>

			{claims.map((claim) => (
				<div key={claim.id} className="card" style={{ padding: 14, display: 'grid', gap: 12 }}>
					{!claim.profile_id && (
						<div style={{ fontSize: 12, color: 'var(--fg-2)', background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px' }}>
							<span className="tag warn">Pending signup</span> This user hasn’t signed up yet. When they create an account with <strong>{claim.claimant_email}</strong>, this claim links to it automatically.
						</div>
					)}
					<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: 13 }}>
						<div><div className="co-stat-label">Claimed by</div>{claim.claimant_name ?? '—'}</div>
						<div><div className="co-stat-label">Email</div>{claim.claimant_email ?? '—'}</div>
						<div><div className="co-stat-label">Position</div>{claim.position_at_company || '—'}</div>
						<div><div className="co-stat-label">Location</div>{[claim.claimant_city, claim.claimant_country].filter(Boolean).join(', ') || '—'}</div>
						{claim.claimant_linkedin && (
							<div><div className="co-stat-label">LinkedIn</div><a href={claim.claimant_linkedin.startsWith('http') ? claim.claimant_linkedin : `https://${claim.claimant_linkedin}`} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>View profile</a></div>
						)}
						<div><div className="co-stat-label">Submitted</div>{new Date(claim.created_at).toLocaleDateString()}</div>
					</div>
					<div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, flexWrap: 'wrap' }}>
						<button className={`tg ${claim.is_verified ? 'on' : ''}`} disabled={busy} onClick={() => void setVerified(claim.id, !claim.is_verified)} aria-label="Toggle verified"><span className="tg-knob" /></button>
						<span style={{ flex: 1 }}><strong>Verified</strong> <span style={{ color: 'var(--fg-muted)' }}>— this person is verified for the company (the public badge stays on while anyone is)</span></span>
						{claim.is_verified && <button className="btn ghost" disabled={busy} onClick={() => void sendEmail(claim.id)} title="Email the claimant that their claim is verified">Send email</button>}
						{claim.is_verified && claim.shareable_token && <button className="btn ghost" onClick={() => copyLink(claim.shareable_token!)}>Copy verified link</button>}
					</div>
				</div>
			))}

			{adding
				? <CreateClaimOnBehalf companyId={companyId} hasClaims onDone={() => { setAdding(false); refresh(); }} onFlags={onFlags} />
				: <div><button className="btn ghost" onClick={() => setAdding(true)}>+ Create a claim on behalf of another person</button></div>}
		</div>
	);
}

function CreateClaimOnBehalf({ companyId, onDone, onFlags, hasClaims = false }: { companyId: string; onDone: () => void; onFlags?: (f: { is_verified?: boolean; is_actively_raising?: boolean }) => void; hasClaims?: boolean }) {
	const [f, setF] = useState({ user_email: '', company_email: '', first_name: '', last_name: '', position: '', linkedin: '', city: '', country: '' });
	const [verified, setVerified] = useState(false);
	const [raising, setRaising] = useState(false);
	const [raiseAmount, setRaiseAmount] = useState('');
	const [raiseRound, setRaiseRound] = useState('');
	const [raiseValuation, setRaiseValuation] = useState('');
	const [pending, setPending] = useState(false);
	const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));

	const submit = async () => {
		if (!f.user_email.trim()) { toast.error('User email is required.'); return; }
		setPending(true);
		try {
			const body: Record<string, unknown> = { user_email: f.user_email.trim() };
			for (const k of ['company_email', 'first_name', 'last_name', 'position', 'linkedin', 'city', 'country'] as const) {
				if (f[k].trim()) body[k] = f[k].trim();
			}
			const created = await api<{ id: string }>('POST', `/api/admin/companies/${companyId}/claim`, body);
			// Verify + active-raise are applied through the vetted claim/company
			// endpoints so their side-effects (badge sync, report, cache) all run.
			if (verified && created?.id) await api('POST', `/api/admin/claims/${created.id}/verify`, { send_email: false });
			if (raising) {
				await api('PATCH', `/api/admin/companies/${companyId}`, {
					is_actively_raising: true,
					actively_raising_amount: raiseAmount.trim() ? Number(raiseAmount) : undefined,
					actively_raising_round: raiseRound.trim() || undefined,
					actively_raising_valuation: raiseValuation.trim() ? Number(raiseValuation) : undefined,
				});
			}
			if (verified || raising) onFlags?.({ ...(verified ? { is_verified: true } : {}), ...(raising ? { is_actively_raising: true } : {}) });
			toast.success('Claim created');
			onDone();
		} catch (e) { toast.error((e as Error).message); }
		finally { setPending(false); }
	};

	return (
		<div style={{ display: 'grid', gap: 12 }}>
			<div style={{ fontSize: 13, color: 'var(--fg-2)' }}>
				{hasClaims
					? 'Add another person from this company. Once verified, they can submit edit requests too — several people per company can be verified.'
					: 'No claim exists for this company. Create one on behalf of a user to enable the verified badge and let them submit edit requests.'}
			</div>
			<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
				<Field label="User email *" hint="the person's login email — links the claim to their account"><input className="search-input" value={f.user_email} onChange={(e) => set('user_email', e.target.value)} placeholder="user@company.com" /></Field>
				<Field label="Company email" hint="public contact address"><input className="search-input" value={f.company_email} onChange={(e) => set('company_email', e.target.value)} placeholder="contact@company.com" /></Field>
			</div>
			<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
				<Field label="First name"><input className="search-input" value={f.first_name} onChange={(e) => set('first_name', e.target.value)} /></Field>
				<Field label="Last name"><input className="search-input" value={f.last_name} onChange={(e) => set('last_name', e.target.value)} /></Field>
			</div>
			<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
				<Field label="Position at company"><input className="search-input" value={f.position} onChange={(e) => set('position', e.target.value)} placeholder="CEO, Founder, etc." /></Field>
				<Field label="LinkedIn"><input className="search-input" value={f.linkedin} onChange={(e) => set('linkedin', e.target.value)} placeholder="https://linkedin.com/in/…" /></Field>
			</div>
			<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
				<Field label="City"><input className="search-input" value={f.city} onChange={(e) => set('city', e.target.value)} /></Field>
				<Field label="Country"><input className="search-input" value={f.country} onChange={(e) => set('country', e.target.value)} /></Field>
			</div>
			<div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, display: 'grid', gap: 10 }}>
				<div className="co-stat-label">Verification options</div>
				<label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
					<input type="checkbox" checked={verified} onChange={(e) => setVerified(e.target.checked)} /> Verify immediately <span style={{ color: 'var(--fg-muted)' }}>— verifies this person (turns the public badge on if it isn't already)</span>
				</label>
				<label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
					<input type="checkbox" checked={raising} onChange={(e) => setRaising(e.target.checked)} /> Mark actively raising
				</label>
				{raising && (
					<div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, padding: 12, border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg-2)' }}>
						<Field label="Amount ($)"><input className="search-input" type="number" value={raiseAmount} onChange={(e) => setRaiseAmount(e.target.value)} placeholder="target raise" /></Field>
						<Field label="Round"><input className="search-input" value={raiseRound} onChange={(e) => setRaiseRound(e.target.value)} placeholder="e.g. Series A" /></Field>
						<Field label="Valuation ($)"><input className="search-input" type="number" value={raiseValuation} onChange={(e) => setRaiseValuation(e.target.value)} placeholder="pre/post" /></Field>
					</div>
				)}
			</div>
			<div style={{ display: 'flex', justifyContent: 'flex-end' }}>
				<button className="btn" disabled={pending || !f.user_email.trim()} onClick={() => void submit()}>{pending ? 'Creating…' : 'Create claim'}</button>
			</div>
		</div>
	);
}

// ── Staged Funding / M&A tabs (NEW company) ──────────────────────────────────
// Drafts are held in parent form state and created atomically alongside the
// company on save (no company_id exists yet). The "Add" action expands an
// inline editor in place — no child modal — matching the legacy admin's flow.

const DEAL_STATUSES = ['active', 'inactive', 'not_sportstech', 'website_error'] as const;
const SIZE_BUCKETS = ['under_1m', 'from_1m_to_10m', 'from_10m_to_100m', 'over_100m'] as const;
const ACQ_TYPES = ['acquisition', 'merger', 'asset_purchase'] as const;
const PARTY_MODELS = ['b2b', 'b2c', 'b2b2c'] as const;

function fmtStagedAmount(v: string): string {
	const n = Number(v);
	if (!Number.isFinite(n) || n <= 0) return '—';
	if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
	if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
	if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
	return `$${n}`;
}

const editorBox: CSSProperties = { border: '1px solid var(--border)', borderRadius: 8, padding: 12, display: 'grid', gap: 12, background: 'var(--bg-2)' };

interface PartyForm { is_sportstech: boolean; sector_id: string; business_model: string; hq: LocationValue; sport_ids: string[] }
const emptyParty = (): PartyForm => ({ is_sportstech: false, sector_id: '', business_model: '', hq: { ...EMPTY_LOCATION }, sport_ids: [] });

function StagedFundingTab({ drafts, onChange }: { drafts: StagedDeal[]; onChange: (d: StagedDeal[]) => void }) {
	const [open, setOpen] = useState(false);
	return (
		<div style={{ display: 'grid', gap: 10 }}>
			<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
				<div style={{ fontSize: 12, color: 'var(--fg-muted)' }}>{drafts.length} round{drafts.length === 1 ? '' : 's'} staged · saved with the company</div>
				{!open && <button className="btn" onClick={() => setOpen(true)}><Plus size={12} /> Add funding round</button>}
			</div>
			{drafts.length === 0 ? (
				<div style={{ fontSize: 13, color: 'var(--fg-muted)' }}>No funding rounds yet. Add rounds here — they’ll be created when you save the company.</div>
			) : (
				<table className="data-table">
					<thead><tr><th>Round</th><th>Year</th><th>Amount</th><th /></tr></thead>
					<tbody>
						{drafts.map((d, i) => (
							<tr key={i}>
								<td>{d.label.round ?? '—'}</td>
								<td className="num">{d.label.year ?? '—'}</td>
								<td className="num">{d.label.amount ?? '—'}</td>
								<td style={{ textAlign: 'right' }}>
									<button className="btn ghost" style={{ color: 'var(--accent)' }} onClick={() => onChange(drafts.filter((_, j) => j !== i))}><Trash2 size={12} /></button>
								</td>
							</tr>
						))}
					</tbody>
				</table>
			)}
			{open && <InlineFundingEditor onStage={(d) => { onChange([...drafts, d]); setOpen(false); }} onCancel={() => setOpen(false)} />}
		</div>
	);
}

function InlineFundingEditor({ onStage, onCancel }: { onStage: (d: StagedDeal) => void; onCancel: () => void }) {
	const [roundTypeId, setRoundTypeId] = useState('');
	const [date, setDate] = useState('');
	const [amount, setAmount] = useState('');
	const [currency, setCurrency] = useState('');
	const [sourceUrl, setSourceUrl] = useState('');
	const [txnUrl, setTxnUrl] = useState('');
	const [investors, setInvestors] = useState<DealInvestor[]>([]);

	const add = () => {
		const body: Record<string, unknown> = {
			round_type_id: roundTypeId || undefined,
			announced_date: date || undefined,
			amount: amount.trim() ? Number(amount) : undefined,
			currency_code: currency || undefined,
			source_url: sourceUrl.trim() || undefined,
			transaction_url: txnUrl.trim() || undefined,
			investors,
		};
		onStage({ body, label: { amount: amount.trim() ? fmtStagedAmount(amount) : undefined, year: date ? date.slice(0, 4) : undefined } });
	};

	return (
		<div style={editorBox}>
			<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
				<Field label="Round type"><RoundTypeSelect value={roundTypeId} onChange={setRoundTypeId} /></Field>
				<Field label="Announced date *" hint="required — sets the year, sort order and the FX rate used to convert the amount to USD"><input className="search-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
			</div>
			<div style={{ display: 'grid', gridTemplateColumns: '1fr 120px', gap: 12 }}>
				<Field label="Amount" hint="in the currency at right — converted to USD automatically"><input className="search-input" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 5000000" /></Field>
				<Field label="Currency" hint="of the amount"><CurrencySelect value={currency} onChange={setCurrency} /></Field>
			</div>
			<Field label="Investors" hint="star marks the lead"><InvestorPicker value={investors} onChange={setInvestors} /></Field>
			{/* Sector / business model / location / sports / status / size bucket are
			    NOT asked here: they're company attributes the round inherits (set on
			    the company itself), and status defaults active / size auto-derives. */}
			<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
				<Field label="Source URL"><input className="search-input" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="https://" /></Field>
				<Field label="Transaction URL"><input className="search-input" value={txnUrl} onChange={(e) => setTxnUrl(e.target.value)} placeholder="https://" /></Field>
			</div>
			<div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
				<button className="btn ghost" onClick={onCancel}>Cancel</button>
				<button className="btn" disabled={!date} onClick={add}><Plus size={12} /> Add round</button>
			</div>
		</div>
	);
}

function StagedMaTab({ drafts, onChange }: { drafts: StagedAcq[]; onChange: (a: StagedAcq[]) => void }) {
	const [open, setOpen] = useState(false);
	return (
		<div style={{ display: 'grid', gap: 10 }}>
			<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
				<div style={{ fontSize: 12, color: 'var(--fg-muted)' }}>{drafts.length} acquisition{drafts.length === 1 ? '' : 's'} staged · saved with the company</div>
				{!open && <button className="btn" onClick={() => setOpen(true)}><Plus size={12} /> Add acquisition</button>}
			</div>
			{drafts.length === 0 ? (
				<div style={{ fontSize: 13, color: 'var(--fg-muted)' }}>No acquisitions yet. Choose whether this company was the acquirer or the acquiree, then add the other party.</div>
			) : (
				<table className="data-table">
					<thead><tr><th>This company</th><th>Counterparty</th><th>Year</th><th>Amount</th><th /></tr></thead>
					<tbody>
						{drafts.map((a, i) => (
							<tr key={i}>
								<td>{a.label.role === 'acquirer' ? 'Acquirer' : 'Acquiree'}</td>
								<td>{a.label.counterparty ?? a.label.acquirer ?? '—'}</td>
								<td className="num">{a.label.year ?? '—'}</td>
								<td className="num">{a.label.amount ?? '—'}</td>
								<td style={{ textAlign: 'right' }}>
									<button className="btn ghost" style={{ color: 'var(--accent)' }} onClick={() => onChange(drafts.filter((_, j) => j !== i))}><Trash2 size={12} /></button>
								</td>
							</tr>
						))}
					</tbody>
				</table>
			)}
			{open && <InlineMaEditor onStage={(a) => { onChange([...drafts, a]); setOpen(false); }} onCancel={() => setOpen(false)} />}
		</div>
	);
}

function InlineMaEditor({ onStage, onCancel }: { onStage: (a: StagedAcq) => void; onCancel: () => void }) {
	const [role, setRole] = useState<'acquiree' | 'acquirer'>('acquiree');
	const [cpId, setCpId] = useState('');        // counterparty company (the other side)
	const [cpName, setCpName] = useState('');    // counterparty free-text name / display
	const [party, setParty] = useState<PartyForm>(emptyParty());
	const [date, setDate] = useState('');
	const [amount, setAmount] = useState('');
	const [currency, setCurrency] = useState('');
	const [type, setType] = useState('acquisition');
	const [sourceUrl, setSourceUrl] = useState('');

	// The new company's role; the counterparty fills the *opposite* side's columns.
	const opposite = role === 'acquiree' ? 'acquirer' : 'acquiree';
	const cpLabel = role === 'acquiree' ? 'Acquiring company (acquirer)' : 'Acquired company (acquiree)';

	const pickCounterparty = (id: string) => {
		setCpId(id);
		if (!id) return;
		// Auto-fill the counterparty's classification/location from its catalog record.
		void (async () => {
			try {
				const c = await api<{ name?: string; sector_id?: string | null; business_model?: string | null; hq_country?: string | null; hq_city?: string | null; hq_continent?: string | null; hq_region?: string | null; hq_state?: string | null; sport_ids?: string[] }>('GET', `/api/admin/companies/${id}/edit`);
				setCpName(c.name ?? '');
				setParty((p) => ({
					...p,
					sector_id: c.sector_id ?? '',
					business_model: c.business_model ?? '',
					hq: { country: c.hq_country ?? '', city: c.hq_city ?? '', continent: c.hq_continent ?? '', region: c.hq_region ?? '', state: c.hq_state ?? '' },
					sport_ids: c.sport_ids ?? [],
				}));
			} catch { /* leave fields for manual entry */ }
		})();
	};

	const canAdd = (!!cpId || !!cpName.trim()) && !!date;
	const add = () => {
		const body: Record<string, unknown> = {
			_role: role,
			acquisition_date: date || undefined,
			amount: amount.trim() ? Number(amount) : undefined,
			currency_code: currency || undefined,
			acquisition_type: type,
			source_url: sourceUrl.trim() || undefined,
			[`${opposite}_company_id`]: cpId || undefined,
			[`${opposite}_name`]: !cpId && cpName.trim() ? cpName.trim() : undefined,
			[`${opposite}_is_sportstech`]: party.is_sportstech,
			[`${opposite}_sector_id`]: party.sector_id || undefined,
			[`${opposite}_business_model`]: party.business_model || undefined,
			[`${opposite}_hq_country`]: party.hq.country.trim() || undefined,
			[`${opposite}_hq_city`]: party.hq.city.trim() || undefined,
			[`${opposite}_hq_continent`]: party.hq.continent.trim() || undefined,
			[`${opposite}_hq_region`]: party.hq.region.trim() || undefined,
			[`${opposite}_hq_state`]: party.hq.state.trim() || undefined,
			[`${opposite}_sport_ids`]: party.sport_ids,
		};
		onStage({ body, label: { counterparty: cpName.trim() || undefined, role, amount: amount.trim() ? fmtStagedAmount(amount) : undefined, year: date ? date.slice(0, 4) : undefined } });
	};

	const roleBtn = (r: 'acquiree' | 'acquirer', title: string, sub: string) => (
		<button type="button" onClick={() => setRole(r)}
			style={{
				flex: 1, padding: '10px 12px', borderRadius: 8, cursor: 'pointer', textAlign: 'left',
				border: `1px solid ${role === r ? 'var(--accent)' : 'var(--border)'}`,
				background: role === r ? 'var(--bg-3)' : 'transparent',
			}}>
			<div style={{ fontWeight: 600, fontSize: 13 }}>{title}</div>
			<div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{sub}</div>
		</button>
	);

	return (
		<div style={editorBox}>
			<div>
				<div className="co-stat-label" style={{ marginBottom: 6 }}>Is this company the acquirer or the acquiree?</div>
				<div style={{ display: 'flex', gap: 8 }}>
					{roleBtn('acquirer', 'Acquirer', 'This company acquired another')}
					{roleBtn('acquiree', 'Acquiree', 'This company was acquired')}
				</div>
			</div>
			<Field label={cpLabel} hint="search the catalog to auto-fill, or type a name">
				<CompanySelectOne value={cpId} onChange={pickCounterparty} placeholder={`Search the ${opposite}…`} />
			</Field>
			{!cpId && (
				<Field label="…or counterparty name (free text)"><input className="search-input" value={cpName} onChange={(e) => setCpName(e.target.value)} placeholder="Name of the other company" /></Field>
			)}
			{/* Attributes only for an off-catalog (free-text) counterparty; a linked
			    company supplies its own, as in the standalone M&A form. */}
			{!cpId ? (
				<>
					<Field label="Counterparty sector"><SectorCascade value={party.sector_id} onChange={(v) => setParty((p) => ({ ...p, sector_id: v }))} /></Field>
					<Field label="Counterparty business model">
						<Select value={party.business_model} onChange={(v) => setParty((p) => ({ ...p, business_model: v }))} placeholder="—" width="100%" style={{ display: 'block', width: '100%' }} options={[{ value: '', label: '—' }, ...PARTY_MODELS.map((b) => ({ value: b, label: b.toUpperCase() }))]} />
					</Field>
					<Field label="Counterparty location"><LocationFields value={party.hq} onChange={(v) => setParty((p) => ({ ...p, hq: v }))} /></Field>
					<Field label="Counterparty sports"><SportsPicker value={party.sport_ids} onChange={(v) => setParty((p) => ({ ...p, sport_ids: v }))} /></Field>
				</>
			) : (
				<div style={{ fontSize: 12.5, color: 'var(--fg-muted)' }}>Counterparty sector, business model, location and sports are taken from the linked company.</div>
			)}
			<label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
				<input type="checkbox" checked={party.is_sportstech} onChange={(e) => setParty((p) => ({ ...p, is_sportstech: e.target.checked }))} /> Counterparty is SportsTech <span style={{ color: 'var(--fg-muted)' }}>— tick if the other party operates in sports-tech</span>
			</label>
			<div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, display: 'grid', gap: 12 }}>
				<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
					<Field label="Acquisition date *" hint="required — sets the year, sort order and the FX rate used to convert the amount to USD"><input className="search-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
					<Field label="Type">
						<Select value={type} onChange={setType} width="100%" style={{ display: 'block', width: '100%' }} options={ACQ_TYPES.map((t) => ({ value: t, label: t.replace(/_/g, ' ') }))} />
					</Field>
				</div>
				<div style={{ display: 'grid', gridTemplateColumns: '1fr 120px', gap: 12 }}>
					<Field label="Amount" hint="in the currency at right — converted to USD automatically"><input className="search-input" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 5000000" /></Field>
					<Field label="Currency" hint="of the amount"><CurrencySelect value={currency} onChange={setCurrency} /></Field>
				</div>
				<Field label="Source URL"><input className="search-input" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="https://" /></Field>
			</div>
			<div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
				<button className="btn ghost" onClick={onCancel}>Cancel</button>
				<button className="btn" disabled={!canAdd} onClick={add}><Plus size={12} /> Add acquisition</button>
			</div>
		</div>
	);
}

function CompanyForm({ id, initial, onClose, onSaved, promotePipelineId, enrichedFields }: { id: string | null; initial: CompanyForm; onClose: () => void; onSaved: (createdId?: string) => void; promotePipelineId?: string; enrichedFields?: string[] }) {
	const isEdit = !!id;
	const [tab, setTab] = useTabs('profile');
	const [form, setForm] = useState<CompanyForm>(initial);
	const [stagedDeals, setStagedDeals] = useState<StagedDeal[]>([]);
	const [stagedAcqs, setStagedAcqs] = useState<StagedAcq[]>([]);
	const [pending, setPending] = useState(false);

	const set = <K extends keyof CompanyForm>(k: K, v: CompanyForm[K]) => setForm((f) => ({ ...f, [k]: v }));
	const [enriching, setEnriching] = useState(false);
	// Fields the "Enrich" button just filled — merged with `enrichedFields`
	// (the pipeline-promote ones) so both get the "verify before saving" highlight.
	const [attioEnriched, setAttioEnriched] = useState<Set<string>>(new Set());
	// Pull everything we can find for the website's domain — Apollo first, Attio as fallback, with
	// taxonomy mapped to our reference data server-side. Fills only empty fields
	// so it never clobbers admin edits.
	const enrich = async () => {
		if (!form.website.trim()) { toast.error('Enter a website first.'); return; }
		setEnriching(true);
		try {
			const r = await api<{ found: boolean; data: {
				name: string | null; description: string | null; website: string | null; city: string | null; country: string | null; logo_url: string | null; founded_year: number | null;
				linkedin: string | null; twitter: string | null; facebook: string | null; instagram: string | null;
				sector_id: string | null; sector_name: string | null; sport_ids: string[]; tech_tag_ids: string[]; business_model: string | null;
				poc: { first_name: string | null; last_name: string | null; job_title: string | null; email: string | null; linkedin: string | null } | null;
				sources: Record<string, 'attio' | 'apollo' | 'ai'>;
				unavailable?: Array<'attio' | 'apollo' | 'ai'>;
			} | null }>(
				'GET', `/api/admin/integrations/company-enrich?domain=${encodeURIComponent(form.website.trim())}${form.name.trim() ? `&name=${encodeURIComponent(form.name.trim())}` : ''}`);
			if (!r.found || !r.data) { toast.error('Neither Apollo nor Attio knows this domain.'); return; }
			const d = r.data;
			const poc = d.poc;
			// Track which fields this actually fills (empty-before + source-has-value),
			// so only those get highlighted. Names match the <Field>/<EnrichedGroup name>.
			const filled = new Set<string>();
			const mark = (cond: boolean, name: string) => { if (cond) filled.add(name); };
			mark(!form.name.trim() && !!d.name, 'name');
			mark(!form.description.trim() && !!d.description, 'description');
			mark(!form.custom_logo_url.trim() && !!d.logo_url, 'custom_logo_url');
			mark(!form.founded_year && !!d.founded_year, 'founded_year');
			mark(!form.sector_id && !!d.sector_id, 'sector_id');
			mark(!form.business_model && !!d.business_model, 'business_model');
			mark(!form.sport_ids.length && d.sport_ids.length > 0, 'sport_ids');
			mark(!form.tech_tag_ids.length && d.tech_tag_ids.length > 0, 'tech_tag_ids');
			// A city is only meaningful with its own country: when editing a company that
			// already has a (different) country, don't drop the source's city next to it —
			// saving would mint a bogus "Paris, Germany" city row.
			const formCountry = form.hq.country.trim().toLowerCase();
			const cityFits = !formCountry || !d.country || formCountry === d.country.toLowerCase();
			mark((!form.hq.city.trim() && !!d.city && cityFits) || (!form.hq.country.trim() && !!d.country), 'hq');
			mark((!form.social.linkedin_url.trim() && !!d.linkedin) || (!form.social.twitter_url.trim() && !!d.twitter) || (!form.social.facebook_url.trim() && !!d.facebook) || (!form.social.instagram_url.trim() && !!d.instagram), 'social');
			mark(!form.poc_first_name.trim() && !!poc?.first_name, 'poc_first_name');
			mark(!form.poc_last_name.trim() && !!poc?.last_name, 'poc_last_name');
			mark(!form.poc_job_position.trim() && !!poc?.job_title, 'poc_job_position');
			// poc_email is saved (below) but has no visible input, so it's not highlighted.
			mark(!form.poc_linkedin.trim() && !!poc?.linkedin, 'poc_linkedin');
			setAttioEnriched((prev) => new Set([...prev, ...filled]));
			setForm((f) => ({
				...f,
				name: f.name.trim() || d.name || f.name,
				description: f.description.trim() || d.description || f.description,
				custom_logo_url: f.custom_logo_url.trim() || d.logo_url || f.custom_logo_url,
				founded_year: f.founded_year || (d.founded_year ? String(d.founded_year) : f.founded_year),
				sector_id: f.sector_id || d.sector_id || f.sector_id,
				business_model: f.business_model || d.business_model || f.business_model,
				sport_ids: f.sport_ids.length ? f.sport_ids : d.sport_ids,
				tech_tag_ids: f.tech_tag_ids.length ? f.tech_tag_ids : d.tech_tag_ids,
				hq: { ...f.hq, city: f.hq.city.trim() || (cityFits ? d.city : null) || f.hq.city, country: f.hq.country.trim() || d.country || f.hq.country },
				social: {
					...f.social,
					linkedin_url: f.social.linkedin_url.trim() || d.linkedin || f.social.linkedin_url,
					twitter_url: f.social.twitter_url.trim() || d.twitter || f.social.twitter_url,
					facebook_url: f.social.facebook_url.trim() || d.facebook || f.social.facebook_url,
					instagram_url: f.social.instagram_url.trim() || d.instagram || f.social.instagram_url,
				},
				poc_first_name: f.poc_first_name.trim() || poc?.first_name || f.poc_first_name,
				poc_last_name: f.poc_last_name.trim() || poc?.last_name || f.poc_last_name,
				poc_job_position: f.poc_job_position.trim() || poc?.job_title || f.poc_job_position,
				poc_email: f.poc_email.trim() || poc?.email || f.poc_email,
				poc_linkedin: f.poc_linkedin.trim() || poc?.linkedin || f.poc_linkedin,
			}));
			// Name only the providers behind fields this click actually filled (form
			// field → the enrichment keys that feed it), not every provider that answered.
			const LABEL = { attio: 'Attio', apollo: 'Apollo', ai: 'AI mapping' } as const;
			const FEEDS: Record<string, string[]> = {
				custom_logo_url: ['logo_url'], hq: ['city', 'country'], social: ['linkedin', 'twitter', 'facebook', 'instagram'],
				poc_first_name: ['poc'], poc_last_name: ['poc'], poc_job_position: ['poc'], poc_linkedin: ['poc'],
			};
			const src = d.sources ?? {};
			const usedKeys = filled.size ? [...filled].flatMap((f) => FEEDS[f] ?? [f]) : Object.keys(src);
			const used = [...new Set(usedKeys.map((k) => src[k]).filter((v): v is 'attio' | 'apollo' | 'ai' => !!v))].map((k) => LABEL[k]).join(' + ') || 'Apollo/Attio';
			toast.success(filled.size ? `Filled ${filled.size} field${filled.size === 1 ? '' : 's'} from ${used} — highlighted for review` : `Matched (${used}), but every field was already filled`);
			// Apollo (the primary source) errored — this is a partial, Attio-only result.
			if (d.unavailable?.includes('apollo')) toast.warning('Apollo was unavailable, so this used Attio only — click Enrich again shortly for the full result.');
		} catch (e) { toast.error((e as Error).message); } finally { setEnriching(false); }
	};

	const submit = async () => {
		setPending(true);
		try {
			const body: Record<string, unknown> = {
				name: form.name.trim(),
				// On edit, only send website when it actually changed — re-sending an
				// unchanged (possibly legacy/odd) value would re-run URL validation and
				// could fail a save that never touched the website.
				website: (!isEdit || form.website.trim() !== (initial.website ?? '').trim()) ? form.website.trim() : undefined,
				slug: form.slug.trim() || undefined,
				description: form.description.trim() || undefined,
				custom_logo_url: form.custom_logo_url.trim() || undefined,
				sector_id: form.sector_id || undefined,
				business_model: form.business_model || undefined,
				hq_country: form.hq.country.trim() || undefined,
				hq_city: form.hq.city.trim() || undefined,
				hq_continent: form.hq.continent.trim() || undefined,
				hq_region: form.hq.region.trim() || undefined,
				hq_state: form.hq.state.trim() || undefined,
					hq_report_region: (form.hq.report_region ?? '').trim() || undefined,
				founded_year: form.founded_year ? Number(form.founded_year) : undefined,
				ipo_date: form.ipo_date || undefined,
				status: form.status,
				is_verified: form.is_verified,
				is_unicorn: form.is_unicorn,
				is_hidden: form.is_hidden,
				is_actively_raising: form.is_actively_raising,
				actively_raising_amount: form.raising_amount.trim() ? Number(form.raising_amount) : undefined,
				actively_raising_round: form.raising_round.trim() || undefined,
				actively_raising_valuation: form.raising_valuation.trim() ? Number(form.raising_valuation) : undefined,
				actively_raising_pitch_deck_url: form.raising_pitch_deck_url.trim() || undefined,
				social: form.social,
				sport_ids: form.sport_ids,
				tech_tag_ids: form.tech_tag_ids,
					poc_first_name: form.poc_first_name.trim() || undefined,
					poc_last_name: form.poc_last_name.trim() || undefined,
					poc_job_position: form.poc_job_position.trim() || undefined,
					poc_email: form.poc_email.trim() || undefined,
					poc_linkedin: form.poc_linkedin.trim() || undefined,
					poc_personal_email: form.poc_personal_email.trim() || undefined,
					poc_personal_linkedin: form.poc_personal_linkedin.trim() || undefined,
					accelerator: form.accelerator.trim() || undefined,
					cohort: form.cohort.trim() || undefined,
				};
			let createdId: string | undefined;
			if (isEdit) await api('PATCH', `/api/admin/companies/${id}`, body);
			else {
				// Carry any funding rounds / acquisitions staged on a brand-new company
				// so they're created in the same atomic request.
				if (stagedDeals.length) body.deals = stagedDeals.map((d) => d.body);
				if (stagedAcqs.length) body.acquisitions = stagedAcqs.map((a) => a.body);
				// Promote-from-queue: link the pipeline row in the same create tx.
				if (promotePipelineId) body.pipeline_id = promotePipelineId;
				const created = await api<{ id: string }>('POST', '/api/admin/companies', body);
				createdId = created?.id;
			}
			toast.success(isEdit ? 'Saved' : 'Created');
			onSaved(createdId);
		} catch (e) {
			toast.error((e as Error).message);
		} finally {
			setPending(false);
		}
	};

	return (
		<Modal
			title={isEdit ? 'Edit company' : 'New company'}
			onClose={onClose}
			width={860}
			footer={
				<>
					<button className="btn ghost" onClick={onClose}>Cancel</button>
					<button className="btn" disabled={!form.name.trim() || !form.website.trim() || pending} onClick={() => void submit()}>
						<Save size={12} /> {pending ? 'Saving…' : 'Save'}
					</button>
				</>
			}
		>
			{(
				<EnrichedFieldsProvider value={new Set([...(enrichedFields ?? []), ...attioEnriched])}>
					{(!!enrichedFields?.length || attioEnriched.size > 0) && (
						<div style={{ fontSize: 12, color: 'var(--info)', padding: '8px 10px', border: '1px solid color-mix(in oklab, var(--info) 30%, transparent)', background: 'color-mix(in oklab, var(--info) 6%, transparent)', borderRadius: 'var(--radius-sm)', marginBottom: 4 }}>Highlighted fields were auto-filled by enrichment — verify before saving.</div>
					)}
					<TabbedForm
					active={tab}
					onChange={setTab}
					tabs={[
						{
							key: 'profile', label: 'Profile', node: (
								<>
									<Field name="name" label="Name *" hint="required — the display name used everywhere"><input className="search-input" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Acme Sports" /></Field>
									<Field label="Website *" hint="required & unique — used to dedupe and to enrich from Apollo (+ Attio)">
										<div style={{ display: 'flex', gap: 6 }}>
											<input className="search-input" type="url" value={form.website} onChange={(e) => set('website', e.target.value)} placeholder="https://acmesports.com" style={{ flex: 1 }} />
											<button type="button" className="btn ghost" disabled={enriching || !form.website.trim()} onClick={() => void enrich()} title="Fill empty fields (description, logo, founded year, HQ, socials, sector, sports, tech tags, business model, contact) from Apollo, with Attio as fallback, using this domain">{enriching ? 'Enriching…' : 'Enrich'}</button>
										</div>
									</Field>
									<Field label="Slug" hint={isEdit ? 'the public URL is fixed once created' : 'optional — auto-generated from the name if left blank'}><input className="search-input" style={{ fontFamily: 'var(--font-mono)' }} value={form.slug} onChange={(e) => set('slug', e.target.value)} disabled={isEdit} placeholder={isEdit ? undefined : 'acme-sports'} /></Field>
									<Field name="description" label="Description" hint="one or two sentences shown on the public profile"><textarea className="search-input" style={{ minHeight: 80, resize: 'vertical' }} value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="What the company does, in a sentence or two." /></Field>
									<Field name="custom_logo_url" label="Logo" hint="square image works best; leave blank to fall back to the fetched favicon"><ImageInput value={form.custom_logo_url} onChange={(u) => set('custom_logo_url', u)} pathPrefix="companies/logos" /></Field>
									<div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 12 }}>
										<Field name="founded_year" label="Founded" hint="year"><YearSelect value={form.founded_year} onChange={(v) => set('founded_year', v)} /></Field>
										<Field label="IPO date"><input className="search-input" type="date" value={form.ipo_date} onChange={(e) => set('ipo_date', e.target.value)} /></Field>
									</div>
								</>
							),
						},
						{
							key: 'class', label: 'Classification', hint: form.sport_ids.length + form.tech_tag_ids.length, node: (
								<>
									<Field name="sector_id" label="Sector" hint="drill into sub-sectors as needed"><SectorCascade value={form.sector_id} onChange={(v) => set('sector_id', v)} /></Field>
									<Field name="business_model" label="Business model" hint="who they sell to — B2B, B2C or B2B2C">
										<Select value={form.business_model} onChange={(v) => set('business_model', v)} placeholder="—" width="100%" style={{ display: 'block', width: '100%' }} options={[{ value: '', label: '—' }, ...BUSINESS_MODELS.map((b) => ({ value: b, label: b.toUpperCase() }))]} />
									</Field>
									<Field name="sport_ids" label="Sports" hint={form.sport_ids.length ? `${form.sport_ids.length} selected · pick “Multisport” for 5+` : 'pick “Multisport” for 5+ sports'}><SportsPicker value={form.sport_ids} onChange={(v) => set('sport_ids', v)} /></Field>
									<Field name="tech_tag_ids" label="Tech tags" hint={form.tech_tag_ids.length ? `${form.tech_tag_ids.length} selected` : undefined}><TechTagsPicker value={form.tech_tag_ids} onChange={(v) => set('tech_tag_ids', v)} /></Field>
									<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
										<Field label="Accelerator" hint="programs the company joined"><input className="search-input" value={form.accelerator} onChange={(e) => set('accelerator', e.target.value)} placeholder="e.g. Techstars" /></Field>
										<Field label="Cohort" hint="batch / year, if any"><input className="search-input" value={form.cohort} onChange={(e) => set('cohort', e.target.value)} placeholder="e.g. 2023 Spring" /></Field>
									</div>
								</>
							),
						},
						{ key: 'location', label: 'Location', node: <Field name="hq" label="Headquarters"><LocationFields value={form.hq} onChange={(v) => set('hq', v)} /></Field> },
						{ key: 'social', label: 'Social', node: <EnrichedGroup name="social"><SocialLinks value={form.social} onChange={(v) => set('social', v)} /></EnrichedGroup> },
						{
							key: 'contact', label: 'Contact', node: (
								<>
									<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
										<Field name="poc_first_name" label="POC first name"><input className="search-input" value={form.poc_first_name} onChange={(e) => set('poc_first_name', e.target.value)} /></Field>
										<Field name="poc_last_name" label="POC last name"><input className="search-input" value={form.poc_last_name} onChange={(e) => set('poc_last_name', e.target.value)} /></Field>
									</div>
									<Field name="poc_job_position" label="POC job position"><input className="search-input" value={form.poc_job_position} onChange={(e) => set('poc_job_position', e.target.value)} /></Field>
									<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
										<Field label="POC email (company)"><input className="search-input" value={form.poc_email} onChange={(e) => set('poc_email', e.target.value)} placeholder="name@company.com" /></Field>
										<Field name="poc_linkedin" label="POC LinkedIn (company)"><input className="search-input" value={form.poc_linkedin} onChange={(e) => set('poc_linkedin', e.target.value)} placeholder="https://linkedin.com/in/…" /></Field>
									</div>
									<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
										<Field label="POC personal email"><input className="search-input" value={form.poc_personal_email} onChange={(e) => set('poc_personal_email', e.target.value)} placeholder="personal@email.com" /></Field>
										<Field label="POC personal LinkedIn"><input className="search-input" value={form.poc_personal_linkedin} onChange={(e) => set('poc_personal_linkedin', e.target.value)} placeholder="https://linkedin.com/in/…" /></Field>
									</div>
								</>
							),
						},
						...(isEdit && id
							? [
								{ key: 'funding', label: 'Funding', node: <CompanyFundingTab companyId={id} /> },
								{ key: 'ma', label: 'M&A', node: <CompanyMaTab companyId={id} /> },
								{ key: 'claim', label: 'Claim', node: <CompanyClaimTab companyId={id} onFlags={(f) => { if (f.is_verified !== undefined) set('is_verified', f.is_verified); if (f.is_actively_raising !== undefined) set('is_actively_raising', f.is_actively_raising); }} /> },
							]
							: [
								{ key: 'funding', label: 'Funding', hint: stagedDeals.length || undefined, node: <StagedFundingTab drafts={stagedDeals} onChange={setStagedDeals} /> },
								{ key: 'ma', label: 'M&A', hint: stagedAcqs.length || undefined, node: <StagedMaTab drafts={stagedAcqs} onChange={setStagedAcqs} /> },
							]),
						{
							key: 'status', label: 'Status', node: (
								<>
									<Field label="Status">
										<Select value={form.status} onChange={(v) => set('status', v)} width="100%" style={{ display: 'block', width: '100%' }} options={STATUSES.map((s) => ({ value: s, label: s.replace(/_/g, ' ') }))} />
									</Field>
									<label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
										<input type="checkbox" checked={form.is_verified} onChange={(e) => set('is_verified', e.target.checked)} /> Verified <span style={{ color: 'var(--fg-muted)', fontWeight: 400 }}>— shows the verified badge on the public profile</span>
									</label>
									<label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
										<input type="checkbox" checked={form.is_unicorn} onChange={(e) => set('is_unicorn', e.target.checked)} /> Unicorn <span style={{ color: 'var(--fg-muted)', fontWeight: 400 }}>— valuation has reached $1B or more</span>
									</label>
									<label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
										<input type="checkbox" checked={form.is_hidden} onChange={(e) => set('is_hidden', e.target.checked)} /> Hidden <span style={{ color: 'var(--fg-muted)', fontWeight: 400 }}>— test or fake record: kept here, never shown to users</span>
									</label>
									<label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
										<input type="checkbox" checked={form.is_actively_raising} onChange={(e) => set('is_actively_raising', e.target.checked)} /> Actively raising <span style={{ color: 'var(--fg-muted)', fontWeight: 400 }}>— surfaces in “raising” filters and reveals the raise details below</span>
									</label>
									{form.is_actively_raising && (
										<div style={{ display: 'grid', gap: 12, padding: 12, border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg-2)' }}>
											<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
												<Field label="Raising amount ($)"><input className="search-input" type="number" value={form.raising_amount} onChange={(e) => set('raising_amount', e.target.value)} placeholder="target raise" /></Field>
												<Field label="Round"><input className="search-input" value={form.raising_round} onChange={(e) => set('raising_round', e.target.value)} placeholder="e.g. Series A" /></Field>
											</div>
											<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
												<Field label="Valuation ($)"><input className="search-input" type="number" value={form.raising_valuation} onChange={(e) => set('raising_valuation', e.target.value)} placeholder="pre/post" /></Field>
												<Field label="Pitch deck URL"><input className="search-input" value={form.raising_pitch_deck_url} onChange={(e) => set('raising_pitch_deck_url', e.target.value)} placeholder="https://" /></Field>
											</div>
										</div>
									)}
								</>
							),
						},
					]}
				/>
				</EnrichedFieldsProvider>
			)}
		</Modal>
	);
}

// ── Combined "Companies & Deals" page ────────────────────────────────────────
// Like the old admin: one destination for companies, funding deals and M&A, with
// a combined Statistics panel (with an "added since" date filter) and in-page
// tabs for the differentiable entities. The active tab lives in the URL (?tab=)
// so it survives a refresh.
interface EntityYoyStats { total: number; this_year?: number | null; last_year?: number | null; yoy_change?: number | null }
type CdTab = 'companies' | 'deals' | 'acquisitions' | 'claims' | 'changes';
const CD_TABS: ReadonlyArray<{ key: CdTab; label: string }> = [
	{ key: 'companies', label: 'Companies' },
	{ key: 'deals', label: 'Deals' },
	{ key: 'acquisitions', label: 'M&A' },
	{ key: 'claims', label: 'Ownership claims' },
	{ key: 'changes', label: 'Data changes' },
];
export default function CompaniesAdminPage() {
	const searchParams = useSearchParams();
	const router = useRouter();
	const pathname = usePathname();
	const raw = searchParams.get('tab');
	const tab: CdTab = (CD_TABS.some((t) => t.key === raw) ? raw : 'companies') as CdTab;
	const setTab = (t: CdTab) => router.replace(`${pathname}?tab=${t}`, { scroll: false });

	const [dateRange, setDateRange] = useState<RangeValue>({});
	const from = dateRange.from, to = dateRange.to;
	const key = (path: string): [string] | [string, Record<string, string>] => {
		const params: Record<string, string> = {};
		if (from) params.from = from;
		if (to) params.to = to;
		return Object.keys(params).length ? [path, params] : [path];
	};
	const cStats = useSWR<CompanyStats>(key('/api/admin/stats/companies'), { dedupingInterval: 60_000 });
	const dStats = useSWR<EntityYoyStats>(key('/api/admin/stats/deals'), { dedupingInterval: 60_000 });
	const aStats = useSWR<EntityYoyStats>(key('/api/admin/stats/acquisitions'), { dedupingInterval: 60_000 });
	const c = cStats.data, d = dStats.data, a = aStats.data;

	const rangeFilter = <DateRangePicker value={dateRange} onChange={setDateRange} />;

	return (
		<div>
			<PageHeader kicker="Data" title="Companies & Deals" subtitle="Manage companies, funding deals and M&A transactions." />

			<StatsPanel action={rangeFilter}>
				<StatStrip cols={4}>
					<RichStatCard label="Total Companies" tone="blue" Icon={Building2} loading={cStats.isLoading} value={(c?.total ?? 0).toLocaleString()}
						totalRows={c?.total_rows} thisYear={c?.this_year} lastYear={c?.last_year} yoy={c?.yoy_change} />
					<RichStatCard label="Total Funding Deals" tone="green" Icon={CircleDollarSign} loading={dStats.isLoading} value={(d?.total ?? 0).toLocaleString()}
						thisYear={d?.this_year} lastYear={d?.last_year} yoy={d?.yoy_change} />
					<RichStatCard label="Total M&A Transactions" tone="purple" Icon={GitMerge} loading={aStats.isLoading} value={(a?.total ?? 0).toLocaleString()}
						thisYear={a?.this_year} lastYear={a?.last_year} yoy={a?.yoy_change} />
					<RichStatCard label="Verified Companies" tone="teal" Icon={BadgeCheck} loading={cStats.isLoading} value={(c?.verified ?? 0).toLocaleString()}
						period="month" thisYear={c?.verified_this_month} lastYear={c?.verified_last_month} yoy={c?.verified_mom} />
				</StatStrip>
			</StatsPanel>

			<div style={{ marginBottom: 'var(--space-4)' }}>
				<PillTabs tabs={CD_TABS} value={tab} onChange={setTab} />
			</div>

			{tab === 'companies' && <CompaniesView embedded />}
			{tab === 'deals' && <DealsView embedded />}
			{tab === 'acquisitions' && <AcquisitionsView embedded />}
			{tab === 'claims' && <ClaimsView embedded lockType="company" />}
			{tab === 'changes' && <DataRequestsView embedded lockEntity="company,deal" />}
		</div>
	);
}
