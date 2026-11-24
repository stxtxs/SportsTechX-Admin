'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';
import { RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader, AsyncState, Pager, SortableTh } from '@/components/atoms';
import { FilterBar, FilterSelect } from '@/components/filters';
import { useUrlNumber, useUrlState } from '@/hooks/use-url-state';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useTableColumns } from '@/hooks/use-table-columns';

const LIMIT = 50;

interface StrategySession {
	id: string;
	raise_id: string;
	status: string;
	scheduled_at: string | null;
	booked_at: string | null;
	meeting_link: string | null;
	created_at: string;
	company_name: string | null;
	founder_email: string | null;
}
interface Resp { data: StrategySession[]; total: number; totalPages?: number }

export default function StrategySessionsPage() {
	const cols = useTableColumns('strategy-sessions');
	const [when, setWhen] = useState<Record<string, string>>({});
	const [link, setLink] = useState<Record<string, string>>({});
	const [pending, setPending] = useState<string | null>(null);
	const [page, setPage] = useUrlNumber('ss', 'page', 1);
	const [state, setState] = useUrlState('ss', 'state', '');
	const [search, setSearch] = useUrlState('ss', 'q', '');
	const debouncedSearch = useDebouncedValue(search);
	const [sort, setSort] = useUrlState('ss', 'sort', '-requested');
	/** Set a filter and go back to page 1. */
	const f = (set: (v: string) => void) => (v: string) => { set(v); setPage(1); };
	const activeFilters = [state, search].filter(Boolean).length;
	const clearFilters = () => { setState(''); setSearch(''); setPage(1); };

	// Only 'booked' rows exist (bookStrategy always inserts 'booked'; locked/
	// available are states the home service derives, never persisted). The real
	// distinction is requested vs confirmed (a time set) — that's the `state` filter.
	const { data, error, isLoading, mutate } = useSWR<Resp>(
		['/api/admin/strategy-sessions', { status: 'booked', state: state || undefined, q: debouncedSearch.trim() || undefined, sort, limit: LIMIT, offset: (page - 1) * LIMIT }],
		{ dedupingInterval: 15_000 },
	);
	const rows = data?.data ?? [];

	const confirm = async (id: string) => {
		const local = when[id];
		if (!local) { toast.error('Pick a date and time first.'); return; }
		setPending(id);
		try {
			await api('PATCH', `/api/admin/strategy-sessions/${id}/confirm`, {
				scheduled_at: new Date(local).toISOString(),
				// Untouched field = not sent (keeps the saved link); emptied = null (removes it).
				meeting_link: link[id] === undefined ? undefined : (link[id].trim() || null),
			});
			toast.success('Session confirmed — the founder has been notified in Atlas.');
			void mutate();
		} catch (e) { toast.error((e as Error).message); }
		finally { setPending(null); }
	};

	return (
		<div>
			<PageHeader
				kicker="Review queue"
				title="Strategy sessions"
				subtitle="Quarterly Raise sessions founders have requested. Set a date and time to confirm each — the founder's page updates immediately."
				action={<button className="btn ghost" onClick={() => void mutate()}><RefreshCw size={12} /> Refresh</button>}
			/>

			<FilterBar>
				<input
					className="search-input" style={{ flex: '0 0 240px', height: 32 }}
					placeholder="Search company or founder email…" aria-label="Search strategy sessions"
					value={search} onChange={(e) => f(setSearch)(e.target.value)}
				/>
				<FilterSelect
					ariaLabel="Status" value={state} onChange={f(setState)} allLabel="All statuses"
					options={[{ value: 'requested', label: 'Requested (no time yet)' }, { value: 'confirmed', label: 'Confirmed' }]}
				/>
				{activeFilters > 0 && <button className="btn ghost" onClick={clearFilters}>Clear {activeFilters} filter{activeFilters === 1 ? '' : 's'}</button>}
			</FilterBar>

			<div className="card" ref={cols.ref} style={{ padding: 'var(--space-4)' }}>
				<div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingBottom: 10, marginBottom: 10, borderBottom: '1px solid var(--border)', fontSize: 12, color: 'var(--fg-muted)' }}>
					{data ? `${data.total.toLocaleString()} session${data.total === 1 ? '' : 's'}${activeFilters ? ' match these filters' : ''}` : 'Loading…'} · click a column header to sort
					<span style={{ marginLeft: 'auto' }}>{cols.menu}</span>
</div>
				<AsyncState loading={isLoading} error={error} empty={rows.length === 0} emptyMsg={activeFilters ? 'No sessions match these filters.' : 'No strategy sessions in this view.'} onRetry={() => void mutate()}>
					<table className="data-table">
						<thead>
							<tr>
								<SortableTh label="Requested" field="requested" sort={sort} onSort={f(setSort)} />
								<SortableTh label="Company" field="company" sort={sort} onSort={f(setSort)} />
								<SortableTh label="Founder" field="founder" sort={sort} onSort={f(setSort)} />
								<th>Status</th>
								<SortableTh label="Schedule" field="scheduled" sort={sort} onSort={f(setSort)} />
								<th>Confirm</th>
							</tr>
						</thead>
						<tbody>
							{rows.map((r) => (
								<tr key={r.id}>
									<td style={{ whiteSpace: 'nowrap', color: 'var(--fg-muted)', fontSize: 12 }}>{r.booked_at ? new Date(r.booked_at).toLocaleDateString() : '—'}</td>
									<td style={{ fontSize: 13 }}>{r.company_name ?? '—'}</td>
									<td style={{ fontSize: 12, color: 'var(--fg-muted)' }}>{r.founder_email ?? '—'}</td>
									<td><span className={`chip ${r.scheduled_at ? 'on' : 'warn'}`}>{r.scheduled_at ? 'Confirmed' : 'Requested'}</span></td>
									<td>
										<div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
											<input
												type="datetime-local" className="search-input" style={{ height: 30 }}
												value={when[r.id] ?? (r.scheduled_at ? toLocalInput(r.scheduled_at) : '')}
												onChange={(e) => setWhen((p) => ({ ...p, [r.id]: e.target.value }))}
											/>
											<input
												type="url" className="search-input" style={{ height: 30 }} placeholder="Call link (optional)"
												value={link[r.id] ?? (r.meeting_link ?? '')}
												onChange={(e) => setLink((p) => ({ ...p, [r.id]: e.target.value }))}
											/>
										</div>
									</td>
									<td>
										<button className="btn" disabled={pending === r.id} onClick={() => void confirm(r.id)}>
											{r.scheduled_at ? 'Update' : 'Confirm'}
										</button>
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

/** ISO → the `YYYY-MM-DDTHH:mm` a datetime-local input expects, in local time. */
function toLocalInput(iso: string): string {
	const d = new Date(iso);
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
