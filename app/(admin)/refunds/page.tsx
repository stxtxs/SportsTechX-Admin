'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';
import { RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader, AsyncState, SortableTh, Pager } from '@/components/atoms';
import { FilterBar, FilterSelect } from '@/components/filters';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useUrlState, useUrlNumber } from '@/hooks/use-url-state';
import { useTableColumns } from '@/hooks/use-table-columns';
import { refundStatusLabel } from '@/lib/labels';

/**
 * Refunds owed after an in-app downgrade.
 *
 * Cancelling a paid plan is self-serve and instant, but the money back is not:
 * the server queues what it owes and a human releases it here. That split is
 * deliberate — this is the only path in the product that moves money *out*, and
 * it had no code at all until now.
 *
 * Approving is safe to retry. The server uses the request's own id as the
 * Stripe idempotency key and the table has a unique constraint on the invoice,
 * so a double click cannot send the money twice.
 */
interface RefundRequest {
	id: string;
	profile_id: string;
	email: string | null;
	full_name: string | null;
	stripe_subscription_id: string;
	stripe_invoice_id: string;
	amount_cents: number;
	currency: string;
	/** Why the figure is what it is — kept so an approver can sanity-check it. */
	basis: { paid_cents: number; days_total: number; days_used: number; days_remaining: number } | null;
	status: 'pending' | 'refunded' | 'rejected' | 'failed';
	stripe_refund_id: string | null;
	failure_reason: string | null;
	requested_at: string;
	reviewed_at: string | null;
}
interface Resp { data: RefundRequest[]; total: number; totalPages: number }

const STATUSES = ['pending', 'refunded', 'rejected', 'failed'] as const;
const statusChip: Record<string, string> = { pending: 'warn', refunded: 'on', rejected: '', failed: 'bad' };

const money = (cents: number, ccy: string) =>
	new Intl.NumberFormat(undefined, { style: 'currency', currency: (ccy || 'eur').toUpperCase() }).format((cents ?? 0) / 100);

export default function RefundsPage() {
	const cols = useTableColumns('refunds');
	// Defaults to the work queue (pending); "All statuses" is '' and is kept in the URL.
	const [status, setStatus] = useUrlState('refund', 'status', 'pending');
	const [search, setSearch] = useUrlState('refund', 'q');
	const [sort, setSort] = useUrlState('refund', 'sort', '-requested');
	const [page, setPage] = useUrlNumber('refund', 'page', 1);
	const debouncedSearch = useDebouncedValue(search);
	const [pending, setPending] = useState<string | null>(null);
	const activeFilters = (status !== 'pending' ? 1 : 0) + (search ? 1 : 0);
	/** Change a filter or the sort and go back to page 1. */
	const f = (set: (v: string) => void) => (v: string) => { set(v); setPage(1); };
	const clearFilters = () => { setStatus('pending'); setSearch(''); setPage(1); };

	const { data, error, isLoading, mutate } = useSWR<Resp>(
		['/api/admin/refunds', { status: status || 'all', q: debouncedSearch || undefined, sort, page, limit: 50 }],
		{ dedupingInterval: 15_000 },
	);
	const rows = data?.data ?? [];

	const act = async (r: RefundRequest, action: 'approve' | 'reject') => {
		// Releasing money deserves one deliberate pause. The amount is in the
		// prompt because that is the number actually leaving the account.
		if (action === 'approve'
			&& !window.confirm(`Refund ${money(r.amount_cents, r.currency)} to ${r.email ?? 'this customer'}?\n\nThis sends the money back to their card and cannot be undone here.`)) {
			return;
		}
		setPending(r.id);
		try {
			await api('POST', `/api/admin/refunds/${r.id}/${action}`);
			toast.success(action === 'approve' ? `Refunded ${money(r.amount_cents, r.currency)}` : 'Rejected');
			void mutate();
		} catch (e) { toast.error((e as Error).message); }
		finally { setPending(null); }
	};

	return (
		<div>
			<PageHeader
				kicker="Review queue"
				title="Refunds"
				subtitle="Pro-rata refunds owed after a customer downgraded to Explore. Approve to send the money back to their card; reject if it should not be paid."
				action={<button className="btn ghost" onClick={() => void mutate()}><RefreshCw size={12} /> Refresh</button>}
			/>

			<FilterBar>
				<input
					className="search-input" style={{ flex: '0 0 280px', height: 32 }}
					placeholder="Search customer, invoice or subscription id…" aria-label="Search refunds" value={search}
					onChange={(e) => f(setSearch)(e.target.value)}
				/>
				<FilterSelect
					ariaLabel="Status" value={status} onChange={f(setStatus)} allLabel="All statuses"
					options={STATUSES.map((s) => ({ value: s, label: refundStatusLabel(s) }))}
				/>
				{activeFilters > 0 && <button className="btn ghost" onClick={clearFilters}>Clear {activeFilters} filter{activeFilters === 1 ? '' : 's'}</button>}
			</FilterBar>

			<div className="card" ref={cols.ref}>
				<div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px var(--space-4)', borderBottom: '1px solid var(--border)', fontSize: 12, color: 'var(--fg-muted)' }}>
					{data ? `${data.total.toLocaleString()} refund${data.total === 1 ? '' : 's'}${status ? ` · ${refundStatusLabel(status)}` : ''}${search ? ' matching the search' : ''}` : 'Loading…'} · click a column header to sort
					<span style={{ marginLeft: 'auto' }}>{cols.menu}</span>
</div>
				<AsyncState loading={isLoading} error={error} empty={rows.length === 0} emptyMsg={search ? 'No refunds match the search.' : 'Nothing to refund.'} onRetry={() => void mutate()}>
					<table className="data-table">
						<thead>
							<tr>
								<SortableTh label="Requested" field="requested" sort={sort} onSort={f(setSort)} />
								<SortableTh label="Customer" field="customer" sort={sort} onSort={f(setSort)} />
								<SortableTh label="Refund" field="amount" sort={sort} onSort={f(setSort)} />
								<th>Unused</th>
								<SortableTh label="Status" field="status" sort={sort} onSort={f(setSort)} />
								<SortableTh label="Reviewed" field="reviewed" sort={sort} onSort={f(setSort)} />
							</tr>
						</thead>
						<tbody>
							{rows.map((r) => (
								<tr key={r.id}>
									<td style={{ whiteSpace: 'nowrap', color: 'var(--fg-muted)', fontSize: 12 }}>
										{new Date(r.requested_at).toLocaleDateString()}
									</td>
									<td>
										<div style={{ fontSize: 13 }}>{r.full_name ?? '—'}</div>
										<div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{r.email ?? ''}</div>
									</td>
									<td style={{ whiteSpace: 'nowrap', fontWeight: 600 }}>
										{money(r.amount_cents, r.currency)}
										{r.basis && (
											<div style={{ fontSize: 11, fontWeight: 400, color: 'var(--fg-muted)' }}>
												of {money(r.basis.paid_cents, r.currency)} paid
											</div>
										)}
									</td>
									<td style={{ fontSize: 12, color: 'var(--fg-2)', whiteSpace: 'nowrap' }}>
										{r.basis ? `${r.basis.days_remaining} of ${r.basis.days_total} days` : '—'}
									</td>
									<td>
										<span className={`chip ${statusChip[r.status] ?? ''}`}>{refundStatusLabel(r.status)}</span>
										{r.failure_reason && (
											<div style={{ fontSize: 11, color: 'var(--fg-muted)', maxWidth: 240 }}>{r.failure_reason}</div>
										)}
									</td>
									<td>
										{r.status === 'pending' || r.status === 'failed' ? (
											<div style={{ display: 'flex', gap: 6 }}>
												<button className="btn" disabled={pending === r.id} onClick={() => void act(r, 'approve')}>
													{pending === r.id ? 'Working…' : r.status === 'failed' ? 'Retry refund' : 'Approve refund'}
												</button>
												<button className="btn ghost" disabled={pending === r.id} onClick={() => void act(r, 'reject')}>Reject</button>
											</div>
										) : (
											<span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
												{r.reviewed_at ? new Date(r.reviewed_at).toLocaleDateString() : '—'}
											</span>
										)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</AsyncState>
			</div>
			<Pager page={page} totalPages={data?.totalPages} onPage={setPage} />
		</div>
	);
}
