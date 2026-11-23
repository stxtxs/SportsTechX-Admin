'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';
import { RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader, AsyncState, Pager } from '@/components/atoms';
import { useUrlNumber } from '@/hooks/use-url-state';

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
	const [when, setWhen] = useState<Record<string, string>>({});
	const [link, setLink] = useState<Record<string, string>>({});
	const [pending, setPending] = useState<string | null>(null);
	const [page, setPage] = useUrlNumber('ss', 'page', 1);

	// Only 'booked' rows exist (bookStrategy always inserts 'booked'; locked/
	// available are states the home service derives, never persisted), so there's
	// nothing to filter — the "requested"/"confirmed" chip carries the distinction.
	// Paged (was the first 100 only, newest first).
	const { data, error, isLoading, mutate } = useSWR<Resp>(
		['/api/admin/strategy-sessions', { status: 'booked', limit: LIMIT, offset: (page - 1) * LIMIT }],
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
				meeting_link: link[id]?.trim() || null,
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

			<div className="card" style={{ padding: 'var(--space-4)' }}>
				<AsyncState loading={isLoading} error={error} empty={rows.length === 0} emptyMsg="No strategy sessions in this view." onRetry={() => void mutate()}>
					<table className="data-table">
						<thead>
							<tr><th>Requested</th><th>Company</th><th>Founder</th><th>Status</th><th>Schedule</th><th>Confirm</th></tr>
						</thead>
						<tbody>
							{rows.map((r) => (
								<tr key={r.id}>
									<td style={{ whiteSpace: 'nowrap', color: 'var(--fg-muted)', fontSize: 12 }}>{r.booked_at ? new Date(r.booked_at).toLocaleDateString() : '—'}</td>
									<td style={{ fontSize: 13 }}>{r.company_name ?? '—'}</td>
									<td style={{ fontSize: 12, color: 'var(--fg-muted)' }}>{r.founder_email ?? '—'}</td>
									<td><span className={`chip ${r.scheduled_at ? 'on' : 'warn'}`}>{r.scheduled_at ? 'confirmed' : 'requested'}</span></td>
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
