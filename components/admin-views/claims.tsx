'use client';

import { Fragment, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import useSWR, { useSWRConfig } from 'swr';
import { toast } from 'sonner';
import { ChevronDown, ChevronRight, ExternalLink, Mail, MailCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { Select } from '@/components/select';
import { PageHeader, AsyncState, StatCard, StatsPanel, Section, Pager, SortableTh } from '@/components/atoms';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useInitialQuery } from '@/hooks/use-initial-query';
import { useEditParam } from '@/hooks/use-edit-param';
import { Funnel } from '@/components/charts';
import { FilterBar, FilterSelect, StatStrip } from '@/components/filters';
import { SectorCascade, LocationFields, EMPTY_LOCATION, type LocationValue } from '@/components/entity-pickers';
import { YearSelect } from '@/components/year-select';
import { useUrlState, useUrlNumber } from '@/hooks/use-url-state';
import { useTableColumns } from '@/hooks/use-table-columns';
import { activeFlagLabel, businessModelLabel, claimStatusLabel, claimTypeLabel, entityTypeLabel, investorCategoryLabel, tidy } from '@/lib/labels';

type ClaimStatus = 'pending' | 'picked_up' | 'verified' | 'rejected';
interface QueueStats { claims: { pending: number; picked_up: number; verified: number; rejected: number } }

interface Claim {
	id: string;
	ecosystem_type?: string | null;
	claim_type: string;
	profile_id: string | null;
	entity_type?: string | null;
	entity_id?: string | null;
	entity_name?: string | null;
	claimant_email?: string | null;
	claimant_name?: string | null;
	company_email?: string | null;
	position_at_company?: string | null;
	status: ClaimStatus;
	is_verified: boolean;
	picked_up_at: string | null;
	verified_at: string | null;
	rejection_reason?: string | null;
	new_entry_request?: boolean;
	target_website_snapshot?: string | null;
	shareable_token?: string | null;
	picked_up_by_email?: string | null;
	is_actively_raising?: boolean | null;
	/** Other people's claims on the same entity — several may be verified (admin's call). */
	entity_verified_count?: number;
	entity_pending_count?: number;
	report_id?: string | null;
	report_status?: string | null;
	created_at: string;
}

/** The report page lives in the Atlas app, not the admin panel. */
const ATLAS_BASE = process.env.NEXT_PUBLIC_ATLAS_URL ?? 'https://www.atlas.sportstechx.com';

/** The claimed record's admin page (company edit form, investor edit form, ecosystem entry). */
const ECO_TAB: Record<string, string> = { program: 'programs', event: 'events', initiative: 'initiatives', organization: 'organizations' };
/** An ecosystem entry's admin page, on its own tab. */
const ecoHref = (id: string, type?: string | null) => `/ecosystem?tab=${ECO_TAB[type ?? ''] ?? 'programs'}&open=${id}`;
const entityHref = (cl: Claim): string | null => {
	if (!cl.entity_id) return null;
	if (cl.claim_type === 'company') return `/companies?edit=${cl.entity_id}`;
	if (cl.claim_type === 'investor') return `/ecosystem?tab=investors&edit=${cl.entity_id}`;
	// The claims list doesn't return the ecosystem entry's type (program/event/…); its detail opens by id.
	return ecoHref(cl.entity_id, cl.ecosystem_type);
};
const linkStyle = { color: 'inherit', textDecoration: 'underline', textDecorationColor: 'var(--border)', textUnderlineOffset: 2 } as const;

const TYPE_FILTERS = [
	{ label: 'Companies', value: 'company' },
	{ label: 'Investors', value: 'investor' },
	{ label: 'Ecosystem', value: 'ecosystem_entity' },
];

interface ClaimsResponse { data: Claim[]; total: number; totalPages: number }

export function ClaimsView({ embedded = false }: { embedded?: boolean }) {
	const cols = useTableColumns('claims');
	const ns = 'claim';
	const { mutate } = useSWRConfig();
	const [claimType, setClaimType] = useUrlState(ns, 'type');
	const [page, setPage] = useUrlNumber(ns, 'page', 1);
	const [cpage, setCpage] = useUrlNumber(ns, 'cpage', 1);
	// One sort for both tables (they share the column headers).
	const [sort, setSort] = useUrlState(ns, 'sort', '-sent');
	const [pendingId, setPendingId] = useState<string | null>(null);
	const [sendEmail, setSendEmail] = useState(true);
	// `?open=<id>` expands a claim directly (global search, shared links).
	const [expandedId, setExpandedId] = useEditParam('open');
	const [showCompleted, setShowCompleted] = useState(false);
	const [search, setSearch] = useUrlState(ns, 'q', '', 'q');
	const debouncedSearch = useDebouncedValue(search);

	// Pending (open) and Completed are separate server queries, each with its own pages: one
	// mixed page split in the browser hid older pending claims behind newer completed ones.
	const filters = { claim_type: claimType || undefined, q: debouncedSearch || undefined, sort };
	const activeFilters = (claimType ? 1 : 0) + (search ? 1 : 0);
	/** Change a filter or the sort and go back to the first page of both lists. */
	const f = (set: (v: string) => void) => (v: string) => { set(v); setPage(1); setCpage(1); };
	const clearFilters = () => { setClaimType(''); setSearch(''); setPage(1); setCpage(1); };
	const { data, error, isLoading } = useSWR<ClaimsResponse>(
		['/api/admin/claims', { ...filters, status: 'open', page, limit: 50 }],
		{ dedupingInterval: 30_000 },
	);
	const done = useSWR<ClaimsResponse>(
		['/api/admin/claims', { ...filters, status: 'completed', page: cpage, limit: 50 }],
		{ dedupingInterval: 30_000 },
	);
	const stats = useSWR<QueueStats>(['/api/admin/stats/queues'], { dedupingInterval: 60_000 });
	const c = stats.data?.claims;
	const usersResp = useSWR<{ data: Array<{ id: string; full_name?: string | null; display_name?: string | null; email: string; user_role: string }> }>(
		['/api/admin/users', { role: 'admin', limit: 100 }], { dedupingInterval: 5 * 60_000 });
	const admins = (usersResp.data?.data ?? []).filter((u) => u.user_role === 'admin');

	const claims = data?.data ?? [];

	// Also re-reads each claim's submitted form, so its entries show what verify created.
	const refresh = () => mutate((key) => Array.isArray(key) && (key[0] === '/api/admin/claims' || String(key[0]).startsWith('/api/claims/')));

	const act = async (id: string, fn: () => Promise<unknown>, ok: string) => {
		setPendingId(id);
		try {
			await fn();
			toast.success(ok);
			void refresh();
		} catch (e) {
			toast.error((e as Error).message);
		} finally {
			setPendingId(null);
		}
	};

	const pickup = (id: string) => act(id, () => api('POST', `/api/admin/claims/${id}/pickup`, { picked_up: true }), 'Claim picked up');
	const assign = (id: string, adminId: string) => act(id, () => api('POST', `/api/admin/claims/${id}/pickup`, { picked_up: true, assign_to: adminId }), 'Claim assigned');
	const verify = (id: string) => act(id, () => api('POST', `/api/admin/claims/${id}/verify`, { send_email: sendEmail }), 'Claim verified');
	const reject = (id: string) => {
		const reason = window.prompt('Reason for rejection (optional, up to 500 characters):') ?? undefined;
		if (reason === undefined) return; // cancelled
		if (reason.trim().length > 500) { toast.error(`The reason is ${reason.trim().length} characters — keep it to 500.`); return; }
		void act(id, () => api('POST', `/api/admin/claims/${id}/reject`, { reason }), 'Claim rejected');
	};
	const reopen = (id: string) => act(id, () => api('POST', `/api/admin/claims/${id}/reopen`), 'Claim re-opened');
	const unverify = (id: string) => act(id, () => api('POST', `/api/admin/claims/${id}/unverify`), 'Verification removed');
	const regenerate = (id: string) => act(id, () => api('POST', `/api/admin/claims/${id}/regenerate-report`), 'Report regeneration queued');
	// Manual send of the report-link email (the report job also sends it on its own).
	const sendReport = (cl: Claim) => {
		if (!window.confirm(`Email the report link to ${cl.claimant_email ?? 'the claimant'}?`)) return;
		void act(cl.id, () => api('POST', `/api/admin/claims/${cl.id}/send-report`), 'Report link emailed');
	};
	const toggleActive = (id: string, active: boolean) => act(id, () => api('POST', `/api/admin/claims/${id}/toggle-active`, { active }), active ? 'Marked active' : 'Marked inactive');
	const copyShare = (token: string) => { void navigator.clipboard.writeText(`${window.location.origin}/verified/${token}`); toast.success('Share link copied'); };

	// Old-admin layout: Pending (unverified, not rejected) + Completed.
	const pending = claims;
	const completed = done.data?.data ?? [];

	const claimsHead = (
		<thead>
			<tr>
				<SortableTh label="Claimed" field="name" sort={sort} onSort={f(setSort)} />
				<SortableTh label="Contact" field="contact" sort={sort} onSort={f(setSort)} />
				<SortableTh label="Type" field="type" sort={sort} onSort={f(setSort)} />
				<th style={{ textAlign: 'center' }}>Verified</th>
				<th style={{ textAlign: 'center' }}>Actively raising / investing</th>
				<SortableTh label="Picked Up By" field="picked_up_by" sort={sort} onSort={f(setSort)} />
				<SortableTh label="Sent" field="sent" sort={sort} onSort={f(setSort)} />
				<th style={{ textAlign: 'center' }}>Notify</th>
			</tr>
		</thead>
	);

	const renderRow = (cl: Claim) => (
		<Fragment key={cl.id}>
			<tr>
				<td style={{ minWidth: 170 }}>
					<div style={{ display: 'flex', alignItems: 'flex-start', gap: 4 }}>
						<button className="btn ghost" style={{ padding: '2px 4px' }} onClick={() => setExpandedId(expandedId === cl.id ? null : cl.id)} aria-label="Toggle details">
							{expandedId === cl.id ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
						</button>
						<div style={{ minWidth: 0 }}>
							<div style={{ fontWeight: 600, fontSize: 12 }}>
								{entityHref(cl) ? <Link href={entityHref(cl)!} style={linkStyle} title="Open the record">{cl.entity_name ?? 'Unnamed record'}</Link> : (cl.entity_name ?? '—')}
							</div>
							{cl.target_website_snapshot && (
								<a href={cl.target_website_snapshot.startsWith('http') ? cl.target_website_snapshot : `https://${cl.target_website_snapshot}`} target="_blank" rel="noopener noreferrer"
									style={{ fontSize: 11, color: 'var(--accent)', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
									{cl.target_website_snapshot}<ExternalLink size={10} />
								</a>
							)}
						</div>
					</div>
				</td>
				<td style={{ fontSize: 12 }}>
					{cl.claimant_name && <div>{cl.profile_id ? <Link href={`/users/${cl.profile_id}`} style={linkStyle} title="Open the user">{cl.claimant_name}</Link> : cl.claimant_name}</div>}
					<div style={{ color: 'var(--fg-muted)' }}>{cl.profile_id && !cl.claimant_name && cl.claimant_email ? <Link href={`/users/${cl.profile_id}`} style={linkStyle} title="Open the user">{cl.claimant_email}</Link> : (cl.claimant_email ?? cl.company_email ?? '—')}</div>
					{cl.position_at_company && <div style={{ color: 'var(--fg-muted)' }}>{cl.position_at_company}</div>}
				</td>
				<td>
					<div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
						<span className="tag">{claimTypeLabel(cl.claim_type)}</span>
						{cl.new_entry_request && <span className="tag warn">New Entry</span>}
						{(cl.entity_verified_count ?? 0) > 0 && (
							<span className="tag" title={`${cl.entity_verified_count} other ${cl.entity_verified_count === 1 ? 'person is' : 'people are'} already verified for this entity — verifying this one adds another.`}>
								+{cl.entity_verified_count} verified
							</span>
						)}
						{(cl.entity_pending_count ?? 0) > 0 && (
							<span className="tag" style={{ opacity: 0.8 }} title={`${cl.entity_pending_count} other pending ${cl.entity_pending_count === 1 ? 'claim' : 'claims'} for this entity`}>
								+{cl.entity_pending_count} pending
							</span>
						)}
					</div>
				</td>
				<td style={{ textAlign: 'center' }}>
					<button className={`tg ${cl.is_verified ? 'on' : ''}`} disabled={pendingId === cl.id || (!!cl.new_entry_request && !cl.entity_id)}
						title={cl.new_entry_request && !cl.entity_id ? 'Create the entity first before verifying' : (cl.is_verified ? 'Un-verify' : 'Verify')}
						onClick={() => (cl.is_verified ? void unverify(cl.id) : void verify(cl.id))}>
						<span className="tg-knob" />
					</button>
				</td>
				<td style={{ textAlign: 'center' }}>
					{cl.entity_id && (cl.claim_type === 'company' || cl.claim_type === 'investor') ? (
						<button className={`tg ${cl.is_actively_raising ? 'on' : ''}`} disabled={pendingId === cl.id}
							title={activeFlagLabel(cl.claim_type)}
							onClick={() => void toggleActive(cl.id, !cl.is_actively_raising)}>
							<span className="tg-knob" />
						</button>
					) : <span style={{ color: 'var(--fg-muted)' }}>—</span>}
				</td>
				<td style={{ fontSize: 12 }}>
					{cl.picked_up_by_email ? <span style={{ color: 'var(--pos)' }}>{cl.picked_up_by_email}</span> : <span style={{ color: 'var(--fg-muted)' }}>—</span>}
				</td>
				<td className="num" style={{ fontSize: 12, color: 'var(--fg-muted)' }}>{new Date(cl.created_at).toLocaleDateString()}</td>
				<td style={{ textAlign: 'center' }}>
					{cl.is_verified ? <MailCheck size={15} style={{ color: 'var(--pos)' }} /> : <Mail size={15} style={{ color: 'var(--fg-muted)' }} />}
				</td>
			</tr>
			{expandedId === cl.id && (
				<tr>
					<td colSpan={8} style={{ background: 'var(--bg-2)' }}>
						<div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, padding: '4px 4px 10px', fontSize: 12 }}>
							<div><div className="co-stat-label">Claim type</div>{claimTypeLabel(cl.claim_type)} · {claimStatusLabel(cl.status)}</div>
							<div><div className="co-stat-label">Claimed</div>{entityHref(cl) ? <Link href={entityHref(cl)!} style={{ color: 'var(--accent)' }}>{cl.entity_name ?? 'Unnamed record'} ↗</Link> : (cl.entity_name ?? '—')}</div>
							<div><div className="co-stat-label">Position</div>{cl.position_at_company ?? '—'}</div>
							<div><div className="co-stat-label">Claimant</div>{cl.profile_id ? <Link href={`/users/${cl.profile_id}`} style={{ color: 'var(--accent)' }}>{cl.claimant_name ?? cl.claimant_email ?? 'Open user'} ↗</Link> : (cl.claimant_name ?? '—')}</div>
							<div><div className="co-stat-label">Claimant email</div>{cl.claimant_email ?? '—'}</div>
							<div><div className="co-stat-label">Company email</div>{cl.company_email ?? '—'}</div>
							<div><div className="co-stat-label">Submitted</div>{new Date(cl.created_at).toLocaleString()}</div>
							<div><div className="co-stat-label">Picked up</div>{cl.picked_up_at ? new Date(cl.picked_up_at).toLocaleString() : '—'}</div>
							<div><div className="co-stat-label">Verified</div>{cl.verified_at ? new Date(cl.verified_at).toLocaleString() : '—'}</div>
							{cl.rejection_reason && <div style={{ gridColumn: '1 / -1' }}><div className="co-stat-label">Rejection reason</div>{cl.rejection_reason}</div>}
						</div>
						<div style={{ padding: '0 4px 10px', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
							{cl.status === 'pending' && <button className="btn ghost" disabled={pendingId === cl.id} onClick={() => void pickup(cl.id)}>Pick up</button>}
							{(cl.status === 'pending' || cl.status === 'picked_up') && admins.length > 0 && (
								<Select value="" onChange={(v) => { if (v) void assign(cl.id, v); }} disabled={pendingId === cl.id} searchable width={160} ariaLabel="Assign claim to admin" placeholder="Assign to…" options={[{ value: '', label: 'Assign to…' }, ...admins.map((a) => ({ value: a.id, label: a.full_name || a.display_name || a.email }))]} />
							)}
							{cl.status !== 'rejected' && <button className="btn ghost" style={{ color: 'var(--accent)' }} disabled={pendingId === cl.id} onClick={() => reject(cl.id)}>Reject</button>}
							{cl.status === 'rejected' && <button className="btn ghost" disabled={pendingId === cl.id} onClick={() => void reopen(cl.id)}>Re-open</button>}
							{cl.status === 'verified' && (
								<>
									{cl.shareable_token && <button className="btn ghost" disabled={pendingId === cl.id} onClick={() => copyShare(cl.shareable_token!)} title="Copy verified share link">Copy link</button>}
									{cl.report_id && cl.report_status === 'ready' && (
										<a className="btn ghost" style={{ color: 'var(--pos)', display: 'inline-flex', alignItems: 'center', gap: 4 }}
											href={`${ATLAS_BASE}/verified-reports/${cl.report_id}`} target="_blank" rel="noopener noreferrer"
											title="Open the verified-company (Locker Room) report in Atlas">View report <ExternalLink size={10} /></a>
									)}
									{cl.report_id && cl.report_status === 'ready' && (
										<button className="btn ghost" disabled={pendingId === cl.id} onClick={() => sendReport(cl)} title="Email the claimant the link to this report">Email report</button>
									)}
									{cl.report_status === 'pending' && <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>Report generating…</span>}
									{cl.report_status === 'error' && <span style={{ fontSize: 11, color: 'var(--accent)' }}>Report failed — regenerate</span>}
									<button className="btn ghost" disabled={pendingId === cl.id} onClick={() => void regenerate(cl.id)} title="Re-run the verified-company report">Regenerate report</button>
								</>
							)}
							<span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>Use the Verified toggle to verify / un-verify (emails the claimant if enabled).</span>
						</div>
						{cl.claim_type === 'company' && <DeckAnalysisPanel claimId={cl.id} />}
						{(cl.claim_type === 'company' || cl.claim_type === 'investor') && <SubmittedEntries claimId={cl.id} verified={cl.is_verified} />}
						{cl.new_entry_request && !cl.entity_id && <CreateEntityPanel claim={cl} onDone={() => void refresh()} />}
					</td>
				</tr>
			)}
		</Fragment>
	);

	return (
		<div ref={cols.ref}>
			{!embedded && <PageHeader kicker={`Queues · ${((data?.total ?? 0) + (done.data?.total ?? 0)).toLocaleString()} claims`} title="Claims" />}

			{!embedded && (
				<StatsPanel>
					<StatStrip cols={4}>
						<StatCard label="Pending" loading={stats.isLoading} value={(c?.pending ?? 0).toLocaleString()} urgent={(c?.pending ?? 0) > 0} />
						<StatCard label="Picked up" loading={stats.isLoading} value={(c?.picked_up ?? 0).toLocaleString()} />
						<StatCard label="Verified" loading={stats.isLoading} value={(c?.verified ?? 0).toLocaleString()} />
						<StatCard label="Rejected" loading={stats.isLoading} value={(c?.rejected ?? 0).toLocaleString()} />
					</StatStrip>
				</StatsPanel>
			)}

			{!embedded && (
				<Section title="Claim funnel" meta="pending → verified">
					<Funnel stages={[
						{ label: 'Pending', value: c?.pending ?? 0 },
						{ label: 'Picked up', value: c?.picked_up ?? 0 },
						{ label: 'Verified', value: c?.verified ?? 0, color: 'var(--pos)' },
						{ label: 'Rejected', value: c?.rejected ?? 0, color: 'var(--neg)' },
					]} />
				</Section>
			)}

			<div style={{ height: 'var(--space-4)' }} />

			<FilterBar>
				<input className="search-input" style={{ flex: '0 0 260px', height: 32 }} placeholder="Search company / claimant…" aria-label="Search claims" value={search} onChange={(e) => f(setSearch)(e.target.value)} />
				<FilterSelect ariaLabel="Claim type" value={claimType} onChange={f(setClaimType)} options={TYPE_FILTERS} allLabel="All types" />
				{activeFilters > 0 && <button className="btn ghost" onClick={clearFilters}>Clear {activeFilters} filter{activeFilters === 1 ? '' : 's'}</button>}
				<div style={{ flex: 1 }} />
				<label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, color: 'var(--fg-2)' }}>
					<input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} /> Send email on verify
				</label>
			</FilterBar>
			<div style={{ fontSize: 12, color: 'var(--fg-muted)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
				<span style={{ marginLeft: 'auto', order: 2 }}>{cols.menu}</span>
				{data && done.data ? `${(data.total + done.data.total).toLocaleString()} claim${data.total + done.data.total === 1 ? '' : 's'}${activeFilters ? ' match these filters' : ''}` : 'Loading…'} · click a column header to sort
			</div>


			<div style={{ marginBottom: 'var(--space-4)' }}>
				<div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
					Pending <span className="tag">{(data?.total ?? 0).toLocaleString()}</span>
				</div>
				<div className="card" style={{ padding: 0, maxHeight: 420, overflow: 'auto' }}>
					<AsyncState loading={isLoading} error={error} empty={pending.length === 0} emptyMsg={activeFilters ? 'No pending claims match these filters.' : 'No pending claims'} onRetry={() => void refresh()}>
						<table className="data-table">
							{claimsHead}
							<tbody>{pending.map(renderRow)}</tbody>
						</table>
					</AsyncState>
				</div>
				<Pager page={page} totalPages={data?.totalPages} onPage={setPage} />
			</div>

			{(done.data?.total ?? 0) > 0 && (
				<div style={{ marginBottom: 'var(--space-4)' }}>
					<button className="btn ghost" style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, padding: '2px 4px', display: 'inline-flex', alignItems: 'center', gap: 8 }} onClick={() => setShowCompleted((v) => !v)}>
						{showCompleted ? <ChevronDown size={14} /> : <ChevronRight size={14} />} Completed <span className="tag">{(done.data?.total ?? 0).toLocaleString()}</span>
					</button>
					{showCompleted && (
						<>
							<div className="card" style={{ padding: 0, maxHeight: 360, overflow: 'auto' }}>
								<table className="data-table">
									{claimsHead}
									<tbody>{completed.map(renderRow)}</tbody>
								</table>
							</div>
							<Pager page={cpage} totalPages={done.data?.totalPages} onPage={setCpage} />
						</>
					)}
				</div>
			)}
		</div>
	);
}

interface DeckAnalysis {
	status: string;
	error: string | null;
	stage: string | null;
	raise_amount_usd: string | null;
	traction_summary: string | null;
	team_summary: string | null;
	market_summary: string | null;
	business_model: string | null;
	strengths: unknown;
	risks: unknown;
	overall_score: number | null;
	score_rationale: string | null;
	market_context: string | null;
	analyzed_at: string | null;
}

/**
 * Pitch-deck analysis panel for a company claim. Shows an "Analyze deck" button
 * (admin-triggered) and renders Claude's extracted fields + score once ready.
 * Renders nothing if the claim has no deck.
 */
type Row = Record<string, unknown>;
const str = (v: unknown) => (v == null || v === '' ? '' : String(v));

/**
 * Where a submitted company / investor stands: an Atlas record (picked from
 * search), one the claimant ADDED because search didn't find it — unverified,
 * shown with its details, created as a live record when this claim is verified
 * (or linked to an existing one with the same website) — or plain text from an
 * older claim.
 */
function EntryBadge({ id, details }: { id: unknown; details: unknown }) {
	if (id && details) return <span className="tag pos" title="Added by the claimant; created when the claim was verified">Added by user · created</span>;
	if (details && (details as Row).materialized_at) return <span className="tag neg" title="Created on verify, then the record was deleted — it won't be recreated">Added by user · record deleted</span>;
	if (id) return <span className="tag pos">In Atlas</span>;
	if (details) return <span className="tag warn" title="Not in Atlas yet — created when you verify this claim">Added by user · unverified</span>;
	return <span className="tag">Text only</span>;
}
function EntryDetails({ id, details }: { id: unknown; details: unknown }) {
	if (id || !details || typeof details !== 'object') return null;
	const d = details as Row;
	const parts = [str(d.website), [str(d.hq_city), str(d.hq_country)].filter(Boolean).join(', '), d.category ? investorCategoryLabel(str(d.category)) : '', str(d.founded_year) && `founded ${str(d.founded_year)}`].filter(Boolean);
	return (
		<div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 2 }}>
			{parts.join(' · ')}{d.description ? <> — {str(d.description)}</> : null}
		</div>
	);
}

/** Funding rounds, M&A and portfolio from the claim, with each company / investor's status. */
function SubmittedEntries({ claimId, verified }: { claimId: string; verified: boolean }) {
	const { data } = useSWR<{ company?: { details?: { programs?: Row[] | null } | null; funding_rounds?: Row[]; mna?: Row[] }; investor?: { portfolio?: Row[] } }>([`/api/claims/${claimId}/form`], { revalidateOnFocus: false });
	const rounds = data?.company?.funding_rounds ?? [];
	const mna = data?.company?.mna ?? [];
	const portfolio = data?.investor?.portfolio ?? [];
	const programs = Array.isArray(data?.company?.details?.programs) ? data!.company!.details!.programs! : [];
	if (!rounds.length && !mna.length && !portfolio.length && !programs.length) return null;
	const waiting = (id: unknown, details: unknown) => !id && !!details && !(details as Row).materialized_at;
	const pending = [
		...rounds.flatMap((r) => (Array.isArray(r.investor_refs) ? (r.investor_refs as Row[]) : []).filter((x) => waiting(x.investor_id, { ...(x.new_investor as Row ?? {}), materialized_at: x.materialized_at }) && x.new_investor)),
		...mna.filter((m) => waiting(m.counterparty_company_id, m.new_counterparty)),
		...portfolio.filter((p) => waiting(p.company_id, p.new_company)),
		...programs.filter((p) => waiting(p.program_id, p.new_program && { ...(p.new_program as Row), materialized_at: p.materialized_at })),
	].length;
	const line = { padding: '6px 0', borderTop: '1px solid var(--border)', fontSize: 12 } as const;
	const head = (t: string) => <div className="co-stat-label" style={{ margin: '10px 0 4px' }}>{t}</div>;
	return (
		<div style={{ padding: '4px 4px 12px' }}>
			{pending > 0 && (verified ? (
				<div style={{ fontSize: 12, color: 'var(--accent)', marginBottom: 6 }}>
					<strong>{pending}</strong> user-added {pending === 1 ? "entry wasn't" : "entries weren't"} created when this claim was verified (see the server log) — add them by hand in Companies / Investors, or re-verify the claim to retry.
				</div>
			) : (
				<div style={{ fontSize: 12, color: 'var(--fg-muted)', marginBottom: 6 }}>
					<strong>{pending}</strong> {pending === 1 ? 'entry was' : 'entries were'} added by the claimant and {pending === 1 ? "isn't" : "aren't"} in Atlas yet. Verifying this claim creates {pending === 1 ? 'it as a live (unclaimed) record' : 'them as live (unclaimed) records'} — or links an existing record with the same website.
				</div>
			))}
			{rounds.length > 0 && <>
				{head('Funding rounds')}
				{rounds.map((r, i) => {
					const refs = Array.isArray(r.investor_refs) ? (r.investor_refs as Row[]) : [];
					return (
						<div key={i} style={line}>
							<div>{[str(r.round_label), r.amount_usd ? `$${Number(r.amount_usd).toLocaleString()}` : '', str(r.round_date)].filter(Boolean).join(' · ') || 'Round'}</div>
							{refs.length ? refs.map((x, k) => (
								<div key={k} style={{ marginTop: 4, paddingLeft: 10 }}>
									<span style={{ marginRight: 6 }}>{str(x.name)}</span><EntryBadge id={x.investor_id} details={x.new_investor && { ...(x.new_investor as Row), materialized_at: x.materialized_at }} />
									<EntryDetails id={x.investor_id} details={x.new_investor} />
								</div>
							)) : r.investors ? <div style={{ marginTop: 4, paddingLeft: 10 }}>{str(r.investors)} <span className="tag">Text only</span></div> : null}
						</div>
					);
				})}
			</>}
			{mna.length > 0 && <>
				{head('M&A')}
				{mna.map((m, i) => (
					<div key={i} style={line}>
						<span style={{ marginRight: 6 }}>{[m.deal_type ? tidy(str(m.deal_type)) : '', str(m.counterparty)].filter(Boolean).join(' — ')}</span><EntryBadge id={m.counterparty_company_id} details={m.new_counterparty} />
						<EntryDetails id={m.counterparty_company_id} details={m.new_counterparty} />
					</div>
				))}
			</>}
			{programs.length > 0 && <>
				{head('Program participation')}
				{programs.map((p, i) => (
					<div key={i} style={line}>
						<span style={{ marginRight: 6 }}>{[str(p.name), str(p.cohort_year)].filter(Boolean).join(' · ')}</span>
						{/* Linked to the company when the claim is verified (added ones are created first). */}
						<EntryBadge id={p.program_id} details={p.new_program && { ...(p.new_program as Row), materialized_at: p.materialized_at }} />
						<EntryDetails id={p.program_id} details={p.new_program} />
					</div>
				))}
			</>}
			{portfolio.length > 0 && <>
				{head('Portfolio')}
				{portfolio.map((p, i) => (
					<div key={i} style={line}>
						<span style={{ marginRight: 6 }}>{[str(p.company_name), str(p.stage), str(p.invest_year)].filter(Boolean).join(' · ')}</span><EntryBadge id={p.company_id} details={p.new_company} />
						<EntryDetails id={p.company_id} details={p.new_company} />
					</div>
				))}
			</>}
		</div>
	);
}

function DeckAnalysisPanel({ claimId }: { claimId: string }) {
	const { data, mutate, isLoading } = useSWR<{ hasDeck: boolean; analysis: DeckAnalysis | null }>(
		[`/api/admin/claims/${claimId}/deck-analysis`],
		{
			refreshInterval: (d) => {
				const s = d?.analysis?.status;
				return s === 'pending' || s === 'processing' ? 5000 : 0;
			},
		},
	);
	const [busy, setBusy] = useState(false);

	if (isLoading || !data || !data.hasDeck) return null;
	const a = data.analysis;
	const running = a?.status === 'pending' || a?.status === 'processing';
	const strengths = Array.isArray(a?.strengths) ? (a!.strengths as string[]) : [];
	const risks = Array.isArray(a?.risks) ? (a!.risks as string[]) : [];

	const analyze = async () => {
		setBusy(true);
		try {
			await api('POST', `/api/admin/claims/${claimId}/analyze-deck`);
			await mutate();
		} catch (e) {
			toast.error((e as Error).message);
		} finally {
			setBusy(false);
		}
	};

	return (
		<div style={{ padding: '0 4px 12px' }}>
			<div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
				<div className="co-stat-label" style={{ flex: 1 }}>Pitch deck analysis</div>
				<button className="btn ghost" disabled={busy || running} onClick={() => void analyze()}>
					{running ? 'Analyzing…' : a?.status === 'done' ? 'Re-analyze' : 'Analyze deck'}
				</button>
			</div>
			{!a && <div style={{ fontSize: 12, color: 'var(--fg-muted)' }}>Not analyzed yet.</div>}
			{running && <div style={{ fontSize: 12, color: 'var(--fg-muted)' }}>Analysis in progress…</div>}
			{a?.status === 'failed' && <div style={{ fontSize: 12, color: 'var(--neg)' }}>Failed: {a.error ?? 'unknown error'}</div>}
			{a?.status === 'unsupported' && <div style={{ fontSize: 12, color: 'var(--neg)' }}>{a.error ?? 'Unsupported deck format.'}</div>}
			{a?.status === 'done' && (
				<div style={{ display: 'grid', gap: 10, fontSize: 12 }}>
					<div style={{ display: 'flex', gap: 16, alignItems: 'baseline' }}>
						{a.overall_score != null && (
							<div style={{ fontSize: 22, fontWeight: 700 }}>
								{a.overall_score}<span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>/100</span>
							</div>
						)}
						<div style={{ color: 'var(--fg-2)' }}>{a.score_rationale}</div>
					</div>
					<div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
						<div><div className="co-stat-label">Stage</div>{a.stage ?? '—'}</div>
						<div><div className="co-stat-label">Raising</div>{a.raise_amount_usd ? `$${Number(a.raise_amount_usd).toLocaleString()}` : '—'}</div>
						<div><div className="co-stat-label">Business model</div>{a.business_model ? businessModelLabel(a.business_model) : '—'}</div>
						<div><div className="co-stat-label">Team</div>{a.team_summary ?? '—'}</div>
						<div style={{ gridColumn: '1 / -1' }}><div className="co-stat-label">Traction</div>{a.traction_summary ?? '—'}</div>
						<div style={{ gridColumn: '1 / -1' }}><div className="co-stat-label">Market</div>{a.market_summary ?? '—'}</div>
					</div>
					{strengths.length > 0 && (
						<div><div className="co-stat-label">Strengths</div><ul style={{ margin: '4px 0 0 16px' }}>{strengths.map((s, i) => <li key={i}>{s}</li>)}</ul></div>
					)}
					{risks.length > 0 && (
						<div><div className="co-stat-label">Risks</div><ul style={{ margin: '4px 0 0 16px' }}>{risks.map((s, i) => <li key={i}>{s}</li>)}</ul></div>
					)}
					{a.market_context && <div><div className="co-stat-label">Market context</div>{a.market_context}</div>}
				</div>
			)}
		</div>
	);
}

// d2c/b2g/other dropped - unused across all records (verified) and not wanted.
const BUSINESS_MODELS = ['b2b', 'b2c', 'b2b2c'] as const;
const INVESTOR_CATEGORIES = ['venture_capital', 'private_equity', 'financial_services', 'family_investment_office', 'sovereign_wealth_fund', 'angel', 'other'] as const;
const ECOSYSTEM_TYPES = ['program', 'event', 'organization', 'initiative'] as const;

interface ClaimDetails {
	description?: string | null; sector_id?: string | null; business_model?: string | null;
	founded_year?: number | null; year_launched?: number | null; category?: string | null;
	entity_type?: string | null; op_type?: string | null;
	hq_city?: string | null; hq_country?: string | null; location?: string | null; country?: string | null;
	applications_open?: boolean | null; next_intake?: string | null; key_date?: string | null; offer?: string | null;
}
interface ClaimFormResp {
	company?: { details?: ClaimDetails | null };
	investor?: { details?: ClaimDetails | null };
	entity?: { details?: ClaimDetails | null };
}

/**
 * Edit-then-create panel for a NEW-entity claim. Everything the founder already
 * filled in (sector, HQ, founded year, description, …) is prefilled from the
 * claim's submitted details via `GET /api/claims/:id/form` — the admin reviews
 * and clicks Create, which makes the live record, links it, and verifies in one
 * call. (The admin can still edit anything before creating.)
 */
function CreateEntityPanel({ claim, onDone }: { claim: Claim; onDone: () => void }) {
	const kind = claim.claim_type; // 'company' | 'investor' | 'ecosystem_entity'
	const [name, setName] = useState(claim.entity_name ?? '');
	const [website, setWebsite] = useState(claim.target_website_snapshot ?? '');
	const [description, setDescription] = useState('');
	const [sectorId, setSectorId] = useState('');
	const [businessModel, setBusinessModel] = useState('');
	const [category, setCategory] = useState('');
	const [entityType, setEntityType] = useState('program');
	const [year, setYear] = useState('');
	const [hq, setHq] = useState<LocationValue>({ ...EMPTY_LOCATION });
	const [pending, setPending] = useState(false);
	// Set when Create is refused because the record already exists (same website).
	const [dupOf, setDupOf] = useState<string | null>(null);

	// Prefill from what the founder submitted. Owner-or-admin endpoint; cheap and
	// only fetched once the row is expanded (this panel mounts there).
	const { data: form } = useSWR<ClaimFormResp>([`/api/claims/${claim.id}/form`], { revalidateOnFocus: false });
	const seeded = useRef(false);
	// LocationFields seeds its city search box from value.city on mount only, so a
	// remount (bumped key) is how the prefilled city shows up after the fetch.
	const [locKey, setLocKey] = useState(0);
	useEffect(() => {
		if (seeded.current || !form) return;
		const d = form.company?.details ?? form.investor?.details ?? form.entity?.details;
		if (!d) return;
		seeded.current = true;
		if (d.description) setDescription(d.description);
		const city = d.hq_city ?? d.location ?? '';
		const country = d.hq_country ?? d.country ?? '';
		if (city || country) { setHq((h) => ({ ...h, city: city || h.city, country: country || h.country })); setLocKey((k) => k + 1); }
		if (kind === 'company') {
			if (d.sector_id) setSectorId(d.sector_id);
			if (d.business_model) setBusinessModel(d.business_model);
			if (d.founded_year != null) setYear(String(d.founded_year));
		} else if (kind === 'investor') {
			if (d.category) setCategory(d.category);
			if (d.year_launched != null) setYear(String(d.year_launched));
		} else {
			if (d.entity_type) setEntityType(d.entity_type);
			if (d.op_type) setCategory(d.op_type);
			if (d.founded_year != null) setYear(String(d.founded_year));
		}
	}, [form, kind]);

	const submit = async () => {
		if (!name.trim()) { toast.error('Name is required.'); return; }
		setPending(true);
		try {
			const body: Record<string, unknown> = {
				name: name.trim(),
				website: website.trim() || undefined,
				description: description.trim() || undefined,
				hq_country: hq.country.trim() || undefined,
				hq_city: hq.city.trim() || undefined,
				hq_continent: hq.continent.trim() || undefined,
				hq_region: hq.region.trim() || undefined,
				hq_state: hq.state.trim() || undefined,
			};
			if (kind === 'company') {
				if (sectorId) body.sector_id = sectorId;
				if (businessModel) body.business_model = businessModel;
				if (year) body.founded_year = Number(year);
			} else if (kind === 'investor') {
				if (category) body.category = category;
				if (year) body.year_launched = Number(year);
			} else {
				body.entity_type = entityType;
				if (category) body.category = category;
				if (year) body.founded_year = Number(year);
			}
			await api('POST', `/api/admin/claims/${claim.id}/create-entity`, body);
			toast.success('Record created, linked & verified');
			onDone();
		} catch (e) {
			const msg = (e as Error).message;
			// The record already exists (same website) — offer to link instead of create.
			if (/already exists/i.test(msg)) setDupOf(msg);
			toast.error(msg);
		} finally {
			setPending(false);
		}
	};
	// Attach this "add new" claim to the existing record (several people may be
	// verified for one entity). Verifying stays a separate step on the claim row.
	const linkExisting = async () => {
		setPending(true);
		try {
			await api('POST', `/api/admin/claims/${claim.id}/link`, { website: website.trim() });
			toast.success('Linked to the existing record — verify the claim when ready');
			onDone();
		} catch (e) { toast.error((e as Error).message); }
		finally { setPending(false); }
	};

	const L = (label: string, node: React.ReactNode) => (
		<div><div className="co-stat-label" style={{ marginBottom: 4 }}>{label}</div>{node}</div>
	);

	return (
		<div style={{ padding: '4px 4px 12px', display: 'grid', gap: 10 }}>
			<div style={{ fontSize: 12, color: 'var(--fg-muted)' }}>
				This is a <strong>new {claimTypeLabel(kind).toLowerCase()}</strong> request — review &amp; edit, then create it as a live record.
			</div>
			<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
				{L('Name', <input className="search-input" value={name} onChange={(e) => setName(e.target.value)} />)}
				{L('Website', <input className="search-input" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://" />)}
			</div>
			{L('Description', <textarea className="search-input" style={{ minHeight: 56, resize: 'vertical' }} value={description} onChange={(e) => setDescription(e.target.value)} />)}
			<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
				{kind === 'company' && L('Sector', <SectorCascade value={sectorId} onChange={setSectorId} />)}
				{kind === 'company' && L('Business model', (
					<Select value={businessModel} onChange={setBusinessModel} width="100%" style={{ display: 'block', width: '100%' }} placeholder="—" options={[{ value: '', label: '—' }, ...BUSINESS_MODELS.map((m) => ({ value: m, label: businessModelLabel(m) }))]} />
				))}
				{kind === 'investor' && L('Category', (
					<Select value={category} onChange={setCategory} width="100%" style={{ display: 'block', width: '100%' }} placeholder="—" options={[{ value: '', label: '—' }, ...INVESTOR_CATEGORIES.map((c) => ({ value: c, label: investorCategoryLabel(c) }))]} />
				))}
				{kind === 'ecosystem_entity' && L('Type', (
					<Select value={entityType} onChange={setEntityType} width="100%" style={{ display: 'block', width: '100%' }} options={ECOSYSTEM_TYPES.map((t) => ({ value: t, label: entityTypeLabel(t) }))} />
				))}
				{kind === 'ecosystem_entity' && L('Category', <input className="search-input" value={category} onChange={(e) => setCategory(e.target.value)} />)}
				{L(kind === 'investor' ? 'Year launched' : 'Founded year', <YearSelect value={year} onChange={setYear} />)}
			</div>
			{L('Headquarters', <LocationFields key={locKey} value={hq} onChange={setHq} />)}
			{kind === 'ecosystem_entity' && (() => {
				// The operator's intake answers, copied onto the program (or event start date) on create.
				const d = form?.entity?.details;
				const parts = [d?.applications_open != null && `Applications ${d.applications_open ? 'open' : 'closed'}`, d?.next_intake && `Next intake: ${d.next_intake}`, d?.key_date && `Key date: ${d.key_date}`, d?.offer && `Offer: ${d.offer}`].filter(Boolean);
				return parts.length ? (
					<div style={{ fontSize: 12, color: 'var(--fg-muted)' }}>
						Carried over {entityType === 'program' ? 'to the program details' : entityType === 'event' ? '(key date → event start date)' : '— only for a program or event'}: {parts.join(' · ')}
					</div>
				) : null;
			})()}
			{dupOf && (
				<div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg-2)', fontSize: 12 }}>
					<span style={{ flex: 1 }}>{dupOf}</span>
					<button className="btn" disabled={pending || !website.trim()} onClick={() => void linkExisting()}>Link to existing</button>
				</div>
			)}
			<div style={{ display: 'flex', justifyContent: 'flex-end' }}>
				<button className="btn" disabled={pending || !name.trim()} onClick={() => void submit()}>
					{pending ? 'Creating…' : `Create & verify ${claimTypeLabel(kind).toLowerCase()}`}
				</button>
			</div>
		</div>
	);
}

