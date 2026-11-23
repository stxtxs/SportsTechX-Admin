'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import useSWRInfinite from 'swr/infinite';
import { PageHeader, Section, StatCard, StatsPanel, AsyncState, Tag } from '@/components/atoms';

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
const RECENT_FILTERS: Array<{ k: 'all' | 'ai' | 'integration'; label: string }> = [
	{ k: 'all', label: 'All' }, { k: 'ai', label: 'AI' }, { k: 'integration', label: 'Export' },
];

export default function CreditUsagePage() {
	const { data: usage, isLoading, error } = useSWR<UsageResp>(['/api/admin/credits/usage'], { dedupingInterval: 30_000 });
	const ai = usage?.byType.find((t) => t.credit_type === 'ai');
	const integ = usage?.byType.find((t) => t.credit_type === 'integration');

	const [type, setType] = useState<'all' | 'ai' | 'integration'>('all');
	const getKey = (index: number, prev: RecentPage | null) => {
		if (prev && !prev.nextCursor) return null;
		const cursor = index === 0 ? undefined : (prev?.nextCursor ?? undefined);
		return ['/api/admin/credits/recent', { type, cursor, limit: 40 }];
	};
	const { data: recentPages, size, setSize, isValidating } = useSWRInfinite<RecentPage>(getKey, { revalidateFirstPage: false });
	useEffect(() => { setSize(1); }, [type, setSize]);
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

			<Section title="Top spenders" meta="last 30 days · by total credits">
				<AsyncState loading={isLoading} error={error} empty={!usage?.topUsers.length} emptyMsg="No spend in the last 30 days.">
					<div className="table-scroll">
						<table className="data-table">
							<thead>
								<tr>
									<th>User</th><th>Tier</th>
									<th style={{ textAlign: 'right' }}>AI</th><th style={{ textAlign: 'right' }}>Export</th>
									<th style={{ textAlign: 'right' }}>Total</th><th style={{ textAlign: 'right' }}>Txns</th><th></th>
								</tr>
							</thead>
							<tbody>
								{usage?.topUsers.map((u) => (
									<tr key={u.profile_id}>
										<td>
											<div style={{ fontWeight: 600 }}>{u.name || u.email || u.profile_id.slice(0, 8)}</div>
											{u.email && u.name && <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{u.email}</div>}
										</td>
										<td><Tag>{u.tier || '—'}</Tag></td>
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
								<tr><th>Activity</th><th>Pool</th><th style={{ textAlign: 'right' }}>Credits</th><th style={{ textAlign: 'right' }}>Txns</th></tr>
							</thead>
							<tbody>
								{usage?.byOperation.map((o) => (
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

			<Section
				title="Recent activity"
				meta="all users"
				action={
					<div style={{ display: 'flex', gap: 4 }}>
						{RECENT_FILTERS.map((f) => (
							<button
								key={f.k}
								className="btn ghost"
								style={{ height: 26, padding: '0 10px', fontSize: 12, borderBottom: type === f.k ? '2px solid var(--accent)' : '2px solid transparent', color: type === f.k ? 'var(--fg)' : 'var(--fg-muted)' }}
								onClick={() => setType(f.k)}
							>
								{f.label}
							</button>
						))}
					</div>
				}
			>
				{recent.length === 0 ? (
					<div style={{ padding: 16, color: 'var(--fg-muted)', fontSize: 13 }}>No activity.</div>
				) : (
					<div className="table-scroll">
						<table className="data-table">
							<thead>
								<tr><th>When</th><th>User</th><th>Pool</th><th>Activity</th><th style={{ textAlign: 'right' }}>Amount</th></tr>
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
