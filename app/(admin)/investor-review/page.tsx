'use client';

import { useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { toast } from 'sonner';
import { Plus, Trash2, Check, SkipForward, Rocket, Undo2, RefreshCw, Eye, Upload, Pencil } from 'lucide-react';
import { api } from '@/lib/api';
import { val, fmtNum, enrichedKeys } from '@/lib/format';
import { Select } from '@/components/select';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useConfirm } from '@/components/confirm';
import { Modal } from '@/components/modal';
import { PageHeader, StatCard, StatsPanel, AsyncState, Tag, Chip, Section, Pager } from '@/components/atoms';
import { Funnel } from '@/components/charts';
import { StatStrip } from '@/components/filters';
import { DateRangePicker, type RangeValue } from '@/components/date-range-picker';
import { AssignToAdmins, CompletionByAdmin, TimeAnalytics, WeeklyMetrics } from '@/components/queue-stats';
import { WorkSessionTimer, countWorkItem } from '@/components/work-session-timer';
import { CandidateInput, EditCandidateModal, parseInvestorCandidates } from '@/components/candidate-import';
import { InvestorModal } from '@/components/admin-views/investors';
import { AddCandidateModal, L } from '@/components/investor-candidate-modal';
import { useUrlState, useUrlNumber } from '@/hooks/use-url-state';

type EnrichStatus = 'pending' | 'enriching' | 'enriched' | 'failed';
interface QueueRow {
	id: string; name: string; website: string | null; category: string | null; country: string | null;
	status: string; skip_reason: string | null; assigned_to: string | null; created_at: string;
	investor_id: string | null;
	enrichment_status: EnrichStatus; enrichment_error: string | null; enriched_at: string | null;
}
// Full row (incl. apollo_raw) fetched on demand for the view modal.
interface EnrichedDetail {
	enrichment_status: EnrichStatus; enrichment_error: string | null;
	description: string | null; country: string | null; city: string | null; year_launched: number | null;
	twitter_url: string | null; facebook_url: string | null; instagram_url: string | null; linkedin_url: string | null;
	poc_name: string | null; poc_position: string | null; poc_email: string | null; poc_linkedin: string | null;
	apollo_raw: Record<string, unknown> | null;
}
interface QueueResponse { data: QueueRow[]; total: number; totalPages?: number }
interface PerAdmin { assigned_to: string | null; full_name: string | null; pending: number; completed: number; skipped: number; completion_rate: number }
interface Stats {
	counts: { pending: number; completed: number; skipped: number; total: number };
	byAdmin: PerAdmin[];
	weekly?: { completed_this_week: number; completed_last_week: number; carried: number; carried_last_week: number; avg_per_day: number; avg_per_day_last_week: number };
}
interface TimeStats { perAdmin: Array<{ admin_id: string; full_name: string | null; total_seconds: number; items: number; avg_seconds_per_item: number }>; totals: { total_seconds: number; items: number } }
interface AdminUser { id: string; full_name?: string | null; display_name?: string | null; email: string; user_role: string }
interface UsersResponse { data: AdminUser[] }
interface DedupeMatch { id: string; name: string; website: string | null; slug: string | null }
interface Preview { matches: DedupeMatch[]; prefill: { name: string; website: string; category: string; hq_country: string; state: string; continent: string; region: string; report_region: string; description: string; year_launched: number | null; city: string; twitter_url: string; instagram_url: string; facebook_url: string; linkedin_url: string; poc_name: string; poc_position: string; poc_email: string; poc_linkedin: string; keywords: string; logo_url: string; num_employees: number | null; total_funding: string; annual_revenue: string; last_raised_at: string } }

const STATUSES = ['pending', 'completed', 'skipped'] as const;

export default function InvestorReviewPage() {
	const { mutate } = useSWRConfig();
	const ask = useConfirm();
	const [status, setStatus] = useUrlState('ir', 'status', 'pending');
	const [page, setPage] = useUrlNumber('ir', 'page', 1);
	const [assigned, setAssigned] = useUrlState('ir', 'assigned', '');
	const [search, setSearch] = useUrlState('ir', 'search', '');
	const debouncedSearch = useDebouncedValue(search);
	const [from, setFrom] = useUrlState('ir', 'from', '');
	const [to, setTo] = useUrlState('ir', 'to', '');
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [creating, setCreating] = useState(false);
	const [importing, setImporting] = useState(false);
	const [promoting, setPromoting] = useState<QueueRow | null>(null);
	const [skipping, setSkipping] = useState<QueueRow | null>(null);
	const [viewing, setViewing] = useState<QueueRow | null>(null);
	const [editing, setEditing] = useState<QueueRow | null>(null);
	const [bulkAssignee, setBulkAssignee] = useState('');
	const [statsRange, setStatsRange] = useState<RangeValue>({});
	// A filter change starts over at page 1 with nothing selected (page 3 of the old view was empty).
	const refilter = (set: (v: string) => void) => (v: string) => { set(v); setPage(1); setSelected(new Set()); };

	const { data, error, isLoading } = useSWR<QueueResponse>(
		['/api/admin/investor-review', { status: status || undefined, assigned_to: assigned || undefined, q: debouncedSearch || undefined, from: from || undefined, to: to || undefined, page, limit: 50 }],
		{ dedupingInterval: 15_000 },
	);
	const { data: stats } = useSWR<Stats>(['/api/admin/investor-review/stats', { from: statsRange.from, to: statsRange.to }], { dedupingInterval: 15_000 });
	const { data: timeStats } = useSWR<TimeStats>(['/api/admin/work-sessions/stats', { queue: 'investor_review', from: statsRange.from, to: statsRange.to }], { dedupingInterval: 30_000 });
	const { data: usersResp } = useSWR<UsersResponse>(['/api/admin/users', { role: 'admin', limit: 100 }], { dedupingInterval: 300_000 });
	const admins = (usersResp?.data ?? []).filter((u) => u.user_role === 'admin');
	const adminName = (id: string | null) => {
		if (!id) return '—';
		const u = admins.find((a) => a.id === id);
		return u ? (u.full_name || u.display_name || u.email) : `${id.slice(0, 8)}…`;
	};
	const c = stats?.counts;
	const pending = c?.pending ?? 0;
	const weekDelta = stats?.weekly && stats.weekly.completed_last_week > 0 ? ((stats.weekly.completed_this_week - stats.weekly.completed_last_week) / stats.weekly.completed_last_week) * 100 : null;
	// Unassigned work is shown as its own row (the old admin did), not dropped.
	const reviewers = stats?.byAdmin ?? [];

	const refreshAll = () => {
		void mutate((key) => Array.isArray(key) && typeof key[0] === 'string' && (key[0].startsWith('/api/admin/investor-review') || key[0].startsWith('/api/admin/work-sessions')));
	};

	const rows = data?.data ?? [];
	const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
	const toggleAll = () => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)));
	const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

	const act = async (fn: () => Promise<unknown>, ok: string) => {
		try { await fn(); toast.success(ok); setSelected(new Set()); refreshAll(); }
		catch (e) { toast.error((e as Error).message); }
	};

	const bulkAssign = (roundRobin: boolean) => act(
		() => api('PATCH', '/api/admin/investor-review/bulk-assign', roundRobin
			? { ids: [...selected], assigned_to_list: admins.map((a) => a.id) }
			: { ids: [...selected], assigned_to: bulkAssignee || null }),
		roundRobin ? 'Distributed round-robin' : 'Assigned',
	);
	const bulkComplete = () => act(() => api('PATCH', '/api/admin/investor-review/bulk-status', { ids: [...selected], status: 'completed' }), 'Marked completed');
	const bulkSkip = () => act(() => api('PATCH', '/api/admin/investor-review/bulk-status', { ids: [...selected], status: 'skipped' }), 'Marked skipped');
	const bulkPending = () => act(() => api('PATCH', '/api/admin/investor-review/bulk-status', { ids: [...selected], status: 'pending' }), 'Moved back to pending');
	const bulkDelete = async () => { if (await ask(`Delete ${selected.size} candidate(s)? This cannot be undone.`)) void act(() => api('DELETE', '/api/admin/investor-review/bulk', { ids: [...selected] }), 'Deleted'); };
	const selectAllMatching = async () => {
		const p = new URLSearchParams();
		if (status) p.set('status', status);
		if (assigned) p.set('assigned_to', assigned);
		if (search) p.set('q', search);
		if (from) p.set('from', from);
		if (to) p.set('to', to);
		try { const r = await api<{ ids: string[] }>('GET', `/api/admin/investor-review/ids?${p.toString()}`); setSelected(new Set(r.ids)); }
		catch (e) { toast.error((e as Error).message); }
	};
	const remove = (id: string) => { void (async () => { if (await ask('Delete this candidate?')) void act(() => api('DELETE', `/api/admin/investor-review/${id}`), 'Deleted'); })(); };
	const unskip = (id: string) => act(() => api('PATCH', `/api/admin/investor-review/${id}`, { status: 'pending', skip_reason: '' }), 'Moved back to pending');
	const reEnrich = (id: string) => act(() => api('POST', `/api/admin/investor-review/${id}/re-enrich`), 'Enrichment queued');
	const saveEdit = async (id: string, body: { name?: string; website?: string | null }) => {
		await api('PATCH', `/api/admin/investor-review/${id}`, body);
		toast.success(body.website ? 'Saved — enrichment queued for the new website' : 'Saved');
		setEditing(null); refreshAll();
	};

	return (
		<div>
			<PageHeader kicker="Curation · investor review" title="Investor review" subtitle="Triage candidate investors, assign reviewers, then promote into the catalog." />

			<div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8, marginBottom: 'var(--space-3)' }}>
				<button className="btn" onClick={() => setImporting(true)}><Upload size={12} /> Bulk upload</button>
				<WorkSessionTimer queue="investor_review" />
			</div>

			<StatsPanel title="Statistics" action={<DateRangePicker value={statsRange} onChange={setStatsRange} />}>
				<StatStrip cols={5}>
					<StatCard label="Total in Queue" tone="blue" value={(c?.total ?? 0).toLocaleString()} />
					<StatCard label="Completed" tone="green" value={(c?.completed ?? 0).toLocaleString()} delta={weekDelta} />
					<StatCard label="Pending" tone="amber" value={pending.toLocaleString()} urgent={pending > 0} />
					<StatCard label="Skipped" value={(c?.skipped ?? 0).toLocaleString()} />
					<StatCard label="Completed this week" tone="purple" value={(stats?.weekly?.completed_this_week ?? 0).toLocaleString()} />
				</StatStrip>
			</StatsPanel>

			{/* Per-admin completion + time, week-over-week throughput, and the funnel — matches the old admin panel. */}
			<CompletionByAdmin rows={reviewers.map((a) => ({ key: a.assigned_to ?? 'unassigned', name: a.assigned_to ? (a.full_name ?? adminName(a.assigned_to)) : 'Unassigned', done: a.completed, skipped: a.skipped, pending: a.pending, total: a.completed + a.skipped + a.pending, rate: a.completion_rate }))} />

			<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)', marginBottom: 'var(--space-5)' }}>
				<TimeAnalytics timeStats={timeStats} adminName={adminName} />
				<WeeklyMetrics metrics={stats?.weekly ? [
					{ label: 'Investors Completed', cur: stats.weekly.completed_this_week, prev: stats.weekly.completed_last_week, fmt: (n) => n.toLocaleString() },
					{ label: 'Carried Forward', cur: stats.weekly.carried, prev: stats.weekly.carried_last_week ?? 0, fmt: (n) => n.toLocaleString(), goodDown: true },
					{ label: 'Avg Per Day', cur: stats.weekly.avg_per_day ?? 0, prev: stats.weekly.avg_per_day_last_week ?? 0, fmt: (n) => n.toFixed(1) },
				] : null} />
			</div>

			<Section title="Review funnel" meta="pending → completed">
				<Funnel stages={[
					{ label: 'Pending', value: c?.pending ?? 0 },
					{ label: 'Completed', value: c?.completed ?? 0, color: 'var(--pos)' },
					{ label: 'Skipped', value: c?.skipped ?? 0, color: 'var(--warn)' },
				]} />
			</Section>
			<div style={{ marginBottom: 'var(--space-5)' }} />

			<div className="filter-bar" style={{ marginBottom: 'var(--space-4)', gap: 8, flexWrap: 'wrap' }}>
				<Chip active={status === ''} onClick={() => refilter(setStatus)('')}>All</Chip>
				{STATUSES.map((s) => <Chip key={s} active={status === s} onClick={() => refilter(setStatus)(s)}>{s}</Chip>)}
				<Select value={assigned} onChange={refilter(setAssigned)} searchable width={200} options={[{ value: '', label: 'Any assignee' }, { value: 'unassigned', label: 'Unassigned' }, ...admins.map((a) => ({ value: a.id, label: a.full_name || a.display_name || a.email }))]} />
				<input className="search-input" style={{ flex: '0 0 200px', height: 30 }} placeholder="Search name…" value={search} onChange={(e) => refilter(setSearch)(e.target.value)} />
				<input className="search-input" type="date" style={{ height: 30 }} value={from} onChange={(e) => refilter(setFrom)(e.target.value)} title="Added from" />
				<input className="search-input" type="date" style={{ height: 30 }} value={to} onChange={(e) => refilter(setTo)(e.target.value)} title="Added to" />
				<div style={{ flex: 1 }} />
				<button className="btn" onClick={() => setCreating(true)}><Plus size={12} /> Add candidate</button>
			</div>

			{selected.size > 0 && (
				<div className="card" style={{ padding: 12, marginBottom: 'var(--space-4)', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
					<strong>{selected.size} selected</strong>
					{(data?.total ?? 0) > selected.size && (
						<button className="btn ghost" onClick={() => void selectAllMatching()}>Select all {(data?.total ?? 0).toLocaleString()} matching</button>
					)}
					<Select value={bulkAssignee} onChange={setBulkAssignee} searchable width={200} placeholder="Unassign" options={[{ value: '', label: 'Unassign' }, ...admins.map((a) => ({ value: a.id, label: a.full_name || a.display_name || a.email }))]} />
					<button className="btn ghost" onClick={() => void bulkAssign(false)}>Assign</button>
					<button className="btn ghost" disabled={admins.length === 0} onClick={() => void bulkAssign(true)} title="Distribute evenly across admins">Round-robin</button>
					<button className="btn ghost" onClick={() => void bulkComplete()}><Check size={12} /> Completed</button>
					<button className="btn ghost" onClick={() => void bulkSkip()}><SkipForward size={12} /> Skip</button>
					<button className="btn ghost" onClick={() => void bulkPending()} title="Undo a Completed / Skip"><Undo2 size={12} /> Back to pending</button>
					<div style={{ flex: 1 }} />
					<button className="btn ghost" style={{ color: 'var(--accent)' }} onClick={() => void bulkDelete()}><Trash2 size={12} /> Delete</button>
				</div>
			)}

			{creating && <AddCandidateModal onClose={() => setCreating(false)} onSaved={() => { setCreating(false); refreshAll(); }} />}
			{importing && <ImportModal admins={admins.map((a) => ({ id: a.id, name: a.full_name || a.display_name || a.email }))} onClose={() => setImporting(false)} onSaved={() => { setImporting(false); refreshAll(); }} />}
			{promoting && <PromoteModal row={promoting} onClose={() => setPromoting(null)} onDone={() => { setPromoting(null); refreshAll(); }} />}
			{skipping && <SkipModal row={skipping} onClose={() => setSkipping(null)} onSaved={() => { setSkipping(null); refreshAll(); }} />}
			{viewing && <ViewModal row={viewing} onClose={() => setViewing(null)} />}
			{editing && <EditCandidateModal name={editing.name} website={editing.website} onClose={() => setEditing(null)} onSave={(b) => saveEdit(editing.id, b)} />}

			<div className="card">
				<AsyncState loading={isLoading} error={error} empty={rows.length === 0} emptyMsg="No candidates in this view." onRetry={refreshAll}>
					<table className="data-table">
						<thead>
							<tr>
								<th style={{ width: 28 }}><input type="checkbox" checked={allSelected} onChange={toggleAll} /></th>
								<th>Name</th><th>Category</th><th>Country</th><th>Enrichment</th><th>Assigned</th><th>Status</th><th style={{ textAlign: 'right' }} />
							</tr>
						</thead>
						<tbody>
							{rows.map((r) => (
								<tr key={r.id}>
									<td><input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} /></td>
									<td><div style={{ fontWeight: 600 }}>{r.name}</div>{r.website && <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{r.website}</div>}</td>
									<td>{r.category ?? '—'}</td>
									<td>{r.country ?? '—'}</td>
									<td title={r.website ? (r.enrichment_error ?? undefined) : 'Enrichment needs a website — add one with Edit'}>
										{/* Most deal-queued candidates have no website, so "pending" here never moved. */}
										{!r.website && r.enrichment_status !== 'enriched'
											? <Tag>no website</Tag>
											: <Tag variant={r.enrichment_status === 'enriched' ? 'pos' : r.enrichment_status === 'failed' ? 'warn' : ''}>{r.enrichment_status}</Tag>}
									</td>
									<td>{adminName(r.assigned_to)}</td>
									<td>
										<Tag variant={r.status === 'completed' ? 'pos' : r.status === 'skipped' ? 'warn' : ''}>{r.status}</Tag>
										{r.status === 'skipped' && r.skip_reason && <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{r.skip_reason}</div>}
									</td>
									<td style={{ textAlign: 'right', display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
										<button className="btn ghost" title="View enriched data" onClick={() => setViewing(r)}><Eye size={12} /></button>
										<button className="btn ghost" title="Edit name / website" onClick={() => setEditing(r)}><Pencil size={12} /></button>
										{/* A row marked Completed in bulk has no investor yet — it can still be promoted. */}
										{(r.status !== 'completed' || !r.investor_id) && <button className="btn" title="Promote to investors" onClick={() => setPromoting(r)}><Rocket size={12} /> Promote</button>}
										{r.website && <button className="btn ghost" title={r.enrichment_status === 'enriched' ? 'Re-run enrichment (Apollo, Attio as fallback)' : 'Enrich now (Apollo, Attio as fallback)'} disabled={r.enrichment_status === 'enriching'} onClick={() => void reEnrich(r.id)}><RefreshCw size={12} /></button>}
										{r.status === 'skipped' || (r.status === 'completed' && !r.investor_id)
											? <button className="btn ghost" title="Move back to pending" onClick={() => void unskip(r.id)}><Undo2 size={12} /> {r.status === 'skipped' ? 'Unskip' : 'Reopen'}</button>
											: r.status === 'pending' && <button className="btn ghost" title="Skip" onClick={() => setSkipping(r)}><SkipForward size={12} /></button>}
										<button className="btn ghost" style={{ color: 'var(--accent)' }} title="Delete" onClick={() => remove(r.id)}><Trash2 size={12} /></button>
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

function SkipModal({ row, onClose, onSaved }: { row: QueueRow; onClose: () => void; onSaved: () => void }) {
	const [reason, setReason] = useState(row.skip_reason ?? '');
	const [pending, setPending] = useState(false);
	const submit = async () => {
		setPending(true);
		try {
			await api('PATCH', `/api/admin/investor-review/${row.id}`, { status: 'skipped', skip_reason: reason.trim() || undefined });
			toast.success('Skipped'); onSaved();
		} catch (e) { toast.error((e as Error).message); } finally { setPending(false); }
	};
	return (
		<Modal title={`Skip ${row.name}`} onClose={onClose} width={420} footer={
			<>
				<button className="btn ghost" onClick={onClose}>Cancel</button>
				<button className="btn" disabled={pending} onClick={() => void submit()}>{pending ? 'Saving…' : 'Skip'}</button>
			</>
		}>
			<L label="Reason">
				<div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
					{SKIP_PRESETS.map((p) => <button key={p} type="button" className={`chip ${reason === p ? 'on' : ''}`} onClick={() => setReason(p)}>{p}</button>)}
				</div>
				<textarea className="search-input" style={{ minHeight: 60, resize: 'vertical' }} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Pick a preset above or type a reason…" />
			</L>
		</Modal>
	);
}
const SKIP_PRESETS = ['Individual', 'Sports Organisation', 'Asset Manager', 'Not an investor', 'Other'];

// Valid investor category enum labels — used to map a free-text queue category
// onto the investor form's select (left blank if it doesn't match).
const INVESTOR_CATEGORIES = ['venture_capital', 'private_equity', 'financial_services', 'family_investment_office', 'sovereign_wealth_fund', 'angel', 'other'];

function PromoteModal({ row, onClose, onDone }: { row: QueueRow; onClose: () => void; onDone: () => void }) {
	const { data: preview, isLoading } = useSWR<Preview>([`/api/admin/investor-review/${row.id}/promote-preview`], { revalidateOnFocus: false });
	const [createOpen, setCreateOpen] = useState(false);
	const [busy, setBusy] = useState(false);

	const merge = async (investorId: string) => {
		setBusy(true);
		try {
			const r = await api<{ filled?: string[] }>('POST', `/api/admin/investor-review/${row.id}/merge`, { investor_id: investorId });
			countWorkItem('investor_review');
			toast.success(r.filled?.length ? `Merged — filled ${r.filled.length} empty field(s): ${r.filled.join(', ').replace(/_/g, ' ')}` : 'Merged into existing investor (nothing missing to fill)');
			onDone();
		}
		catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
	};
	const onCreated = (createdId?: string) => {
		// The investor create links + marks the review row in its own transaction
		// (via promoteReviewId), so there's no separate mark-promoted call here.
		if (!createdId) { setCreateOpen(false); return; }
		countWorkItem('investor_review');
		onDone();
	};

	if (createOpen) {
		const p = preview?.prefill;
		const cat = p && INVESTOR_CATEGORIES.includes(p.category) ? p.category : '';
		const seed = p ? { name: p.name, website: p.website, category: cat, description: p.description, year_launched: p.year_launched ? String(p.year_launched) : '', hq: { country: p.hq_country, city: p.city, continent: p.continent, region: p.region, state: p.state, report_region: p.report_region }, social: { twitter_url: p.twitter_url, instagram_url: p.instagram_url, facebook_url: p.facebook_url, linkedin_url: p.linkedin_url, youtube_url: '', email: '' }, poc_name: p.poc_name, poc_position: p.poc_position, poc_email: p.poc_email, poc_linkedin: p.poc_linkedin, keywords: p.keywords, logo_url: p.logo_url, num_employees: p.num_employees != null ? String(p.num_employees) : '', total_funding: p.total_funding, annual_revenue: p.annual_revenue, last_raised_at: p.last_raised_at } : undefined;
		return (
			<InvestorModal
				id={null}
				seed={seed}
				enrichedFields={enrichedKeys(seed)}
				promoteReviewId={row.id}
				onClose={() => setCreateOpen(false)}
				onSaved={(id) => onCreated(id)}
			/>
		);
	}
	return (
		<Modal title={`Promote ${row.name}`} onClose={onClose} width={520} footer={
			<>
				<button className="btn ghost" onClick={onClose}>Cancel</button>
				<button className="btn" disabled={busy} onClick={() => setCreateOpen(true)}>Create new investor →</button>
			</>
		}>
			{isLoading ? <div style={{ color: 'var(--fg-muted)', fontSize: 13 }}>Checking for duplicates…</div> : (
				(preview?.matches.length ?? 0) > 0 ? (
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
				) : <div style={{ fontSize: 13, color: 'var(--fg-muted)' }}>No likely duplicates found. Create a new investor with the candidate&apos;s details.</div>
			)}
		</Modal>
	);
}

function ImportModal({ admins, onClose, onSaved }: { admins: Array<{ id: string; name: string }>; onClose: () => void; onSaved: () => void }) {
	const [text, setText] = useState('');
	const [pending, setPending] = useState(false);
	const [assignees, setAssignees] = useState<string[]>([]);
	const submit = async () => {
		const rows = parseInvestorCandidates(text);
		if (!rows.length) { toast.error('Paste at least one line'); return; }
		setPending(true);
		try {
			const r = await api<{ inserted: number; skipped: number; enqueued: number }>('POST', '/api/admin/investor-review/import', { rows, ...(assignees.length ? { assigned_to_list: assignees } : {}) });
			toast.success(`Imported ${r.inserted}${r.skipped ? `, skipped ${r.skipped} dup(s)` : ''}${r.enqueued ? ` · ${r.enqueued} queued for enrichment` : ''}`); onSaved();
		} catch (e) { toast.error((e as Error).message); } finally { setPending(false); }
	};
	return (
		<Modal title="Bulk import candidates" onClose={onClose} width={520} footer={
			<>
				<button className="btn ghost" onClick={onClose}>Cancel</button>
				<button className="btn" disabled={!text.trim() || pending} onClick={() => void submit()}>{pending ? 'Importing…' : 'Import'}</button>
			</>
		}>
			<CandidateInput
				text={text} onText={setText} sampleName="Sequoia Capital"
				placeholder={'Name, Website, Category, Country, City, Year_Launched, LinkedIn\nSequoia Capital, https://sequoiacap.com, venture_capital, USA, Menlo Park, 1972, https://linkedin.com/company/sequoia'}
				parse={(t) => parseInvestorCandidates(t).map((r) => ({ name: r.name, website: r.website }))}
				templateColumns={['Name', 'Website', 'Category', 'Country', 'City', 'Year_Launched', 'Description', 'LinkedIn', 'Twitter', 'Instagram', 'Facebook', 'POC_Name', 'POC_Position', 'POC_Email', 'POC_LinkedIn']}
				templateRows={[['Sequoia Capital', 'https://sequoiacap.com', 'venture_capital', 'USA', 'Menlo Park', '1972', 'Global venture capital firm', 'https://linkedin.com/company/sequoia', 'https://x.com/sequoia', '', '', 'Roelof Botha', 'Managing Partner', 'roelof@sequoiacap.com', 'https://linkedin.com/in/roelofbotha']]}
			/>
			<AssignToAdmins admins={admins} value={assignees} onChange={setAssignees} />
		</Modal>
	);
}

/** Read-only view of a candidate's enriched data (queue fields + raw Apollo
 *  firmographics), fetched on demand so the list payload stays light. */
function ViewModal({ row, onClose }: { row: QueueRow; onClose: () => void }) {
	const { data, isLoading, error } = useSWR<EnrichedDetail>([`/api/admin/investor-review/${row.id}/enriched`], { revalidateOnFocus: false });
	const raw = (data?.apollo_raw ?? {}) as Record<string, unknown>;
	const kw = Array.isArray(raw.keywords) ? (raw.keywords as unknown[]).join(', ') : '';
	const notEnriched = !!data && data.enrichment_status !== 'enriched' && !data.apollo_raw;
	const fields: Array<[string, React.ReactNode]> = data ? [
		['Enrichment', <Tag key="e" variant={data.enrichment_status === 'enriched' ? 'pos' : data.enrichment_status === 'failed' ? 'warn' : ''}>{data.enrichment_status}</Tag>],
		['Description', val(data.description)],
		['Country', val(data.country ?? raw.country)],
		['City', val(data.city ?? raw.city)],
		['Year launched', val(data.year_launched ?? raw.founded_year)],
		['LinkedIn', val(data.linkedin_url)],
		['Twitter', val(data.twitter_url)],
		['Facebook', val(data.facebook_url)],
		['Instagram', val(data.instagram_url)],
		['POC', val([data.poc_name, data.poc_position].filter(Boolean).join(' · '))],
		['POC email', val(data.poc_email)],
		['POC LinkedIn', val(data.poc_linkedin)],
		['Logo (Apollo)', typeof raw.logo_url === 'string' && raw.logo_url ? <img key="l" src={raw.logo_url} alt="" style={{ height: 28, borderRadius: 4 }} /> : val(null)],
		['Industry (Apollo)', val(raw.industry)],
		['Employees (Apollo)', fmtNum(raw.estimated_num_employees)],
		['Total funding (Apollo)', fmtNum(raw.total_funding)],
		['Annual revenue (Apollo)', fmtNum(raw.annual_revenue)],
		['Keywords (Apollo)', val(kw)],
	] : [];
	if (data?.enrichment_error) fields.push(['Error', data.enrichment_error]);
	return (
		<Modal title={`Enriched data — ${row.name}`} onClose={onClose} width={560}>
			{error ? <div style={{ color: 'var(--neg)', fontSize: 13 }}>Couldn&apos;t load enriched data.</div>
				: isLoading ? <div style={{ color: 'var(--fg-muted)', fontSize: 13 }}>Loading…</div>
				: notEnriched ? <div style={{ color: 'var(--fg-muted)', fontSize: 13 }}>{row.website
					? (data?.enrichment_status === 'failed' ? `Enrichment failed${data.enrichment_error ? `: ${data.enrichment_error}` : ''}. Use Re-enrich to try again.` : 'Not enriched yet — it runs in the background; use Re-enrich if it doesn’t finish.')
					: 'No website yet. Add one with Edit (pencil) and enrichment runs automatically.'}</div>
				: (
					<div style={{ display: 'grid', gap: 8, fontSize: 13 }}>
						{fields.map(([k, v]) => (
							<div key={k} style={{ display: 'grid', gridTemplateColumns: '170px 1fr', gap: 10, alignItems: 'start' }}>
								<div style={{ color: 'var(--fg-muted)' }}>{k}</div>
								<div style={{ wordBreak: 'break-word' }}>{v}</div>
							</div>
						))}
					</div>
				)}
		</Modal>
	);
}

