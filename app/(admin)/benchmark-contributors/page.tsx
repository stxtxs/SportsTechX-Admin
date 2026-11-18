'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';
import { UserPlus, Ban } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader, Section, AsyncState, Tag } from '@/components/atoms';
import { useConfirm } from '@/components/confirm';

/**
 * VC Deal Sourcing Benchmark contributors (allowlist per edition). An email on the list keeps the
 * benchmark's gated sections on any plan (also after a downgrade to Explore), and — with "Your
 * benchmark" — sees their personal report once it's generated. Plan changes never remove anyone;
 * only a revoke here does.
 *
 *   GET/POST /api/admin/benchmark/:edition/contributors · POST …/:id/revoke
 */
const EDITION = 2026;
interface Row { id: string; email_normalised: string; report: 'r2' | 'r3'; fund_name: string | null; respondent_name: string | null; source: string; created_at: string; revoked_at: string | null }
const REPORT_LABEL = { r2: 'Full report', r3: 'Your benchmark' } as const;

export default function BenchmarkContributorsPage() {
	const path = `/api/admin/benchmark/${EDITION}/contributors`;
	const { data, mutate, isLoading, error } = useSWR<{ data: Row[] }>([path]);
	const ask = useConfirm();
	const [email, setEmail] = useState('');
	const [fund, setFund] = useState('');
	const [person, setPerson] = useState('');
	const [r3, setR3] = useState(true);
	const [busy, setBusy] = useState(false);
	const rows = data?.data ?? [];
	const live = rows.filter((r) => !r.revoked_at);

	const add = async () => {
		setBusy(true);
		try {
			await api('POST', path, { email, reports: r3 ? ['r2', 'r3'] : ['r2'], ...(fund.trim() ? { fund_name: fund.trim() } : {}), ...(person.trim() ? { respondent_name: person.trim() } : {}) });
			toast.success('Contributor added');
			setEmail(''); setFund(''); setPerson('');
			await mutate();
		} catch (e) { toast.error((e as Error).message ?? 'Add failed'); }
		finally { setBusy(false); }
	};
	const revoke = async (r: Row) => {
		const ok = await ask({ title: `Revoke “${REPORT_LABEL[r.report]}” for ${r.email_normalised}?`, message: r.report === 'r2' ? 'On Explore they lose the gated sections again.' : 'They lose access to their personal report.', confirmLabel: 'Revoke', danger: true });
		if (!ok) return;
		try { await api('POST', `${path}/${r.id}/revoke`); toast.success('Revoked'); await mutate(); }
		catch (e) { toast.error((e as Error).message ?? 'Revoke failed'); }
	};

	return (
		<div>
			<PageHeader
				kicker={`Reports · VC Benchmark ${EDITION}`}
				title="Benchmark contributors"
				subtitle="Funds that answered the survey. They keep the full benchmark on any plan, also after a downgrade to Explore, and see “Your benchmark” once their personal report is generated. Emails match without +tags and case."
			/>
			<Section title="Add a contributor">
				<div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
					<input className="search-input" type="email" placeholder="Survey email" style={{ minWidth: 260 }} value={email} onChange={(e) => setEmail(e.target.value)} />
					<input className="search-input" placeholder="Fund (optional)" value={fund} maxLength={200} onChange={(e) => setFund(e.target.value)} />
					<input className="search-input" placeholder="Respondent (optional)" value={person} maxLength={200} onChange={(e) => setPerson(e.target.value)} />
					<label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
						<input type="checkbox" checked={r3} onChange={(e) => setR3(e.target.checked)} /> Also “Your benchmark”
					</label>
					<button className="btn" disabled={busy || !email.includes('@')} onClick={() => void add()}><UserPlus size={13} /> Add</button>
				</div>
			</Section>
			<div style={{ marginTop: 'var(--space-4)' }}>
				<Section title="Contributors" meta={`${new Set(live.map((r) => r.email_normalised)).size} active`}>
					<AsyncState loading={isLoading} error={error} empty={rows.length === 0} emptyMsg="No contributors yet." onRetry={() => void mutate()}>
						<div className="table-scroll">
							<table className="data-table">
								<thead><tr><th>Email</th><th>Fund</th><th>Access</th><th>Added</th><th>Status</th><th /></tr></thead>
								<tbody>
									{rows.map((r) => (
										<tr key={r.id} style={{ opacity: r.revoked_at ? 0.55 : 1 }}>
											<td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{r.email_normalised}</td>
											<td>{r.fund_name ?? '—'}{r.respondent_name && <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{r.respondent_name}</div>}</td>
											<td><Tag variant={r.report === 'r3' ? 'pos' : ''}>{REPORT_LABEL[r.report]}</Tag></td>
											<td>{new Date(r.created_at).toLocaleDateString(undefined, { month: 'short', day: '2-digit', year: 'numeric' })}</td>
											<td>{r.revoked_at ? 'Revoked' : 'Active'}</td>
											<td style={{ textAlign: 'right' }}>{!r.revoked_at && <button className="btn ghost" style={{ color: 'var(--accent)' }} title="Revoke" onClick={() => void revoke(r)}><Ban size={12} /></button>}</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					</AsyncState>
				</Section>
			</div>
		</div>
	);
}
