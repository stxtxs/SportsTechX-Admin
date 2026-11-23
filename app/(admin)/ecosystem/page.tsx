'use client';

import { useState } from 'react';
import { useSearchParams, usePathname } from 'next/navigation';
import useSWR, { useSWRConfig } from 'swr';
import { toast } from 'sonner';
import { Plus, Save, Trash2, Layers, CalendarClock, Package, GraduationCap, Lightbulb, Banknote } from 'lucide-react';
import { api } from '@/lib/api';
import { Select } from '@/components/select';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { Modal } from '@/components/modal';
import { PageHeader, AsyncState, Loading, ErrorState, StatCard, RichStatCard, StatsPanel, PillTabs, Section, Pager } from '@/components/atoms';
import { PieDonut, PieLegend, toSegments, type Bucket } from '@/components/charts';
import { FilterBar, FilterSelect, StatStrip, FilterRange, RefSlugFilter } from '@/components/filters';
import { CsvImportButton, CsvTemplateButton, CsvCheckButton } from '@/components/csv-import';
import { YearSelect } from '@/components/year-select';
import { ImageInput } from '@/components/image-input';
import { useConfirm } from '@/components/confirm';
import { TabbedForm, Field, useTabs } from '@/components/tabbed-form';
import { SportsPicker, LocationFields, SocialLinks, CompanySelectOne, EMPTY_SOCIAL, EMPTY_LOCATION, type SocialValue, type LocationValue } from '@/components/entity-pickers';
import { InvestorsView } from '@/components/admin-views/investors';
import { ClaimsView } from '@/components/admin-views/claims';
import { DataRequestsView } from '@/components/admin-views/data-requests';
import { DateRangePicker, type RangeValue } from '@/components/date-range-picker';
import { confirmDelete } from '@/lib/delete-impact';
import { MergeModal } from '@/components/merge-modal';
import { useUrlState, useUrlNumber } from '@/hooks/use-url-state';
import { useEditPayload } from '@/hooks/use-edit-payload';

interface Entity {
	id: string;
	name: string;
	slug?: string;
	entity_type: string;
	category?: string | null;
	status?: string | null;
	hq_country?: string | null;
}
interface Response { data: Entity[]; total: number; totalPages: number }
interface EcoStats {
	total: number; upcoming_events?: number; added_this_month?: number; added_last_month?: number;
	total_rows?: number; this_year?: number; last_year?: number; yoy_change?: number | null;
	programs?: number; programs_this_year?: number; programs_last_year?: number; programs_yoy?: number | null;
	events?: number; events_this_year?: number; events_last_year?: number; events_yoy?: number | null;
	initiatives?: number; initiatives_this_year?: number; initiatives_last_year?: number; initiatives_yoy?: number | null;
	by_type: Bucket[]; by_status: Bucket[];
}
interface InvestorYoyStats { total: number; this_year?: number; last_year?: number; yoy_change?: number | null }

const STATUSES = ['active', 'inactive', 'paused'] as const;
const TYPE_META = [
	{ key: 'program' as const, label: 'Program', Icon: GraduationCap, desc: 'Accelerator, incubator, or startup program' },
	{ key: 'event' as const, label: 'Event', Icon: CalendarClock, desc: 'Conference, summit, or networking event' },
	{ key: 'initiative' as const, label: 'Initiative', Icon: Lightbulb, desc: 'Industry initiative, body, or partnership' },
];
const PROGRAM_CATEGORIES = ['Accelerator', 'Incubator', 'Challenge/Competition'] as const;
const EVENT_MODES = ['in_person', 'virtual', 'hybrid'] as const;

type EcoType = 'program' | 'event' | 'initiative' | 'organization';
export function EcosystemView({ embedded = false, entityType }: { embedded?: boolean; entityType?: EcoType }) {
	// Programs / Events / Initiatives tabs reuse this view: each keeps its own filters in the URL.
	const ns = `eco-${entityType ?? 'all'}`;
	const { mutate } = useSWRConfig();
	const ask = useConfirm();
	const [typeState, setType] = useState<EcoType>('program');
	const type = entityType ?? typeState;
	const [search, setSearch] = useUrlState(ns, 'search', '');
	const debouncedSearch = useDebouncedValue(search);
	const [status, setStatus] = useUrlState(ns, 'status', '');
	const [country, setCountry] = useUrlState(ns, 'country', '');
	const [category, setCategory] = useUrlState(ns, 'category', '');
	const [sport, setSport] = useUrlState(ns, 'sport', '');
	const [foundedMin, setFoundedMin] = useUrlState(ns, 'foundedMin', '');
	const [foundedMax, setFoundedMax] = useUrlState(ns, 'foundedMax', '');
	const [mode, setMode] = useUrlState(ns, 'mode', '');
	const [featured, setFeatured] = useUrlState(ns, 'featured', '');
	const [upcoming, setUpcoming] = useUrlState(ns, 'upcoming', '');
	const [entriesOpen, setEntriesOpen] = useUrlState(ns, 'entriesOpen', '');
	const [page, setPage] = useUrlNumber(ns, 'page', 1);
	const reset1 = () => setPage(1);
	const [creating, setCreating] = useState(false);
	const [editingId, setEditingId] = useState<string | null>(null);
	const [removePending, setRemovePending] = useState(false);
	const [merging, setMerging] = useState<{ id: string; name: string } | null>(null);
	const [viewingId, setViewingId] = useState<string | null>(null);

	// Typed filters (country, min/max) wait for typing to pause, like search, instead of one request per key.
	const dCountry = useDebouncedValue(country);
	const dCategory = useDebouncedValue(category);
	const dFoundedMin = useDebouncedValue(foundedMin);
	const dFoundedMax = useDebouncedValue(foundedMax);
	const { data, error, isLoading } = useSWR<Response>(
		['/api/ecosystem-entities', {
			entity_type: type, q: debouncedSearch || undefined, status: status || undefined,
			country: dCountry.trim() || undefined, category: dCategory.trim() || undefined, sport_slug: sport || undefined,
			founded_year_min: dFoundedMin || undefined, founded_year_max: dFoundedMax || undefined,
			...(type === 'event'
				? { mode: mode || undefined, is_featured: featured || undefined, upcoming_only: upcoming || undefined }
				: type === 'program'
					? { entries_open: entriesOpen || undefined }
					: {}),
			page, limit: 30,
		}],
		{ dedupingInterval: 30_000 },
	);
	const stats = useSWR<EcoStats>(['/api/admin/stats/ecosystem'], { dedupingInterval: 60_000 });
	const typeSegments = toSegments(stats.data?.by_type ?? []);
	const statusSegments = toSegments(stats.data?.by_status ?? []);

	const refresh = () => mutate((key) => Array.isArray(key) && key[0] === '/api/ecosystem-entities');

	const remove = async (id: string, name: string) => {
		if (!(await confirmDelete(ask, 'ecosystem', id, name))) return;
		setRemovePending(true);
		try {
			await api('DELETE', `/api/admin/ecosystem-entities/${id}`);
			toast.success('Deleted');
			void refresh();
		} catch (e) {
			toast.error((e as Error).message);
		} finally {
			setRemovePending(false);
		}
	};

	const entities = data?.data ?? [];
	return (
		<div>
			{!embedded && <PageHeader kicker={`Ecosystem · ${(stats.data?.total ?? 0).toLocaleString()} entities`} title="Programs & events" />}

			{!embedded && (
				<StatsPanel>
					<StatStrip cols={4}>
						<RichStatCard label="Total entities" tone="blue" Icon={Layers} loading={stats.isLoading} value={(stats.data?.total ?? 0).toLocaleString()}
							thisYear={stats.data?.this_year} lastYear={stats.data?.last_year} yoy={stats.data?.yoy_change} />
						<StatCard
							label="Added this month"
							tone="indigo"
							loading={stats.isLoading}
							value={(stats.data?.added_this_month ?? 0).toLocaleString()}
							delta={stats.data && (stats.data.added_last_month ?? 0) > 0 ? (((stats.data.added_this_month ?? 0) - (stats.data.added_last_month ?? 0)) / (stats.data.added_last_month ?? 1)) * 100 : null}
						/>
						<RichStatCard label="Upcoming events" tone="amber" Icon={CalendarClock} loading={stats.isLoading} value={(stats.data?.upcoming_events ?? 0).toLocaleString()} />
						{(stats.data?.by_type ?? []).slice(0, 1).map((b) => (
							<RichStatCard key={b.label} label={b.label} tone="purple" Icon={Package} loading={stats.isLoading} value={b.value.toLocaleString()} />
						))}
					</StatStrip>
				</StatsPanel>
			)}

			{!embedded && (
				<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)', marginBottom: 'var(--space-5)' }}>
					<Section title="By type" meta="entities" center>
						<AsyncState loading={stats.isLoading} error={stats.error} empty={typeSegments.length === 0} emptyMsg="No data" onRetry={() => void stats.mutate()}>
							<div style={{ display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
								<PieDonut segments={typeSegments} size={170} mode="donut" />
								<div style={{ flex: 1, minWidth: 160 }}><PieLegend segments={typeSegments} /></div>
							</div>
						</AsyncState>
					</Section>
					<Section title="By status" meta="entities" center>
						<AsyncState loading={stats.isLoading} error={stats.error} empty={statusSegments.length === 0} emptyMsg="No data" onRetry={() => void stats.mutate()}>
							<PieDonut segments={statusSegments} mode="bar" />
						</AsyncState>
					</Section>
				</div>
			)}

			{(creating || editingId) && (
				<EntityModal
					id={editingId}
					defaultType={type}
					onClose={() => { setCreating(false); setEditingId(null); }}
					onSaved={() => { setCreating(false); setEditingId(null); void refresh(); }}
				/>
			)}
			{merging && <MergeModal kind="ecosystem" id={merging.id} name={merging.name} onClose={() => setMerging(null)} onMerged={() => { setMerging(null); void refresh(); }} />}

			{viewingId ? (
				<EntityDetail id={viewingId} onBack={() => setViewingId(null)} onEdit={(eid) => setEditingId(eid)} onView={setViewingId} />
			) : (
				<>
			<FilterBar>
				{!entityType && (
					<>
						<button className={`chip ${type === 'program' ? 'on' : ''}`} onClick={() => { setType('program'); setPage(1); }}>Programs</button>
						<button className={`chip ${type === 'event' ? 'on' : ''}`} onClick={() => { setType('event'); setPage(1); }}>Events</button>
					</>
				)}
				<input className="search-input" style={{ flex: '0 0 220px', height: 32 }} placeholder="Search…" value={search} onChange={(e) => { setSearch(e.target.value); reset1(); }} />
				<FilterSelect ariaLabel="Status" value={status} onChange={(v) => { setStatus(v); reset1(); }} options={[...STATUSES]} allLabel="All statuses" />
				<RefSlugFilter kind="sports" ariaLabel="Sport" value={sport} onChange={(v) => { setSport(v); reset1(); }} allLabel="All sports" />
				<input className="search-input" style={{ height: 32, width: 120 }} placeholder="Category" value={category} onChange={(e) => { setCategory(e.target.value); reset1(); }} />
				<input className="search-input" style={{ height: 32, width: 120 }} placeholder="Country" value={country} onChange={(e) => { setCountry(e.target.value); reset1(); }} />
				<FilterRange label="Founded" min={foundedMin} max={foundedMax} onMin={(v) => { setFoundedMin(v); reset1(); }} onMax={(v) => { setFoundedMax(v); reset1(); }} width={64} />
				{type === 'event' && (
					<>
						<FilterSelect ariaLabel="Mode" value={mode} onChange={(v) => { setMode(v); reset1(); }} options={[...EVENT_MODES]} allLabel="Any mode" />
						<FilterSelect ariaLabel="Upcoming" value={upcoming} onChange={(v) => { setUpcoming(v); reset1(); }} options={[{ value: 'true', label: 'Upcoming only' }]} allLabel="All dates" />
						<FilterSelect ariaLabel="Featured" value={featured} onChange={(v) => { setFeatured(v); reset1(); }} options={[{ value: 'true', label: 'Featured only' }]} allLabel="Any" />
					</>
				)}
				{type === 'program' && (
					<FilterSelect ariaLabel="Applications" value={entriesOpen} onChange={(v) => { setEntriesOpen(v); reset1(); }} options={[{ value: 'true', label: 'Applications open' }, { value: 'false', label: 'Closed' }]} allLabel="Any application status" />
				)}
				<div style={{ flex: 1 }} />
				<CsvImportButton entity="ecosystem" onDone={() => void refresh()} />
				<CsvTemplateButton entity="ecosystem" />
				<CsvCheckButton entity="ecosystem" />
				<button className="btn" onClick={() => setCreating(true)}><Plus size={12} /> Add {type}</button>
			</FilterBar>
			<div className="card">
				<AsyncState loading={isLoading} error={error} empty={entities.length === 0} emptyMsg={`No ${type}s yet.`} onRetry={() => void refresh()}>
					<table className="data-table">
						<thead><tr><th>Name</th><th>Slug</th><th>Category</th><th>Status</th><th>HQ</th><th style={{ textAlign: 'right' }} /></tr></thead>
						<tbody>
							{entities.map((e) => (
								<tr key={e.id}>
									<td><button className="btn ghost" style={{ padding: '2px 4px', fontWeight: 600, textAlign: 'left' }} onClick={() => setViewingId(e.id)}>{e.name}</button></td>
									<td className="num">{e.slug ?? '—'}</td>
									<td>{e.category ?? '—'}</td>
									<td>{e.status ?? '—'}</td>
									<td>{e.hq_country ?? '—'}</td>
									<td style={{ textAlign: 'right', display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
										<button className="btn ghost" onClick={() => setEditingId(e.id)}>Edit</button>
										<button className="btn ghost" title="Merge this duplicate into another organisation" onClick={() => setMerging({ id: e.id, name: e.name })}>Merge</button>
										<button className="btn ghost" style={{ color: 'var(--accent)' }} disabled={removePending} onClick={() => void remove(e.id, e.name)}>
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
				</>
			)}
		</div>
	);
}

interface ProgramDetails {
	duration_label: string; interval_label: string; investment_label: string; equity_label: string;
	stage_label: string; cohort_size: string; latest_cohort_year: string; cohort_history_label: string;
	details: string; entries_open: boolean; entries_end_date: string; virtual_mode: string; has_office_space: string; is_profitable: string;
}
interface EventDetails {
	mode: string; start_date: string; end_date: string; is_featured: boolean;
	cover_url: string; discount_code: string; discount_description: string;
}
interface EntityForm {
	name: string; slug: string; entity_type: string; description: string; website: string;
	category: string; founded_year: string; latest_activity_year: string; status: string; hq: LocationValue;
	poc_name: string; poc_position: string; poc_email: string; poc_linkedin: string;
	social: SocialValue; sport_ids: string[]; program: ProgramDetails; event: EventDetails;
}

const EMPTY_PROGRAM: ProgramDetails = {
	duration_label: '', interval_label: '', investment_label: '', equity_label: '', stage_label: '',
	cohort_size: '', latest_cohort_year: '', cohort_history_label: '', details: '',
	entries_open: false, entries_end_date: '', virtual_mode: '', has_office_space: '', is_profitable: '',
};
const EMPTY_EVENT: EventDetails = {
	mode: '', start_date: '', end_date: '', is_featured: false, cover_url: '', discount_code: '', discount_description: '',
};
const emptyEntity = (type: string): EntityForm => ({
	name: '', slug: '', entity_type: type, description: '', website: '', category: '', founded_year: '', latest_activity_year: '', status: 'active',
	poc_name: '', poc_position: '', poc_email: '', poc_linkedin: '',
	hq: { ...EMPTY_LOCATION }, social: { ...EMPTY_SOCIAL }, sport_ids: [], program: { ...EMPTY_PROGRAM }, event: { ...EMPTY_EVENT },
});

interface EntityEdit extends Entity {
	description?: string | null; website?: string | null; founded_year?: number | null; latest_activity_year?: number | null;
	poc_name?: string | null; poc_position?: string | null; poc_email?: string | null; poc_linkedin?: string | null;
	hq_city?: string | null; hq_continent?: string | null; hq_region?: string | null; hq_state?: string | null; hq_report_region?: string | null;
	twitter_url?: string | null; instagram_url?: string | null; facebook_url?: string | null;
	linkedin_url?: string | null; youtube_url?: string | null; email?: string | null;
	sport_ids?: string[];
	program?: Record<string, unknown> | null;
	event?: Record<string, unknown> | null;
}

function toEntityForm(h: EntityEdit, defaultType: string): EntityForm {
	const p = (h.program ?? {}) as Record<string, unknown>;
	const ev = (h.event ?? {}) as Record<string, unknown>;
	const str = (v: unknown) => (v == null ? '' : String(v));
	const date = (v: unknown) => (v == null ? '' : String(v).slice(0, 10));
	return {
		name: h.name ?? '', slug: h.slug ?? '', entity_type: h.entity_type ?? defaultType,
		description: h.description ?? '', website: h.website ?? '', category: h.category ?? '',
		founded_year: h.founded_year ? String(h.founded_year) : '', latest_activity_year: h.latest_activity_year ? String(h.latest_activity_year) : '', status: h.status ?? 'active',
		poc_name: h.poc_name ?? '', poc_position: h.poc_position ?? '', poc_email: h.poc_email ?? '', poc_linkedin: h.poc_linkedin ?? '',
		hq: { country: h.hq_country ?? '', city: h.hq_city ?? '', continent: h.hq_continent ?? '', region: h.hq_region ?? '', state: h.hq_state ?? '', report_region: h.hq_report_region ?? '' },
		social: {
			twitter_url: h.twitter_url ?? '', instagram_url: h.instagram_url ?? '', facebook_url: h.facebook_url ?? '',
			linkedin_url: h.linkedin_url ?? '', youtube_url: h.youtube_url ?? '', email: h.email ?? '',
		},
		sport_ids: h.sport_ids ?? [],
		program: {
			duration_label: str(p.duration_label), interval_label: str(p.interval_label), investment_label: str(p.investment_label),
			equity_label: str(p.equity_label), stage_label: str(p.stage_label), cohort_size: str(p.cohort_size),
			latest_cohort_year: str(p.latest_cohort_year), cohort_history_label: str(p.cohort_history_label), details: str(p.details),
			entries_open: !!p.entries_open, entries_end_date: date(p.entries_end_date), virtual_mode: str(p.virtual_mode), has_office_space: p.has_office_space == null ? '' : (p.has_office_space ? 'yes' : 'no'), is_profitable: p.is_profitable == null ? '' : (p.is_profitable ? 'yes' : 'no'),
		},
		event: {
			mode: str(ev.mode), start_date: date(ev.start_date), end_date: date(ev.end_date),
			is_featured: !!ev.is_featured, cover_url: str(ev.cover_url), discount_code: str(ev.discount_code), discount_description: str(ev.discount_description),
		},
	};
}

function EntityModal({ id, defaultType, onClose, onSaved }: { id: string | null; defaultType: string; onClose: () => void; onSaved: () => void }) {
	const isEdit = !!id;
	const { data: hydrated } = useEditPayload<EntityEdit>(isEdit ? `/api/admin/ecosystem-entities/${id}/edit` : null);
	if (isEdit && !hydrated) return <Modal title="Edit entity" onClose={onClose}><Loading msg="Loading entity…" /></Modal>;
	return <EntityForm id={id} initial={hydrated ? toEntityForm(hydrated, defaultType) : emptyEntity(defaultType)} onClose={onClose} onSaved={onSaved} />;
}

function EntityForm({ id, initial, onClose, onSaved }: { id: string | null; initial: EntityForm; onClose: () => void; onSaved: () => void }) {
	const isEdit = !!id;
	const [tab, setTab] = useTabs('profile');
	const [form, setForm] = useState<EntityForm>(initial);
	const [pending, setPending] = useState(false);

	const set = <K extends keyof EntityForm>(k: K, v: EntityForm[K]) => setForm((f) => ({ ...f, [k]: v }));
	// On edit an emptied field is sent as null so it clears; undefined would keep the old value.
	const blank = isEdit ? null : undefined;
	const numOrNull = (s: string) => (s.trim() === '' ? null : Number(s));
	const yesNoNull = (s: string) => (s === '' ? null : s === 'yes');

	const submit = async () => {
		setPending(true);
		try {
			const body: Record<string, unknown> = {
				name: form.name.trim(),
				slug: form.slug.trim() || undefined,
				entity_type: form.entity_type,
				description: form.description.trim() || blank,
				website: form.website.trim() || blank,
				category: form.category.trim() || blank,
				founded_year: form.founded_year ? Number(form.founded_year) : blank,
				latest_activity_year: form.latest_activity_year ? Number(form.latest_activity_year) : blank,
				poc_name: form.poc_name.trim() || blank,
				poc_position: form.poc_position.trim() || blank,
				poc_email: form.poc_email.trim() || blank,
				poc_linkedin: form.poc_linkedin.trim() || blank,
				status: form.status,
				hq_country: form.hq.country.trim() || blank,
				hq_city: form.hq.city.trim() || blank,
				hq_continent: form.hq.continent.trim() || blank,
				hq_region: form.hq.region.trim() || blank,
				hq_state: form.hq.state.trim() || blank,
				hq_report_region: (form.hq.report_region ?? '').trim() || blank,
				social: form.social,
				sport_ids: form.sport_ids,
			};
			if (form.entity_type === 'program') {
				body.program = {
					duration_label: form.program.duration_label.trim() || null,
					interval_label: form.program.interval_label.trim() || null,
					investment_label: form.program.investment_label.trim() || null,
					equity_label: form.program.equity_label.trim() || null,
					stage_label: form.program.stage_label.trim() || null,
					cohort_size: numOrNull(form.program.cohort_size),
					latest_cohort_year: numOrNull(form.program.latest_cohort_year),
					cohort_history_label: form.program.cohort_history_label.trim() || null,
					details: form.program.details.trim() || null,
					entries_open: form.program.entries_open,
					entries_end_date: form.program.entries_end_date || null,
					virtual_mode: form.program.virtual_mode || null,
					has_office_space: yesNoNull(form.program.has_office_space),
					is_profitable: yesNoNull(form.program.is_profitable),
				};
			}
			if (form.entity_type === 'event') {
				body.event = {
					mode: form.event.mode || null,
					start_date: form.event.start_date || null,
					end_date: form.event.end_date || null,
					is_featured: form.event.is_featured,
					cover_url: form.event.cover_url.trim() || null,
					discount_code: form.event.discount_code.trim() || null,
					discount_description: form.event.discount_description.trim() || null,
				};
			}
			if (isEdit) await api('PATCH', `/api/admin/ecosystem-entities/${id}`, body);
			else await api('POST', '/api/admin/ecosystem-entities', body);
			toast.success(isEdit ? 'Saved' : 'Created');
			onSaved();
		} catch (e) {
			toast.error((e as Error).message);
		} finally {
			setPending(false);
		}
	};

	const isEvent = form.entity_type === 'event';
	const isProgram = form.entity_type === 'program';
	const setProgram = <K extends keyof ProgramDetails>(k: K, v: ProgramDetails[K]) => set('program', { ...form.program, [k]: v });
	const setEvent = <K extends keyof EventDetails>(k: K, v: EventDetails[K]) => set('event', { ...form.event, [k]: v });

	const detailsTab = isEvent ? {
		key: 'details', label: 'Event details', node: (
			<>
				<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
					<Field label="Mode" hint="how attendees join"><Select value={form.event.mode} onChange={(v) => setEvent('mode', v)} width="100%" style={{ display: 'block', width: '100%' }} placeholder="—" options={[{ value: '', label: '—' }, ...EVENT_MODES.map((m) => ({ value: m, label: m.replace(/_/g, ' ') }))]} /></Field>
					<Field label="Cover image"><ImageInput value={form.event.cover_url} onChange={(u) => setEvent('cover_url', u)} pathPrefix="ecosystem/events" /></Field>
				</div>
				<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
					<Field label="Start date"><input className="search-input" type="date" value={form.event.start_date} onChange={(e) => setEvent('start_date', e.target.value)} /></Field>
					<Field label="End date"><input className="search-input" type="date" value={form.event.end_date} onChange={(e) => setEvent('end_date', e.target.value)} /></Field>
				</div>
				<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
					<Field label="Discount code"><input className="search-input" value={form.event.discount_code} onChange={(e) => setEvent('discount_code', e.target.value)} placeholder="e.g. SPORTSTECH20" /></Field>
					<Field label="Discount description"><input className="search-input" value={form.event.discount_description} onChange={(e) => setEvent('discount_description', e.target.value)} placeholder="e.g. 20% off tickets" /></Field>
				</div>
				<label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
					<input type="checkbox" checked={form.event.is_featured} onChange={(e) => setEvent('is_featured', e.target.checked)} /> Featured event <span style={{ color: 'var(--fg-muted)' }}>— pins it in the events list</span>
				</label>
			</>
		),
	} : {
		key: 'details', label: 'Program details', node: (
			<>
				<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
					<Field label="Duration"><input className="search-input" value={form.program.duration_label} onChange={(e) => setProgram('duration_label', e.target.value)} placeholder="e.g. 12 weeks" /></Field>
					<Field label="Interval"><input className="search-input" value={form.program.interval_label} onChange={(e) => setProgram('interval_label', e.target.value)} placeholder="e.g. Twice per year" /></Field>
				</div>
				<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
					<Field label="Investment"><input className="search-input" value={form.program.investment_label} onChange={(e) => setProgram('investment_label', e.target.value)} placeholder="$120k" /></Field>
					<Field label="Equity"><input className="search-input" value={form.program.equity_label} onChange={(e) => setProgram('equity_label', e.target.value)} placeholder="6%" /></Field>
				</div>
				<div style={{ display: 'grid', gridTemplateColumns: '1fr 120px 120px', gap: 12 }}>
					<Field label="Stage"><input className="search-input" value={form.program.stage_label} onChange={(e) => setProgram('stage_label', e.target.value)} placeholder="e.g. Idea to Seed" /></Field>
					<Field label="Cohort size"><input className="search-input" type="number" value={form.program.cohort_size} onChange={(e) => setProgram('cohort_size', e.target.value)} /></Field>
					<Field label="Latest cohort"><YearSelect value={form.program.latest_cohort_year} onChange={(v) => setProgram('latest_cohort_year', v)} /></Field>
				</div>
				<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
					<Field label="Virtual"><Select value={form.program.virtual_mode} onChange={(v) => setProgram('virtual_mode', v)} width="100%" style={{ display: 'block', width: '100%' }} placeholder="—" options={[{ value: '', label: '—' }, { value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }, { value: 'hybrid', label: 'Hybrid' }]} /></Field>
					<Field label="Office space"><Select value={form.program.has_office_space} onChange={(v) => setProgram('has_office_space', v)} width="100%" style={{ display: 'block', width: '100%' }} placeholder="—" options={[{ value: '', label: '—' }, { value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]} /></Field>
					<Field label="Profit type"><Select value={form.program.is_profitable} onChange={(v) => setProgram('is_profitable', v)} width="100%" style={{ display: 'block', width: '100%' }} placeholder="—" options={[{ value: '', label: '—' }, { value: 'yes', label: 'For profit' }, { value: 'no', label: 'Non-profit' }]} /></Field>
				</div>
				<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
					<Field label="Cohort history"><input className="search-input" value={form.program.cohort_history_label} onChange={(e) => setProgram('cohort_history_label', e.target.value)} /></Field>
					<Field label="Applications close"><input className="search-input" type="date" value={form.program.entries_end_date} onChange={(e) => setProgram('entries_end_date', e.target.value)} /></Field>
				</div>
				<label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
					<input type="checkbox" checked={form.program.entries_open} onChange={(e) => setProgram('entries_open', e.target.checked)} /> Entries open <span style={{ color: 'var(--fg-muted)' }}>— applications currently accepted</span>
				</label>
				{form.program.entries_open && (
					<Field label="Application details" hint="deadlines, requirements — shown while entries are open"><textarea className="search-input" style={{ minHeight: 60, resize: 'vertical' }} value={form.program.details} onChange={(e) => setProgram('details', e.target.value)} placeholder="Enter application details, deadlines, or requirements…" /></Field>
				)}
			</>
		),
	};

	return (
		<Modal
			title={isEdit ? `Edit ${form.entity_type}` : `New ${form.entity_type}`}
			onClose={onClose}
			width={860}
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
				<TabbedForm
					active={tab}
					onChange={setTab}
					tabs={[
						{ key: 'profile', label: 'Profile', node: (
							<>
								<Field label="Name *" hint="required — the display name used everywhere"><input className="search-input" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Techstars Sports" /></Field>
								<Field label="Type">
									<div style={{ display: 'grid', gridTemplateColumns: `repeat(${TYPE_META.length}, 1fr)`, gap: 8 }}>
										{TYPE_META.map((tm) => {
											const on = form.entity_type === tm.key;
											return (
												<button key={tm.key} type="button" onClick={() => set('entity_type', tm.key)}
													style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start', padding: '9px 11px', borderRadius: 8, cursor: 'pointer', textAlign: 'left', color: 'inherit', background: on ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'transparent', border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}` }}>
													<span style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, fontSize: 13 }}>
														<tm.Icon size={14} style={{ color: on ? 'var(--accent)' : 'var(--fg-muted)' }} /> {tm.label}
													</span>
													<span style={{ fontSize: 11, color: 'var(--fg-muted)', lineHeight: 1.3 }}>{tm.desc}</span>
												</button>
											);
										})}
									</div>
								</Field>
								<Field label="Slug" hint={isEdit ? 'the public URL is fixed once created' : 'optional — auto-generated from the name if left blank'}><input className="search-input" style={{ fontFamily: 'var(--font-mono)' }} value={form.slug} onChange={(e) => set('slug', e.target.value)} disabled={isEdit} /></Field>
								<Field label="Description"><textarea className="search-input" style={{ minHeight: 70, resize: 'vertical' }} value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="What this entity does, in a sentence or two." /></Field>
								<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 120px', gap: 12 }}>
									<Field label="Website"><input className="search-input" type="url" value={form.website} onChange={(e) => set('website', e.target.value)} placeholder="https://" /></Field>
									<Field label="Category" hint={isProgram ? 'program type' : undefined}>
										{isProgram
											? <Select value={form.category} onChange={(v) => set('category', v)} width="100%" style={{ display: 'block', width: '100%' }} placeholder="—" options={[{ value: '', label: '—' }, ...PROGRAM_CATEGORIES.map((c) => ({ value: c, label: c }))]} />
											: <input className="search-input" value={form.category} onChange={(e) => set('category', e.target.value)} placeholder="e.g. Industry body" />}
									</Field>
									<Field label="Founded"><YearSelect value={form.founded_year} onChange={(v) => set('founded_year', v)} /></Field>
								</div>
								<Field label="Status"><Select value={form.status} onChange={(v) => set('status', v)} width="100%" style={{ display: 'block', width: '100%' }} options={STATUSES.map((s) => ({ value: s, label: s }))} /></Field>
							</>
						) },
						{ key: 'contact', label: 'Contact', node: (
							<>
								<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
									<Field label="POC name"><input className="search-input" value={form.poc_name} onChange={(e) => set('poc_name', e.target.value)} /></Field>
									<Field label="POC position"><input className="search-input" value={form.poc_position} onChange={(e) => set('poc_position', e.target.value)} /></Field>
								</div>
								<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
									<Field label="POC email"><input className="search-input" type="email" value={form.poc_email} onChange={(e) => set('poc_email', e.target.value)} placeholder="name@org.com" /></Field>
									<Field label="POC LinkedIn"><input className="search-input" value={form.poc_linkedin} onChange={(e) => set('poc_linkedin', e.target.value)} placeholder="https://linkedin.com/in/…" /></Field>
								</div>
								<Field label="Latest activity year" hint="most recent year this entity was active"><YearSelect value={form.latest_activity_year} onChange={(v) => set('latest_activity_year', v)} /></Field>
							</>
						) },
						{ key: 'location', label: 'Location', node: <Field label="Headquarters"><LocationFields value={form.hq} onChange={(v) => set('hq', v)} /></Field> },
						...((isEvent || isProgram) ? [detailsTab] : []),
						{ key: 'social', label: 'Social', node: <SocialLinks value={form.social} onChange={(v) => set('social', v)} /> },
						{ key: 'sports', label: 'Sports', hint: form.sport_ids.length, node: <Field label="Sports"><SportsPicker value={form.sport_ids} onChange={(v) => set('sport_ids', v)} /></Field> },
						{ key: 'links', label: 'Links & cohort', node: isEdit && id
							? <LinksCohortPanel entityId={id} />
							: <div style={{ fontSize: 13, color: 'var(--fg-muted)' }}>Save the entity first, then re-open it to link related programs/events and manage cohort participants.</div> },
					]}
				/>
			)}
		</Modal>
	);
}

const REL_TYPES = ['initiative_has_program', 'initiative_has_event', 'program_has_event', 'program_has_initiative', 'program_has_program', 'initiative_has_initiative', 'organization_has_program', 'organization_has_event'] as const;
const PART_STATUS = ['applied', 'accepted', 'graduated', 'dropped'] as const;

interface RelRow { id: string; relationship_type: string; child_id: string; child_name: string; child_type: string }
interface PartRow { id: string; company_id: string | null; name: string | null; cohort_name: string | null; cohort_year: number | null; participation_status: string }
interface EcoHit { id: string; name: string; entity_type: string }

/** Relationship-linking + cohort-participant management for an existing entity. */
function LinksCohortPanel({ entityId, onView }: { entityId: string; onView?: (id: string) => void }) {
	const { mutate } = useSWRConfig();
	const ask = useConfirm();
	const rels = useSWR<RelRow[]>([`/api/admin/ecosystem-entities/${entityId}/relationships`], { dedupingInterval: 10_000 });
	const parts = useSWR<PartRow[]>([`/api/admin/ecosystem-entities/${entityId}/participants`], { dedupingInterval: 10_000 });
	const refreshRels = () => mutate([`/api/admin/ecosystem-entities/${entityId}/relationships`]);
	const refreshParts = () => mutate([`/api/admin/ecosystem-entities/${entityId}/participants`]);

	// relationship add state
	const [relType, setRelType] = useState<string>('program_has_event');
	const [childQ, setChildQ] = useState('');
	const [childId, setChildId] = useState('');
	const childSearch = useSWR<{ data: EcoHit[] }>(childQ.length >= 2 ? ['/api/ecosystem-entities', { q: childQ, limit: 8 }] : null, { dedupingInterval: 10_000, keepPreviousData: true });
	const addRel = async () => {
		if (!childId) { toast.error('Pick an entity to link.'); return; }
		try { await api('POST', `/api/admin/ecosystem-entities/${entityId}/relationships`, { child_id: childId, relationship_type: relType }); toast.success('Linked'); setChildId(''); setChildQ(''); void refreshRels(); }
		catch (e) { toast.error((e as Error).message); }
	};
	const delRel = async (relId: string) => { try { await api('DELETE', `/api/admin/ecosystem-entities/${entityId}/relationships/${relId}`); void refreshRels(); } catch (e) { toast.error((e as Error).message); } };

	// participant add state — prefer linking a real company; fall back to a free-text name.
	const [pCompanyId, setPCompanyId] = useState('');
	const [pName, setPName] = useState('');
	const [pCohort, setPCohort] = useState('');
	const [pYear, setPYear] = useState('');
	const [pStatus, setPStatus] = useState<string>('accepted');
	const addPart = async () => {
		if (!pCompanyId && !pName.trim()) { toast.error('Pick a company or enter a startup name.'); return; }
		try {
			await api('POST', `/api/admin/ecosystem-entities/${entityId}/participants`, {
				company_id: pCompanyId || undefined,
				startup_name: !pCompanyId && pName.trim() ? pName.trim() : undefined,
				cohort_name: pCohort.trim() || undefined, cohort_year: pYear ? Number(pYear) : undefined, status: pStatus,
			});
			toast.success('Participant added'); setPCompanyId(''); setPName(''); setPCohort(''); setPYear(''); void refreshParts();
		} catch (e) { toast.error((e as Error).message); }
	};
	// Link a text-only participant to a catalog company (or create it from the picker).
	const [linkingId, setLinkingId] = useState<string | null>(null);
	const linkPart = async (ppId: string, companyId: string) => {
		if (!companyId) return;
		try { await api('PATCH', `/api/admin/ecosystem-entities/${entityId}/participants/${ppId}`, { company_id: companyId }); toast.success('Linked'); setLinkingId(null); void refreshParts(); }
		catch (e) { toast.error((e as Error).message); }
	};
	const delPart = async (ppId: string) => { try { await api('DELETE', `/api/admin/ecosystem-entities/${entityId}/participants/${ppId}`); void refreshParts(); } catch (e) { toast.error((e as Error).message); } };
	const delCohort = async (year: number) => {
		if (!(await ask(`Delete all participants in the ${year} cohort?`))) return;
		try { await api('DELETE', `/api/admin/ecosystem-entities/${entityId}/cohorts/${year}`); toast.success(`${year} cohort cleared`); void refreshParts(); }
		catch (e) { toast.error((e as Error).message); }
	};
	// Group participants by cohort year (newest first; null years last).
	const grouped = (() => {
		const m = new Map<number | null, PartRow[]>();
		for (const p of parts.data ?? []) { const y = p.cohort_year ?? null; if (!m.has(y)) m.set(y, []); m.get(y)!.push(p); }
		return [...m.entries()].sort((a, b) => (b[0] ?? -1) - (a[0] ?? -1));
	})();

	return (
		<div style={{ display: 'grid', gap: 18 }}>
			<div>
				<div className="co-stat-label" style={{ marginBottom: 8 }}>Related entities</div>
				<div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'flex-start', marginBottom: 10 }}>
					<Select value={relType} onChange={setRelType} searchable width={230} options={REL_TYPES.map((t) => ({ value: t, label: t.replace(/_/g, ' ') }))} />
					<div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
						<input className="search-input" style={{ width: '100%', height: 32 }} placeholder="Search entity to link…" value={childId ? '' : childQ} onChange={(e) => { setChildQ(e.target.value); setChildId(''); }} />
						{childId === '' && childQ.length >= 2 && (childSearch.data?.data?.length ?? 0) > 0 && (
							<div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20, background: 'var(--bg-1)', border: '1px solid var(--border)', maxHeight: 180, overflow: 'auto' }}>
								{(childSearch.data?.data ?? []).filter((h) => h.id !== entityId).map((h) => (
									<button key={h.id} type="button" onClick={() => { setChildId(h.id); setChildQ(h.name); }} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '6px 10px', background: 'transparent', border: 0, cursor: 'pointer', color: 'var(--fg)', fontSize: 13 }}>{h.name} <span style={{ color: 'var(--fg-muted)' }}>· {h.entity_type}</span></button>
								))}
							</div>
						)}
						{childId && <div style={{ fontSize: 12, color: 'var(--fg-muted)', marginTop: 2 }}>selected: {childQ}</div>}
					</div>
					<button className="btn" style={{ height: 32 }} onClick={() => void addRel()}>Link</button>
				</div>
				<AsyncState loading={rels.isLoading} error={rels.error} empty={(rels.data?.length ?? 0) === 0} emptyMsg="No linked entities." onRetry={() => void refreshRels()}>
					<table className="data-table"><tbody>
						{(rels.data ?? []).map((r) => (
							<tr key={r.id}><td>{onView ? <button className="btn ghost" style={{ padding: '2px 4px', fontWeight: 600 }} onClick={() => onView(r.child_id)}>{r.child_name}</button> : r.child_name} <span style={{ color: 'var(--fg-muted)', fontSize: 11 }}>· {r.child_type}</span></td><td style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-muted)' }}>{r.relationship_type.replace(/_/g, ' ')}</td><td style={{ textAlign: 'right' }}><button className="btn ghost" style={{ color: 'var(--accent)' }} onClick={() => void delRel(r.id)}><Trash2 size={12} /></button></td></tr>
						))}
					</tbody></table>
				</AsyncState>
			</div>

			<div>
				<div className="co-stat-label" style={{ marginBottom: 8 }}>Cohort participants</div>
				<div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'flex-start', marginBottom: 4 }}>
					<div style={{ flex: '1 1 200px' }}><CompanySelectOne value={pCompanyId} onChange={setPCompanyId} /></div>
					<input className="search-input" style={{ height: 32, flex: '0 0 110px' }} placeholder="Cohort" value={pCohort} onChange={(e) => setPCohort(e.target.value)} />
					<div style={{ flex: '0 0 100px' }}><YearSelect value={pYear} onChange={setPYear} placeholder="Year" /></div>
					<div style={{ flex: '0 0 130px' }}><Select value={pStatus} onChange={setPStatus} width="100%" style={{ display: 'block', width: '100%' }} options={PART_STATUS.map((s) => ({ value: s, label: s }))} /></div>
					<button className="btn" style={{ height: 32 }} onClick={() => void addPart()}>Add</button>
				</div>
				{!pCompanyId && (
					<input className="search-input" style={{ height: 30, marginBottom: 10, width: '100%' }} placeholder="…or a startup name not yet in the database" value={pName} onChange={(e) => setPName(e.target.value)} />
				)}
				<AsyncState loading={parts.isLoading} error={parts.error} empty={(parts.data?.length ?? 0) === 0} emptyMsg="No participants." onRetry={() => void refreshParts()}>
					<div style={{ display: 'grid', gap: 12 }}>
						{grouped.map(([year, rows]) => (
							<div key={year ?? 'none'}>
								<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
									<div style={{ fontSize: 12, fontWeight: 600 }}>{year ?? 'No year'} <span style={{ color: 'var(--fg-muted)', fontWeight: 400 }}>· {rows.length}</span></div>
									{year != null && <button className="btn ghost" style={{ color: 'var(--accent)', fontSize: 11, padding: '2px 8px' }} onClick={() => void delCohort(year)}>Delete cohort</button>}
								</div>
								<table className="data-table"><tbody>
									{rows.map((pp) => (
										<tr key={pp.id}><td>{pp.name ?? '—'}{pp.company_id
											? <span className="tag pos" style={{ marginLeft: 6 }}>linked</span>
											: linkingId === pp.id
												? <div style={{ marginTop: 6, display: 'flex', gap: 6, alignItems: 'center' }}><div style={{ flex: 1 }}><CompanySelectOne value="" onChange={(cid) => void linkPart(pp.id, cid)} placeholder={`Find ${pp.name ?? 'the company'}…`} /></div><button className="btn ghost" onClick={() => setLinkingId(null)}>Cancel</button></div>
												: <button className="btn ghost" style={{ marginLeft: 6, fontSize: 11, padding: '1px 8px' }} onClick={() => setLinkingId(pp.id)} title="Link this name to a company in the catalog">Link</button>}</td><td>{pp.cohort_name ?? '—'}</td><td>{pp.participation_status}</td><td style={{ textAlign: 'right' }}><button className="btn ghost" style={{ color: 'var(--accent)' }} onClick={() => void delPart(pp.id)}><Trash2 size={12} /></button></td></tr>
									))}
								</tbody></table>
							</div>
						))}
					</div>
				</AsyncState>
			</div>
		</div>
	);
}

/** Full-page drill-down for one entity: header + key facts + linked entities &
 *  cohorts. Linked entities are clickable to hop straight to their own detail. */
function EntityDetail({ id, onBack, onEdit, onView }: { id: string; onBack: () => void; onEdit: (id: string) => void; onView: (id: string) => void }) {
	const { data: e, isLoading, error, mutate } = useEditPayload<EntityEdit>(`/api/admin/ecosystem-entities/${id}/edit`);
	if (isLoading || (!e && !error)) return <div className="card" style={{ padding: 'var(--space-4)' }}><Loading msg="Loading entity…" /></div>;
	if (error || !e) return <div className="card" style={{ padding: 'var(--space-4)' }}><ErrorState error={error} onRetry={() => void mutate()} /></div>;
	const p = (e.program ?? {}) as Record<string, unknown>;
	const ev = (e.event ?? {}) as Record<string, unknown>;
	const isEvent = e.entity_type === 'event';
	const isProgram = e.entity_type === 'program';
	const yn = (v: unknown) => (v == null ? '—' : v ? 'Yes' : 'No');
	const s = (v: unknown) => (v == null || v === '' ? '—' : String(v));
	const facts: Array<[string, string]> = isEvent
		? [['Mode', s(ev.mode).replace(/_/g, ' ')], ['Start', s(ev.start_date).slice(0, 10)], ['End', s(ev.end_date).slice(0, 10)], ['Featured', yn(ev.is_featured)], ['Discount', s(ev.discount_code)]]
		: isProgram
			? [['Duration', s(p.duration_label)], ['Interval', s(p.interval_label)], ['Investment', s(p.investment_label)], ['Equity', s(p.equity_label)], ['Stage', s(p.stage_label)], ['Cohort size', s(p.cohort_size)], ['Virtual', s(p.virtual_mode)], ['Office space', yn(p.has_office_space)], ['Profit', p.is_profitable == null ? '—' : (p.is_profitable ? 'For profit' : 'Non-profit')], ['Latest cohort', s(p.latest_cohort_year)], ['Entries open', yn(p.entries_open)]]
			: [];
	const info: Array<[string, string]> = [
		['Type', s(e.entity_type)], ['Status', s(e.status)], ['Category', s(e.category)],
		['HQ', [e.hq_city, e.hq_country].filter(Boolean).join(', ') || '—'],
		['Founded', s(e.founded_year)], ['Latest activity', s(e.latest_activity_year)],
		['POC', s(e.poc_name)], ['POC email', s(e.poc_email)],
	];
	return (
		<div style={{ display: 'grid', gap: 16 }}>
			<div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
				<button className="btn ghost" onClick={onBack}>← Back to list</button>
				<div style={{ flex: 1 }} />
				<button className="btn" onClick={() => onEdit(id)}>Edit</button>
			</div>
			<div className="card" style={{ padding: 'var(--space-4)' }}>
				<div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
					<h2 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 800, margin: 0 }}>{e.name}</h2>
					<span className="tag">{e.entity_type}</span>
					{e.status && <span className="tag">{e.status}</span>}
				</div>
				{e.website && <a href={e.website.startsWith('http') ? e.website : `https://${e.website}`} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', fontSize: 13 }}>{e.website}</a>}
				{e.description && <p style={{ fontSize: 13, color: 'var(--fg-2)', marginTop: 8, marginBottom: 0 }}>{e.description}</p>}
				<div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginTop: 14 }}>
					{info.map(([k, v]) => <div key={k}><div className="co-stat-label">{k}</div><div style={{ fontSize: 13 }}>{v}</div></div>)}
				</div>
			</div>
			{facts.length > 0 && (
				<Section title={isEvent ? 'Event details' : 'Program details'} meta={e.entity_type}>
					<div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
						{facts.map(([k, v]) => <div key={k}><div className="co-stat-label">{k}</div><div style={{ fontSize: 13, textTransform: 'capitalize' }}>{v}</div></div>)}
					</div>
				</Section>
			)}
			<div className="card" style={{ padding: 'var(--space-4)' }}>
				<LinksCohortPanel entityId={id} onView={onView} />
			</div>
		</div>
	);
}

// ── Combined Ecosystem page ──────────────────────────────────────────────────
// Like Companies & Deals: one destination for the four ecosystem entities, with
// a combined Statistics panel (date-range filter) and in-page tabs. Active tab
// persists in the URL (?tab=).
type EcoTab = 'programs' | 'events' | 'investors' | 'initiatives' | 'investor-claims' | 'entity-claims' | 'changes';
const ECO_TABS: ReadonlyArray<{ key: EcoTab; label: string }> = [
	{ key: 'programs', label: 'Programs' },
	{ key: 'events', label: 'Events' },
	{ key: 'investors', label: 'Investors' },
	{ key: 'initiatives', label: 'Initiatives' },
	{ key: 'investor-claims', label: 'Investor claims' },
	{ key: 'entity-claims', label: 'Entity claims' },
	{ key: 'changes', label: 'Data changes' },
];

export default function EcosystemAdminPage() {
	const searchParams = useSearchParams();
	const pathname = usePathname();
	const raw = searchParams.get('tab');
	const tab: EcoTab = (ECO_TABS.some((t) => t.key === raw) ? raw : 'programs') as EcoTab;
	// Keep each tab's own list filters (co.*, deal.* …) when switching tabs.
	const setTab = (t: EcoTab) => { const q = new URLSearchParams(window.location.search); q.set('tab', t); q.delete('q'); window.history.replaceState(null, '', `${pathname}?${q}`); };

	const [dateRange, setDateRange] = useState<RangeValue>({});
	const { from, to } = dateRange;
	const key = (path: string): [string] | [string, Record<string, string>] => {
		const params: Record<string, string> = {};
		if (from) params.from = from;
		if (to) params.to = to;
		return Object.keys(params).length ? [path, params] : [path];
	};
	const eStats = useSWR<EcoStats>(key('/api/admin/stats/ecosystem'), { dedupingInterval: 60_000 });
	const iStats = useSWR<InvestorYoyStats>(key('/api/admin/stats/investors'), { dedupingInterval: 60_000 });
	const e = eStats.data, i = iStats.data;

	return (
		<div>
			<PageHeader kicker="Data" title="Ecosystem" subtitle="Programs, events, investors and initiatives." />

			<StatsPanel action={<DateRangePicker value={dateRange} onChange={setDateRange} />}>
				<StatStrip cols={4}>
					<RichStatCard label="Programs" tone="blue" Icon={GraduationCap} loading={eStats.isLoading} value={(e?.programs ?? 0).toLocaleString()}
						thisYear={e?.programs_this_year} lastYear={e?.programs_last_year} yoy={e?.programs_yoy} />
					<RichStatCard label="Events" tone="amber" Icon={CalendarClock} loading={eStats.isLoading} value={(e?.events ?? 0).toLocaleString()}
						thisYear={e?.events_this_year} lastYear={e?.events_last_year} yoy={e?.events_yoy} />
					<RichStatCard label="Investors" tone="green" Icon={Banknote} loading={iStats.isLoading} value={(i?.total ?? 0).toLocaleString()}
						thisYear={i?.this_year} lastYear={i?.last_year} yoy={i?.yoy_change} />
					<RichStatCard label="Initiatives" tone="purple" Icon={Lightbulb} loading={eStats.isLoading} value={(e?.initiatives ?? 0).toLocaleString()}
						thisYear={e?.initiatives_this_year} lastYear={e?.initiatives_last_year} yoy={e?.initiatives_yoy} />
				</StatStrip>
			</StatsPanel>

			<div style={{ marginBottom: 'var(--space-4)' }}>
				<PillTabs tabs={ECO_TABS} value={tab} onChange={setTab} />
			</div>

			{tab === 'programs' && <EcosystemView embedded entityType="program" />}
			{tab === 'events' && <EcosystemView embedded entityType="event" />}
			{tab === 'investors' && <InvestorsView embedded />}
			{tab === 'initiatives' && <EcosystemView embedded entityType="initiative" />}
			{tab === 'investor-claims' && <ClaimsView embedded lockType="investor" />}
			{tab === 'entity-claims' && <ClaimsView embedded lockType="ecosystem_entity" />}
			{tab === 'changes' && <DataRequestsView embedded lockEntity="investor,ecosystem,investor_fund,investor_portfolio" />}
		</div>
	);
}
