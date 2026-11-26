'use client';

import { useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { toast } from 'sonner';
import { RefreshCw, Star, ShieldAlert, Building2, Download, Send } from 'lucide-react';
import { downloadCsv } from '@/components/csv-import';
import { api } from '@/lib/api';
import { Select } from '@/components/select';
import { Modal } from '@/components/modal';
import { useConfirm } from '@/components/confirm';
import { PageHeader, AsyncState, StatCard, StatsPanel, Tag, Pager, SortableTh } from '@/components/atoms';
import { FilterBar, FilterSelect, StatStrip } from '@/components/filters';
import { useUrlState, useUrlNumber } from '@/hooks/use-url-state';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useTableColumns } from '@/hooks/use-table-columns';
import { roundLabel, scoutDealStatusLabel, scoutInterestStatusLabel, tidy } from '@/lib/labels';

/**
 * Deal Flow — the eligibility queue.
 *
 * The spec is deliberate about what this is: an **eligibility check, not
 * investment due diligence or endorsement**. The listing copy says so, and this
 * screen should not grow features that imply otherwise.
 *
 * This is also the only place a founder's contact details surface anywhere in
 * the product — every Scout-facing projection omits those columns — because the
 * person making the introduction needs them. Treat that panel accordingly.
 *
 * Two deliberate omissions, both enforced server-side:
 *   - Assignment is **not a lock**. Both existing admin queues work that way and
 *     two admins can open the same deal, so this does not pretend otherwise.
 *   - Disclosure of a requester's identity is a *separate* act on the interest
 *     queue, never a side effect of a status reaching `live` here.
 */
const DEAL_STATUSES = ['draft', 'pending', 'reviewing', 'live', 'changes_requested', 'closed'] as const;
const SOURCES = ['circle', 'verified_raise'] as const;

/** Terminal transitions stamp `reviewed_by`/`reviewed_at` on the server. */
const TERMINAL = new Set(['live', 'closed', 'changes_requested']);

const statusChip: Record<string, string> = {
	draft: '', pending: 'warn', reviewing: 'warn',
	live: 'on', changes_requested: 'bad', closed: '',
};

interface DealRow {
	id: string;
	source: string;
	status: string;
	company_name: string | null;
	company_website: string | null;
	company_hq: string | null;
	company_id: string | null;
	pipeline_entry_id: string | null;
	company_anonymous: boolean;
	submitter_anonymous: boolean;
	founder_consent: boolean;
	round_type: string | null;
	currency_code: string | null;
	target_amount: string | null;
	is_featured: boolean;
	featured_until: string | null;
	/** Position on the Featured tab (1 first); null = after the ordered ones. */
	featured_order: number | null;
	featured_at: string | null;
	/** A test raise: admins see it, members never do. */
	is_test: boolean;
	submitted_at: string | null;
	created_at: string;
	submitter_fund: string | null;
	submitter_email: string | null;
	interest_count: number;
}

/** The detail read adds founder contact and the `live_*` overlay. */
interface DealDetail extends DealRow {
	company_description: string | null;
	founder_contact_name: string | null;
	founder_contact_email: string | null;
	founder_contact_phone: string | null;
	instrument: string | null;
	committed_amount: string | null;
	ticket_min: string | null;
	ticket_max: string | null;
	valuation: string | null;
	target_close_date: string | null;
	lead_status: string | null;
	lead_investor: string | null;
	member_relationship: string | null;
	member_commitment: string | null;
	member_perspective: string | null;
	materials_access: string | null;
	deck_path: string | null;
	one_pager_path: string | null;
	review_notes: string | null;
	reviewed_at: string | null;
	raise_id: string | null;
	live_round_type: string | null;
	live_currency_code: string | null;
	live_target_amount: string | null;
	live_committed_amount: string | null;
	live_valuation: string | null;
	live_target_close_date: string | null;
	raise_dealflow_status: string | null;
	founder_account_email: string | null;
	/** Verified Raise: required fields (11.3) still empty, by key. */
	missing_fields?: string[];
	review_fields?: string[];
	invited_by?: string | null;
	founder_confirmed_at?: string | null;
	/** Every status change (11.6). */
	events?: Array<{ status: string; actor_role: string; actor_email: string | null; note: string | null; fields: string[]; created_at: string }>;
}

interface Stats {
	pending: number; reviewing: number; live: number;
	changes_requested: number; closed: number;
	from_circle: number; verified_raises: number; featured: number;
	interest_total: number; disclosed: number;
}
interface ListResp { data: DealRow[]; total: number; totalPages?: number }
interface AdminUser { id: string; full_name?: string | null; display_name?: string | null; email: string; user_role: string }

const LIMIT = 25;
const money = (amount: string | null, ccy: string | null) => {
	if (!amount) return null;
	const n = Number(amount);
	if (!Number.isFinite(n)) return null;
	return new Intl.NumberFormat(undefined, {
		style: 'currency', currency: (ccy || 'eur').toUpperCase(), maximumFractionDigits: 0,
	}).format(n);
};

/** Required to go live (Deal Flow 11.3); keys match the server's REQUIRED_FIELDS. */
const REQUIRED: [string, string][] = [
	['company', 'Company'], ['description', 'One-line description'], ['sector', 'Sector'], ['hq', 'HQ'], ['round', 'Round'],
	['target', 'Target amount and currency'], ['committed', 'Committed so far'], ['instrument', 'Instrument'],
	['close_date', 'Target close date'], ['lead', 'Lead status'], ['deck', 'Pitch deck'], ['contact', 'Contact person'],
];
const requiredLabel = (k: string) => REQUIRED.find(([key]) => key === k)?.[1] ?? k;

export default function ScoutDealsPage() {
	const cols = useTableColumns('scout-deals');
	const ask = useConfirm();
	const [status, setStatus] = useUrlState('sd', 'status', 'pending');
	const [source, setSource] = useUrlState('sd', 'source', '');
	const [assigned, setAssigned] = useUrlState('sd', 'reviewer', '');
	const [search, setSearch] = useUrlState('sd', 'q', '');
	const debouncedSearch = useDebouncedValue(search);
	const [sort, setSort] = useUrlState('sd', 'sort', '-submitted');
	const [page, setPage] = useUrlNumber('sd', 'page', 1);
	const [openId, setOpenId] = useState<string | null>(null);
	/** Set a filter and go back to page 1. */
	const f = (set: (v: string) => void) => (v: string) => { set(v); setPage(1); };
	// Status defaults to the pending queue (like a tab); these are the filters "Clear" resets.
	const activeFilters = [source, assigned, search].filter(Boolean).length;
	const clearFilters = () => { for (const set of [setSource, setAssigned, setSearch]) set(''); setPage(1); };

	const { data: usersResp } = useSWR<{ data: AdminUser[] }>(['/api/admin/users', { role: 'admin', limit: 100 }], { dedupingInterval: 300_000 });
	const admins = (usersResp?.data ?? []).filter((u) => u.user_role === 'admin');

	const list = useSWR<ListResp>(
		['/api/admin/scout-deals', {
			status: status || undefined,
			source: source || undefined,
			reviewed_by: assigned || undefined,
			q: debouncedSearch.trim() || undefined,
			sort,
			limit: LIMIT,
			offset: (page - 1) * LIMIT,
		}],
		{ dedupingInterval: 15_000 },
	);
	const stats = useSWR<Stats>('/api/admin/scout-deals/stats', { dedupingInterval: 30_000 });
	const rows = list.data?.data ?? [];

	const refresh = () => { void list.mutate(); void stats.mutate(); };
	const [raising, setRaising] = useState(false);
	const [exporting, setExporting] = useState(false);
	/** Every submission in the current filters, with review dates and notes (11.6). */
	const exportCsv = async () => {
		setExporting(true);
		try {
			const q = new URLSearchParams(Object.entries({ status, source, reviewed_by: assigned, q: debouncedSearch.trim(), sort, limit: '100' }).filter(([, v]) => v) as [string, string][]);
			const all: DealRow[] = [];
			for (let offset = 0; offset < 5000; offset += 100) {
				const page = await api<{ data: DealRow[] }>('GET', `/api/admin/scout-deals?${q}&offset=${offset}`);
				all.push(...page.data);
				if (page.data.length < 100) break;
			}
			downloadCsv('deal-flow-submissions.csv',
				['submitted', 'company', 'source', 'status', 'featured', 'test', 'submitter', 'reviewed_at', 'review_notes', 'interest_requests'],
				all.map((r) => {
					const x = r as DealRow & { reviewed_at?: string | null; review_notes?: string | null };
					return [r.submitted_at ?? r.created_at, r.company_name ?? '', r.source, scoutDealStatusLabel(r.status), r.is_featured ? 'yes' : '', r.is_test ? 'yes' : '',
						r.submitter_email ?? '', x.reviewed_at ?? '', x.review_notes ?? '', String(r.interest_count ?? 0)];
				}));
		} catch (e) { toast.error((e as Error).message); }
		finally { setExporting(false); }
	};

	return (
		<div>
			<PageHeader
				kicker="Review queue"
				title="Deal Flow"
				subtitle="Raises shared with the Investor Circle. This is an eligibility check — that the round is real and the founder consented — not due diligence or an endorsement."
				action={<div style={{ display: 'flex', gap: 8 }}>
					<button className="btn ghost" onClick={() => setRaising((v) => !v)}><Send size={12} /> Raising companies</button>
					<button className="btn ghost" disabled={exporting} onClick={() => void exportCsv()}><Download size={12} /> {exporting ? 'Exporting…' : 'Export CSV'}</button>
					<button className="btn ghost" onClick={refresh}><RefreshCw size={12} /> Refresh</button>
				</div>}
			/>
			{raising && <RaisingCompanies onChanged={refresh} />}

			<StatsPanel title="Queue">
				<StatStrip cols={5}>
					<StatCard label="Pending" value={stats.data?.pending ?? '—'} loading={stats.isLoading} urgent={(stats.data?.pending ?? 0) > 0} />
					<StatCard label="Reviewing" value={stats.data?.reviewing ?? '—'} loading={stats.isLoading} />
					<StatCard label="Live" value={stats.data?.live ?? '—'} loading={stats.isLoading} tone="green" />
					<StatCard label="Changes requested" value={stats.data?.changes_requested ?? '—'} loading={stats.isLoading} />
					<StatCard label="Closed" value={stats.data?.closed ?? '—'} loading={stats.isLoading} />
					<StatCard label="Verified raises" value={stats.data?.verified_raises ?? '—'} loading={stats.isLoading} sub="founder opted in" />
					<StatCard label="From the Circle" value={stats.data?.from_circle ?? '—'} loading={stats.isLoading} sub="member submitted" />
					<StatCard label="Featured" value={stats.data?.featured ?? '—'} loading={stats.isLoading} />
					<StatCard label="Interest requests" value={stats.data?.interest_total ?? '—'} loading={stats.isLoading} />
					<StatCard label="Disclosed" value={stats.data?.disclosed ?? '—'} loading={stats.isLoading} sub="identity released" />
				</StatStrip>
			</StatsPanel>

			<FilterBar>
				<input
					className="search-input" style={{ flex: '0 0 240px', height: 32 }}
					placeholder="Search company, fund, email…" aria-label="Search deals"
					value={search} onChange={(e) => f(setSearch)(e.target.value)}
				/>
				<FilterSelect
					ariaLabel="Status" value={status} onChange={f(setStatus)}
					allLabel="All statuses" options={DEAL_STATUSES.map((s) => ({ value: s, label: scoutDealStatusLabel(s) }))}
				/>
				<FilterSelect
					ariaLabel="Source" value={source} onChange={f(setSource)}
					allLabel="Any source" options={SOURCES.map((s) => ({ value: s, label: s === 'circle' ? 'From the Circle' : 'Verified raise' }))}
				/>
				<FilterSelect
					ariaLabel="Reviewed by" value={assigned} onChange={f(setAssigned)} allLabel="Reviewed by: anyone"
					options={[{ value: 'none', label: 'Not reviewed yet' }, ...admins.map((a) => ({ value: a.id, label: a.full_name || a.display_name || a.email }))]}
				/>
				{activeFilters > 0 && <button className="btn ghost" onClick={clearFilters}>Clear {activeFilters} filter{activeFilters === 1 ? '' : 's'}</button>}
			</FilterBar>

			<div className="card" ref={cols.ref} style={{ padding: 'var(--space-4)' }}>
				<div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingBottom: 10, marginBottom: 10, borderBottom: '1px solid var(--border)', fontSize: 12, color: 'var(--fg-muted)' }}>
					{list.data ? `${list.data.total.toLocaleString()} deal${list.data.total === 1 ? '' : 's'}${activeFilters ? ' match these filters' : ''}` : 'Loading…'} · click a column header to sort
					<span style={{ marginLeft: 'auto' }}>{cols.menu}</span>
</div>
				<AsyncState
					loading={list.isLoading} error={list.error} empty={rows.length === 0}
					emptyMsg={status === 'pending' && !activeFilters ? 'Nothing waiting for review.' : 'No deals match these filters.'}
					onRetry={() => void list.mutate()}
				>
					<table className="data-table">
						<thead>
							<tr>
								<SortableTh label="Submitted" field="submitted" sort={sort} onSort={f(setSort)} />
								<SortableTh label="Company" field="company" sort={sort} onSort={f(setSort)} />
								<SortableTh label="Source" field="source" sort={sort} onSort={f(setSort)} />
								<th>Submitter</th>
								<SortableTh label="Round · target" field="target" sort={sort} onSort={f(setSort)} />
								<SortableTh label="Interest" field="interest" sort={sort} onSort={f(setSort)} />
								<SortableTh label="Status" field="status" sort={sort} onSort={f(setSort)} />
								<th>Actions</th>
							</tr>
						</thead>
						<tbody>
							{rows.map((r) => (
								<tr key={r.id}>
									<td style={{ whiteSpace: 'nowrap', color: 'var(--fg-muted)', fontSize: 12 }}>
										{new Date(r.submitted_at ?? r.created_at).toLocaleDateString()}
									</td>
									<td>
										<div style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
											{r.company_name ?? '—'}
											{r.is_featured && <Star size={12} aria-label="Featured" style={{ color: 'var(--warn, #c90)' }} />}
											{r.is_featured && r.featured_order != null && <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>#{r.featured_order}</span>}
											{r.is_test && <Tag variant="pill">test</Tag>}
										</div>
										<div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
											{r.company_hq ?? ''}
											{/* What investors actually see, which is not what this table shows. */}
											{r.company_anonymous && <> · <Tag variant="pill">company hidden</Tag></>}
										</div>
									</td>
									<td style={{ fontSize: 12 }}>
										{r.source === 'verified_raise' ? <Tag variant="pos">Verified raise</Tag> : <Tag>From the Circle</Tag>}
									</td>
									<td>
										<div style={{ fontSize: 12 }}>{r.submitter_fund ?? (r.source === 'verified_raise' ? 'Founder opt-in' : '—')}</div>
										<div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
											{r.submitter_email ?? ''}
											{r.submitter_anonymous && <> · <Tag variant="pill">submitter hidden</Tag></>}
										</div>
									</td>
									<td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
										{roundLabel(r.round_type)}
										{money(r.target_amount, r.currency_code) && (
											<div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{money(r.target_amount, r.currency_code)}</div>
										)}
									</td>
									<td style={{ fontSize: 12 }}>{r.interest_count || '—'}</td>
									<td>
										<span className={`chip ${statusChip[r.status] ?? ''}`}>{scoutDealStatusLabel(r.status)}</span>
										{!r.founder_consent && (
											<div style={{ fontSize: 11, color: 'var(--danger, #c33)', display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
												<ShieldAlert size={11} /> no consent
											</div>
										)}
									</td>
									<td>
										<button className="btn" onClick={() => setOpenId(r.id)}>Review</button>
									</td>
								</tr>
							))}
						</tbody>
					</table>
					<Pager page={page} totalPages={list.data?.totalPages} onPage={setPage} />
				</AsyncState>
			</div>

			{openId && (
				<ReviewModal
					id={openId}
					onClose={() => setOpenId(null)}
					onSaved={() => { setOpenId(null); refresh(); }}
					onChanged={refresh}
					ask={ask}
				/>
			)}
		</div>
	);
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<div style={{ display: 'flex', gap: 10, padding: '4px 0', fontSize: 12 }}>
			<div style={{ flex: '0 0 150px', color: 'var(--fg-muted)' }}>{label}</div>
			<div style={{ flex: 1, color: 'var(--fg-2)' }}>{children ?? '—'}</div>
		</div>
	);
}

function ReviewModal({ id, onClose, onSaved, onChanged, ask }: {
	id: string;
	onClose: () => void;
	onSaved: () => void;
	/** A change made without closing (featured, interest) — refreshes the list + stats behind the modal. */
	onChanged: () => void;
	ask: (arg: { title?: string; message: string; confirmLabel?: string; danger?: boolean } | string) => Promise<boolean>;
}) {
	const { data: d, error, isLoading, mutate } = useSWR<DealDetail>(`/api/admin/scout-deals/${id}`);
	const [next, setNext] = useState('');
	const [notes, setNotes] = useState('');
	const [busy, setBusy] = useState(false);
	const [featuredUntil, setFeaturedUntil] = useState('');
	/** Verified Raise, Request changes: the required fields to fix (shown to the founder). Starts from what is flagged now. */
	const [flaggedEdit, setFlagged] = useState<string[] | null>(null);
	const flagged = flaggedEdit ?? d?.review_fields ?? [];
	// Empty = keep the current order (or none for a new feature).
	const [featuredOrder, setFeaturedOrder] = useState('');

	// Seed the form from the row once it arrives, without clobbering edits.
	const current = d?.status ?? '';
	const chosen = next || current;

	const save = async () => {
		if (!d) return;
		// `changes_requested` is the one transition whose whole purpose is to tell
		// the submitter what to fix — an empty note makes it unactionable.
		if (chosen === 'changes_requested' && !notes.trim()) {
			toast.error('Add a note saying what needs to change.');
			return;
		}
		// A new company must be in Atlas before the deal can go live. The server
		// enforces this too (409); catching it here gives a clear next step.
		if (chosen === 'live' && !d.company_id) {
			toast.error('Add this company to the directory first — open its Startups-pipeline entry, research and add it, then set the deal live.');
			return;
		}
		// Publishing is the consequential one: it is what investors begin to see.
		if (chosen === 'live' && !(await ask({
			title: 'Publish to the Investor Circle?',
			message: `${d.company_name ?? 'This deal'} becomes visible to Scout members.${d.company_anonymous ? ' The company name stays hidden from them.' : ''}`,
			confirmLabel: 'Publish',
		}))) return;

		setBusy(true);
		try {
			// A note with no transition sends no status: the server then keeps the status as is and
			// doesn't re-notify the submitter (and a `draft` deal can take a note).
			const body = {
				...(chosen !== current ? { status: chosen } : {}),
				review_notes: notes.trim() || null,
				...(d.source === 'verified_raise' && chosen === 'changes_requested' ? { review_fields: flagged } : {}),
			};
			try {
				await api('PATCH', `/api/admin/scout-deals/${id}/review`, body);
			} catch (e) {
				// Required fields missing (11.3): publish only on a deliberate second click; it goes in the history.
				if (chosen === 'live' && /Required fields are missing/.test((e as Error).message) && await ask({
					title: 'Publish with required fields missing?',
					message: `${(e as Error).message} Publishing anyway is recorded in this raise's history.`,
					confirmLabel: 'Publish anyway', danger: true,
				})) await api('PATCH', `/api/admin/scout-deals/${id}/review`, { ...body, override_missing: true });
				else throw e;
			}
			toast.success(chosen !== current ? `Marked ${scoutDealStatusLabel(chosen).toLowerCase()}` : 'Note saved');
			onSaved();
		} catch (e) { toast.error((e as Error).message); }
		finally { setBusy(false); }
	};

	const toggleFeatured = async () => {
		if (!d) return;
		setBusy(true);
		try {
			await api('PATCH', `/api/admin/scout-deals/${id}/featured`, {
				is_featured: !d.is_featured,
				featured_until: !d.is_featured && featuredUntil ? featuredUntil : null,
				featured_order: !d.is_featured && featuredOrder ? Number(featuredOrder) : null,
			});
			toast.success(d.is_featured ? 'Removed from Featured' : 'Added to Featured');
			setFeaturedOrder('');
			void mutate(); onChanged();
		} catch (e) { toast.error((e as Error).message); }
		finally { setBusy(false); }
	};

	/** Moves a featured raise on the Featured tab; keeps its feature date and end date. */
	const saveOrder = async () => {
		if (!d) return;
		setBusy(true);
		try {
			await api('PATCH', `/api/admin/scout-deals/${id}/featured`, {
				is_featured: true,
				featured_until: d.featured_until,
				featured_order: featuredOrder ? Number(featuredOrder) : null,
			});
			toast.success(featuredOrder ? `Featured position set to ${featuredOrder}` : 'Featured position cleared');
			setFeaturedOrder('');
			void mutate(); onChanged();
		} catch (e) { toast.error((e as Error).message); }
		finally { setBusy(false); }
	};

	const toggleTest = async () => {
		if (!d) return;
		if (!d.is_test && !(await ask({
			title: 'Mark as a test raise?',
			message: 'Members stop seeing it at once; only admins see it. scripts/remove-test-raises.ts deletes every test raise.',
			confirmLabel: 'Mark as test',
		}))) return;
		setBusy(true);
		try {
			await api('PATCH', `/api/admin/scout-deals/${id}/test`, { is_test: !d.is_test });
			toast.success(d.is_test ? 'No longer a test raise' : 'Marked as a test raise');
			void mutate(); onChanged();
		} catch (e) { toast.error((e as Error).message); }
		finally { setBusy(false); }
	};

	return (
		<Modal
			title={d?.company_name ?? 'Deal'}
			onClose={onClose}
			width={720}
			footer={
				<>
					<button className="btn ghost" onClick={onClose}>Cancel</button>
					<Select
						value={chosen}
						onChange={setNext}
						ariaLabel="Status"
						width={190}
						// Admins can't move a deal TO draft (that's the submitter's state); a draft deal still shows it.
						// A listing SportsTechX started waits for the founder: until they confirm it can only be closed.
						options={DEAL_STATUSES.filter((s) => (current === 'draft' && !d?.founder_consent ? s === 'draft' || s === 'closed' : s !== 'draft' || current === 'draft')).map((s) => ({ value: s, label: scoutDealStatusLabel(s) }))}
					/>
					{/* A note with no transition is a legitimate triage action, so this
					    stays enabled when only the note changed. */}
					<button className="btn" disabled={busy || !d || (chosen === current && !notes.trim())} onClick={() => void save()}>
						{busy ? 'Saving…' : TERMINAL.has(chosen) && chosen !== current ? 'Save decision' : 'Save note'}
					</button>
				</>
			}
		>
			<AsyncState loading={isLoading} error={error} empty={!d} emptyMsg="Deal not found." onRetry={() => void mutate()}>
				{d && (
					<>
						{!d.founder_consent && (
							<div className="card" style={{ padding: 10, marginBottom: 12, borderColor: 'var(--danger, #c33)' }}>
								<div style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
									<ShieldAlert size={13} /> <strong>No founder consent recorded.</strong>
								</div>
								<div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 4 }}>
									The database refuses to publish without it, so this cannot go live until the
									submitter confirms consent.
								</div>
							</div>
						)}

						{!d.company_id && (
							<div className="card" style={{ padding: 10, marginBottom: 12, borderColor: 'var(--warn, #b80)' }}>
								<div style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
									<Building2 size={13} /> <strong>New company — not in Atlas yet.</strong>
								</div>
								<div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 4 }}>
									This deal can’t go live until the company is in the directory. Research and add it from the{' '}
									<Link href="/startups-pipeline" style={{ textDecoration: 'underline' }}>Startups pipeline</Link>
									{d.pipeline_entry_id ? ' (its entry is already queued there)' : ''} — once added, the deal links to it automatically and you can publish.
								</div>
							</div>
						)}

						<Section2 title="Company">
							<Row label="Name">{d.company_name}</Row>
							<Row label="Website">
								{d.company_website
									? <a href={d.company_website} target="_blank" rel="noopener noreferrer">{d.company_website}</a>
									: null}
							</Row>
							<Row label="HQ">{d.company_hq}</Row>
							<Row label="Description">{d.company_description}</Row>
						</Section2>

						<Section2 title="Round">
							{/* A verified raise copies no numbers on opt-in — the Scout read paths
							    project them from raise_profiles, so show that overlay or an admin
							    reviews a row of NULLs. */}
							<Row label="Type">{roundLabel(d.round_type ?? d.live_round_type)}</Row>
							<Row label="Instrument">{d.instrument && tidy(d.instrument)}</Row>
							<Row label="Target">
								{money(d.target_amount, d.currency_code)
									?? money(d.live_target_amount, d.live_currency_code)}
							</Row>
							<Row label="Committed">
								{money(d.committed_amount, d.currency_code)
									?? money(d.live_committed_amount, d.live_currency_code)}
							</Row>
							<Row label="Valuation">{d.valuation ?? d.live_valuation}</Row>
							<Row label="Target close">{d.target_close_date ?? d.live_target_close_date}</Row>
							<Row label="Lead">{d.lead_investor ?? (d.lead_status && tidy(d.lead_status))}</Row>
							<Row label="Ticket">
								{[money(d.ticket_min, d.currency_code), money(d.ticket_max, d.currency_code)].filter(Boolean).join(' – ') || null}
							</Row>
						</Section2>

						{d.source === 'circle' && (
							<Section2 title="Submitting member">
								<Row label="Fund">{d.submitter_fund}</Row>
								<Row label="Account">{d.submitter_email}</Row>
								<Row label="Relationship">{d.member_relationship && tidy(d.member_relationship)}</Row>
								<Row label="Their commitment">{money(d.member_commitment, d.currency_code)}</Row>
								<Row label="Their view">{d.member_perspective}</Row>
							</Section2>
						)}

						{/* The one place these columns surface anywhere in the product. */}
						<Section2 title="Founder contact — admin only">
							<Row label="Name">{d.founder_contact_name}</Row>
							<Row label="Email">{d.founder_contact_email}</Row>
							<Row label="Phone">{d.founder_contact_phone}</Row>
							<Row label="Atlas account">{d.founder_account_email}</Row>
						</Section2>

						<Section2 title="What investors see">
							<Row label="Company name">{d.company_anonymous ? 'Hidden' : 'Shown'}</Row>
							<Row label="Submitter">{d.submitter_anonymous ? 'Hidden' : 'Shown'}</Row>
							<Row label="Materials">{d.materials_access && tidy(d.materials_access)}</Row>
							<Row label="Documents">
								{[d.deck_path && 'deck', d.one_pager_path && 'one-pager'].filter(Boolean).join(', ') || 'none uploaded'}
							</Row>
							{d.source === 'verified_raise' && <Row label="Founder's own status">{d.raise_dealflow_status && tidy(d.raise_dealflow_status)}</Row>}
						</Section2>

						<Section2 title="Featured">
							<div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
								<button className="btn ghost" disabled={busy} onClick={() => void toggleFeatured()}>
									<Star size={12} /> {d.is_featured ? 'Remove from Featured' : 'Add to Featured'}
								</button>
								{!d.is_featured && (
									<input
										type="date" className="search-input" style={{ height: 32, flex: '0 0 160px' }}
										value={featuredUntil} onChange={(e) => setFeaturedUntil(e.target.value)}
										aria-label="Featured until"
									/>
								)}
								{d.is_featured && d.featured_until && (
									<span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>until {d.featured_until}</span>
								)}
								{d.is_featured && d.featured_at && (
									<span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>featured {new Date(d.featured_at).toLocaleDateString()}</span>
								)}
							</div>
							<div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
								<label style={{ fontSize: 12, color: 'var(--fg-muted)' }} htmlFor="featured-order">Position on Featured (1 first)</label>
								<input
									id="featured-order" type="number" min={1} max={999} step={1} className="search-input" style={{ height: 32, flex: '0 0 90px' }}
									value={featuredOrder} placeholder={d.featured_order != null ? String(d.featured_order) : 'none'}
									onChange={(e) => setFeaturedOrder(e.target.value)}
								/>
								{d.is_featured && (
									<button className="btn ghost" disabled={busy || (featuredOrder === '' && d.featured_order == null)} onClick={() => void saveOrder()}>
										{featuredOrder === '' ? 'Clear position' : 'Save position'}
									</button>
								)}
								<span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>Unnumbered raises follow, newest feature first.</span>
							</div>
						</Section2>

						<Section2 title="Test raise">
							<div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
								<button className="btn ghost" disabled={busy} onClick={() => void toggleTest()}>
									{d.is_test ? 'Not a test raise' : 'Mark as test raise'}
								</button>
								<span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
									{d.is_test ? 'Only admins see it in Atlas. Members never do.' : 'Members see this raise once it is live.'}
								</span>
							</div>
						</Section2>

						<InterestPanel dealId={id} companyName={d.company_name} anonymous={d.company_anonymous} onChanged={onChanged} />

						{d.source === 'verified_raise' && (
							<Section2 title="Required to go live">
								{(d.missing_fields ?? []).length === 0
									? <span style={{ fontSize: 12, color: 'var(--pos, #2a7)' }}>Every required field is filled.</span>
									: <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
										<span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>Missing:</span>
										{(d.missing_fields ?? []).map((k) => <span key={k} className="chip warn">{requiredLabel(k)}</span>)}
									</div>}
								{d.invited_by && (
									<div style={{ fontSize: 12, color: 'var(--fg-muted)', marginTop: 6 }}>
										Started by SportsTechX. {d.founder_confirmed_at ? `Founder confirmed ${new Date(d.founder_confirmed_at).toLocaleDateString()}.` : 'Waiting for the founder to confirm from the emailed link.'}
									</div>
								)}
							</Section2>
						)}

						<Section2 title="Decision">
							{d.review_notes && (
								<Row label="Previous note">{d.review_notes}</Row>
							)}
							{d.source === 'verified_raise' && chosen === 'changes_requested' && (
								<div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', margin: '6px 0' }}>
									<span style={{ fontSize: 12, color: 'var(--fg-muted)', width: '100%' }}>Fields to fix (the founder sees them marked):</span>
									{REQUIRED.map(([k, label]) => (
										<label key={k} style={{ fontSize: 12, display: 'flex', gap: 4, alignItems: 'center' }}>
											<input type="checkbox" checked={flagged.includes(k)} onChange={(e) => setFlagged(e.target.checked ? [...flagged, k] : flagged.filter((x) => x !== k))} /> {label}
										</label>
									))}
								</div>
							)}
							{d.reviewed_at && <Row label="Last reviewed">{new Date(d.reviewed_at).toLocaleString()}</Row>}
							<textarea
								className="search-input"
								style={{ width: '100%', minHeight: 72, padding: 8, marginTop: 6 }}
								placeholder={chosen === 'changes_requested'
									? 'Required — what does the submitter need to change?'
									: chosen === 'closed' && d.source === 'verified_raise'
										? 'Reason, shown to the founder (Decline)'
										: 'Review note (optional)'}
								value={notes}
								onChange={(e) => setNotes(e.target.value)}
							/>
						</Section2>

						{(d.events ?? []).length > 0 && (
							<Section2 title="History">
								{(d.events ?? []).map((e, i) => (
									<div key={i} style={{ fontSize: 12, padding: '4px 0', borderTop: i ? '1px solid var(--border)' : undefined }}>
										<span style={{ color: 'var(--fg-muted)' }}>{new Date(e.created_at).toLocaleString()}</span>
										{' · '}<strong>{scoutDealStatusLabel(e.status)}</strong>
										{' · '}{e.actor_role === 'admin' ? (e.actor_email ?? 'SportsTechX') : e.actor_role === 'founder' ? 'Founder' : 'Automatic'}
										{e.fields.length > 0 && ` · fields: ${e.fields.map(requiredLabel).join(', ')}`}
										{e.note && <div style={{ color: 'var(--fg-2)' }}>{e.note}</div>}
									</div>
								))}
							</Section2>
						)}
					</>
				)}
			</AsyncState>
		</Modal>
	);
}

interface InterestRow {
	id: string;
	kind: string;
	note: string | null;
	status: string;
	disclosed_at: string | null;
	created_at: string;
	fund_name: string | null;
	scout_email: string | null;
}

const interestChip: Record<string, string> = {
	received: 'warn', source_confirmed: 'warn', shared: 'on', connected: 'on', declined: '',
};

/**
 * Who has asked about this deal, and whether they have been told who it is.
 *
 * **Disclosure is deliberately not a status.** The spec has STX "first confirm
 * that further information can be shared", so releasing one investor's view is
 * its own decision — bundling it into a status change would let an admin widen
 * someone's access while merely moving a row along. The server keeps the two
 * fields separate for that reason, and so does this panel.
 *
 * The notification goes to the **requesting investor**, not to the company —
 * `interestRecipient` resolves the scout's own profile email. Confirming with
 * the company is the human step the spec describes, and nothing here does it.
 *
 * It is also **one-way**: `disclosed_at` is set only if not already set, so a
 * re-run cannot move or retract it. Once disclosed, the button becomes a fact.
 *
 * This is per-deal rather than a global queue because that is the only endpoint
 * there is — the dashboard-level counts come from `/stats` instead.
 */
function InterestPanel({ dealId, companyName, anonymous, onChanged }: {
	dealId: string;
	companyName: string | null;
	anonymous: boolean;
	onChanged: () => void;
}) {
	const ask = useConfirm();
	const { data, error, isLoading, mutate } = useSWR<InterestRow[]>(`/api/admin/scout-deals/${dealId}/interest`);
	const [pending, setPending] = useState<string | null>(null);
	const rows = data ?? [];

	const act = async (r: InterestRow, status: string, disclose = false) => {
		const who = r.fund_name ?? r.scout_email ?? 'this investor';
		if (disclose && !(await ask({
			title: 'Release the company’s identity?',
			message: `${who} will be told that this deal is ${companyName ?? 'this company'}${anonymous ? ', which is currently hidden from them' : ''}. They are emailed about it, and this cannot be undone. The company is NOT notified — tell them yourself if that was the agreement.`,
			confirmLabel: 'Disclose',
			danger: true,
		}))) return;

		setPending(r.id);
		try {
			await api('PATCH', `/api/admin/scout-deals/interest/${r.id}`, { status, ...(disclose ? { disclose: true } : {}) });
			toast.success(disclose ? `Disclosed to ${who}` : `Marked ${scoutInterestStatusLabel(status).toLowerCase()}`);
			void mutate(); onChanged();   // interest count + Disclosed stat behind the modal
		} catch (e) { toast.error((e as Error).message); }
		finally { setPending(null); }
	};

	return (
		<Section2 title={`Interest${rows.length ? ` · ${rows.length}` : ''}`}>
			<AsyncState loading={isLoading} error={error} empty={rows.length === 0} emptyMsg="No one has asked about this deal yet." onRetry={() => void mutate()}>
				{rows.map((r) => (
					<div key={r.id} style={{ borderTop: '1px solid var(--border)', padding: '8px 0', fontSize: 12 }}>
						<div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
							<strong>{r.fund_name ?? '—'}</strong>
							<span style={{ color: 'var(--fg-muted)' }}>{r.scout_email ?? ''}</span>
							<span className={`chip ${interestChip[r.status] ?? ''}`}>{scoutInterestStatusLabel(r.status)}</span>
							<Tag variant="pill">{tidy(r.kind)}</Tag>
							{r.disclosed_at
								? <Tag variant="pos">disclosed {new Date(r.disclosed_at).toLocaleDateString()}</Tag>
								: <Tag>not disclosed</Tag>}
							<span style={{ marginLeft: 'auto', color: 'var(--fg-muted)' }}>{new Date(r.created_at).toLocaleDateString()}</span>
						</div>
						{r.note && <div style={{ color: 'var(--fg-2)', margin: '4px 0' }}>{r.note}</div>}
						<div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginTop: 4 }}>
							{/* Introductions move only through the approval flow (Send to founder → Accept / Decline). */}
							<a className="btn" href={`/raise-intros?ri.status=&ri.q=${encodeURIComponent(companyName ?? '')}`}>Manage in Deal Flow introductions</a>
							{/* One-way, and emailed — so it is never a side effect of the
							    dropdown above. */}
							{!r.disclosed_at && (
								<button className="btn ghost" disabled={pending === r.id} onClick={() => void act(r, r.status, true)}>
									Disclose identity
								</button>
							)}
						</div>
					</div>
				))}
			</AsyncState>
		</Section2>
	);
}

/** Local section heading — `Section` from atoms renders its own card chrome,
 *  which nests badly inside a modal. */
function Section2({ title, children }: { title: string; children: React.ReactNode }) {
	return (
		<div style={{ marginBottom: 14 }}>
			<div style={{ fontWeight: 700, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--fg-muted)', marginBottom: 4 }}>
				{title}
			</div>
			{children}
		</div>
	);
}

/**
 * Actively raising companies and where each stands in Verified Raises. "Invite" starts a listing
 * from the company's data and emails its verified founder a link to confirm; nothing is shown to
 * investors until they confirm and SportsTechX accepts it here.
 */
function RaisingCompanies({ onChanged }: { onChanged: () => void }) {
	const ask = useConfirm();
	const { data, error, isLoading, mutate } = useSWR<{ data: Array<{ id: string; name: string; round: string | null; amount: string | null; founder_id: string | null; founder_email: string | null; founder_name: string | null; deal_id: string | null; deal_status: string | null }> }>('/api/admin/scout-deals/raising-candidates');
	const [busy, setBusy] = useState<string | null>(null);
	const rows = data?.data ?? [];
	const invite = async (r: (typeof rows)[number]) => {
		if (!(await ask({ title: `Invite ${r.name}?`, message: `${r.founder_name ?? 'The founder'} (${r.founder_email}) gets an email from Atlas asking to confirm a Verified Raise listing built from ${r.name}'s data. It goes to this review queue only after they confirm.`, confirmLabel: 'Send invite' }))) return;
		setBusy(r.id);
		try {
			await api('POST', `/api/admin/scout-deals/invite/${r.id}`, {});
			toast.success(`Invite sent to ${r.founder_email}`);
			void mutate(); onChanged();
		} catch (e) { toast.error((e as Error).message); }
		finally { setBusy(null); }
	};
	return (
		<StatsPanel title={`Actively raising companies · ${rows.length}`}>
			<AsyncState loading={isLoading} error={error} empty={rows.length === 0} emptyMsg="No company is marked actively raising." onRetry={() => void mutate()}>
				<table className="data-table">
					<thead><tr><th>Company</th><th>Raising</th><th>Verified founder</th><th>Verified Raises</th><th /></tr></thead>
					<tbody>
						{rows.map((r) => (
							<tr key={r.id}>
								<td>{r.name}</td>
								<td style={{ fontSize: 12, color: 'var(--fg-2)' }}>{[r.round, r.amount ? `$${Number(r.amount).toLocaleString()}` : null].filter(Boolean).join(' · ') || '—'}</td>
								<td style={{ fontSize: 12 }}>{r.founder_email ? <>{r.founder_name ?? '—'}<div style={{ color: 'var(--fg-muted)' }}>{r.founder_email}</div></> : <span style={{ color: 'var(--fg-muted)' }}>None yet: they need to claim the company</span>}</td>
								<td>{r.deal_status ? <span className="chip">{scoutDealStatusLabel(r.deal_status)}</span> : <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>Not listed</span>}</td>
								<td>
									{r.founder_id && (!r.deal_status || ['draft', 'closed'].includes(r.deal_status)) && (
										<button className="btn ghost" disabled={busy === r.id} onClick={() => void invite(r)}>{r.deal_status === 'draft' ? 'Send again' : 'Invite'}</button>
									)}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</AsyncState>
		</StatsPanel>
	);
}
