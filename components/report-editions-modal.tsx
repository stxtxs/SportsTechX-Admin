'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';
import { Trash2, Save, Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { useConfirm } from '@/components/confirm';
import { Modal } from '@/components/modal';
import { Loading } from '@/components/atoms';
import { ImageInput } from '@/components/image-input';
import { ReportPdfInput } from '@/components/report-pdf-input';

interface Edition {
	id: string; language_code: string; access_tier: string;
	title: string | null; description: string | null; summary_points: string | null;
	cover_url: string | null; pdf_url: string | null; drive_link: string | null;
}
const emptyEdition = () => ({ language_code: '', access_tier: 'explore', title: '', description: '', summary_points: '', cover_url: '', pdf_url: '', drive_link: '' });

/**
 * Manage a report's language/tier editions (report_versions). The English/free
 * edition is canonical (also editable from the metadata form) and can't be
 * deleted here; add other languages with their own PDF / cover / copy.
 */
export function ReportEditionsModal({ id, onClose }: { id: string; onClose: () => void }) {
	const ask = useConfirm();
	const { data, isLoading, mutate } = useSWR<Edition[]>([`/api/admin/reports/${id}/versions`], { revalidateOnFocus: false });
	const [draft, setDraft] = useState(emptyEdition());
	const [editing, setEditing] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	const set = (k: keyof ReturnType<typeof emptyEdition>, v: string) => setDraft((d) => ({ ...d, [k]: v }));
	const editions = data ?? [];

	const edit = (e: Edition) => {
		setEditing(e.id);
		setDraft({ language_code: e.language_code, access_tier: e.access_tier, title: e.title ?? '', description: e.description ?? '', summary_points: e.summary_points ?? '', cover_url: e.cover_url ?? '', pdf_url: e.pdf_url ?? '', drive_link: e.drive_link ?? '' });
	};
	const reset = () => { setEditing(null); setDraft(emptyEdition()); };
	const save = async () => {
		if (!draft.language_code.trim()) { toast.error('Language code is required (e.g. en, fr, de)'); return; }
		setPending(true);
		try {
			await api('POST', `/api/admin/reports/${id}/versions`, {
				language_code: draft.language_code.trim().toLowerCase(), access_tier: draft.access_tier,
				title: draft.title.trim() || null, description: draft.description.trim() || null, summary_points: draft.summary_points.trim() || null,
				cover_url: draft.cover_url.trim() || null, pdf_url: draft.pdf_url.trim() || null, drive_link: draft.drive_link.trim() || null,
			});
			toast.success('Edition saved'); reset(); void mutate();
		} catch (e) { toast.error((e as Error).message); } finally { setPending(false); }
	};
	const remove = async (e: Edition) => {
		if (!(await ask(`Delete the ${e.language_code}/${e.access_tier} edition?`))) return;
		try { await api('DELETE', `/api/admin/reports/${id}/versions/${e.id}`); toast.success('Deleted'); void mutate(); }
		catch (err) { toast.error((err as Error).message); }
	};

	return (
		<Modal title="Language editions" onClose={onClose} width={680} footer={<button className="btn ghost" onClick={onClose}>Close</button>}>
			<div style={{ display: 'grid', gap: 14 }}>
				{isLoading ? <Loading msg="Loading editions…" /> : (
					<table className="data-table" style={{ fontSize: 12 }}>
						<thead><tr><th>Language</th><th>Tier</th><th>Title</th><th>PDF</th><th /></tr></thead>
						<tbody>
							{editions.length === 0 && <tr><td colSpan={5} style={{ color: 'var(--fg-muted)' }}>No editions yet.</td></tr>}
							{editions.map((e) => (
								<tr key={e.id}>
									<td style={{ textTransform: 'uppercase' }}>{e.language_code}</td>
									<td>{e.access_tier}</td>
									<td>{e.title ?? '—'}</td>
									<td>{e.pdf_url ? '✓' : '—'}</td>
									<td style={{ textAlign: 'right', display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
										<button className="btn ghost" onClick={() => edit(e)}>Edit</button>
										{!(e.language_code === 'en' && e.access_tier === 'explore') && (
											<button className="btn ghost" style={{ color: 'var(--accent)' }} onClick={() => void remove(e)}><Trash2 size={12} /></button>
										)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				)}

				<div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 12, display: 'grid', gap: 10, background: 'var(--bg-2)' }}>
					<div style={{ fontWeight: 600, fontSize: 13 }}>{editing ? 'Edit edition' : 'Add edition'}</div>
					<div style={{ display: 'grid', gridTemplateColumns: '120px 140px 1fr', gap: 8 }}>
						{/* Lang + tier are the edition's identity (the upsert key); lock them when
						    editing so a change can't silently fork a new edition. */}
						<input className="search-input" placeholder="Lang (en, fr…)" value={draft.language_code} disabled={!!editing} title={editing ? 'Delete and re-add to change the language' : undefined} onChange={(e) => set('language_code', e.target.value)} />
						<select className="search-input" value={draft.access_tier} disabled={!!editing} onChange={(e) => set('access_tier', e.target.value)}>
							{['explore', 'raise', 'scout'].map((t) => <option key={t} value={t}>{t}</option>)}
						</select>
						<input className="search-input" placeholder="Title (in this language)" value={draft.title} onChange={(e) => set('title', e.target.value)} />
					</div>
					<div><div className="co-stat-label" style={{ marginBottom: 4 }}>PDF</div><ReportPdfInput value={draft.pdf_url} onChange={(u) => set('pdf_url', u)} downloadName={`${draft.title || 'report'}-${draft.language_code}-${draft.access_tier}`} /></div>
					<div><div className="co-stat-label" style={{ marginBottom: 4 }}>Cover image</div><ImageInput value={draft.cover_url} onChange={(u) => set('cover_url', u)} pathPrefix="reports/covers" /></div>
					<input className="search-input" placeholder="Drive link" value={draft.drive_link} onChange={(e) => set('drive_link', e.target.value)} />
					<textarea className="search-input" placeholder="Description" value={draft.description} onChange={(e) => set('description', e.target.value)} style={{ minHeight: 56, resize: 'vertical' }} />
					<textarea className="search-input" placeholder="Summary points (one per line)" value={draft.summary_points} onChange={(e) => set('summary_points', e.target.value)} style={{ minHeight: 48, resize: 'vertical' }} />
					<div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
						{editing && <button className="btn ghost" onClick={reset}>New edition</button>}
						<button className="btn" disabled={pending || !draft.language_code.trim()} onClick={() => void save()}>
							{editing ? <Save size={12} /> : <Plus size={12} />} {pending ? 'Saving…' : editing ? 'Save edition' : 'Add edition'}
						</button>
					</div>
				</div>
			</div>
		</Modal>
	);
}
