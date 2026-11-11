'use client';

import { useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { toast } from 'sonner';
import { Plus, Check, X, Trash2, Upload, Rocket, RefreshCw, Eye } from 'lucide-react';
import { api } from '@/lib/api';
import { qk } from '@/lib/query-keys';
import { val, fmtNum, enrichedKeys } from '@/lib/format';
import { Select } from '@/components/select';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useConfirm } from '@/components/confirm';
import { Modal } from '@/components/modal';
import { PageHeader, AsyncState, StatCard, StatsPanel, Section, Tag, Pager } from '@/components/atoms';
import { Funnel } from '@/components/charts';
import { StatStrip } from '@/components/filters';
import { DateRangePicker, type RangeValue } from '@/components/date-range-picker';
import { CompletionByAdmin, TimeAnalytics, WeeklyMetrics } from '@/components/queue-stats';
import { WorkSessionTimer, countWorkItem } from '@/components/work-session-timer';
import { CandidateInput, parseCandidates } from '@/components/candidate-import';
import { EMPTY_LOCATION } from '@/components/entity-pickers';
import { CompanyModal } from '../companies/page';

type Status = 'new' | 'reviewing' | 'added' | 'rejected';
interface PerAdmin { assigned_to: string | null; full_name: string | null; pending: number; added: number; rejected: number; completion_rate: number }
interface Stats {
	counts: { new: number; reviewing: number; added: number; rejected: number; total: number };
	byAdmin: PerAdmin[];
	weekly: { added_this_week: number; added_last_week: number; carried: number; carried_last_week: number; avg_per_day: number; avg_per_day_last_week: number };
}
interface TimeStats { perAdmin: Array<{ admin_id: string; full_name: string | null; total_seconds: number; items: number; avg_seconds_per_item: number }>; totals: { total_seconds: number; items: number } }
interface AdminUser { id: string; full_name?: string | null; display_name?: string | null; email: string; user_role: string }
interface UsersResponse { data: AdminUser[] }

type EnrichStatus = 'pending' | 'enriching' | 'enriched' | 'failed';
interface Suggestions { primary_sector?: string | null; sectors?: string[]; tech_tags?: string[]; sports?: string[]; business_model?: string | null; confidence?: number }
interface Entry {
	id: string; name: string; website: string | null; source: string | null; notes: string | null;
	status: Status; hq_country: string | null; hq_city: string | null;
	assigned_to: string | null; company_id: string | null; created_at: string;
	enrichment_status: EnrichStatus; enrichment_error: string | null; enriched_at: string | null;
}
// Full row (incl. apollo_raw + suggestions) fetched on demand for the view modal.
interface EnrichedDetail {
	enrichment_status: EnrichStatus; enrichment_error: string | null;
	description: string | null; hq_country: string | null; hq_city: string | null;
	poc_name: string | null; poc_position: string | null; poc_linkedin: string | null;
	apollo_raw: Record<string, unknown> | null; suggestions: Suggestions | null;
}
interface Response { data: Entry[]; total: number; totalPages?: number }
interface DedupeMatch { id: string; name: string; website: string | null; slug: string | null; status: string | null }
interface Preview { matches: DedupeMatch[]; suggestions: Suggestions | null; prefill: { name: string; website: string; description: string; hq_country: string; hq_city: string; hq_state: string; continent: string; region: string; report_region: string; logo_url: string; founded_year: number | null; linkedin_url: string; twitter_url: string; facebook_url: string; instagram_url?: string; poc_name: string; poc_position: string; poc_linkedin: string; poc_email?: string;
	// Server-resolved taxonomy from the merged enrichment; null on rows enriched before it existed.
	sector_id?: string | null; sport_ids?: string[] | null; tech_tag_ids?: string[] | null; business_model?: string | null } }

const TABS: Array<{ label: string; key: Status | '' }> = [
	{ label: 'All', key: '' }, { label: 'New', key: 'new' }, { label: 'Reviewing', key: 'reviewing' },
	{ label: 'Added', key: 'added' }, { label: 'Rejected', key: 'rejected' },
];

export default function StartupsPipelinePage() {
	const { mutate } = useSWRConfig();
	const ask = useConfirm();
	const [status, setStatus] = useState<Status | ''>('new');
	const [page, setPage] = useState(1);
	const [assigned, setAssigned] = useState('');
	const [search, setSearch] = useState('');
	const debouncedSearch = useDebouncedValue(search);
	const [from, setFrom] = useState('');
	const [to, setTo] = useState('');
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [bulkAssignee, setBulkAssignee] = useState('');
	const [creating, setCreating] = useState(false);
	const [importing, setImporting] = useState(false);
	const [promoting, setPromoting] = useState<Entry | null>(null);
	const [viewing, setViewing] = useState<Entry | null>(null);

	const { data, error, isLoading } = useSWR<Response>(
		['/api/admin/startups-pipeline', { status: status || undefined, assigned_to: assigned || undefined, q: debouncedSearch || undefined, from: from || undefined, to: to || undefined, page, limit: 50 }],
		{ dedupingInterval: 15_000 },
	);
	const [statsRange, setStatsRange] = useState<RangeValue>({});
	const { data: stats } = useSWR<Stats>(['/api/admin/startups-pipeline/stats', { from: statsRange.from, to: statsRange.to }], { dedupingInterval: 30_000 });
	const { data: timeStats } = useSWR<TimeStats>(['/api/admin/work-sessions/stats', { queue: 'startups_pipeline', from: statsRange.from, to: statsRange.to }], { dedupingInterval: 30_000 });
	const { data: usersResp } = useSWR<UsersResponse>(['/api/admin/users', { role: 'admin', limit: 100 }], { dedupingInterval: 300_000 });
	const admins = (usersResp?.data ?? []).filter((u) => u.user_role === 'admin');
	const adminName = (id: string | null) => { if (!id) return '—'; const u = admins.find((a) => a.id === id); return u ? (u.full_name || u.display_name || u.email) : `${id.slice(0, 8)}…`; };
	const timeFor = (id: string | null) => timeStats?.perAdmin.find((t) => t.admin_id === id);

	const refreshAll = () => void mutate((key) => Array.isArray(key) && typeof key[0] === 'string' && (key[0].startsWith('/api/admin/startups-pipeline') || key[0].startsWith('/api/admin/work-sessions')));

	const c = stats?.counts;
	const pending = (c?.new ?? 0) + (c?.reviewing ?? 0);
	const weekDelta = stats?.weekly && stats.weekly.added_last_week > 0 ? ((stats.weekly.added_this_week - stats.weekly.added_last_week) / stats.weekly.added_last_week) * 100 : null;
	const reviewers = (stats?.byAdmin ?? []).filter((a) => a.assigned_to);
	const entries = data?.data ?? [];
	const allSelected = entries.length > 0 && entries.every((r) => selected.has(r.id));
	const toggleAll = () => setSelected(allSelected ? new Set() : new Set(entries.map((r) => r.id)));
	const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

	const act = async (fn: () => Promise<unknown>, ok: string) => {
		try { await fn(); toast.success(ok); setSelected(new Set()); refreshAll(); }
		catch (e) { toast.error((e as Error).message); }
	};
	const update = (id: string, next: Status) => act(() => api('PATCH', `/api/admin/startups-pipeline/${id}`, { status: next }), 'Updated');
	const reEnrich = (id: string) => act(() => api('POST', `/api/admin/startups-pipeline/${id}/re-enrich`), 'Re-enrichment queued');
	const remove = (id: string, name: string) => { void (async () => { if (await ask(`Delete ${name} from the pipeline?`)) void act(() => api('DELETE', `/api/admin/startups-pipeline/${id}`), 'Deleted'); })(); };
	const selectAllMatching = async () => {
		const p = new URLSearchParams();
		if (status) p.set('status', status);
		if (assigned) p.set('assigned_to', assigned);
		if (search) p.set('q', search);
		if (from) p.set('from', from);
		if (to) p.set('to', to);
		try { const r = await api<{ ids: string[] }>('GET', `/api/admin/startups-pipeline/ids?${p.toString()}`); setSelected(new Set(r.ids)); }
		catch (e) { toast.error((e as Error).message); }
	};
	const bulkAssign = (roundRobin: boolean) => act(
		() => api('PATCH', '/api/admin/startups-pipeline/bulk-assign', roundRobin
			? { ids: [...selected], assigned_to_list: admins.map((a) => a.id) }
			: { ids: [...selected], assigned_to: bulkAssignee || null }),
		roundRobin ? 'Distributed round-robin' : 'Assigned',
	);
	const bulkStatus = (s: Status) => act(() => api('PATCH', '/api/admin/startups-pipeline/bulk-status', { ids: [...selected], status: s }), 'Updated');
	const bulkDelete = () => { void (async () => { if (await ask(`Delete ${selected.size} entr(ies)?`)) void act(() => api('DELETE', '/api/admin/startups-pipeline/bulk', { ids: [...selected] }), 'Deleted'); })(); };

	return (
		<div>
			<PageHeader kicker="Pipeline · startups to add" title="Startups to add" subtitle="Triage submissions, assign reviewers, then promote into the companies catalog." />

			<div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 'var(--space-3)' }}>
				<WorkSessionTimer queue="startups_pipeline" />
			</div>

			<StatsPanel title="Statistics" action={<DateRangePicker value={statsRange} onChange={setStatsRange} />}>
				<StatStrip cols={4}>
					<StatCard label="Total in Sheet" tone="blue" value={(c?.total ?? 0).toLocaleString()} />
					<StatCard label="Added" tone="green" value={(c?.added ?? 0).toLocaleString()} />
					<StatCard label="Pending" tone="amber" value={pending.toLocaleString()} urgent={pending > 0} />
					<StatCard label="Added this week" tone="purple" value={(stats?.weekly.added_this_week ?? 0).toLocaleString()} delta={weekDelta} />
				</StatStrip>
			</StatsPanel>

			{/* Per-admin completion + time, week-over-week throughput, and the funnel — matches the old admin panel. */}
			<CompletionByAdmin rows={reviewers.map((a) => ({ key: a.assigned_to!, name: a.full_name ?? adminName(a.assigned_to), done: a.added + a.rejected, total: a.added + a.rejected + a.pending, rate: a.completion_rate }))} />

			<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)', marginBottom: 'var(--space-5)' }}>
				<TimeAnalytics timeStats={timeStats} adminName={adminName} />
				<WeeklyMetrics metrics={stats?.weekly ? [
					{ label: 'Startups Added', cur: stats.weekly.added_this_week, prev: stats.weekly.added_last_week, fmt: (n) => n.toLocaleString() },
					{ label: 'Carried Forward', cur: stats.weekly.carried, prev: stats.weekly.carried_last_week ?? 0, fmt: (n) => n.toLocaleString(), goodDown: true },
					{ label: 'Avg Per Day', cur: stats.weekly.avg_per_day ?? 0, prev: stats.weekly.avg_per_day_last_week ?? 0, fmt: (n) => n.toFixed(1) },
				] : null} />
			</div>

			<Section title="Pipeline funnel" meta="new → added">
				<Funnel stages={[
					{ label: 'New', value: c?.new ?? 0 },
					{ label: 'Reviewing', value: c?.reviewing ?? 0 },
					{ label: 'Added', value: c?.added ?? 0, color: 'var(--pos)' },
					{ label: 'Rejected', value: c?.rejected ?? 0, color: 'var(--neg)' },
				]} />
			</Section>
			<div style={{ marginBottom: 'var(--space-5)' }} />

			<div className="filter-bar" style={{ marginBottom: 'var(--space-4)', gap: 8, flexWrap: 'wrap' }}>
				{TABS.map((t) => <button key={t.key} className={`chip ${status === t.key ? 'on' : ''}`} onClick={() => setStatus(t.key)}>{t.label}</button>)}
				<Select value={assigned} onChange={setAssigned} searchable width={190} options={[{ value: '', label: 'Any assignee' }, { value: 'unassigned', label: 'Unassigned' }, ...admins.map((a) => ({ value: a.id, label: a.full_name || a.display_name || a.email }))]} />
				<input className="search-input" style={{ flex: '0 0 200px', height: 30 }} placeholder="Search name / site…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
				<input className="search-input" type="date" style={{ height: 30 }} value={from} onChange={(e) => setFrom(e.target.value)} title="Added from" />
				<input className="search-input" type="date" style={{ height: 30 }} value={to} onChange={(e) => setTo(e.target.value)} title="Added to" />
				<div style={{ flex: 1 }} />
				<button className="btn ghost" onClick={() => setImporting(true)}><Upload size={12} /> Import</button>
				<button className="btn" onClick={() => setCreating(true)}><Plus size={12} /> Add candidate</button>
			</div>

			{selected.size > 0 && (
				<div className="card" style={{ padding: 12, marginBottom: 'var(--space-4)', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
					<strong>{selected.size} selected</strong>
					{(data?.total ?? 0) > selected.size && <button className="btn ghost" onClick={() => void selectAllMatching()}>Select all {(data?.total ?? 0).toLocaleString()} matching</button>}
					<Select value={bulkAssignee} onChange={setBulkAssignee} searchable width={180} placeholder="Unassign" options={[{ value: '', label: 'Unassign' }, ...admins.map((a) => ({ value: a.id, label: a.full_name || a.display_name || a.email }))]} />
					<button className="btn ghost" onClick={() => void bulkAssign(false)}>Assign</button>
					<button className="btn ghost" disabled={admins.length === 0} onClick={() => void bulkAssign(true)} title="Distribute evenly across admins">Round-robin</button>
					<button className="btn ghost" onClick={() => void bulkStatus('added')}><Check size={12} /> Added</button>
					<button className="btn ghost" onClick={() => void bulkStatus('rejected')}><X size={12} /> Reject</button>
					<div style={{ flex: 1 }} />
					<button className="btn ghost" style={{ color: 'var(--accent)' }} onClick={() => void bulkDelete()}><Trash2 size={12} /> Delete</button>
				</div>
			)}

			{creating && <AddModal admins={admins} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); refreshAll(); }} />}
			{importing && <ImportModal onClose={() => setImporting(false)} onSaved={() => { setImporting(false); refreshAll(); }} />}
			{promoting && <PromoteModal row={promoting} onClose={() => setPromoting(null)} onDone={() => { setPromoting(null); refreshAll(); }} />}
			{viewing && <ViewModal row={viewing} onClose={() => setViewing(null)} />}

			<div className="card">
				<AsyncState loading={isLoading} error={error} empty={entries.length === 0} emptyMsg={`Nothing in ${status || 'any status'}.`} onRetry={refreshAll}>
					<table className="data-table">
						<thead>
							<tr>
								<th style={{ width: 28 }}><input type="checkbox" checked={allSelected} onChange={toggleAll} /></th>
								<th>Date</th><th>Name</th><th>HQ</th><th>Source</th><th>Enrichment</th><th>Assigned</th><th>Status</th><th style={{ textAlign: 'right' }}>Actions</th>
							</tr>
						</thead>
						<tbody>
							{entries.map((e) => (
								<tr key={e.id}>
									<td><input type="checkbox" checked={selected.has(e.id)} onChange={() => toggle(e.id)} /></td>
									<td className="num">{new Date(e.created_at).toLocaleDateString()}</td>
									<td><div style={{ fontWeight: 600 }}>{e.name}</div>{e.website && <a href={e.website} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: 'var(--accent)' }}>{e.website}</a>}</td>
									<td>{[e.hq_city, e.hq_country].filter(Boolean).join(', ') || '—'}</td>
									<td style={{ fontSize: 12 }}>{e.source ?? '—'}</td>
									<td title={e.enrichment_error ?? undefined}>
										<Tag variant={e.enrichment_status === 'enriched' ? 'pos' : e.enrichment_status === 'failed' ? 'warn' : ''}>{e.enrichment_status}</Tag>
									</td>
									<td>{adminName(e.assigned_to)}</td>
									<td><Tag variant={e.status === 'added' ? 'pos' : e.status === 'rejected' ? 'warn' : ''}>{e.status}</Tag></td>
									<td style={{ textAlign: 'right' }}>
										<div style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
											<button className="btn ghost" title="View enriched data" onClick={() => setViewing(e)}><Eye size={12} /></button>
											{e.status !== 'added' && <button className="btn" title="Promote to companies" onClick={() => setPromoting(e)}><Rocket size={12} /> Promote</button>}
											{e.status === 'new' && <button className="btn ghost" onClick={() => void update(e.id, 'reviewing')}>Review</button>}
											{e.website && <button className="btn ghost" title="Re-run enrichment" disabled={e.enrichment_status === 'enriching'} onClick={() => void reEnrich(e.id)}><RefreshCw size={12} /></button>}
											{e.status !== 'rejected' && e.status !== 'added' && <button className="btn ghost" title="Reject" onClick={() => void update(e.id, 'rejected')}><X size={12} /></button>}
											<button className="btn ghost" style={{ color: 'var(--accent)' }} onClick={() => remove(e.id, e.name)}><Trash2 size={12} /></button>
										</div>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</AsyncState>
			<Pager page={page} totalPages={data?.totalPages} onPage={setPage} />
			</div>
		</div>
	);
}

interface RefRow { id: string; name: string }

function PromoteModal({ row, onClose, onDone }: { row: Entry; onClose: () => void; onDone: () => void }) {
	const { data: preview, isLoading } = useSWR<Preview>([`/api/admin/startups-pipeline/${row.id}/promote-preview`], { revalidateOnFocus: false });
	// Reference lists to resolve Claude's suggested names → the form's IDs.
	const { data: sectorsRef } = useSWR<RefRow[]>(qk.reference.sectors(), { dedupingInterval: 3_600_000 });
	const { data: sportsRef } = useSWR<RefRow[]>(qk.reference.sports(), { dedupingInterval: 3_600_000 });
	const { data: techRef } = useSWR<RefRow[]>(qk.reference.techTags(), { dedupingInterval: 3_600_000 });
	const [createOpen, setCreateOpen] = useState(false);
	const [busy, setBusy] = useState(false);

	const merge = async (companyId: string) => {
		setBusy(true);
		try { await api('POST', `/api/admin/startups-pipeline/${row.id}/merge`, { company_id: companyId }); countWorkItem('startups_pipeline'); toast.success('Merged into existing company'); onDone(); }
		catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
	};
	const onCreated = (createdId?: string) => {
		// The company create links + marks the pipeline row in its own transaction
		// (via promotePipelineId), so there's no separate mark-promoted call here.
		if (!createdId) { setCreateOpen(false); return; }
		countWorkItem('startups_pipeline');
		onDone();
	};

	if (createOpen) {
		const p = preview?.prefill;
		const s = preview?.suggestions;
		const idsByName = (rows: RefRow[] | undefined) => new Map((rows ?? []).map((r) => [r.name.toLowerCase(), r.id]));
		const resolve = (names: string[] | undefined, map: Map<string, string>) =>
			(names ?? []).map((n) => map.get(n.toLowerCase())).filter((x): x is string => !!x);
		const secMap = idsByName(sectorsRef);
		const sportIds = resolve(s?.sports, idsByName(sportsRef));
		const techIds = resolve(s?.tech_tags, idsByName(techRef));
		// Prefer the most-specific (leaf) sector so the sub-sector cascade fills;
		// fall back to the first broad suggestion.
		const primaryId = s?.primary_sector ? secMap.get(s.primary_sector.toLowerCase()) : undefined;
		// Prefer the server-resolved ids from the merged enrichment; older rows fall
		// back to resolving Claude's suggestion names here.
		const sectorId = p?.sector_id ?? primaryId ?? resolve(s?.sectors, secMap)[0] ?? '';
		const pocParts = (p?.poc_name ?? '').trim().split(/\s+/).filter(Boolean);
		const seed = p ? {
					name: p.name, website: p.website, description: p.description,
					custom_logo_url: p.logo_url,
					founded_year: p.founded_year != null ? String(p.founded_year) : '',
					business_model: p.business_model ?? s?.business_model ?? '',
					sector_id: sectorId,
					sport_ids: p.sport_ids ?? sportIds, tech_tag_ids: p.tech_tag_ids ?? techIds,
					hq: { ...EMPTY_LOCATION, country: p.hq_country, city: p.hq_city, state: p.hq_state, continent: p.continent, region: p.region, report_region: p.report_region },
					social: { twitter_url: p.twitter_url, instagram_url: p.instagram_url ?? '', facebook_url: p.facebook_url, linkedin_url: p.linkedin_url, youtube_url: '', email: '' },
					poc_first_name: pocParts[0] ?? '', poc_last_name: pocParts.slice(1).join(' '),
					poc_job_position: p.poc_position, poc_linkedin: p.poc_linkedin, poc_email: p.poc_email ?? '',
				} : undefined;
		return (
			<CompanyModal
				id={null}
				seed={seed}
				enrichedFields={enrichedKeys(seed)}
				promotePipelineId={row.id}
				onClose={() => setCreateOpen(false)}
				onSaved={(id) => onCreated(id)}
			/>
		);
	}

	return (
		<Modal title={`Promote ${row.name}`} onClose={onClose} width={520} footer={
			<>
				<button className="btn ghost" onClick={onClose}>Cancel</button>
				<button className="btn" disabled={busy} onClick={() => setCreateOpen(true)}>Create new company →</button>
			</>
		}>
			{isLoading ? <div style={{ color: 'var(--fg-muted)', fontSize: 13 }}>Checking for duplicates…</div> : (
				<div style={{ display: 'grid', gap: 12 }}>
					{preview?.suggestions && <SuggestionChips s={preview.suggestions} />}
					{(preview?.matches.length ?? 0) > 0 ? (
						<div>
							<div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Possible existing matches — merge to avoid a duplicate:</div>
							<div style={{ display: 'grid', gap: 6 }}>
								{preview!.matches.map((m) => (
									<div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 8, border: '1px solid var(--border)', borderRadius: 8 }}>
										<div style={{ flex: 1 }}>
											<div style={{ fontWeight: 600 }}>{m.name}</div>
											{m.website && <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{m.website}</div>}
										</div>
										<button className="btn ghost" disabled={busy} onClick={() => void merge(m.id)}>Merge</button>
									</div>
								))}
							</div>
						</div>
					) : (
						<div style={{ fontSize: 13, color: 'var(--fg-muted)' }}>No likely duplicates found. Create a new company with the candidate&apos;s details.</div>
					)}
				</div>
			)}
		</Modal>
	);
}

interface CandRow { name: string; website: string | null; in_database: Array<{ name: string; website: string | null }>; in_queue: Array<{ name: string; website: string | null }>; approved: boolean }

/**
 * Bulk import with a dedupe-review step: paste or upload candidates, preview
 * each against the companies catalog + existing queue, then approve/skip per
 * row before importing. Rows with an existing match are unchecked by default.
 */
function ImportModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
	const [text, setText] = useState('');
	const [rows, setRows] = useState<CandRow[] | null>(null);
	const [busy, setBusy] = useState(false);

	const review = async () => {
		const parsed = parseCandidates(text);
		if (!parsed.length) { toast.error('Paste or upload at least one candidate'); return; }
		setBusy(true);
		try {
			const r = await api<{ rows: Array<Omit<CandRow, 'approved'>> }>('POST', '/api/admin/startups-pipeline/import-preview', { rows: parsed });
			setRows(r.rows.map((x) => ({ ...x, approved: x.in_database.length === 0 && x.in_queue.length === 0 })));
		} catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
	};

	const importApproved = async () => {
		const approved = (rows ?? []).filter((r) => r.approved).map((r) => ({ name: r.name, website: r.website ?? undefined }));
		if (!approved.length) { toast.error('No candidates approved'); return; }
		setBusy(true);
		try {
			const r = await api<{ inserted: number; skipped: number; enqueued: number }>('POST', '/api/admin/startups-pipeline/import', { rows: approved });
			toast.success(`Imported ${r.inserted}${r.skipped ? `, ${r.skipped} dup skipped` : ''}${r.enqueued ? ` · ${r.enqueued} queued for enrichment` : ''}`);
			onSaved();
		} catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
	};

	const toggle = (i: number) => setRows((prev) => prev!.map((r, j) => (j === i ? { ...r, approved: !r.approved } : r)));
	const approvedCount = (rows ?? []).filter((r) => r.approved).length;

	return (
		<Modal title="Bulk import candidates" onClose={onClose} width={640} footer={
			rows
				? <><button className="btn ghost" onClick={() => setRows(null)}>← Back</button><button className="btn" disabled={busy || approvedCount === 0} onClick={() => void importApproved()}>{busy ? 'Importing…' : `Import ${approvedCount} approved`}</button></>
				: <><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn" disabled={busy || !text.trim()} onClick={() => void review()}>{busy ? 'Checking…' : 'Review duplicates →'}</button></>
		}>
			{!rows ? (
				<div style={{ display: 'grid', gap: 8 }}>
					<CandidateInput text={text} onText={setText} sampleName="Acme Sports" placeholder={'Acme Sports, https://acme.com\nhttps://example.io'} />
				</div>
			) : (
				<div style={{ display: 'grid', gap: 8 }}>
					<div style={{ fontSize: 12, color: 'var(--fg-muted)' }}>{approvedCount}/{rows.length} approved · rows with an existing match are unchecked — tick to import anyway.</div>
					<div style={{ maxHeight: 360, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 6 }}>
						<table className="data-table">
							<thead><tr><th style={{ width: 28 }} /><th>Candidate</th><th>Existing matches</th></tr></thead>
							<tbody>
								{rows.map((r, i) => {
									const matches = [...r.in_database.map((m) => ({ ...m, where: 'db' as const })), ...r.in_queue.map((m) => ({ ...m, where: 'queue' as const }))];
									return (
										<tr key={i} style={matches.length ? { background: 'var(--bg-2)' } : undefined}>
											<td><input type="checkbox" checked={r.approved} onChange={() => toggle(i)} /></td>
											<td><div style={{ fontWeight: 600 }}>{r.name}</div>{r.website && <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{r.website}</div>}</td>
											<td style={{ fontSize: 12 }}>
												{matches.length === 0 ? <span style={{ color: 'var(--pos)' }}>none — new</span>
													: matches.map((m, k) => <div key={k}><Tag variant={m.where === 'db' ? 'warn' : ''}>{m.where === 'db' ? 'in DB' : 'in queue'}</Tag> {m.name}</div>)}
											</td>
										</tr>
									);
								})}
							</tbody>
						</table>
					</div>
				</div>
			)}
		</Modal>
	);
}

function AddModal({ admins, onClose, onSaved }: { admins: AdminUser[]; onClose: () => void; onSaved: () => void }) {
	const [f, setF] = useState({ name: '', website: '', source: '', notes: '', hq_country: '', hq_city: '', assigned_to: '' });
	const [pending, setPending] = useState(false);
	const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));
	const submit = async () => {
		setPending(true);
		try {
			const body: Record<string, unknown> = { name: f.name.trim() };
			for (const k of ['website', 'source', 'notes', 'hq_country', 'hq_city'] as const) if (f[k].trim()) body[k] = f[k].trim();
			if (f.assigned_to) body.assigned_to = f.assigned_to;
			await api('POST', '/api/admin/startups-pipeline', body);
			toast.success('Added to pipeline'); onSaved();
		} catch (e) { toast.error((e as Error).message); } finally { setPending(false); }
	};
	return (
		<Modal title="Add candidate" onClose={onClose} width={480} footer={
			<>
				<button className="btn ghost" onClick={onClose}>Cancel</button>
				<button className="btn" disabled={!f.name.trim() || pending} onClick={() => void submit()}>{pending ? 'Saving…' : 'Add'}</button>
			</>
		}>
			<div style={{ display: 'grid', gap: 12 }}>
				<L label="Name"><input className="search-input" value={f.name} onChange={(e) => set('name', e.target.value)} /></L>
				<L label="Website"><input className="search-input" value={f.website} onChange={(e) => set('website', e.target.value)} placeholder="https://" /></L>
				<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
					<L label="HQ country"><input className="search-input" value={f.hq_country} onChange={(e) => set('hq_country', e.target.value)} /></L>
					<L label="HQ city"><input className="search-input" value={f.hq_city} onChange={(e) => set('hq_city', e.target.value)} /></L>
				</div>
				<L label="Source"><input className="search-input" value={f.source} onChange={(e) => set('source', e.target.value)} placeholder="Twitter, news…" /></L>
				<L label="Assign to">
					<Select value={f.assigned_to} onChange={(v) => set('assigned_to', v)} searchable width="100%" style={{ display: 'block', width: '100%' }} placeholder="— unassigned —" options={[{ value: '', label: '— unassigned —' }, ...admins.map((a) => ({ value: a.id, label: a.full_name || a.display_name || a.email }))]} />
				</L>
				<L label="Notes"><textarea className="search-input" style={{ minHeight: 60, resize: 'vertical' }} value={f.notes} onChange={(e) => set('notes', e.target.value)} /></L>
			</div>
		</Modal>
	);
}

/** Read-only view of a candidate's enriched data (Claude suggestions + raw
 *  Apollo firmographics), fetched on demand so the list payload stays light. */
function ViewModal({ row, onClose }: { row: Entry; onClose: () => void }) {
	const { data, isLoading, error } = useSWR<EnrichedDetail>([`/api/admin/startups-pipeline/${row.id}/enriched`], { revalidateOnFocus: false });
	const raw = (data?.apollo_raw ?? {}) as Record<string, unknown>;
	const kw = Array.isArray(raw.keywords) ? (raw.keywords as unknown[]).join(', ') : '';
	const notEnriched = !!data && data.enrichment_status !== 'enriched' && !data.apollo_raw;
	const fields: Array<[string, React.ReactNode]> = data ? [
		['Enrichment', <Tag key="e" variant={data.enrichment_status === 'enriched' ? 'pos' : data.enrichment_status === 'failed' ? 'warn' : ''}>{data.enrichment_status}</Tag>],
		['Description', val(data.description)],
		['HQ', val([data.hq_city, raw.state, data.hq_country].filter(Boolean).join(', '))],
		['Founded (Apollo)', val(raw.founded_year)],
		['POC', val([data.poc_name, data.poc_position].filter(Boolean).join(' · '))],
		['POC LinkedIn', val(data.poc_linkedin)],
		['LinkedIn', val(raw.linkedin_url)],
		['Twitter', val(raw.twitter_url)],
		['Facebook', val(raw.facebook_url)],
		['Industry (Apollo)', val(raw.industry)],
		['Employees (Apollo)', fmtNum(raw.estimated_num_employees)],
		['Total funding (Apollo)', fmtNum(raw.total_funding)],
		['Keywords (Apollo)', val(kw)],
	] : [];
	if (data?.enrichment_error) fields.push(['Error', data.enrichment_error]);
	return (
		<Modal title={`Enriched data — ${row.name}`} onClose={onClose} width={560}>
			{error ? <div style={{ color: 'var(--neg)', fontSize: 13 }}>Couldn&apos;t load enriched data.</div>
				: isLoading ? <div style={{ color: 'var(--fg-muted)', fontSize: 13 }}>Loading…</div>
				: notEnriched ? <div style={{ color: 'var(--fg-muted)', fontSize: 13 }}>Not enriched yet. Ensure the candidate has a website, then use Re-enrich.</div>
				: (
					<div style={{ display: 'grid', gap: 12 }}>
						{data?.suggestions && <SuggestionChips s={data.suggestions} />}
						<div style={{ display: 'grid', gap: 8, fontSize: 13 }}>
							{fields.map(([k, v]) => (
								<div key={k} style={{ display: 'grid', gridTemplateColumns: '170px 1fr', gap: 10, alignItems: 'start' }}>
									<div style={{ color: 'var(--fg-muted)' }}>{k}</div>
									<div style={{ wordBreak: 'break-word' }}>{v}</div>
								</div>
							))}
						</div>
					</div>
				)}
		</Modal>
	);
}

function L({ label, children }: { label: string; children: React.ReactNode }) {
	return <div><div className="co-stat-label" style={{ marginBottom: 6 }}>{label}</div>{children}</div>;
}

/** Read-only display of Claude's classification suggestions — the admin confirms
 *  them in the company form (never auto-applied). business_model is pre-seeded. */
function SuggestionChips({ s }: { s: Suggestions }) {
	const groups: Array<[string, string[]]> = [
		['Sectors', s.sectors ?? []],
		['Tech', s.tech_tags ?? []],
		['Sports', s.sports ?? []],
		['Model', s.business_model ? [s.business_model.toUpperCase()] : []],
	].filter(([, v]) => v.length) as Array<[string, string[]]>;
	if (!groups.length) return null;
	return (
		<div style={{ padding: 8, border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg-2)' }}>
			<div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Suggested classification {typeof s.confidence === 'number' ? `· ${Math.round(s.confidence * 100)}% conf` : ''} — confirm in the form:</div>
			<div style={{ display: 'grid', gap: 4 }}>
				{groups.map(([label, vals]) => (
					<div key={label} style={{ fontSize: 12 }}>
						<span style={{ color: 'var(--fg-muted)', marginRight: 6 }}>{label}:</span>
						{vals.map((v) => <span key={v} style={{ marginRight: 4 }}><Tag>{v}</Tag></span>)}
					</div>
				))}
			</div>
		</div>
	);
}
