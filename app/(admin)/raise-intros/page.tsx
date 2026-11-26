'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';
import { Download, RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useUrlState, useUrlNumber } from '@/hooks/use-url-state';
import { PageHeader, AsyncState, SortableTh, Pager } from '@/components/atoms';
import { FilterBar, FilterSelect } from '@/components/filters';
import { useConfirm } from '@/components/confirm';
import { downloadCsv } from '@/components/csv-import';

/**
 * Deal Flow introductions (spec 2.3). A scout asks to be introduced to a raise; SportsTechX
 * approves it (the founder gets an email with Accept / Decline, and sees it in Raise) or
 * declines it (the scout sees "Not right now"). On Accept, Atlas emails both, copying
 * atlas@sportstechx.com. Founders get a reminder after 3 working days; after 7 the request
 * closes as "No response". Every request stays here for tracking, and exports to CSV.
 */
interface Intro {
	id: string;
	status: string;
	note: string | null;
	admin_note: string | null;
	created_at: string;
	approved_at: string | null;
	sent_to_founder_at: string | null;
	reminded_at: string | null;
	decided_at: string | null;
	declined_by: 'stx' | 'founder' | null;
	deal_id: string;
	source: string;
	is_test: boolean;
	company_name: string | null;
	scout_name: string | null;
	scout_email: string | null;
	scout_org: string | null;
	scout_verified: boolean;
	founder_name: string | null;
	founder_email: string | null;
	approved_by_email: string | null;
}
interface Resp { data: Intro[]; total: number; totalPages: number }

const STATUS: Record<string, { label: string; chip: string }> = {
	received: { label: 'Requested', chip: 'warn' },
	source_confirmed: { label: 'Requested', chip: 'warn' },
	shared: { label: 'With the founder', chip: '' },
	connected: { label: 'Introduced', chip: 'on' },
	declined: { label: 'Not right now', chip: '' },
	no_response: { label: 'No response', chip: '' },
};
const FILTERS = [
	{ value: 'open', label: 'Waiting for SportsTechX' }, { value: 'shared', label: 'With the founder' },
	{ value: 'connected', label: 'Introduced' }, { value: 'declined', label: 'Not right now' }, { value: 'no_response', label: 'No response' },
];
const label = (s: string) => STATUS[s]?.label ?? s;
const day = (d: string | null) => (d ? new Date(d).toLocaleDateString() : '');
const declinedBy = (r: Intro) => (r.status === 'declined' ? (r.declined_by === 'stx' ? 'by SportsTechX' : 'by the founder') : '');

export default function RaiseIntrosPage() {
	const ask = useConfirm();
	const [status, setStatus] = useUrlState('ri', 'status', 'open');
	const [search, setSearch] = useUrlState('ri', 'q');
	const [sort, setSort] = useUrlState('ri', 'sort', '-created');
	const [page, setPage] = useUrlNumber('ri', 'page', 1);
	const debounced = useDebouncedValue(search);
	const [pending, setPending] = useState<string | null>(null);
	const [exporting, setExporting] = useState(false);
	const f = (set: (v: string) => void) => (v: string) => { set(v); setPage(1); };
	const activeFilters = (status ? 1 : 0) + (search ? 1 : 0);
	const query = { status: status || undefined, search: debounced || undefined, sort };

	const { data, error, isLoading, mutate } = useSWR<Resp>(
		['/api/admin/raise-intros', { ...query, limit: 25, offset: (page - 1) * 25 }],
		{ dedupingInterval: 10_000 },
	);
	const rows = data?.data ?? [];

	const act = async (r: Intro, action: 'approve' | 'decline') => {
		const who = r.scout_org ?? r.scout_name ?? 'this scout';
		const ok = await ask(action === 'approve'
			? { title: 'Send to the founder?', message: `${r.founder_name ?? 'The founder'} (${r.founder_email ?? 'no email on file'}) gets an email from Atlas asking to accept or decline an introduction to ${who}. No contact details are shared until they accept.${r.is_test ? ' Test raise: nothing is sent.' : ''}`, confirmLabel: 'Send to founder' }
			: { title: 'Decline this request?', message: `${who} sees "Not right now" for ${r.company_name ?? 'this raise'}, with no reason given. The founder is not contacted.`, confirmLabel: 'Decline', danger: true });
		if (!ok) return;
		setPending(r.id);
		try {
			await api('POST', `/api/admin/raise-intros/${r.id}/${action}`, {});
			toast.success(action === 'approve' ? 'Sent to the founder' : 'Declined');
			void mutate();
		} catch (e) { toast.error((e as Error).message); }
		finally { setPending(null); }
	};

	const exportCsv = async () => {
		setExporting(true);
		try {
			const all = await api<Resp>('GET', `/api/admin/raise-intros?${new URLSearchParams(Object.entries({ ...query, limit: '5000', offset: '0' }).filter(([, v]) => v) as [string, string][])}`);
			downloadCsv('deal-flow-introductions.csv',
				['requested', 'status', 'declined_by', 'raise', 'test', 'scout', 'scout_email', 'organisation', 'scout_verified', 'founder', 'founder_email', 'note', 'approved_by', 'sent_to_founder', 'reminded', 'decided'],
				all.data.map((r) => [
					r.created_at, label(r.status), r.declined_by ?? '', r.company_name ?? '', r.is_test ? 'yes' : '', r.scout_name ?? '', r.scout_email ?? '',
					r.scout_org ?? '', r.scout_verified ? 'yes' : 'no', r.founder_name ?? '', r.founder_email ?? '', r.note ?? '', r.approved_by_email ?? '',
					r.sent_to_founder_at ?? '', r.reminded_at ?? '', r.decided_at ?? '',
				]));
		} catch (e) { toast.error((e as Error).message); }
		finally { setExporting(false); }
	};

	return (
		<div>
			<PageHeader
				kicker="Review queue"
				title="Deal Flow introductions"
				subtitle="Scouts asking to meet a raise's founder. Send each to the founder, who accepts or declines, or decline it here. Every request is tracked."
				action={<div style={{ display: 'flex', gap: 8 }}>
					<button className="btn ghost" disabled={exporting} onClick={() => void exportCsv()}><Download size={12} /> {exporting ? 'Exporting…' : 'Export CSV'}</button>
					<button className="btn ghost" onClick={() => void mutate()}><RefreshCw size={12} /> Refresh</button>
				</div>}
			/>

			<FilterBar>
				<input
					className="search-input" style={{ flex: '0 0 280px', height: 32 }}
					placeholder="Search raise, scout or organisation…" aria-label="Search introductions" value={search}
					onChange={(e) => f(setSearch)(e.target.value)}
				/>
				<FilterSelect ariaLabel="Status" value={status} onChange={f(setStatus)} allLabel="All statuses" options={FILTERS} />
				{activeFilters > 0 && <button className="btn ghost" onClick={() => { setStatus(''); setSearch(''); setPage(1); }}>Clear {activeFilters} filter{activeFilters === 1 ? '' : 's'}</button>}
			</FilterBar>

			<div className="card">
				<div style={{ padding: '10px var(--space-4)', borderBottom: '1px solid var(--border)', fontSize: 12, color: 'var(--fg-muted)' }}>
					{data ? `${data.total.toLocaleString()} request${data.total === 1 ? '' : 's'}` : 'Loading…'} · founders are reminded after 3 working days; requests close after 7
				</div>
				<AsyncState loading={isLoading} error={error} empty={rows.length === 0} emptyMsg={status === 'open' ? 'Nothing waiting. New requests show up here.' : 'No introductions match these filters.'} onRetry={() => void mutate()}>
					<table className="data-table">
						<thead>
							<tr>
								<SortableTh label="Requested" field="created" sort={sort} onSort={f(setSort)} />
								<SortableTh label="Raise" field="company" sort={sort} onSort={f(setSort)} />
								<th>Scout</th>
								<th>Founder</th>
								<th>Note</th>
								<SortableTh label="Status" field="status" sort={sort} onSort={f(setSort)} />
								<th>Actions</th>
							</tr>
						</thead>
						<tbody>
							{rows.map((r) => {
								const open = r.status === 'received' || r.status === 'source_confirmed';
								return (
									<tr key={r.id}>
										<td style={{ whiteSpace: 'nowrap', color: 'var(--fg-muted)', fontSize: 12 }}>{day(r.created_at)}</td>
										<td>
											<div style={{ fontSize: 13 }}>{r.company_name ?? '—'} {r.is_test && <span className="chip">test</span>}</div>
											<div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{r.source === 'circle' ? 'From Boardroom' : 'Verified raise'}</div>
										</td>
										<td>
											<div style={{ fontSize: 13 }}>{r.scout_name ?? '—'}{r.scout_org ? ` · ${r.scout_org}` : ''}</div>
											<div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{r.scout_email ?? ''}{r.scout_verified ? ' · verified' : ''}</div>
										</td>
										<td>
											<div style={{ fontSize: 13 }}>{r.founder_name ?? '—'}</div>
											<div style={{ fontSize: 11, color: r.founder_email ? 'var(--fg-muted)' : 'var(--danger, #c33)' }}>{r.founder_email ?? 'No founder email'}</div>
										</td>
										<td style={{ maxWidth: 260, fontSize: 12, color: 'var(--fg-2)' }}>{r.note ?? '—'}</td>
										<td>
											<span className={`chip ${STATUS[r.status]?.chip ?? ''}`}>{label(r.status)}</span>
											<div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 4 }}>
												{declinedBy(r)}
												{r.status === 'shared' && `sent ${day(r.sent_to_founder_at)}${r.reminded_at ? ` · reminded ${day(r.reminded_at)}` : ''}`}
												{r.decided_at && r.status !== 'shared' && ` ${day(r.decided_at)}`}
											</div>
										</td>
										<td>
											{open ? (
												<div style={{ display: 'flex', gap: 6 }}>
													<button className="btn" disabled={pending === r.id || (!r.founder_email && !r.is_test)} title={!r.founder_email && !r.is_test ? 'Add the founder contact on the raise first' : undefined} onClick={() => void act(r, 'approve')}>Send to founder</button>
													<button className="btn ghost" disabled={pending === r.id} onClick={() => void act(r, 'decline')}>Decline</button>
												</div>
											) : <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{r.approved_by_email ? `by ${r.approved_by_email}` : ''}</span>}
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</AsyncState>
			</div>
			<Pager page={page} totalPages={data?.totalPages} onPage={setPage} />
		</div>
	);
}
