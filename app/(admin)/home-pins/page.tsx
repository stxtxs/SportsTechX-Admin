'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';
import { Pin, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader, Section, AsyncState, Tag } from '@/components/atoms';
import { useConfirm } from '@/components/confirm';

/**
 * SportsTechX pins: pinned to every user's Home ("Latest from Atlas", first). A user can unpin one and
 * it stays off their Home; each user sees at most four pins, these included (handover v1 N1).
 *
 *   GET/POST /api/admin/home-pins · DELETE /api/admin/home-pins/:key
 */
type Kind = 'report' | 'guide';
interface PinRow { key: string; kind: Kind | 'newsletter'; title: string; body?: string; href: string; newTab?: boolean; pinned_at: string }
interface Report { slug: string | null; title: string; is_published: boolean; description?: string | null }
interface Guide { slug: string; title: string; summary: string; is_published: boolean }

export default function HomePinsAdminPage() {
	const { data, mutate, isLoading, error } = useSWR<{ data: PinRow[] }>(['/api/admin/home-pins']);
	const { data: reports } = useSWR<{ data: Report[] }>(['/api/reports?limit=100']);
	const { data: guides } = useSWR<{ data: Guide[] }>(['/api/admin/raise-resources']);
	const ask = useConfirm();
	const [kind, setKind] = useState<Kind>('report');
	const [slug, setSlug] = useState('');
	const [busy, setBusy] = useState(false);
	const rows = data?.data ?? [];
	const options = kind === 'report'
		? (reports?.data ?? []).filter((r) => r.is_published && r.slug && !r.slug.endsWith('-yours')).map((r) => ({ slug: r.slug!, title: r.title, body: r.description ?? undefined }))
		: (guides?.data ?? []).filter((g) => g.is_published).map((g) => ({ slug: g.slug, title: g.title, body: g.summary || undefined }));

	const pin = async () => {
		const o = options.find((x) => x.slug === slug);
		if (!o) return;
		setBusy(true);
		try {
			await api('POST', '/api/admin/home-pins', {
				key: `${kind}:${o.slug}`, kind, title: o.title, ...(o.body ? { body: o.body.slice(0, 1000) } : {}),
				href: kind === 'report' ? `/reports/${o.slug}` : `/resources/${o.slug}`, newTab: kind === 'report',
			});
			toast.success('Pinned for everyone');
			setSlug('');
			await mutate();
		} catch (e) { toast.error((e as Error).message ?? 'Pin failed'); }
		finally { setBusy(false); }
	};
	const unpin = async (p: PinRow) => {
		const ok = await ask({ title: `Unpin “${p.title}” for everyone?`, message: 'It leaves every user’s Home. Users who pinned it themselves keep it.', confirmLabel: 'Unpin', danger: true });
		if (!ok) return;
		try { await api('DELETE', `/api/admin/home-pins/${encodeURIComponent(p.key)}`); toast.success('Unpinned'); await mutate(); }
		catch (e) { toast.error((e as Error).message ?? 'Unpin failed'); }
	};

	return (
		<div>
			<PageHeader
				kicker="Content · Atlas Home"
				title="Home pins"
				subtitle="Pinned for every user: shown first in “Latest from Atlas”, newest first. Each user sees at most four pins, these included, and can unpin one for themselves."
			/>
			<Section title="Pin for everyone">
				<div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
					<select className="search-input" value={kind} onChange={(e) => { setKind(e.target.value as Kind); setSlug(''); }}>
						<option value="report">Report</option>
						<option value="guide">Fundraising Guide item</option>
					</select>
					<select className="search-input" style={{ minWidth: 320 }} value={slug} onChange={(e) => setSlug(e.target.value)}>
						<option value="">Choose a published {kind === 'report' ? 'report' : 'guide item'}…</option>
						{options.map((o) => <option key={o.slug} value={o.slug} disabled={rows.some((r) => r.key === `${kind}:${o.slug}`)}>{o.title}</option>)}
					</select>
					{/* Server-enforced too (409): a fifth would leave users no room for their own pins. */}
					<button className="btn" disabled={busy || !slug || rows.length >= 4} title={rows.length >= 4 ? 'Four are pinned for everyone — unpin one first' : undefined} onClick={() => void pin()}><Pin size={13} /> Pin</button>
				</div>
			</Section>
			<div style={{ marginTop: 'var(--space-4)' }}>
				<Section title="Pinned for everyone" meta={`${rows.length} of 4`}>
					{rows.length >= 2 && (
						<p style={{ fontSize: 12, color: 'var(--fg-muted)', margin: '0 0 10px' }}>
							Each user sees at most four pins, these included — with {rows.length} pinned for everyone, users have {Math.max(0, 4 - rows.length)} left for their own.
						</p>
					)}
					<AsyncState loading={isLoading} error={error} empty={rows.length === 0} emptyMsg="Nothing pinned for everyone." onRetry={() => void mutate()}>
						<div className="table-scroll">
							<table className="data-table">
								<thead><tr><th>Item</th><th>Type</th><th>Link</th><th>Pinned</th><th /></tr></thead>
								<tbody>
									{rows.map((p) => (
										<tr key={p.key}>
											<td><div style={{ fontWeight: 600 }}>{p.title}</div>{p.body && <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{p.body}</div>}</td>
											<td><Tag>{p.kind}</Tag></td>
											<td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{p.href}</td>
											<td>{new Date(p.pinned_at).toLocaleDateString(undefined, { month: 'short', day: '2-digit', year: 'numeric' })}</td>
											<td style={{ textAlign: 'right' }}><button className="btn ghost" style={{ color: 'var(--accent)' }} title="Unpin for everyone" onClick={() => void unpin(p)}><Trash2 size={12} /></button></td>
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
