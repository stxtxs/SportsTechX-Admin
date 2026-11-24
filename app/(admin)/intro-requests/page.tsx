'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';
import { RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useUrlState, useUrlNumber } from '@/hooks/use-url-state';
import { PageHeader, AsyncState, SortableTh, Pager } from '@/components/atoms';
import { FilterBar, FilterSelect } from '@/components/filters';
import { useTableColumns } from '@/hooks/use-table-columns';
import { introStatusLabel } from '@/lib/labels';

interface IntroRequest {
	id: string;
	status: string;
	note: string | null;
	created_at: string;
	requester_name: string | null;
	requester_email: string | null;
	investor_name: string | null;
	investor_slug: string | null;
	company_name: string | null;
}
interface Resp { data: IntroRequest[]; total: number; totalPages: number }

const STATUSES = ['requested', 'sent', 'declined'] as const;
const statusChip: Record<string, string> = { requested: 'warn', sent: 'on', declined: '' };

export default function IntroRequestsPage() {
	const cols = useTableColumns('intro-requests');
	const [status, setStatus] = useUrlState('intro', 'status');
	const [search, setSearch] = useUrlState('intro', 'q');
	const [sort, setSort] = useUrlState('intro', 'sort', '-requested');
	const [page, setPage] = useUrlNumber('intro', 'page', 1);
	const debouncedSearch = useDebouncedValue(search);
	const [pending, setPending] = useState<string | null>(null);
	const activeFilters = (status ? 1 : 0) + (search ? 1 : 0);
	/** Change a filter or the sort and go back to page 1. */
	const f = (set: (v: string) => void) => (v: string) => { set(v); setPage(1); };
	const clearFilters = () => { setStatus(''); setSearch(''); setPage(1); };

	const { data, error, isLoading, mutate } = useSWR<Resp>(
		['/api/admin/intro-requests', { status: status || undefined, q: debouncedSearch || undefined, sort, page, limit: 50 }],
		{ dedupingInterval: 15_000 },
	);
	const rows = data?.data ?? [];

	const setStatusFor = async (id: string, next: string) => {
		setPending(id);
		try {
			await api('PATCH', `/api/admin/intro-requests/${id}`, { status: next });
			toast.success(`Marked ${introStatusLabel(next).toLowerCase()}`);
			void mutate();
		} catch (e) { toast.error((e as Error).message); }
		finally { setPending(null); }
	};

	return (
		<div>
			<PageHeader
				kicker="Review queue"
				title="Intro requests"
				subtitle="Warm-intro requests from founders to matched investors. Action each: mark Sent once introduced, or Decline."
				action={<button className="btn ghost" onClick={() => void mutate()}><RefreshCw size={12} /> Refresh</button>}
			/>

			<FilterBar>
				<input
					className="search-input" style={{ flex: '0 0 280px', height: 32 }}
					placeholder="Search founder / investor / company…" aria-label="Search intro requests" value={search}
					onChange={(e) => f(setSearch)(e.target.value)}
				/>
				<FilterSelect ariaLabel="Status" value={status} onChange={f(setStatus)} allLabel="All statuses" options={STATUSES.map((s) => ({ value: s, label: introStatusLabel(s) }))} />
				{activeFilters > 0 && <button className="btn ghost" onClick={clearFilters}>Clear {activeFilters} filter{activeFilters === 1 ? '' : 's'}</button>}
			</FilterBar>

			<div className="card" ref={cols.ref}>
				<div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px var(--space-4)', borderBottom: '1px solid var(--border)', fontSize: 12, color: 'var(--fg-muted)' }}>
					{data ? `${data.total.toLocaleString()} request${data.total === 1 ? '' : 's'}${activeFilters ? ' match these filters' : ''}` : 'Loading…'} · click a column header to sort
					<span style={{ marginLeft: 'auto' }}>{cols.menu}</span>
</div>
				<AsyncState loading={isLoading} error={error} empty={rows.length === 0} emptyMsg={activeFilters ? 'No intro requests match these filters.' : 'No intro requests yet.'} onRetry={() => void mutate()}>
					<table className="data-table">
						<thead>
							<tr>
								<SortableTh label="When" field="requested" sort={sort} onSort={f(setSort)} />
								<SortableTh label="Founder" field="founder" sort={sort} onSort={f(setSort)} />
								<SortableTh label="Investor" field="investor" sort={sort} onSort={f(setSort)} />
								<SortableTh label="Company" field="company" sort={sort} onSort={f(setSort)} />
								<th>Note</th>
								<SortableTh label="Status" field="status" sort={sort} onSort={f(setSort)} />
								<th>Actions</th>
							</tr>
						</thead>
						<tbody>
							{rows.map((r) => (
								<tr key={r.id}>
									<td style={{ whiteSpace: 'nowrap', color: 'var(--fg-muted)', fontSize: 12 }}>{new Date(r.created_at).toLocaleDateString()}</td>
									<td>
										<div style={{ fontSize: 13 }}>{r.requester_name ?? '—'}</div>
										<div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{r.requester_email ?? ''}</div>
									</td>
									<td>{r.investor_name ?? '—'}</td>
									<td style={{ color: 'var(--fg-2)' }}>{r.company_name ?? '—'}</td>
									<td style={{ maxWidth: 280, fontSize: 12, color: 'var(--fg-2)' }}>{r.note ?? '—'}</td>
									<td><span className={`chip ${statusChip[r.status] ?? ''}`}>{introStatusLabel(r.status)}</span></td>
									<td>
										<div style={{ display: 'flex', gap: 6 }}>
											<button className="btn" disabled={pending === r.id || r.status === 'sent'} onClick={() => void setStatusFor(r.id, 'sent')}>Sent</button>
											<button className="btn ghost" disabled={pending === r.id || r.status === 'declined'} onClick={() => void setStatusFor(r.id, 'declined')}>Decline</button>
											{r.status !== 'requested' && (
												<button className="btn ghost" disabled={pending === r.id} onClick={() => void setStatusFor(r.id, 'requested')}>Reset</button>
											)}
										</div>
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
