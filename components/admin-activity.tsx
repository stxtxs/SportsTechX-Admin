'use client';

import useSWRInfinite from 'swr/infinite';
import { AsyncState } from '@/components/atoms';

/**
 * Admin activity (admin_action_log): who changed what through the admin panel. Used by the Admin activity page
 * (all actions) and the user Manage panel's History tab (actions on one user).
 *
 *   GET /api/admin/activity?target=&actor=&q=&before=&limit=
 */
export interface AdminAction {
	id: number; occurred_at: string; actor_email: string | null; actor_name: string | null;
	method: string; route: string; path: string; params: Record<string, unknown> | null; query: Record<string, unknown> | null;
	body: unknown; status: number | null;
}
interface Page { data: AdminAction[]; next: number | null }

/** "PATCH /api/admin/users/:id" → "users · update". */
export function describeAction(a: AdminAction): string {
	const verb = a.method === 'DELETE' ? 'delete' : a.method === 'POST' ? 'create / run' : 'update';
	const area = a.route.replace(/^\/api\/admin\/?/, '').replace(/\/:[^/]+/g, '').replace(/\//g, ' › ') || a.route;
	return `${area} · ${verb}`;
}

function bodySummary(body: unknown): string {
	if (!body || typeof body !== 'object') return '';
	return Object.entries(body as Record<string, unknown>)
		.map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
		.join(' · ')
		.slice(0, 300);
}

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { month: 'short', day: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export function AdminActivityTable({ filter }: { filter: { target?: string; actor?: string; q?: string } }) {
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
		<AsyncState loading={isLoading} error={error} empty={rows.length === 0} emptyMsg="No admin actions recorded yet." onRetry={() => void mutate()}>
			<div className="table-scroll">
				<table className="data-table">
					<thead><tr><th>When</th><th>Admin</th><th>Action</th><th>Target</th><th>Details</th><th>Result</th></tr></thead>
					<tbody>
						{rows.map((a) => (
							<tr key={a.id}>
								<td style={{ whiteSpace: 'nowrap' }}>{when(a.occurred_at)}</td>
								<td>{a.actor_name ?? a.actor_email ?? '—'}<div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{a.actor_name ? a.actor_email : ''}</div></td>
								<td style={{ fontWeight: 600 }}>{describeAction(a)}<div style={{ fontSize: 11, color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>{a.method} {a.path}</div></td>
								<td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{a.params ? Object.values(a.params).join(' / ') : '—'}</td>
								<td style={{ fontSize: 12, maxWidth: 420 }}>{bodySummary(a.body) || '—'}</td>
								<td>{a.status && a.status < 400 ? 'OK' : `Failed (${a.status ?? '?'})`}</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
			{more && <div style={{ marginTop: 10 }}><button className="btn ghost" onClick={() => void setSize(size + 1)}>Load more</button></div>}
		</AsyncState>
	);
}
