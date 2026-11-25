'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';
import { Check, Coins, ExternalLink, RefreshCw, RotateCcw, Wrench, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useConfirm } from '@/components/confirm';
import { Modal } from '@/components/modal';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useUrlState, useUrlNumber } from '@/hooks/use-url-state';
import { PageHeader, AsyncState, SortableTh, Pager, Chip } from '@/components/atoms';
import { DateRangeFilter, FilterBar, FilterSelect, fmtListDate } from '@/components/filters';
import { useTableColumns } from '@/hooks/use-table-columns';
import { useRowSelection, SelectionBar, runBulk } from '@/components/row-selection';
import { feedbackKindLabel, feedbackSeverityLabel, feedbackStatusLabel } from '@/lib/labels';

interface Feedback {
	id: string;
	profile_id: string | null;
	reporter_email: string | null;
	reporter_name: string | null;
	kind: string;
	severity: string | null;
	title: string;
	description: string;
	steps: string | null;
	page_url: string | null;
	page_title: string | null;
	screenshots: string[];
	context: Record<string, string>;
	status: 'new' | 'verified' | 'fixed' | 'discarded';
	admin_note: string | null;
	reviewed_by_name: string | null;
	reviewed_at: string | null;
	credits_granted: number;
	credited_by_name: string | null;
	credited_at: string | null;
	created_at: string;
	screenshot_urls?: (string | null)[];
}
interface Resp { data: Feedback[]; total: number; totalPages: number; counts: Record<string, number>; default_credits: number }

const KINDS = ['bug', 'feedback', 'feature_request', 'enhancement'];
const STATUS_TABS: [string, string][] = [['new', 'New'], ['verified', 'Approved'], ['fixed', 'Fixed'], ['discarded', 'Discarded'], ['', 'All']];
const statusTag: Record<string, string> = { new: 'warn', verified: 'pos', fixed: 'pos', discarded: '' };
const ATLAS = process.env.NEXT_PUBLIC_ATLAS_URL ?? 'https://www.atlas.sportstechx.com';
const when = (s: string | null) => (s ? new Date(s).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—');

export default function FeedbackPage() {
	const cols = useTableColumns('feedback');
	const ask = useConfirm();
	const [status, setStatus] = useUrlState('fb', 'status', 'new');
	const [kind, setKind] = useUrlState('fb', 'kind');
	const [search, setSearch] = useUrlState('fb', 'q');
	const [from, setFrom] = useUrlState('fb', 'from');
	const [to, setTo] = useUrlState('fb', 'to');
	const [sort, setSort] = useUrlState('fb', 'sort', '-created');
	const [page, setPage] = useUrlNumber('fb', 'page', 1);
	const [openId, setOpenId] = useState<string | null>(null);
	const [busy, setBusy] = useState<string | null>(null);
	const q = useDebouncedValue(search);
	const f = (set: (v: string) => void) => (v: string) => { set(v); setPage(1); };
	const activeFilters = (kind ? 1 : 0) + (search ? 1 : 0) + (from || to ? 1 : 0);
	const clear = () => { setKind(''); setSearch(''); setFrom(''); setTo(''); setPage(1); };

	const { data, error, isLoading, mutate } = useSWR<Resp>(
		['/api/admin/feedback', { status: status || undefined, kind: kind || undefined, q: q || undefined, from: from || undefined, to: to || undefined, sort, page, limit: 50 }],
		{ dedupingInterval: 10_000 },
	);
	const rows = data?.data ?? [];
	const counts = data?.counts ?? {};
	const allCount = Object.values(counts).reduce((a, b) => a + b, 0);
	const defaultCredits = data?.default_credits ?? 50;
	const sel = useRowSelection(rows.map((r) => r.id));

	const setStatusFor = async (id: string, next: Feedback['status']) => {
		setBusy(id);
		try { await api('PATCH', `/api/admin/feedback/${id}`, { status: next }); toast.success(feedbackStatusLabel(next)); void mutate(); }
		catch (e) { toast.error((e as Error).message); }
		finally { setBusy(null); }
	};
	const credit = async (r: Feedback, credits: number) => {
		if (!(await ask(`Give ${credits} STX credits to ${r.reporter_name || r.reporter_email || 'this user'}? They are free and don’t expire.`))) return false;
		setBusy(r.id);
		try {
			await api('POST', `/api/admin/feedback/${r.id}/credits`, { credits });
			toast.success(`${credits} credits given`);
			void mutate();
			return true;
		} catch (e) { toast.error((e as Error).message); return false; }
		finally { setBusy(null); }
	};
	const bulkStatus = async (next: Feedback['status']) => {
		if (!(await ask(`Mark ${sel.size} report${sel.size === 1 ? '' : 's'} ${feedbackStatusLabel(next).toLowerCase()}?`))) return;
		await runBulk(sel.ids, (id) => api('PATCH', `/api/admin/feedback/${id}`, { status: next }), feedbackStatusLabel(next));
		sel.clear(); void mutate();
	};

	return (
		<div>
			<PageHeader
				kicker="Review queue"
				title="Feedback"
				subtitle="Bugs, feedback and requests sent from Atlas. Approve a real bug, give the reporter STX credits, and keep the report until it's fixed. Nothing here is ever deleted."
				action={<button className="btn ghost" onClick={() => void mutate()}><RefreshCw size={12} /> Refresh</button>}
			/>

			<div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
				{STATUS_TABS.map(([v, label]) => (
					<Chip key={label} active={status === v} count={v ? counts[v] ?? 0 : allCount} onClick={() => f(setStatus)(v)}>{label}</Chip>
				))}
			</div>

			<FilterBar>
				<input className="search-input" style={{ flex: '0 0 280px', height: 32 }} placeholder="Search title, text, user, page…" aria-label="Search feedback" value={search} onChange={(e) => f(setSearch)(e.target.value)} />
				<FilterSelect ariaLabel="Type" value={kind} onChange={f(setKind)} allLabel="All types" options={KINDS.map((k) => ({ value: k, label: feedbackKindLabel(k) }))} />
				<DateRangeFilter label="Sent" from={from} to={to} onFrom={f(setFrom)} onTo={f(setTo)} />
				{activeFilters > 0 && <button className="btn ghost" onClick={clear}>Clear {activeFilters} filter{activeFilters === 1 ? '' : 's'}</button>}
			</FilterBar>

			<div className="card" ref={cols.ref}>
				<div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px var(--space-4)', borderBottom: '1px solid var(--border)', fontSize: 12, color: 'var(--fg-muted)' }}>
					{data ? `${data.total.toLocaleString()} report${data.total === 1 ? '' : 's'}${activeFilters ? ' match these filters' : ''}` : 'Loading…'} · default reward {defaultCredits} credits (System settings)
					<span style={{ marginLeft: 'auto' }}>{cols.menu}</span>
				</div>
				<SelectionBar sel={sel} exportName="feedback">
					<button className="btn ghost" onClick={() => void bulkStatus('verified')}><Check size={12} /> Approve</button>
					<button className="btn ghost" onClick={() => void bulkStatus('fixed')}><Wrench size={12} /> Mark fixed</button>
					<button className="btn ghost" onClick={() => void bulkStatus('discarded')}><X size={12} /> Discard</button>
				</SelectionBar>
				<AsyncState loading={isLoading} error={error} empty={rows.length === 0} emptyMsg={activeFilters || status ? 'No reports here.' : 'No feedback yet.'} onRetry={() => void mutate()}>
					<div className="table-scroll">
						<table className="data-table">
							<thead><tr>
								{sel.headCell}
								<SortableTh label="Sent" field="created" sort={sort} onSort={f(setSort)} />
								<th>From</th>
								<SortableTh label="Type" field="kind" sort={sort} onSort={f(setSort)} />
								<SortableTh label="Title" field="title" sort={sort} onSort={f(setSort)} />
								<th>Page</th>
								<th style={{ textAlign: 'right' }}>Shots</th>
								<SortableTh label="Status" field="status" sort={sort} onSort={f(setSort)} />
								<SortableTh label="Credits" field="credits" sort={sort} onSort={f(setSort)} align="right" />
								<th />
							</tr></thead>
							<tbody>
								{rows.map((r) => (
									<tr key={r.id} style={{ cursor: 'pointer' }} onClick={(e) => { if (!(e.target as HTMLElement).closest('a,button,input')) setOpenId(r.id); }}>
										{sel.cell(r.id)}
										<td className="num">{fmtListDate(r.created_at)}</td>
										<td>{r.profile_id ? <Link href={`/users/${r.profile_id}`}>{r.reporter_name || r.reporter_email}</Link> : (r.reporter_email ?? 'Deleted account')}</td>
										<td>{feedbackKindLabel(r.kind)}{r.severity && <span className="tag" style={{ marginLeft: 6 }}>{feedbackSeverityLabel(r.severity)}</span>}</td>
										<td title={r.title}>{r.title}</td>
										<td className="num" title={r.page_url ?? ''} style={{ fontSize: 12 }}>{r.page_url ?? '—'}</td>
										<td className="num" style={{ textAlign: 'right' }}>{r.screenshots.length || '—'}</td>
										<td><span className={`tag ${statusTag[r.status] ?? ''}`}>{feedbackStatusLabel(r.status)}</span></td>
										<td className="num" style={{ textAlign: 'right' }}>{r.credits_granted ? r.credits_granted.toLocaleString() : '—'}</td>
										<td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
											<RowActions r={r} busy={busy === r.id} defaultCredits={defaultCredits} onStatus={(s) => void setStatusFor(r.id, s)} onCredit={(n) => credit(r, n)} />
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
					<Pager page={page} totalPages={data?.totalPages} onPage={setPage} />
				</AsyncState>
			</div>

			{openId && <FeedbackDetail id={openId} defaultCredits={defaultCredits} onClose={() => setOpenId(null)}
				onStatus={async (s) => { await setStatusFor(openId, s); }}
				onCredit={async (r, n) => credit(r, n)} onChanged={() => void mutate()} />}
		</div>
	);
}

/** Approve / discard / fixed / reopen, and — on an approved report — the credit reward. */
function RowActions({ r, busy, defaultCredits, onStatus, onCredit }: {
	r: Feedback; busy: boolean; defaultCredits: number;
	onStatus: (s: Feedback['status']) => void; onCredit: (n: number) => Promise<boolean>;
}) {
	const [amount, setAmount] = useState(String(defaultCredits));
	useEffect(() => { setAmount(String(defaultCredits)); }, [defaultCredits]);
	const n = Number(amount);
	const canCredit = (r.status === 'verified' || r.status === 'fixed') && !r.credits_granted && !!r.profile_id;
	return (
		<span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
			{r.status === 'new' && <>
				<button className="btn ghost" disabled={busy} onClick={() => onStatus('verified')} title="It's real — approve it"><Check size={12} /> Approve</button>
				<button className="btn ghost" disabled={busy} onClick={() => onStatus('discarded')} title="Not a bug / not actionable"><X size={12} /> Discard</button>
			</>}
			{r.status === 'verified' && <button className="btn ghost" disabled={busy} onClick={() => onStatus('fixed')}><Wrench size={12} /> Fixed</button>}
			{r.status !== 'new' && <button className="btn ghost" disabled={busy} onClick={() => onStatus('new')} title="Back to New"><RotateCcw size={12} /></button>}
			{canCredit && <>
				<input className="search-input" type="number" min={1} max={10000} aria-label="Credits to give" value={amount}
					onChange={(e) => setAmount(e.target.value)} style={{ width: 76, height: 28 }} />
				<button className="btn" disabled={busy || !(n >= 1 && n <= 10000 && Number.isInteger(n))} onClick={() => void onCredit(n)}><Coins size={12} /> Give</button>
			</>}
		</span>
	);
}

function FeedbackDetail({ id, defaultCredits, onClose, onStatus, onCredit, onChanged }: {
	id: string; defaultCredits: number; onClose: () => void;
	onStatus: (s: Feedback['status']) => Promise<void>; onCredit: (r: Feedback, n: number) => Promise<boolean>; onChanged: () => void;
}) {
	const { data: r, mutate } = useSWR<Feedback>([`/api/admin/feedback/${id}`]);
	const [note, setNote] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	useEffect(() => { if (r && note === null) setNote(r.admin_note ?? ''); }, [r, note]);
	const saveNote = async () => {
		setSaving(true);
		try { await api('PATCH', `/api/admin/feedback/${id}`, { admin_note: note?.trim() || null }); toast.success('Note saved'); void mutate(); onChanged(); }
		catch (e) { toast.error((e as Error).message); }
		finally { setSaving(false); }
	};
	const row = (label: string, value: React.ReactNode) => (
		<div style={{ display: 'flex', gap: 10, padding: '4px 0', fontSize: 13 }}>
			<div style={{ flex: '0 0 120px', color: 'var(--fg-muted)' }}>{label}</div>
			<div style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{value ?? '—'}</div>
		</div>
	);
	return (
		<Modal title={r ? r.title : 'Feedback'} onClose={onClose} width={760}
			footer={r && <span style={{ display: 'flex', gap: 8, width: '100%', alignItems: 'center' }}>
				<RowActions r={r} busy={false} defaultCredits={defaultCredits}
					onStatus={(s) => void onStatus(s).then(() => mutate())}
					onCredit={async (n) => { const ok = await onCredit(r, n); if (ok) void mutate(); return ok; }} />
				<span style={{ flex: 1 }} />
				<button className="btn ghost" onClick={onClose}>Close</button>
			</span>}>
			{!r ? <div style={{ padding: 16, color: 'var(--fg-muted)' }}>Loading…</div> : (
				<div style={{ display: 'grid', gap: 14 }}>
					<div>
						{row('From', r.profile_id ? <Link href={`/users/${r.profile_id}`}>{r.reporter_name || r.reporter_email}</Link> : (r.reporter_email ?? 'Deleted account'))}
						{row('Email', r.reporter_email)}
						{row('Sent', when(r.created_at))}
						{row('Type', <>{feedbackKindLabel(r.kind)}{r.severity && ` · ${feedbackSeverityLabel(r.severity)}`}</>)}
						{row('Status', <>{feedbackStatusLabel(r.status)}{r.reviewed_by_name && <span style={{ color: 'var(--fg-muted)' }}> · by {r.reviewed_by_name}, {when(r.reviewed_at)}</span>}</>)}
						{row('Credits', r.credits_granted ? <>{r.credits_granted} <span style={{ color: 'var(--fg-muted)' }}>· by {r.credited_by_name ?? 'an admin'}, {when(r.credited_at)}</span></> : 'None given')}
						{row('Page', r.page_url ? <a href={`${ATLAS}${r.page_url.startsWith('/') ? r.page_url : `/${r.page_url}`}`} target="_blank" rel="noreferrer">{r.page_url} <ExternalLink size={11} /></a> : null)}
						{r.page_title && row('Page title', r.page_title)}
					</div>
					<div>
						<div style={{ fontSize: 12, color: 'var(--fg-muted)', marginBottom: 4 }}>{r.kind === 'bug' ? 'What happened' : 'Details'}</div>
						<div style={{ whiteSpace: 'pre-wrap', fontSize: 14, lineHeight: 1.5 }}>{r.description}</div>
					</div>
					{r.steps && <div>
						<div style={{ fontSize: 12, color: 'var(--fg-muted)', marginBottom: 4 }}>Steps to reproduce</div>
						<div style={{ whiteSpace: 'pre-wrap', fontSize: 14, lineHeight: 1.5 }}>{r.steps}</div>
					</div>}
					{r.screenshots.length > 0 && <div>
						<div style={{ fontSize: 12, color: 'var(--fg-muted)', marginBottom: 6 }}>Screenshots (links valid for 10 minutes)</div>
						<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
							{(r.screenshot_urls ?? []).map((u, i) => u ? (
								<a key={i} href={u} target="_blank" rel="noreferrer" title="Open full size">
									{/* eslint-disable-next-line @next/next/no-img-element -- signed storage URL */}
									<img src={u} alt={`Screenshot ${i + 1}`} style={{ width: 160, height: 110, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--border)' }} />
								</a>
							) : <span key={i} className="tag">Screenshot {i + 1} unavailable</span>)}
						</div>
					</div>}
					<div>
						<div style={{ fontSize: 12, color: 'var(--fg-muted)', marginBottom: 4 }}>Recorded with the report</div>
						{row('Plan', r.context.tier)}
						{row('Browser', r.context.user_agent)}
						{row('Screen', r.context.viewport)}
						{row('Timezone', r.context.timezone)}
						{row('Language', r.context.language)}
						{r.context.app_version && row('App version', r.context.app_version)}
					</div>
					<div>
						<div style={{ fontSize: 12, color: 'var(--fg-muted)', marginBottom: 4 }}>Admin note</div>
						<textarea className="search-input" style={{ width: '100%', minHeight: 70, height: 'auto' }} maxLength={5000} value={note ?? ''} onChange={(e) => setNote(e.target.value)} placeholder="Where it's tracked, what the cause was…" />
						<div style={{ marginTop: 6 }}><button className="btn ghost" disabled={saving || (note ?? '') === (r.admin_note ?? '')} onClick={() => void saveNote()}>{saving ? 'Saving…' : 'Save note'}</button></div>
					</div>
				</div>
			)}
		</Modal>
	);
}
