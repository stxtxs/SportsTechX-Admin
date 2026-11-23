'use client';

import { useRef, useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { toast } from 'sonner';
import { Plus, Trash2, Save, X, Search } from 'lucide-react';
import { api } from '@/lib/api';
import { Select } from '@/components/select';
import { useConfirm } from '@/components/confirm';
import { Modal } from '@/components/modal';
import { PageHeader, AsyncState, Tag, Loading } from '@/components/atoms';
import { TabbedForm, Field, useTabs } from '@/components/tabbed-form';
import { YearSelect } from '@/components/year-select';
import { useEditPayload } from '@/hooks/use-edit-payload';

const ENTITY_TYPES = ['companies', 'investors', 'deals', 'acquisitions', 'programs', 'events'] as const;
type EntityType = (typeof ENTITY_TYPES)[number];

interface FeaturedList {
	id: string; name: string; description: string | null; entity_type: string;
	share_slug: string | null; is_premium: boolean; show_in_lists: boolean; item_count?: number;
	filters?: unknown; month?: string | null; year?: number | null;
}
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
interface ListItem { entity_key: string; entity_label: string | null }

// Map an entity type to its search endpoint + result shape.
async function searchEntity(type: EntityType, q: string): Promise<Array<{ key: string; label: string }>> {
	const enc = encodeURIComponent(q);
	if (type === 'companies') {
		const r = await api<{ data: Array<{ id: string; name: string }> }>('GET', `/api/companies?q=${enc}&limit=8`);
		return r.data.map((c) => ({ key: c.id, label: c.name }));
	}
	if (type === 'investors') {
		const r = await api<{ data: Array<{ id: string; name: string }> }>('GET', `/api/investors?q=${enc}&limit=8`);
		return r.data.map((c) => ({ key: c.id, label: c.name }));
	}
	if (type === 'deals') {
		const r = await api<{ data: Array<{ id: string; company_name: string | null }> }>('GET', `/api/deals?q=${enc}&limit=8`);
		return r.data.map((d) => ({ key: d.id, label: d.company_name ?? d.id }));
	}
	if (type === 'acquisitions') {
		const r = await api<{ data: Array<{ id: string; acquiree_name: string | null }> }>('GET', `/api/acquisitions?q=${enc}&limit=8`);
		return r.data.map((d) => ({ key: d.id, label: d.acquiree_name ?? d.id }));
	}
	// programs / events — the API filters by `entity_type` and searches by `q` (it ignores `type`).
	const r = await api<{ data: Array<{ id: string; name: string }> }>('GET', `/api/ecosystem-entities?entity_type=${type === 'programs' ? 'program' : 'event'}&q=${enc}&limit=8`);
	return r.data.map((e) => ({ key: e.id, label: e.name }));
}

export default function FeaturedListsPage() {
	const { mutate } = useSWRConfig();
	const ask = useConfirm();
	const [creating, setCreating] = useState(false);
	const [editingId, setEditingId] = useState<string | null>(null);

	const { data, error, isLoading } = useSWR<FeaturedList[]>(['/api/admin/featured-lists'], { dedupingInterval: 15_000 });
	const refresh = () => mutate((key) => Array.isArray(key) && typeof key[0] === 'string' && key[0].startsWith('/api/admin/featured-lists'));

	const remove = async (id: string, name: string) => {
		if (!(await ask(`Delete "${name}"?`))) return;
		try { await api('DELETE', `/api/admin/featured-lists/${id}`); toast.success('Deleted'); refresh(); }
		catch (e) { toast.error((e as Error).message); }
	};
	// No "Copy share link": it pointed at /lists/s/<slug> on the ADMIN origin (a 404), and Atlas
	// has no page that renders a featured list yet. Bring it back with that page.

	const lists = data ?? [];
	return (
		<div>
			<PageHeader kicker="Curation · featured lists" title="Featured lists" subtitle="Curated collections, filter-based or hand-picked. Atlas doesn't show them yet — no public page or share link." />

			<div className="filter-bar" style={{ marginBottom: 'var(--space-4)' }}>
				<div style={{ flex: 1 }} />
				<button className="btn" onClick={() => setCreating(true)}><Plus size={12} /> New list</button>
			</div>

			{(creating || editingId) && (
				<ListModal id={editingId} onClose={() => { setCreating(false); setEditingId(null); }} onSaved={() => { setCreating(false); setEditingId(null); refresh(); }} />
			)}

			<div className="card">
				<AsyncState loading={isLoading} error={error} empty={lists.length === 0} emptyMsg="No featured lists yet." onRetry={refresh}>
					<table className="data-table">
						<thead><tr><th>Name</th><th>Entity</th><th>Mode</th><th style={{ textAlign: 'right' }}>Items</th><th>Period</th><th>Visibility</th><th>Premium</th><th style={{ textAlign: 'right' }} /></tr></thead>
						<tbody>
							{lists.map((l) => (
								<tr key={l.id}>
									<td><div style={{ maxWidth: 420 }}><div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.name}</div>{l.description && <div title={l.description} style={{ fontSize: 11, color: 'var(--fg-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.description}</div>}</div></td>
									<td style={{ textTransform: 'capitalize' }}>{l.entity_type}</td>
									<td>{l.filters ? <Tag>filter</Tag> : <Tag variant="pos">manual</Tag>}</td>
									<td className="num" style={{ textAlign: 'right' }}>{l.item_count ?? 0}</td>
									<td className="num" style={{ whiteSpace: 'nowrap' }}>{l.year ? `${l.month ? l.month.slice(0, 3) + ' ' : ''}${l.year}` : '—'}</td>
									<td>{l.show_in_lists ? <Tag variant="pos">in lists</Tag> : <Tag>hidden</Tag>}</td>
									<td>{l.is_premium ? <Tag variant="warn">premium</Tag> : '—'}</td>
									<td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
										<button className="btn ghost" onClick={() => setEditingId(l.id)}>Edit</button>
										<button className="btn ghost" style={{ color: 'var(--accent)', marginLeft: 6 }} onClick={() => void remove(l.id, l.name)}><Trash2 size={12} /></button>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</AsyncState>
			</div>
		</div>
	);
}

interface ListForm {
	name: string; description: string; entity_type: EntityType;
	is_premium: boolean; show_in_lists: boolean; mode: 'manual' | 'filter';
	month: string; year: string;
	items: ListItem[]; filtersJson: string;
}
const EMPTY: ListForm = {
	name: '', description: '', entity_type: 'companies', is_premium: false, show_in_lists: true,
	mode: 'manual', month: '', year: '', items: [], filtersJson: '',
};

interface ListDetail extends FeaturedList { filters: unknown; items: ListItem[] }

function toListForm(h: ListDetail): ListForm {
	return {
		name: h.name ?? '', description: h.description ?? '',
		entity_type: (h.entity_type as EntityType) ?? 'companies',
		is_premium: !!h.is_premium, show_in_lists: h.show_in_lists !== false,
		mode: h.filters ? 'filter' : 'manual',
		month: h.month ?? '', year: h.year ? String(h.year) : '',
		items: h.items ?? [],
		filtersJson: h.filters ? JSON.stringify(h.filters, null, 2) : '',
	};
}

function ListModal({ id, onClose, onSaved }: { id: string | null; onClose: () => void; onSaved: () => void }) {
	const isEdit = !!id;
	const { data: hydrated } = useEditPayload<ListDetail>(isEdit ? `/api/admin/featured-lists/${id}` : null);
	if (isEdit && !hydrated) return <Modal title="Edit featured list" onClose={onClose}><Loading msg="Loading list…" /></Modal>;
	return <ListForm id={id} initial={hydrated ? toListForm(hydrated) : EMPTY} onClose={onClose} onSaved={onSaved} />;
}

function ListForm({ id, initial, onClose, onSaved }: { id: string | null; initial: ListForm; onClose: () => void; onSaved: () => void }) {
	const isEdit = !!id;
	const [tab, setTab] = useTabs('basics');
	const [form, setForm] = useState<ListForm>(initial);
	const [pending, setPending] = useState(false);

	const set = <K extends keyof ListForm>(k: K, v: ListForm[K]) => setForm((f) => ({ ...f, [k]: v }));

	const submit = async () => {
		setPending(true);
		try {
			const body: Record<string, unknown> = {
				name: form.name.trim(), description: form.description.trim() || (isEdit ? null : undefined),
				entity_type: form.entity_type, is_premium: form.is_premium, show_in_lists: form.show_in_lists,
				month: form.month || null, year: form.year ? Number(form.year) : null,
			};
			if (form.mode === 'filter') {
				body.filters = form.filtersJson.trim() ? JSON.parse(form.filtersJson) : null;
				body.items = [];
			} else {
				body.items = form.items.map((i) => ({ entity_key: i.entity_key, entity_label: i.entity_label ?? undefined }));
				body.filters = null;
			}
			if (isEdit) await api('PATCH', `/api/admin/featured-lists/${id}`, body);
			else await api('POST', '/api/admin/featured-lists', body);
			toast.success(isEdit ? 'Saved' : 'Created');
			onSaved();
		} catch (e) { toast.error((e as Error).message); } finally { setPending(false); }
	};

	return (
		<Modal title={isEdit ? 'Edit featured list' : 'New featured list'} onClose={onClose} width={680} footer={
			<>
				<button className="btn ghost" onClick={onClose}>Cancel</button>
				<button className="btn" disabled={!form.name.trim() || pending} onClick={() => void submit()}><Save size={12} /> {pending ? 'Saving…' : 'Save'}</button>
			</>
		}>
			{(
				<TabbedForm active={tab} onChange={setTab} tabs={[
					{ key: 'basics', label: 'Basics', node: (
						<>
							<Field label="Name"><input className="search-input" value={form.name} onChange={(e) => set('name', e.target.value)} /></Field>
							<Field label="Description"><textarea className="search-input" style={{ minHeight: 60, resize: 'vertical' }} value={form.description} onChange={(e) => set('description', e.target.value)} /></Field>
							<Field label="Entity type" hint={isEdit ? 'fixed after creation' : undefined}>
								<Select value={form.entity_type} onChange={(v) => set('entity_type', v as EntityType)} disabled={isEdit} width="100%" style={{ display: 'block', width: '100%' }} options={ENTITY_TYPES.map((t) => ({ value: t, label: t }))} />
							</Field>
							<div style={{ display: 'grid', gridTemplateColumns: '1fr 120px', gap: 12 }}>
								<Field label="Month (optional)">
									<Select value={form.month} onChange={(v) => set('month', v)} searchable width="100%" style={{ display: 'block', width: '100%' }} placeholder="—" options={[{ value: '', label: '—' }, ...MONTHS.map((m) => ({ value: m, label: m }))]} />
								</Field>
								<Field label="Year (optional)"><YearSelect value={form.year} onChange={(v) => set('year', v)} placeholder="—" /></Field>
							</div>
							<Field label="Mode">
								<div style={{ display: 'flex', gap: 6 }}>
									<button type="button" className={`chip ${form.mode === 'manual' ? 'on' : ''}`} onClick={() => set('mode', 'manual')}>Hand-picked</button>
									<button type="button" className={`chip ${form.mode === 'filter' ? 'on' : ''}`} onClick={() => set('mode', 'filter')}>Filter-based</button>
								</div>
							</Field>
							<div style={{ display: 'flex', gap: 16 }}>
								<label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}><input type="checkbox" checked={form.is_premium} onChange={(e) => set('is_premium', e.target.checked)} /> Premium</label>
								<label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}><input type="checkbox" checked={form.show_in_lists} onChange={(e) => set('show_in_lists', e.target.checked)} /> Show in lists</label>
							</div>
						</>
					) },
					...(form.mode === 'manual' ? [{
						key: 'items', label: 'Records', hint: form.items.length, node: (
							<ManualItems entityType={form.entity_type} items={form.items} onChange={(v) => set('items', v)} />
						),
					}, {
						key: 'csv', label: 'CSV import', node: (
							<CsvImport entityType={form.entity_type} onAdd={(added) => set('items', dedupeItems([...form.items, ...added]))} />
						),
					}] : [{
						key: 'filter', label: 'Filter', node: (
							<Field label="Filter JSON" hint="saved filter combo applied on the entity page">
								<textarea className="search-input" style={{ minHeight: 200, resize: 'vertical', fontFamily: 'var(--font-mono)', fontSize: 12 }}
									value={form.filtersJson} onChange={(e) => set('filtersJson', e.target.value)} placeholder='{ "sector_slug": ["sports-media"], "country": ["United States"] }' />
							</Field>
						),
					}]),
				]} />
			)}
		</Modal>
	);
}

function dedupeItems(items: ListItem[]): ListItem[] {
	const seen = new Set<string>();
	return items.filter((i) => (seen.has(i.entity_key) ? false : (seen.add(i.entity_key), true)));
}

function ManualItems({ entityType, items, onChange }: { entityType: EntityType; items: ListItem[]; onChange: (v: ListItem[]) => void }) {
	const [q, setQ] = useState('');
	const [hits, setHits] = useState<Array<{ key: string; label: string }>>([]);
	const [searching, setSearching] = useState(false);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

	// Debounced search driven by the input handler (not an effect) so we never
	// call setState synchronously inside an effect body.
	const onQuery = (val: string) => {
		setQ(val);
		if (timer.current) clearTimeout(timer.current);
		if (val.trim().length < 2) { setHits([]); setSearching(false); return; }
		setSearching(true);
		timer.current = setTimeout(async () => {
			try { setHits(await searchEntity(entityType, val.trim())); }
			catch { setHits([]); }
			finally { setSearching(false); }
		}, 250);
	};

	const add = (h: { key: string; label: string }) => {
		if (items.some((i) => i.entity_key === h.key)) return;
		onChange([...items, { entity_key: h.key, entity_label: h.label }]);
		setQ('');
	};
	const remove = (key: string) => onChange(items.filter((i) => i.entity_key !== key));

	return (
		<div style={{ display: 'grid', gap: 10 }}>
			{items.length > 0 && (
				<div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
					{items.map((i) => (
						<span key={i.entity_key} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 6px', background: 'var(--bg-2)', border: '1px solid var(--border)', fontSize: 12 }}>
							{i.entity_label ?? i.entity_key}
							<button type="button" onClick={() => remove(i.entity_key)} style={{ background: 'none', border: 0, cursor: 'pointer', color: 'var(--fg-muted)', display: 'inline-flex' }}><X size={12} /></button>
						</span>
					))}
				</div>
			)}
			<div style={{ position: 'relative' }}>
				<Search size={12} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--fg-muted)' }} />
				<input className="search-input" style={{ paddingLeft: 26 }} placeholder={`Search ${entityType}…`} value={q} onChange={(e) => onQuery(e.target.value)} />
			</div>
			{searching && <div style={{ fontSize: 12, color: 'var(--fg-muted)' }}>Searching…</div>}
			{hits.length > 0 && (
				<div style={{ border: '1px solid var(--border)', borderRadius: 4, maxHeight: 220, overflowY: 'auto' }}>
					{hits.map((h) => (
						<button key={h.key} type="button" onClick={() => add(h)}
							style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', background: 'transparent', border: 0, borderBottom: '1px solid var(--border)', cursor: 'pointer', color: 'var(--fg)', fontSize: 13 }}>
							{h.label}
						</button>
					))}
				</div>
			)}
			<div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{items.length} record(s) selected</div>
		</div>
	);
}

interface CsvRow { name: string; candidates: Array<{ key: string; label: string }>; selected: string }

function CsvImport({ entityType, onAdd }: { entityType: EntityType; onAdd: (items: ListItem[]) => void }) {
	const [text, setText] = useState('');
	const [rows, setRows] = useState<CsvRow[]>([]);
	const [running, setRunning] = useState(false);

	const run = async () => {
		const names = text.split(/\r?\n/).map((l) => l.split(',')[0]!.trim()).filter(Boolean);
		if (names.length === 0) { toast.error('Paste at least one name (one per line)'); return; }
		setRunning(true);
		try {
			const out: CsvRow[] = [];
			for (const name of names.slice(0, 200)) {
				const candidates = await searchEntity(entityType, name).catch(() => []);
				out.push({ name, candidates, selected: candidates[0]?.key ?? '' });
			}
			setRows(out);
		} finally { setRunning(false); }
	};

	const apply = () => {
		const items: ListItem[] = rows.filter((r) => r.selected).map((r) => {
			const c = r.candidates.find((x) => x.key === r.selected)!;
			return { entity_key: c.key, entity_label: c.label };
		});
		if (items.length === 0) { toast.error('No rows matched'); return; }
		onAdd(items);
		toast.success(`Added ${items.length} record(s) — review them on the Records tab`);
		setRows([]); setText('');
	};

	const matched = rows.filter((r) => r.selected).length;

	return (
		<div style={{ display: 'grid', gap: 10 }}>
			<Field label="Paste names (one per line; first CSV column used)">
				<textarea className="search-input" style={{ minHeight: 100, resize: 'vertical', fontFamily: 'var(--font-mono)', fontSize: 12 }} value={text} onChange={(e) => setText(e.target.value)} placeholder={'Acme Sports\nFanZone\n…'} />
			</Field>
			<div><button type="button" className="btn ghost" disabled={running} onClick={() => void run()}>{running ? 'Matching…' : 'Match against database'}</button></div>
			{rows.length > 0 && (
				<>
					<div style={{ fontSize: 12, color: 'var(--fg-muted)' }}>{matched}/{rows.length} matched · adjust or skip each row</div>
					<div style={{ border: '1px solid var(--border)', borderRadius: 4, maxHeight: 260, overflowY: 'auto' }}>
						<table className="data-table" style={{ width: '100%' }}>
							<thead><tr><th>Pasted</th><th>Matched record</th></tr></thead>
							<tbody>
								{rows.map((r, idx) => (
									<tr key={`${r.name}-${idx}`}>
										<td>{r.name}</td>
										<td>
											<Select value={r.selected} onChange={(v) => setRows((prev) => prev.map((x, i) => i === idx ? { ...x, selected: v } : x))} searchable width="100%" style={{ display: 'block', width: '100%' }} placeholder="— skip —" options={[{ value: '', label: '— skip —' }, ...r.candidates.map((c) => ({ value: c.key, label: c.label }))]} />
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
					<div><button type="button" className="btn" onClick={apply}>Use {matched} match(es)</button></div>
				</>
			)}
		</div>
	);
}
