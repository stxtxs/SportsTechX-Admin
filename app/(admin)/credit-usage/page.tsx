'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import useSWRInfinite from 'swr/infinite';
import { PageHeader, Section, StatCard, StatsPanel, AsyncState, Tag, SortableTh } from '@/components/atoms';
import { FilterBar, FilterSelect } from '@/components/filters';
import { useUrlState } from '@/hooks/use-url-state';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { tierLabel } from '@/lib/labels';

/**
 * Admin-wide credit usage — everyone's spend rolled up over the last 30 days
 * (per-pool totals, top spenders, top operations) plus a live cross-user
 * activity feed. Reads /api/admin/credits/{usage,recent}.
 */

interface UsageByType { credit_type: string; spent: number; txns: number }
interface UsageByOp { operation_key: string | null; display_name: string | null; credit_type: string; spent: number; txns: number }
interface UsageUser {
	profile_id: string; name: string | null; email: string | null; tier: string | null; company_name: string | null;
	ai_spent: number; integration_spent: number; total_spent: number; txns: number;
}
interface UsageResp { from: string; to: string; byType: UsageByType[]; byOperation: UsageByOp[]; topUsers: UsageUser[] }

interface RecentRow {
	id: string; profile_id: string; name: string | null; email: string | null; tier: string | null;
	credit_type: string; transaction_type: string; amount: number; balance_after: number;
	description: string | null; operation_key: string | null; display_name: string | null; occurred_at: string;
}
interface RecentPage { data: RecentRow[]; nextCursor: string | null }

const TXN_LABEL: Record<string, string> = {
	monthly_grant: 'Monthly grant', topup_purchase: 'Top-up', refund: 'Refund',
	expiry: 'Expired', adjustment: 'Adjustment', spend: 'Usage',
};
function activityLabel(r: { description: string | null; display_name: string | null; operation_key: string | null; transaction_type: string }): string {
	const d = r.description?.trim();
	if (d && /\s/.test(d)) return d;
	if (r.display_name) return r.display_name;
	if (d) return d.replace(/^ai\./, '').replace(/[._]/g, ' ');
	return TXN_LABEL[r.transaction_type] ?? r.transaction_type;
}
/** Spend category of a ledger row. 'stx' rows are wallet movements with no category (grants, monthly grants, expiries). */
const poolLabel = (t: string): string => (t === 'ai' ? 'AI' : t === 'integration' ? 'Export' : 'Wallet');
function fmtWhen(iso: string): string {
	const dt = new Date(iso);
	return Number.isNaN(dt.getTime()) ? '' : dt.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
const POOL_OPTIONS = [{ value: 'ai', label: 'AI' }, { value: 'integration', label: 'Export' }, { value: 'stx', label: 'Wallet' }];
const TXN_OPTIONS = Object.entries(TXN_LABEL).map(([value, label]) => ({ value, label }));

/** Client-side sort for the rollup tables (top 50 / top 25, all loaded). "-key" = descending. */
function sortRows<T>(rows: T[], sort: string, get: Record<string, (r: T) => string | number>): T[] {
	const fn = get[sort.replace(/^-/, '')];
	if (!fn) return rows;
	const dir = sort.startsWith('-') ? -1 : 1;
	return [...rows].sort((a, b) => {
		const x = fn(a), y = fn(b);
		return dir * (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y)));
	});
}
const userName = (u: { name: string | null; email: string | null; profile_id: string }) => u.name || u.email || u.profile_id.slice(0, 8);

export default function CreditUsagePage() {
	const { data: usage, isLoading, error } = useSWR<UsageResp>(['/api/admin/credits/usage'], { dedupingInterval: 30_000 });
	const ai = usage?.byType.find((t) => t.credit_type === 'ai');
	const integ = usage?.byType.find((t) => t.credit_type === 'integration');

	// Rollup tables: sorted and searched in the browser (the endpoint returns the top rows only).
	const [userSort, setUserSort] = useUrlState('cu', 'usort', '-total');
	const [userQ, setUserQ] = useUrlState('cu', 'uq');
	const [opSort, setOpSort] = useUrlState('cu', 'osort', '-credits');
	const uq = userQ.trim().toLowerCase();
	const topUsers = sortRows(
		(usage?.topUsers ?? []).filter((u) => !uq || `${u.name ?? ''} ${u.email ?? ''} ${u.company_name ?? ''}`.toLowerCase().includes(uq)),
		userSort,
		{
			user: (u) => userName(u).toLowerCase(), tier: (u) => tierLabel(u.tier), ai: (u) => u.ai_spent,
			export: (u) => u.integration_spent, total: (u) => u.total_spent, txns: (u) => u.txns,
		},
	);
	const byOperation = sortRows(usage?.byOperation ?? [], opSort, {
		activity: (o) => (o.display_name || o.operation_key || '').toLowerCase(), pool: (o) => poolLabel(o.credit_type),
		credits: (o) => o.spent, txns: (o) => o.txns,
	});

	// Activity feed: filtered and sorted on the server, cursor-paged ("Load more").
	const [type, setType] = useUrlState('cu', 'pool');
	const [txn, setTxn] = useUrlState('cu', 'txn');
	const [q, setQ] = useUrlState('cu', 'q');
	const [sort, setSort] = useUrlState('cu', 'sort', '-when');
	const dq = useDebouncedValue(q.trim());
	const active = [type, txn, q].filter(Boolean).length;
	const clear = () => { setType(''); setTxn(''); setQ(''); };
	const getKey = (index: number, prev: RecentPage | null) => {
		if (prev && !prev.nextCursor) return null;
		const cursor = index === 0 ? undefined : (prev?.nextCursor ?? undefined);
		return ['/api/admin/credits/recent', { type: type || 'all', txn, q: dq, sort, cursor, limit: 40 }];
	};
	const { data: recentPages, error: recentError, size, setSize, isValidating } = useSWRInfinite<RecentPage>(getKey, { revalidateFirstPage: false });
	useEffect(() => { setSize(1); }, [type, txn, dq, sort, setSize]);
	const recent = recentPages ? recentPages.flatMap((p) => p.data) : [];
	const hasMore = Boolean(recentPages?.[recentPages.length - 1]?.nextCursor);
	const loadingMore = isValidating && size > (recentPages?.length ?? 0);

	return (
		<div style={{ display: 'grid', gap: 'var(--space-4)' }}>
			<PageHeader
				kicker="Billing · last 30 days"
				title="Credit usage"
				subtitle="Everyone's credit spend over the last 30 days — AI features, direct exports and CRM syncs. Net of refunds (credits given back for unexported rows or failed runs)."
			/>

			<StatsPanel>
				<div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 'var(--space-4)' }}>
					<StatCard label="AI credits spent · 30d" value={(ai?.spent ?? 0).toLocaleString()} loading={isLoading} />
					<StatCard label="Export credits spent · 30d" value={(integ?.spent ?? 0).toLocaleString()} loading={isLoading} />
					<StatCard label="AI transactions" value={(ai?.txns ?? 0).toLocaleString()} loading={isLoading} />
					<StatCard label="Export transactions" value={(integ?.txns ?? 0).toLocaleString()} loading={isLoading} />
				</div>
			</StatsPanel>

			<Section title="Top spenders" meta="last 30 days · top 50 by total credits">
				<FilterBar>
					<input className="search-input" style={{ height: 32, width: 260, maxWidth: '100%' }} placeholder="Search name, email or company (top 50)…"
						value={userQ} onChange={(e) => setUserQ(e.target.value)} aria-label="Search top spenders" />
				</FilterBar>
				<AsyncState loading={isLoading} error={error} empty={!topUsers.length} emptyMsg={uq ? 'No top spender matches.' : 'No spend in the last 30 days.'}>
					<div className="table-scroll">
						<table className="data-table">
							<thead>
								<tr>
									<SortableTh label="User" field="user" sort={userSort} onSort={setUserSort} />
									<SortableTh label="Plan" field="tier" sort={userSort} onSort={setUserSort} />
									<SortableTh label="AI" field="ai" sort={userSort} onSort={setUserSort} align="right" />
									<SortableTh label="Export" field="export" sort={userSort} onSort={setUserSort} align="right" />
									<SortableTh label="Total" field="total" sort={userSort} onSort={setUserSort} align="right" />
									<SortableTh label="Txns" field="txns" sort={userSort} onSort={setUserSort} align="right" />
									<th></th>
								</tr>
							</thead>
							<tbody>
								{topUsers.map((u) => (
									<tr key={u.profile_id}>
										<td>
											<div style={{ fontWeight: 600 }}>{userName(u)}</div>
											{u.email && u.name && <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{u.email}</div>}
										</td>
										<td><Tag>{tierLabel(u.tier)}</Tag></td>
										<td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{u.ai_spent.toLocaleString()}</td>
										<td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{u.integration_spent.toLocaleString()}</td>
										<td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{u.total_spent.toLocaleString()}</td>
										<td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--fg-muted)' }}>{u.txns.toLocaleString()}</td>
										<td style={{ textAlign: 'right' }}><Link href={`/users/${u.profile_id}`} className="btn ghost" style={{ height: 26, padding: '0 10px', fontSize: 12 }}>Manage →</Link></td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</AsyncState>
			</Section>

			<Section title="By operation" meta="last 30 days · credits by activity type">
				<AsyncState loading={isLoading} error={error} empty={!usage?.byOperation.length} emptyMsg="No spend in the last 30 days.">
					<div className="table-scroll">
						<table className="data-table">
							<thead>
								<tr>
									<SortableTh label="Activity" field="activity" sort={opSort} onSort={setOpSort} />
									<SortableTh label="Pool" field="pool" sort={opSort} onSort={setOpSort} />
									<SortableTh label="Credits" field="credits" sort={opSort} onSort={setOpSort} align="right" />
									<SortableTh label="Txns" field="txns" sort={opSort} onSort={setOpSort} align="right" />
								</tr>
							</thead>
							<tbody>
								{byOperation.map((o) => (
									<tr key={`${o.operation_key}-${o.credit_type}`}>
										<td>{o.display_name || o.operation_key || '—'}</td>
										<td>{poolLabel(o.credit_type)}</td>
										<td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{o.spent.toLocaleString()}</td>
										<td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--fg-muted)' }}>{o.txns.toLocaleString()}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</AsyncState>
			</Section>

			<Section title="Recent activity" meta={`all users · all time${recentPages ? ` · ${recent.length.toLocaleString()}${hasMore ? '+' : ''} shown` : ''}`}>
				<FilterBar>
					<input className="search-input" style={{ height: 32, width: 260, maxWidth: '100%' }} placeholder="Search user, email or activity…"
						value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search credit activity" />
					<FilterSelect ariaLabel="Pool" value={type} onChange={setType} options={POOL_OPTIONS} allLabel="All pools" />
					<FilterSelect ariaLabel="Kind" value={txn} onChange={setTxn} options={TXN_OPTIONS} allLabel="All kinds" />
					{active > 0 && <button className="btn ghost" onClick={clear}>Clear {active} filter{active === 1 ? '' : 's'}</button>}
				</FilterBar>
				{recent.length === 0 ? (
					<div style={{ padding: 16, color: 'var(--fg-muted)', fontSize: 13 }}>{recentError ? 'Could not load activity.' : !recentPages ? 'Loading…' : active ? 'No activity matches these filters.' : 'No activity.'}</div>
				) : (
					<div className="table-scroll">
						<table className="data-table">
							<thead>
								<tr>
									<SortableTh label="When" field="when" sort={sort} onSort={setSort} />
									<th>User</th><th>Pool</th><th>Activity</th>
									<SortableTh label="Amount" field="size" sort={sort} onSort={setSort} align="right" />
								</tr>
							</thead>
							<tbody>
								{recent.map((r) => {
									const spend = r.amount < 0;
									return (
										<tr key={r.id}>
											<td style={{ whiteSpace: 'nowrap', color: 'var(--fg-muted)', fontSize: 12 }}>{fmtWhen(r.occurred_at)}</td>
											<td>
												<Link href={`/users/${r.profile_id}`} style={{ color: 'var(--fg)', textDecoration: 'none', fontWeight: 600 }}>
													{r.name || r.email || r.profile_id.slice(0, 8)}
												</Link>
											</td>
											<td>{poolLabel(r.credit_type)}</td>
											<td>{activityLabel(r)}{r.transaction_type !== 'spend' ? ` (${TXN_LABEL[r.transaction_type] ?? r.transaction_type})` : ''}</td>
											<td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 700, color: spend ? 'var(--neg)' : 'var(--pos)' }}>{spend ? '' : '+'}{r.amount.toLocaleString()}</td>
										</tr>
									);
								})}
							</tbody>
						</table>
						{hasMore && (
							<div style={{ display: 'flex', justifyContent: 'center', padding: 12 }}>
								<button className="btn ghost" disabled={loadingMore} onClick={() => setSize(size + 1)}>{loadingMore ? 'Loading…' : 'Load more'}</button>
							</div>
						)}
					</div>
				)}
			</Section>
		</div>
	);
}
