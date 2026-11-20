'use client';

import { useState, useEffect } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { toast } from 'sonner';
import { Plus, Save, Trash2, GitMerge, Banknote, Trophy } from 'lucide-react';
import { api } from '@/lib/api';
import { Select } from '@/components/select';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useInitialQuery } from '@/hooks/use-initial-query';
import { useConfirm } from '@/components/confirm';
import { Modal } from '@/components/modal';
import { PageHeader, AsyncState, Loading, StatCard, RichStatCard, StatsPanel, Section, Pager, SortableTh } from '@/components/atoms';
import { ComboBarLine, PieDonut, PieLegend, toSegments, type Bucket } from '@/components/charts';
import { FilterBar, FilterSelect, StatStrip, FilterRange, RefSlugFilter, SectorTierFilter } from '@/components/filters';
import { CsvImportButton, CsvTemplateButton, CsvCheckButton } from '@/components/csv-import';
import { Field } from '@/components/tabbed-form';
import { CompanySelectOne, SectorCascade, SportsPicker, CurrencySelect, LocationFields, EMPTY_LOCATION, type LocationValue } from '@/components/entity-pickers';
import { useUrlState, useUrlNumber } from '@/hooks/use-url-state';

interface Acquisition {
	id: string;
	acquiree_name?: string | null;
	acquirer_name?: string | null;
	acquisition_year?: number | null;
	amount_usd?: string | null;
	acquisition_type?: string | null;
	primary_sector?: string | null;
}
interface AcqResponse { data: Acquisition[]; total: number; totalPages: number }
interface AcqStats { total: number; total_amount: number; sportstech: number; total_rows?: number; this_year?: number; last_year?: number; yoy_change?: number | null; by_year: Array<{ year: number; deals: number; amt: number }>; by_type: Bucket[] }

const TYPES = ['acquisition', 'merger', 'asset_purchase'] as const;
// d2c/b2g/other dropped - unused across all records (verified) and not wanted.
const BUSINESS_MODELS = ['b2b', 'b2c', 'b2b2c'] as const;

function fmtAmount(v?: string | null): string {
	if (!v) return '—';
	const n = Number(v);
	if (!Number.isFinite(n) || n <= 0) return 'Undisclosed';
	if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
	if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
	return `$${n.toLocaleString()}`;
}
const fmtMoney = (n: number): string => n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : `$${(n / 1e6).toFixed(1)}M`;

export function AcquisitionsView({ embedded = false }: { embedded?: boolean }) {
	const { mutate } = useSWRConfig();
	const ask = useConfirm();
	const [search, setSearch] = useUrlState('acq', 'q', '', 'q');
	const debouncedSearch = useDebouncedValue(search);
	const [type, setType] = useUrlState('acq', 'type', '');
	const [year, setYear] = useUrlState('acq', 'year', '');
	const [sector, setSector] = useUrlState('acq', 'sector', '');
	const [sport, setSport] = useUrlState('acq', 'sport', '');
	const [country, setCountry] = useUrlState('acq', 'country', '');
	const [stech, setStech] = useUrlState('acq', 'stech', '');
	const [amountMin, setAmountMin] = useUrlState('acq', 'amountMin', '');
	const [amountMax, setAmountMax] = useUrlState('acq', 'amountMax', '');
	const [page, setPage] = useUrlNumber('acq', 'page', 1);
	const [sort, setSort] = useUrlState('acq', 'sort', '-acquisition_date');
	const onSort = (s: string) => { setSort(s); setPage(1); };
	const reset1 = () => setPage(1);
	const [creating, setCreating] = useState(false);
	const [editingId, setEditingId] = useState<string | null>(null);

	// Typed filters (country, min/max) wait for typing to pause, like search, instead of one request per key.
	const dCountry = useDebouncedValue(country);
	const dAmountMin = useDebouncedValue(amountMin);
	const dAmountMax = useDebouncedValue(amountMax);
	const { data, error, isLoading } = useSWR<AcqResponse>(
		['/api/acquisitions', {
			q: debouncedSearch || undefined, acquisition_type: type || undefined, year: year || undefined,
			sector_slug: sector || undefined, sport_slug: sport || undefined, country: dCountry.trim() || undefined,
			acquiree_is_sportstech: stech || undefined,
			amount_usd_min: dAmountMin || undefined, amount_usd_max: dAmountMax || undefined,
			page, limit: 30, sort,
		}],
		{ dedupingInterval: 30_000 },
	);
	const stats = useSWR<AcqStats>(['/api/admin/stats/acquisitions'], { dedupingInterval: 60_000 });
	const yearChart = (stats.data?.by_year ?? []).map((r) => ({ year: r.year, amt: Number(r.amt), deals: Number(r.deals) }));
	const typeSegments = toSegments(stats.data?.by_type ?? []);
	const yearOpts = (stats.data?.by_year ?? []).map((r) => String(r.year)).reverse();
	const refresh = () => mutate((key) => Array.isArray(key) && key[0] === '/api/acquisitions');

	const remove = async (id: string) => {
		if (!(await ask('Delete this acquisition?'))) return;
		try {
			await api('DELETE', `/api/admin/acquisitions/${id}`);
			toast.success('Deleted');
			void refresh();
		} catch (e) { toast.error((e as Error).message); }
	};

	const rows = data?.data ?? [];
	return (
		<div>
			{!embedded && <PageHeader kicker={`M&A · ${(stats.data?.total ?? data?.total ?? 0).toLocaleString()} deals`} title="Acquisitions" />}

			{!embedded && (
				<StatsPanel>
					<StatStrip cols={3}>
						<RichStatCard label="Total M&A Transactions" Icon={GitMerge} loading={stats.isLoading} value={(stats.data?.total ?? 0).toLocaleString()}
							totalRows={stats.data?.total_rows} thisYear={stats.data?.this_year} lastYear={stats.data?.last_year} yoy={stats.data?.yoy_change} />
						<RichStatCard label="Total value (disclosed)" Icon={Banknote} loading={stats.isLoading} value={fmtMoney(stats.data?.total_amount ?? 0)} />
						<RichStatCard label="SportsTech acquirees" Icon={Trophy} loading={stats.isLoading} value={(stats.data?.sportstech ?? 0).toLocaleString()} />
					</StatStrip>
				</StatsPanel>
			)}

			{!embedded && (
				<div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 'var(--space-4)', marginBottom: 'var(--space-5)' }}>
					<Section title="Acquisitions by year" meta="value · count" center>
						<AsyncState loading={stats.isLoading} error={stats.error} empty={yearChart.length === 0} emptyMsg="No data" onRetry={() => void stats.mutate()}>
							<ComboBarLine data={yearChart} height={240} valueFormatter={fmtMoney} barLabel="Value" lineLabel="deals" />
						</AsyncState>
					</Section>
					<Section title="By type" meta="deals" center>
						<AsyncState loading={stats.isLoading} error={stats.error} empty={typeSegments.length === 0} emptyMsg="No data" onRetry={() => void stats.mutate()}>
							<div style={{ display: 'grid', placeItems: 'center', gap: 12 }}>
								<PieDonut segments={typeSegments} size={170} mode="donut" />
								<PieLegend segments={typeSegments} />
							</div>
						</AsyncState>
					</Section>
				</div>
			)}

			<FilterBar>
				<input className="search-input" style={{ flex: '0 0 280px', height: 32 }} placeholder="Search acquiree / acquirer…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
				<FilterSelect ariaLabel="Type" value={type} onChange={(v) => { setType(v); reset1(); }} options={[...TYPES]} allLabel="All types" />
				<FilterSelect ariaLabel="Year" value={year} onChange={(v) => { setYear(v); reset1(); }} options={yearOpts} allLabel="All years" />
				<SectorTierFilter value={sector} onChange={(v) => { setSector(v); reset1(); }} allTopLabel="Any sector" />
				<RefSlugFilter kind="sports" ariaLabel="Sport (either side)" value={sport} onChange={(v) => { setSport(v); reset1(); }} allLabel="Any sport" />
				<input className="search-input" style={{ height: 32, width: 130 }} placeholder="Country" value={country} onChange={(e) => { setCountry(e.target.value); reset1(); }} />
				<FilterSelect ariaLabel="SportsTech acquiree" value={stech} onChange={(v) => { setStech(v); reset1(); }} options={[{ value: 'true', label: 'SportsTech acquiree' }]} allLabel="Any acquiree" />
				<FilterRange label="Value $" min={amountMin} max={amountMax} onMin={(v) => { setAmountMin(v); reset1(); }} onMax={(v) => { setAmountMax(v); reset1(); }} />
				<div style={{ flex: 1 }} />
				<CsvImportButton entity="acquisitions" onDone={() => void refresh()} />
				<CsvTemplateButton entity="acquisitions" />
				<CsvCheckButton entity="acquisitions" />
				<button className="btn" onClick={() => setCreating(true)}><Plus size={12} /> Add acquisition</button>
			</FilterBar>

			{(creating || editingId) && (
				<AcquisitionModal id={editingId} onClose={() => { setCreating(false); setEditingId(null); }} onSaved={() => { setCreating(false); setEditingId(null); void refresh(); }} />
			)}

			<div className="card">
				<AsyncState loading={isLoading} error={error} empty={rows.length === 0} emptyMsg={search ? 'No acquisitions match.' : 'No acquisitions yet.'} onRetry={() => void refresh()}>
					<table className="data-table">
						<thead><tr><th>Acquiree</th><th>Acquirer</th><SortableTh label="Year" field="acquisition_date" sort={sort} onSort={onSort} /><SortableTh label="Amount" field="amount_usd" sort={sort} onSort={onSort} /><th>Type</th><th style={{ textAlign: 'right' }} /></tr></thead>
						<tbody>
							{rows.map((a) => (
								<tr key={a.id}>
									<td>{a.acquiree_name ?? '—'}</td>
									<td>{a.acquirer_name ?? '—'}</td>
									<td className="num">{a.acquisition_year ?? '—'}</td>
									<td className="num">{fmtAmount(a.amount_usd)}</td>
									<td>{a.acquisition_type ?? '—'}</td>
									<td style={{ textAlign: 'right', display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
										<button className="btn ghost" onClick={() => setEditingId(a.id)}>Edit</button>
										<button className="btn ghost" style={{ color: 'var(--accent)' }} onClick={() => void remove(a.id)}><Trash2 size={12} /></button>
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

interface PartyForm {
	is_sportstech: boolean; sector_id: string; business_model: string; hq: LocationValue; sport_ids: string[];
}
/**
 * Role-based shape (mirrors the old IH wizard + the staged InlineMaEditor): the
 * SUBJECT is the catalog company this deal is about; `role` says whether it is
 * the acquiree or the acquirer; the COUNTERPARTY is the other side (a catalog
 * company or a free-text name). On submit these map to the server's
 * acquiree / acquirer columns by role, so a company is entered ONCE.
 */
interface AcqForm {
	role: 'acquiree' | 'acquirer';
	subject_company_id: string;
	subject: PartyForm;
	counterparty_company_id: string;
	counterparty_name: string;
	counterparty: PartyForm;
	acquisition_date: string; amount: string; currency_code: string; acquisition_type: string; source_url: string;
}
const emptyParty = (): PartyForm => ({ is_sportstech: false, sector_id: '', business_model: '', hq: { ...EMPTY_LOCATION }, sport_ids: [] });
const EMPTY_ACQ: AcqForm = {
	role: 'acquiree', subject_company_id: '', subject: { ...emptyParty(), is_sportstech: true },
	counterparty_company_id: '', counterparty_name: '', counterparty: emptyParty(),
	acquisition_date: '', amount: '', currency_code: '', acquisition_type: 'acquisition', source_url: '',
};

interface AcqEdit {
	acquiree_company_id?: string | null; acquirer_company_id?: string | null;
	acquiree_name_snapshot?: string | null; acquirer_name_snapshot?: string | null;
	acquisition_date?: string | null; amount?: string | null; amount_usd?: string | null; currency_code?: string | null;
	acquisition_type?: string | null; source_url?: string | null;
	acquiree_is_sportstech?: boolean | null; acquirer_is_sportstech?: boolean | null;
	acquiree_sector_id?: string | null; acquirer_sector_id?: string | null;
	acquiree_business_model?: string | null; acquirer_business_model?: string | null;
	acquiree_hq_country?: string | null; acquiree_hq_city?: string | null; acquiree_hq_continent?: string | null; acquiree_hq_region?: string | null; acquiree_hq_state?: string | null;
	acquirer_hq_country?: string | null; acquirer_hq_city?: string | null; acquirer_hq_continent?: string | null; acquirer_hq_region?: string | null; acquirer_hq_state?: string | null;
	acquiree_sport_ids?: string[]; acquirer_sport_ids?: string[];
}

function toAcqForm(h: AcqEdit): AcqForm {
	const acquireeParty: PartyForm = {
		is_sportstech: !!h.acquiree_is_sportstech, sector_id: h.acquiree_sector_id ?? '', business_model: h.acquiree_business_model ?? '',
		hq: { country: h.acquiree_hq_country ?? '', city: h.acquiree_hq_city ?? '', continent: h.acquiree_hq_continent ?? '', region: h.acquiree_hq_region ?? '', state: h.acquiree_hq_state ?? '' }, sport_ids: h.acquiree_sport_ids ?? [],
	};
	const acquirerParty: PartyForm = {
		is_sportstech: !!h.acquirer_is_sportstech, sector_id: h.acquirer_sector_id ?? '', business_model: h.acquirer_business_model ?? '',
		hq: { country: h.acquirer_hq_country ?? '', city: h.acquirer_hq_city ?? '', continent: h.acquirer_hq_continent ?? '', region: h.acquirer_hq_region ?? '', state: h.acquirer_hq_state ?? '' }, sport_ids: h.acquirer_sport_ids ?? [],
	};
	// Subject = whichever side is a catalog company (prefer the acquiree); the
	// other side becomes the counterparty. `role` names the subject's side; the
	// admin can flip it to correct a mis-entered direction.
	const role: 'acquiree' | 'acquirer' = !h.acquiree_company_id && h.acquirer_company_id ? 'acquirer' : 'acquiree';
	const subjectIsAcquiree = role === 'acquiree';
	return {
		role,
		subject_company_id: (subjectIsAcquiree ? h.acquiree_company_id : h.acquirer_company_id) ?? '',
		subject: subjectIsAcquiree ? acquireeParty : acquirerParty,
		counterparty_company_id: (subjectIsAcquiree ? h.acquirer_company_id : h.acquiree_company_id) ?? '',
		counterparty_name: (subjectIsAcquiree ? h.acquirer_name_snapshot : h.acquiree_name_snapshot) ?? '',
		counterparty: subjectIsAcquiree ? acquirerParty : acquireeParty,
		acquisition_date: h.acquisition_date ? String(h.acquisition_date).slice(0, 10) : '',
		amount: h.amount ?? h.amount_usd ?? '', currency_code: h.currency_code ?? '',
		acquisition_type: h.acquisition_type ?? 'acquisition', source_url: h.source_url ?? '',
	};
}

// A staged M&A draft = the POST body minus acquiree_company_id (the new company),
// plus a small label snapshot for rendering the row before the company exists.
export interface StagedAcq { body: Record<string, unknown>; label: { acquirer?: string; counterparty?: string; role?: 'acquiree' | 'acquirer'; amount?: string; year?: string } }

export function AcquisitionModal({ id, onClose, onSaved, subjectCompanyId }: { id: string | null; onClose: () => void; onSaved: () => void; subjectCompanyId?: string }) {
	const isEdit = !!id;
	const { data: hydrated } = useSWR<AcqEdit>(isEdit ? [`/api/admin/acquisitions/${id}/edit`] : null, { revalidateOnFocus: false });
	if (isEdit && !hydrated) return <Modal title="Edit acquisition" onClose={onClose}><Loading msg="Loading acquisition…" /></Modal>;
	// Adding from a company profile: pre-map that company as the subject so the
	// admin only picks the role + the other party (no re-selecting the same one).
	const initial = hydrated ? toAcqForm(hydrated) : { ...EMPTY_ACQ, subject_company_id: subjectCompanyId ?? '' };
	return <AcquisitionForm id={id} initial={initial} lockedSubject={!isEdit && !!subjectCompanyId} onClose={onClose} onSaved={onSaved} />;
}

function AcquisitionForm({ id, initial, onClose, onSaved, lockedSubject = false }: { id: string | null; initial: AcqForm; onClose: () => void; onSaved: () => void; lockedSubject?: boolean }) {
	const isEdit = !!id;
	const [form, setForm] = useState<AcqForm>(initial);
	const [pending, setPending] = useState(false);

	const set = <K extends keyof AcqForm>(k: K, v: AcqForm[K]) => setForm((f) => ({ ...f, [k]: v }));
	const setParty = (which: 'subject' | 'counterparty', patch: Partial<PartyForm>) =>
		setForm((f) => ({ ...f, [which]: { ...f[which], ...patch } }));

	// When a side is a catalog company, pull its sector / business model / HQ /
	// sports from the company record instead of making the admin re-type them. The
	// snapshot the acquisition stores is still populated (from the auto-filled
	// form); the admin just doesn't retype a company that already exists.
	const fillFromCompany = async (which: 'subject' | 'counterparty', companyId: string) => {
		if (!companyId) return;
		try {
			const c = await api<{
				sector_id?: string | null; business_model?: string | null;
				hq_country?: string | null; hq_city?: string | null; hq_continent?: string | null; hq_region?: string | null; hq_state?: string | null;
				sport_ids?: string[];
			}>('GET', `/api/admin/companies/${companyId}/edit`);
			setParty(which, {
				sector_id: c.sector_id ?? '',
				business_model: c.business_model ?? '',
				hq: { country: c.hq_country ?? '', city: c.hq_city ?? '', continent: c.hq_continent ?? '', region: c.hq_region ?? '', state: c.hq_state ?? '' },
				sport_ids: c.sport_ids ?? [],
			});
		} catch { /* leave fields as-is — the admin can still save */ }
	};

	// Pre-mapped subject (added from a company profile): pull its attributes once so
	// the stored snapshot matches what picking it manually would produce.
	useEffect(() => {
		if (lockedSubject && form.subject_company_id) void fillFromCompany('subject', form.subject_company_id);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// Map one side (subject or counterparty) onto the server's acquiree_* / acquirer_*
	// columns via the chosen role. Computed keys so each company is entered once.
	const partyBody = (prefix: 'acquiree' | 'acquirer', p: PartyForm, companyId: string, name: string): Record<string, unknown> => ({
		[`${prefix}_company_id`]: companyId || undefined,
		[`${prefix}_name`]: !companyId && name.trim() ? name.trim() : undefined,
		[`${prefix}_is_sportstech`]: p.is_sportstech,
		[`${prefix}_sector_id`]: p.sector_id || undefined,
		[`${prefix}_business_model`]: p.business_model || undefined,
		[`${prefix}_hq_country`]: p.hq.country.trim() || undefined,
		[`${prefix}_hq_city`]: p.hq.city.trim() || undefined,
		[`${prefix}_hq_continent`]: p.hq.continent.trim() || undefined,
		[`${prefix}_hq_region`]: p.hq.region.trim() || undefined,
		[`${prefix}_hq_state`]: p.hq.state.trim() || undefined,
		[`${prefix}_sport_ids`]: p.sport_ids,
	});

	const submit = async () => {
		setPending(true);
		try {
			const other: 'acquiree' | 'acquirer' = form.role === 'acquiree' ? 'acquirer' : 'acquiree';
			const body: Record<string, unknown> = {
				...partyBody(form.role, form.subject, form.subject_company_id, ''),
				...partyBody(other, form.counterparty, form.counterparty_company_id, form.counterparty_name),
				acquisition_date: form.acquisition_date || undefined,
				amount: form.amount.trim() ? Number(form.amount) : undefined,
				currency_code: form.currency_code || undefined,
				acquisition_type: form.acquisition_type,
				source_url: form.source_url.trim() || undefined,
			};
			if (isEdit) await api('PATCH', `/api/admin/acquisitions/${id}`, body);
			else await api('POST', '/api/admin/acquisitions', body);
			toast.success(isEdit ? 'Saved' : 'Created');
			onSaved();
		} catch (e) { toast.error((e as Error).message); } finally { setPending(false); }
	};

	const cpLabel = form.role === 'acquiree' ? 'Acquirer' : 'Acquiree';
	const cpLinked = !!form.counterparty_company_id;
	const canSave = !!form.subject_company_id && (!!form.counterparty_company_id || !!form.counterparty_name.trim()) && !!form.acquisition_date;

	return (
		<Modal
			title={isEdit ? 'Edit acquisition' : 'New acquisition'}
			onClose={onClose}
			width={680}
			footer={
				<>
					<button className="btn ghost" onClick={onClose}>Cancel</button>
					<button className="btn" disabled={!canSave || pending} onClick={() => void submit()}>
						<Save size={12} /> {pending ? 'Saving…' : 'Save'}
					</button>
				</>
			}
		>
			<div style={{ display: 'grid', gap: 14 }}>
				{/* Subject: the catalog company this deal is about — entered once. */}
				<Field label="Company *" hint={lockedSubject ? 'this company profile — only pick the other party below' : 'the company in our catalog this deal is about'}><CompanySelectOne value={form.subject_company_id} onChange={(v) => { set('subject_company_id', v); void fillFromCompany('subject', v); }} locked={lockedSubject} /></Field>

				{/* Role: this company is EITHER the acquirer OR the acquiree. */}
				<div>
					<div className="co-stat-label" style={{ marginBottom: 6 }}>This company is the…</div>
					<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
						<button type="button" className={`btn ${form.role === 'acquiree' ? '' : 'ghost'}`} onClick={() => set('role', 'acquiree')}>Acquiree — it was acquired</button>
						<button type="button" className={`btn ${form.role === 'acquirer' ? '' : 'ghost'}`} onClick={() => set('role', 'acquirer')}>Acquirer — it acquired another</button>
					</div>
				</div>

				{/* Counterparty: the other side — a catalog company or a free-text name. */}
				<Field label={`${cpLabel} (counterparty)`} hint="pick from the catalog, or type a name below if not listed"><CompanySelectOne value={form.counterparty_company_id} onChange={(v) => { set('counterparty_company_id', v); void fillFromCompany('counterparty', v); }} /></Field>
				{cpLinked ? (
					<div style={{ fontSize: 12.5, color: 'var(--fg-muted)' }}>Counterparty sector, business model, location and sports are taken from the linked company.</div>
				) : (
					<>
						<Field label={`…or ${cpLabel.toLowerCase()} name (free text)`}><input className="search-input" value={form.counterparty_name} onChange={(e) => set('counterparty_name', e.target.value)} /></Field>
						<Field label="Counterparty sector"><SectorCascade value={form.counterparty.sector_id} onChange={(v) => setParty('counterparty', { sector_id: v })} /></Field>
						<Field label="Counterparty business model" hint="who they sell to — B2B, B2C or B2B2C">
							<Select value={form.counterparty.business_model} onChange={(v) => setParty('counterparty', { business_model: v })} placeholder="—" width="100%" style={{ display: 'block', width: '100%' }} options={[{ value: '', label: '—' }, ...BUSINESS_MODELS.map((b) => ({ value: b, label: b.toUpperCase() }))]} />
						</Field>
						<Field label="Counterparty location"><LocationFields value={form.counterparty.hq} onChange={(v) => setParty('counterparty', { hq: v })} /></Field>
						<Field label="Counterparty sports"><SportsPicker value={form.counterparty.sport_ids} onChange={(v) => setParty('counterparty', { sport_ids: v })} /></Field>
					</>
				)}

				<div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', fontSize: 13 }}>
					<label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={form.subject.is_sportstech} onChange={(e) => setParty('subject', { is_sportstech: e.target.checked })} /> This company is SportsTech</label>
					<label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={form.counterparty.is_sportstech} onChange={(e) => setParty('counterparty', { is_sportstech: e.target.checked })} /> Counterparty is SportsTech</label>
				</div>

				{/* Deal info */}
				<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
					<Field label="Acquisition date *" hint="sets the FX year used to convert the amount to USD"><input className="search-input" type="date" value={form.acquisition_date} onChange={(e) => set('acquisition_date', e.target.value)} /></Field>
					<Field label="Type">
						<Select value={form.acquisition_type} onChange={(v) => set('acquisition_type', v)} width="100%" style={{ display: 'block', width: '100%' }} options={TYPES.map((t) => ({ value: t, label: t.replace(/_/g, ' ') }))} />
					</Field>
				</div>
				<div style={{ display: 'grid', gridTemplateColumns: '1fr 120px', gap: 12 }}>
					<Field label="Amount" hint="in the currency at right — converted to USD automatically"><input className="search-input" type="number" value={form.amount} onChange={(e) => set('amount', e.target.value)} placeholder="e.g. 5000000" /></Field>
					<Field label="Currency" hint="of the amount"><CurrencySelect value={form.currency_code} onChange={(v) => set('currency_code', v)} /></Field>
				</div>
				<Field label="Source URL"><input className="search-input" value={form.source_url} onChange={(e) => set('source_url', e.target.value)} placeholder="https://" /></Field>
			</div>
		</Modal>
	);
}

