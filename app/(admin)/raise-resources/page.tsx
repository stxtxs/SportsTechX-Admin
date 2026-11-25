'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader, Section, AsyncState, Tag, useClientPage } from '@/components/atoms';
import { useConfirm } from '@/components/confirm';

/**
 * Atlas Raise — Fundraising Guide content (raise_resources). Founders on Raise
 * read published rows at /resources, grouped Prepare → Connect → Close.
 *
 *   GET/POST /api/admin/raise-resources · PATCH/DELETE /api/admin/raise-resources/:id
 */
type Phase = 'prepare' | 'connect' | 'close';
type Kind = 'guide' | 'template' | 'checklist';
interface Resource {
	id: string; slug: string; phase: Phase; kind: Kind; title: string; summary: string; body_md: string;
	sort_order: number; is_published: boolean; updated_at: string; founders_using: number;
}
type Draft = Omit<Resource, 'id' | 'updated_at' | 'founders_using'> & { id?: string };
const BLANK: Draft = { slug: '', phase: 'prepare', kind: 'guide', title: '', summary: '', body_md: '', sort_order: 0, is_published: false };
const PHASES: Phase[] = ['prepare', 'connect', 'close'];
const KINDS: Kind[] = ['guide', 'template', 'checklist'];
const items = (body: string) => body.split(/\r?\n/).filter((l) => /^\s*-\s\[\s?\]\s+\S/.test(l)).length;

export default function RaiseResourcesAdminPage() {
	const { data, mutate, isLoading, error } = useSWR<{ data: Resource[] }>(['/api/admin/raise-resources']);
	const rows = data?.data ?? [];
	const pg = useClientPage(rows);
	const ask = useConfirm();
	const [draft, setDraft] = useState<Draft | null>(null);
	const [busy, setBusy] = useState(false);
	const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d));

	const save = async () => {
		if (!draft) return;
		setBusy(true);
		try {
			const { id, slug, ...fields } = draft;
			if (id) await api('PATCH', `/api/admin/raise-resources/${id}`, fields);
			else await api('POST', '/api/admin/raise-resources', { slug, ...fields });
			toast.success(id ? 'Saved' : 'Resource created');
			setDraft(null);
			await mutate();
		} catch (e) { toast.error((e as Error).message ?? 'Save failed'); }
		finally { setBusy(false); }
	};
	const togglePublish = async (r: Resource) => {
		try { await api('PATCH', `/api/admin/raise-resources/${r.id}`, { is_published: !r.is_published }); await mutate(); }
		catch (e) { toast.error((e as Error).message ?? 'Update failed'); }
	};
	const remove = async (r: Resource) => {
		const ok = await ask({
			title: `Delete "${r.title}"?`,
			message: r.founders_using ? `${r.founders_using} founder(s) have ticked items on it — their progress goes too. Unpublishing hides it instead.` : 'It is removed from the guide for good. Unpublishing hides it instead.',
			confirmLabel: 'Delete', danger: true,
		});
		if (!ok) return;
		try { await api('DELETE', `/api/admin/raise-resources/${r.id}`); toast.success('Deleted'); await mutate(); }
		catch (e) { toast.error((e as Error).message ?? 'Delete failed'); }
	};

	return (
		<div>
			<PageHeader
				kicker="Content · Atlas Raise"
				title="Fundraising Guide"
				subtitle="Guides, templates and checklists founders see at Resources → Fundraising Guide, grouped Prepare → Connect → Close. In the body, “- [ ] item” lines become a checklist founders can tick, and “> ” lines in a template become a block with a Copy button."
			/>

			{draft ? (
				<Section title={draft.id ? `Edit “${draft.title || draft.slug}”` : 'New resource'} meta={draft.kind === 'checklist' ? `${items(draft.body_md)} checklist items` : undefined}>
					<div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
						<Field label="Title"><input className="search-input" style={{ width: '100%' }} value={draft.title} onChange={(e) => set('title', e.target.value)} /></Field>
						<Field label="Slug" hint={draft.id ? 'fixed' : 'lowercase, dashes'}>
							<input className="search-input" style={{ width: '100%', fontFamily: 'var(--font-mono)' }} disabled={!!draft.id} value={draft.slug}
								onChange={(e) => set('slug', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} />
						</Field>
						<Field label="Phase"><select className="search-input" style={{ width: '100%' }} value={draft.phase} onChange={(e) => set('phase', e.target.value as Phase)}>{PHASES.map((p) => <option key={p} value={p}>{p}</option>)}</select></Field>
						<Field label="Type"><select className="search-input" style={{ width: '100%' }} value={draft.kind} onChange={(e) => set('kind', e.target.value as Kind)}>{KINDS.map((k) => <option key={k} value={k}>{k}</option>)}</select></Field>
						<Field label="Order"><input className="search-input" type="number" style={{ width: '100%' }} value={draft.sort_order} onChange={(e) => set('sort_order', Number(e.target.value) || 0)} /></Field>
						<div style={{ gridColumn: '1 / -1' }}><Field label="Summary" hint="one line on the card"><input className="search-input" style={{ width: '100%' }} maxLength={300} value={draft.summary} onChange={(e) => set('summary', e.target.value)} /></Field></div>
						<div style={{ gridColumn: '1 / -1' }}>
							<Field label="Body" hint="markdown · “- [ ] item” = checklist · “> ” = template block">
								<textarea className="search-input" style={{ width: '100%', minHeight: 380, fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: 1.55, resize: 'vertical' }}
									value={draft.body_md} onChange={(e) => set('body_md', e.target.value)} />
							</Field>
						</div>
					</div>
					<div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 14, flexWrap: 'wrap' }}>
						<label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
							<input type="checkbox" checked={draft.is_published} onChange={(e) => set('is_published', e.target.checked)} /> Published
						</label>
						<button className="btn" disabled={busy || !draft.title.trim() || (!draft.id && !draft.slug)} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</button>
						<button className="btn ghost" disabled={busy} onClick={() => setDraft(null)}>Cancel</button>
					</div>
				</Section>
			) : (
				<button className="btn" onClick={() => setDraft({ ...BLANK })}><Plus size={13} /> New resource</button>
			)}

			<div style={{ marginTop: 'var(--space-4)' }}>
				<Section title="All resources" meta={`${rows.filter((r) => r.is_published).length} published · ${rows.length} total`}>
					<AsyncState loading={isLoading} error={error} empty={rows.length === 0} emptyMsg="No resources yet." onRetry={() => void mutate()}>
						<div className="table-scroll">
							<table className="data-table">
								<thead><tr><th>Resource</th><th>Phase</th><th>Type</th><th style={{ textAlign: 'right' }}>Founders using</th><th>Status</th><th /></tr></thead>
								<tbody>
									{pg.rows.map((r) => (
										<tr key={r.id} style={{ opacity: r.is_published ? 1 : 0.6 }}>
											<td>
												<div style={{ fontWeight: 600 }}>{r.title}</div>
												<div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{r.summary}</div>
											</td>
											<td style={{ textTransform: 'capitalize' }}>{r.phase}</td>
											<td><Tag variant={r.kind === 'checklist' ? 'pos' : ''}>{r.kind}{r.kind === 'checklist' ? ` · ${items(r.body_md)}` : ''}</Tag></td>
											<td className="num" style={{ textAlign: 'right' }}>{r.founders_using}</td>
											<td>
												<button type="button" className={`chip ${r.is_published ? 'on' : ''}`} onClick={() => void togglePublish(r)}
													title={r.is_published ? 'Visible to founders — click to hide' : 'Draft — click to publish'}>
													{r.is_published ? 'Published' : 'Draft'}
												</button>
											</td>
											<td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
												<button className="btn ghost" title="Edit" onClick={() => setDraft({ id: r.id, slug: r.slug, phase: r.phase, kind: r.kind, title: r.title, summary: r.summary, body_md: r.body_md, sort_order: r.sort_order, is_published: r.is_published })}><Pencil size={12} /></button>
												<button className="btn ghost" style={{ color: 'var(--accent)' }} title="Delete" onClick={() => void remove(r)}><Trash2 size={12} /></button>
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
						{pg.pager}
					</AsyncState>
				</Section>
			</div>
		</div>
	);
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
	return (
		<div>
			<div className="co-stat-label" style={{ marginBottom: 6 }}>
				{label}{hint && <span style={{ color: 'var(--fg-muted)', fontWeight: 400 }}> · {hint}</span>}
			</div>
			{children}
		</div>
	);
}
