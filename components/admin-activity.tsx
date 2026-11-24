'use client';

import Link from 'next/link';
import useSWRInfinite from 'swr/infinite';
import { AsyncState, SortableTh } from '@/components/atoms';
import { tidy } from '@/lib/labels';

/**
 * Admin activity (admin_action_log): who changed what through the admin panel. Used by the Admin activity page
 * (all actions) and each user's Activity tab (actions on one user).
 *
 *   GET /api/admin/activity?target=&actor=&q=&from=&to=&sort=&before=&limit=
 *
 * Each row reads as a sentence: "Edited company · Acme" with only the fields that changed (old → new). Edits made
 * since 24 Nov 2026 store the record's previous state (`before`); older ones only know what was submitted.
 */
export interface AdminAction {
	id: number; occurred_at: string; actor_email: string | null; actor_name: string | null;
	method: string; route: string; path: string; params: Record<string, unknown> | null; query: Record<string, unknown> | null;
	body: unknown; status: number | null; before?: Record<string, unknown> | null;
	target?: { kind: string; id: string; name: string | null; href: string | null; deleted: boolean } | null;
}
interface Page { data: AdminAction[]; next: number | null }

/** Specific actions, matched on "METHOD /route" (route below /api/admin). First match wins. */
const ACTIONS: Array<[RegExp, string]> = [
	[/^POST users\/:id\/promote$/, 'Made admin'],
	[/^POST users\/:id\/demote$/, 'Removed admin rights'],
	[/^POST users\/:id\/block$/, 'Blocked account'],
	[/^POST users\/:id\/unblock$/, 'Unblocked account'],
	[/^POST users\/:id\/revoke-access$/, 'Revoked paid access'],
	[/^POST users\/:profileId\/feature-grants$/, 'Granted a feature'],
	[/^DELETE users\/:profileId\/feature-grants/, 'Removed a feature grant'],
	[/^PATCH users\/:id$/, 'Edited user'],
	[/^POST billing\/grant-access$/, 'Granted plan access'],
	[/^POST billing\/bulk-grant-access$/, 'Granted plan access (bulk)'],
	[/^POST billing\/bulk-grant-trial$/, 'Granted trials (bulk)'],
	[/^POST billing\/bulk-credit-grant$/, 'Granted credits'],
	[/^POST accounts$/, 'Created an account'],
	[/^POST accounts\/:id\/sign-in-link$/, 'Sent a sign-in link'],
	[/^POST claims\/:id\/verify$/, 'Verified claim'],
	[/^POST claims\/:id\/unverify$/, 'Un-verified claim'],
	[/^POST claims\/:id\/reject$/, 'Rejected claim'],
	[/^POST claims\/:id\/pickup$/, 'Picked up claim'],
	[/^POST claims\/:id\/create-entity$/, 'Created the record for a claim'],
	[/^POST data-change-requests\/:id\/apply$/, 'Applied data change'],
	[/^POST data-change-requests\/:id\/reject$/, 'Rejected data change'],
	[/^POST merge\//, 'Merged duplicate records'],
	[/^POST ecosystem-entities\/:id\/participants$/, 'Added a participant'],
	[/^POST ecosystem-entities\/:id\/relationships$/, 'Linked ecosystem entries'],
	[/^POST startups-pipeline\/import$/, 'Imported startups'],
	[/^POST startups-pipeline\/import-preview$/, 'Checked a startup import'],
	[/^POST work-sessions\/count$/, 'Logged review work'],
	[/^POST notifications\/:id\/read$/, 'Read a notification'],
];
const NOUN: Record<string, string> = {
	users: 'user', companies: 'company', deals: 'funding deal', acquisitions: 'M&A deal', investors: 'investor',
	'ecosystem-entities': 'ecosystem entry', reports: 'report', claims: 'claim', 'investor-review': 'investor candidate',
	'startups-pipeline': 'startup candidate', 'scout-deals': 'deal-flow deal', polls: 'poll', 'featured-lists': 'featured list',
	'home-pins': 'home pin', features: 'feature', 'subscription-plans': 'plan', 'credit-packs': 'credit pack', 'site-assets': 'site asset',
	'raise-resources': 'guide item', 'market-roundup': 'market roundup', reference: 'reference data', 'app-settings': 'system setting',
};

/** "PATCH /api/admin/companies/:id" → "Edited company". */
export function describeAction(a: AdminAction): string {
	const r = a.route.replace(/^\/api\/admin\/?/, '');
	const hit = ACTIONS.find(([re]) => re.test(`${a.method} ${r}`));
	if (hit) return hit[1];
	const segs = r.split('/').filter(Boolean);
	const noun = NOUN[segs[0] ?? ''] ?? tidy(segs[0] ?? 'record').toLowerCase();
	const action = segs.slice(1).filter((s) => !s.startsWith(':')).pop();
	if (action) return `${tidy(action)} · ${noun}`; // e.g. "Enrich · company"
	const verb = a.method === 'DELETE' ? 'Deleted' : a.method === 'POST' ? 'Added' : 'Edited';
	return `${verb} ${noun}`;
}

// ── Values in words ────────────────────────────────────────────────────────────
const SKIP = new Set(['id', 'updated_at', 'created_at', 'search_vector', 'fts', 'tsv']);
const isDay = (s: string) => /^\d{4}-\d{2}-\d{2}(T|$)/.test(s);
function show(v: unknown): string {
	if (v === null || v === undefined || v === '') return 'empty';
	if (typeof v === 'boolean') return v ? 'Yes' : 'No';
	if (Array.isArray(v)) return v.length === 0 ? 'none' : v.every((x) => typeof x !== 'object') && v.join(', ').length <= 80 ? v.join(', ') : `${v.length} item${v.length === 1 ? '' : 's'}`;
	if (typeof v === 'object') { const s = JSON.stringify(v); return s.length > 80 ? `${s.slice(0, 80)}…` : s; }
	const s = String(v);
	if (isDay(s)) return new Date(s).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
	return s.length > 80 ? `${s.slice(0, 80)}…` : s;
}
/** Same value written two ways ("2026-01-02" vs "2026-01-02T00:00:00Z", "100" vs 100, null vs "")? */
function same(a: unknown, b: unknown): boolean {
	const n = (v: unknown) => (v === null || v === undefined || v === '' ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));
	const x = n(a), y = n(b);
	if (x === y) return true;
	if (isDay(x) && isDay(y)) return x.slice(0, 10) === y.slice(0, 10);
	if (x !== '' && y !== '' && !Number.isNaN(Number(x)) && !Number.isNaN(Number(y))) return Number(x) === Number(y);
	return false;
}

function Details({ a }: { a: AdminAction }) {
	const body = a.body && typeof a.body === 'object' && !Array.isArray(a.body) ? (a.body as Record<string, unknown>) : null;
	if (a.method === 'DELETE') return <span style={{ color: 'var(--fg-muted)' }}>{a.before ? 'Record removed (its last state is kept in the log).' : '—'}</span>;
	if (!body) return <span style={{ color: 'var(--fg-muted)' }}>—</span>;
	if (body.truncated) return <span style={{ color: 'var(--fg-muted)' }}>Large request ({(body.keys as string[] | undefined)?.length ?? 'many'} fields)</span>;
	const keys = Object.keys(body).filter((k) => !SKIP.has(k));
	// Edits since 24 Nov 2026: only what actually changed.
	if (a.before) {
		const changed = keys.filter((k) => k in a.before! && !same(a.before![k], body[k]));
		const extra = keys.filter((k) => !(k in a.before!));
		if (!changed.length) return <span style={{ color: 'var(--fg-muted)' }}>No field changed{extra.length ? ` (also sent: ${extra.map(tidy).join(', ')})` : ''}</span>;
		return (
			<ul className="act-changes">
				{changed.slice(0, 8).map((k) => (
					<li key={k}><span className="act-field">{tidy(k)}</span> <span className="act-old">{show(a.before![k])}</span> → <span className="act-new">{show(body[k])}</span></li>
				))}
				{changed.length > 8 && <li style={{ color: 'var(--fg-muted)' }}>+ {changed.length - 8} more field{changed.length - 8 === 1 ? '' : 's'}</li>}
			</ul>
		);
	}
	// Older entries / non-edits: what was submitted, in words.
	if (keys.length > 6) return <span>Submitted {keys.length} fields <span style={{ color: 'var(--fg-muted)' }}>(older entry: what changed wasn’t recorded)</span></span>;
	return (
		<ul className="act-changes">
			{keys.map((k) => <li key={k}><span className="act-field">{tidy(k)}</span> {show(body[k])}</li>)}
		</ul>
	);
}

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { month: 'short', day: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export interface AdminActivityFilter { target?: string; actor?: string; q?: string; from?: string; to?: string; sort?: string }

/** `onSort` makes the When column sortable (newest/oldest first); without it the table is newest first, as on a user's Activity tab. */
export function AdminActivityTable({ filter, onSort, emptyMsg = 'No admin actions recorded yet.' }: { filter: AdminActivityFilter; onSort?: (s: string) => void; emptyMsg?: string }) {
	const qs = (before: number | null) => {
		const p = new URLSearchParams({ limit: '50' });
		for (const [k, v] of Object.entries(filter)) if (v) p.set(k, v);
		if (before) p.set('before', String(before));
		return `/api/admin/activity?${p.toString()}`;
	};
	const { data, size, setSize, isLoading, error, mutate } = useSWRInfinite<Page>(
		(i, prev) => (i === 0 ? [qs(null)] : prev?.next ? [qs(prev.next)] : null),
		{ revalidateFirstPage: false },
	);
	const rows = (data ?? []).flatMap((p) => p.data);
	const more = !!data?.[data.length - 1]?.next;
	return (
		<AsyncState loading={isLoading} error={error} empty={rows.length === 0} emptyMsg={emptyMsg} onRetry={() => void mutate()}>
			<div className="table-scroll">
				<table className="data-table">
					<thead><tr>{onSort ? <SortableTh label="When" field="when" sort={filter.sort || '-when'} onSort={onSort} /> : <th>When</th>}<th>Admin</th><th>Action</th><th>On</th><th>What changed</th><th>Result</th></tr></thead>
					<tbody>
						{rows.map((a) => (
							<tr key={a.id}>
								<td className="num" style={{ verticalAlign: 'top' }}>{when(a.occurred_at)}</td>
								<td style={{ verticalAlign: 'top' }}>{a.actor_name || a.actor_email || '—'}{a.actor_name && <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{a.actor_email}</div>}</td>
								<td style={{ verticalAlign: 'top', fontWeight: 600 }} title={`${a.method} ${a.path}`}>{describeAction(a)}</td>
								<td style={{ verticalAlign: 'top' }}>
									{!a.target ? <span style={{ color: 'var(--fg-muted)' }}>—</span>
										: a.target.href && !a.target.deleted ? <Link href={a.target.href}>{a.target.name || 'Open'}</Link>
										: a.target.name ? <>{a.target.name} <span className="tag">deleted</span></> : <span style={{ color: 'var(--fg-muted)' }}>Deleted record</span>}
								</td>
								<td className="wrap" style={{ verticalAlign: 'top', fontSize: 12.5, maxWidth: 520 }}><Details a={a} /></td>
								<td style={{ verticalAlign: 'top' }}>{a.status && a.status < 400 ? <span className="tag pos">Done</span> : <span className="tag neg" title={`HTTP ${a.status ?? '?'}`}>Failed</span>}</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
			{more && <div style={{ marginTop: 10 }}><button className="btn ghost" onClick={() => void setSize(size + 1)}>Load more</button></div>}
		</AsyncState>
	);
}
