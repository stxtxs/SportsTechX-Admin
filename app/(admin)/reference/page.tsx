'use client';

import { useEffect, useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { toast } from 'sonner';
import { Plus, Trash2, Save, Search } from 'lucide-react';
import { Modal } from '@/components/modal';
import { api } from '@/lib/api';
import { useConfirm } from '@/components/confirm';
import { PageHeader, PillTabs, useClientPage } from '@/components/atoms';
import { Select } from '@/components/select';
import { confirmDelete } from '@/lib/delete-impact';

type Kind = 'sectors' | 'sports' | 'tech-tags' | 'round-types' | 'countries' | 'cities';

const TABS: { key: Kind; label: string }[] = [
	{ key: 'sectors', label: 'Sectors' },
	{ key: 'sports', label: 'Sports' },
	{ key: 'tech-tags', label: 'Tech tags' },
	{ key: 'round-types', label: 'Round types' },
	{ key: 'countries', label: 'Countries' },
	{ key: 'cities', label: 'Cities' },
];

const CONTINENTS = ['Africa', 'Asia', 'Europe', 'North America', 'Oceania', 'South America'] as const;
const REGIONS = [
	'Australia and New Zealand', 'Caribbean', 'Central America', 'Central Asia',
	'Eastern Africa', 'Eastern Asia', 'Eastern Europe', 'Melanesia', 'Micronesia',
	'Middle Africa', 'Northern Africa', 'Northern America', 'Northern Europe',
	'Polynesia', 'South America', 'South-Eastern Asia', 'Southern Africa',
	'Southern Asia', 'Southern Europe', 'Western Africa', 'Western Asia', 'Western Europe',
] as const;

interface RefRow {
	id: string;
	name: string;
	slug: string;
	parent_id?: string | null;
	description?: string | null;
	sort_order?: number | null;
	iso2?: string | null;
	continent?: string | null;
	region?: string | null;
}

interface RefResponse { data: RefRow[] }

/**
 * Order a flat reference list into a parent→child tree (DFS) and tag each row
 * with its `depth`, so the table can indent sub-sectors and sub-sub-sectors
 * distinctly instead of lumping every child at one indent level (BUG-057).
 * Any row whose parent isn't present is appended at depth 0 so nothing is hidden.
 */
function orderTree(rows: RefRow[]): Array<RefRow & { depth: number }> {
	const childrenOf = new Map<string | null, RefRow[]>();
	for (const r of rows) {
		const p = r.parent_id ?? null;
		const arr = childrenOf.get(p) ?? [];
		arr.push(r);
		childrenOf.set(p, arr);
	}
	const out: Array<RefRow & { depth: number }> = [];
	const walk = (parent: string | null, depth: number) => {
		for (const r of childrenOf.get(parent) ?? []) {
			out.push({ ...r, depth });
			walk(r.id, depth + 1);
		}
	};
	walk(null, 0);
	const seen = new Set(out.map((r) => r.id));
	for (const r of rows) if (!seen.has(r.id)) out.push({ ...r, depth: 0 });
	return out;
}

export default function ReferenceAdminPage() {
	const { mutate } = useSWRConfig();
	const ask = useConfirm();
	const [kind, setKind] = useState<Kind>('sectors');
	const [editing, setEditing] = useState<RefRow | null>(null);
	const [creating, setCreating] = useState(false);
	const [q, setQ] = useState('');

	// Cities aren't a CRUD reference table (33k+ rows, de-dupe tool instead), so
	// skip the standard list fetch for that tab.
	const { data } = useSWR<RefResponse>(kind === 'cities' ? null : [`/api/admin/reference/${kind}`]);

	const refresh = () => mutate((key) => Array.isArray(key) && typeof key[0] === 'string' && (key[0] as string).startsWith(`/api/admin/reference/${kind}`));

	const remove = async (id: string, name: string) => {
		if (!(await confirmDelete(ask, kind, id, name))) return;
		try {
			await api('DELETE', `/api/admin/reference/${kind}/${id}`);
			toast.success('Deleted');
			void refresh();
		} catch (e) { toast.error((e as Error).message); }
	};

	const rows = data?.data ?? [];
	const showParent = kind !== 'round-types' && kind !== 'countries';
	const showSortOrder = kind === 'sectors' || kind === 'round-types';
	const showCountryCols = kind === 'countries';
	const filtered = q.trim() ? rows.filter((r) => `${r.name} ${r.slug}`.toLowerCase().includes(q.trim().toLowerCase())) : null;
	const tree = filtered ? filtered.map((r) => ({ ...r, depth: 0 })) : orderTree(rows);
	const pg = useClientPage(tree, `${kind}|${q}`);

	return (
		<div>
			<PageHeader kicker="Reference · taxonomy" title="Reference data" subtitle="Sectors, sports, tech tags, round types. Public read endpoints cache 1h — changes propagate on the next cache miss." />

			<div style={{ marginBottom: 'var(--space-4)' }}>
				<PillTabs tabs={TABS.map((t) => ({ key: t.key, label: t.label }))} value={kind} onChange={(k) => { setKind(k); setEditing(null); setCreating(false); setQ(''); }} />
			</div>

			{kind === 'cities' ? <CityMergeTool /> : (<>
			<div className="filter-bar" style={{ marginBottom: 12 }}>
				<div style={{ position: 'relative' }}>
					<Search size={12} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--fg-muted)' }} />
					<input className="search-input" style={{ height: 30, paddingLeft: 26, width: 220 }} placeholder="Filter…" value={q} onChange={(e) => setQ(e.target.value)} />
				</div>
				<div style={{ flex: 1 }} />
				<span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>{tree.length} {tree.length === 1 ? 'entry' : 'entries'}</span>
				<button className="btn" onClick={() => setCreating(true)}><Plus size={12} /> Add</button>
			</div>

			{(creating || editing) && (
				<RefModal
					kind={kind}
					initial={editing}
					parents={rows.filter((r) => r.id !== editing?.id)}
					onClose={() => { setCreating(false); setEditing(null); }}
					onSaved={() => { setCreating(false); setEditing(null); void refresh(); }}
				/>
			)}

			<div className="card" style={{ padding: 0, overflow: 'hidden' }}>
				<table className="data-table" style={{ width: '100%' }}>
					<thead>
						<tr>
							<th>Name</th>
							<th>Slug</th>
							{showCountryCols && <th>ISO2</th>}
							{showCountryCols && <th>Continent</th>}
							{showCountryCols && <th>Region</th>}
							{showParent && <th>Parent</th>}
							{showSortOrder && <th>Sort</th>}
							<th />
						</tr>
					</thead>
					<tbody>
						{tree.length === 0 ? (
							<tr><td colSpan={5} style={{ textAlign: 'center', padding: 24, color: 'var(--fg-muted)' }}>{q.trim() ? 'No matches.' : 'No entries.'}</td></tr>
						) : pg.rows.map((r) => {
							const parent = r.parent_id ? rows.find((x) => x.id === r.parent_id) : null;
							return (
								<tr key={r.id}>
									<td style={{ paddingLeft: 14 + r.depth * 24 }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>{r.depth > 0 && <span style={{ color: 'var(--fg-muted)', fontSize: 12 }}>↳</span>}<span style={{ fontWeight: r.depth === 0 ? 700 : 600, fontSize: r.depth === 0 ? 14 : 13, color: r.depth === 0 ? 'var(--fg)' : r.depth === 1 ? 'var(--fg-2)' : 'var(--fg-muted)' }}>{r.name}</span>{kind === 'sectors' && <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.06em', padding: '1px 6px', borderRadius: 999, color: r.depth === 0 ? 'var(--accent)' : 'var(--fg-muted)', background: r.depth === 0 ? 'color-mix(in srgb, var(--accent) 14%, transparent)' : 'var(--bg-3)' }}>{['Sector', 'Sub-sector', 'Sub-sub'][Math.min(r.depth, 2)]}</span>}</span></td>
									<td style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{r.slug}</td>
									{showCountryCols && <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{r.iso2 ?? '—'}</td>}
									{showCountryCols && <td style={{ fontSize: 12 }}>{r.continent ?? '—'}</td>}
									{showCountryCols && <td style={{ fontSize: 12 }}>{r.region ?? '—'}</td>}
									{showParent && <td style={{ color: 'var(--fg-muted)' }}>{parent?.name ?? '—'}</td>}
									{showSortOrder && <td>{r.sort_order ?? '—'}</td>}
									<td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
										<button className="btn ghost" onClick={() => setEditing(r)}>Edit</button>
										<button className="btn ghost" style={{ color: 'var(--accent)', marginLeft: 6 }} onClick={() => void remove(r.id, r.name)}><Trash2 size={12} /></button>
									</td>
								</tr>
							);
						})}
					</tbody>
				</table>
				{pg.pager}
			</div>
		</>)}
		</div>
	);
}

function RefModal({ kind, initial, parents, onClose, onSaved }: { kind: Kind; initial: RefRow | null; parents: RefRow[]; onClose: () => void; onSaved: () => void }) {
	const [name, setName] = useState(initial?.name ?? '');
	const [slug, setSlug] = useState(initial?.slug ?? '');
	const [parentId, setParentId] = useState<string>(initial?.parent_id ?? '');
	const [description, setDescription] = useState<string>(initial?.description ?? '');
	const [sortOrder, setSortOrder] = useState<string>(initial?.sort_order != null ? String(initial.sort_order) : '0');
	const [iso2, setIso2] = useState(initial?.iso2 ?? '');
	const [continent, setContinent] = useState(initial?.continent ?? '');
	const [region, setRegion] = useState(initial?.region ?? '');
	const [pending, setPending] = useState(false);

	const showParent = kind !== 'round-types' && kind !== 'countries';
	const showDescription = kind === 'sectors';
	const showSort = kind === 'sectors' || kind === 'round-types';
	const showCountryFields = kind === 'countries';

	const submit = async () => {
		setPending(true);
		try {
			const body: Record<string, unknown> = { name: name.trim() };
			if (slug.trim()) body.slug = slug.trim();
			if (showParent) body.parent_id = parentId || null;
			if (showDescription) body.description = description.trim() || null;
			if (showSort) body.sort_order = Number(sortOrder) || 0;
			if (showCountryFields) {
				body.iso2 = iso2.trim().toUpperCase() || null;
				body.continent = continent || null;
				body.region = region || null;
			}
			if (initial) await api('PATCH', `/api/admin/reference/${kind}/${initial.id}`, body);
			else await api('POST', `/api/admin/reference/${kind}`, body);
			toast.success(initial ? 'Saved' : 'Created');
			onSaved();
		} catch (e) { toast.error((e as Error).message); }
		finally { setPending(false); }
	};

	return (
		<Modal
			title={`${initial ? 'Edit' : 'New'} entry`}
			onClose={onClose}
			width={480}
			footer={
				<>
					<button className="btn ghost" onClick={onClose}>Cancel</button>
					<button className="btn" disabled={!name.trim() || pending} onClick={() => void submit()}>
						<Save size={12} /> {pending ? 'Saving…' : 'Save'}
					</button>
				</>
			}
		>
			<div style={{ display: 'grid', gap: 12 }}>
				<Field label="Name"><input className="search-input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
				<Field label="Slug (optional — auto from name)"><input className="search-input" style={{ fontFamily: 'var(--font-mono)' }} value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))} disabled={!!initial} /></Field>
				{showParent && (
					<Field label="Parent (optional)">
						<Select value={parentId} onChange={setParentId} searchable width="100%" style={{ display: 'block', width: '100%' }} placeholder="— top level —" options={[{ value: '', label: '— top level —' }, ...parents.filter((p) => p.id !== initial?.id).map((p) => ({ value: p.id, label: p.name }))]} />
					</Field>
				)}
				{showDescription && <Field label="Description"><textarea className="search-input" style={{ minHeight: 60 }} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>}
				{showSort && <Field label="Sort"><input className="search-input" type="number" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} /></Field>}
				{showCountryFields && (
					<>
						<Field label="ISO 3166-1 alpha-2"><input className="search-input" style={{ fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }} maxLength={2} value={iso2} onChange={(e) => setIso2(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))} /></Field>
						<Field label="Continent">
							<Select value={continent} onChange={setContinent} width="100%" style={{ display: 'block', width: '100%' }} placeholder="Select continent" options={CONTINENTS.map((c) => ({ value: c, label: c }))} />
						</Field>
						<Field label="Region">
							<Select value={region} onChange={setRegion} searchable width="100%" style={{ display: 'block', width: '100%' }} placeholder="Select region" options={REGIONS.map((r) => ({ value: r, label: r }))} />
						</Field>
					</>
				)}
			</div>
		</Modal>
	);
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<div>
			<div className="co-stat-label" style={{ marginBottom: 6 }}>{label}</div>
			{children}
		</div>
	);
}

interface CityHit { id: string; name: string; state: string | null; country: string | null; country_id: string; usage: number }

/**
 * City de-duplication. Search the city catalog, pick the canonical city and the
 * duplicate, and merge: every record pointing at the duplicate is repointed at
 * the canonical city and the duplicate row is deleted. There's no "add city"
 * here — cities are created implicitly when an admin saves an entity with a new
 * HQ (resolveLocation find-or-creates). This tab only cleans up variants.
 */
function CityMergeTool() {
	const ask = useConfirm();
	const [q, setQ] = useState('');
	const [debounced, setDebounced] = useState('');
	const [keep, setKeep] = useState<CityHit | null>(null);
	const [dupe, setDupe] = useState<CityHit | null>(null);
	const [pending, setPending] = useState(false);

	useEffect(() => {
		const t = setTimeout(() => setDebounced(q.trim()), 300);
		return () => clearTimeout(t);
	}, [q]);

	const { data, mutate } = useSWR<{ data: CityHit[] }>(debounced.length >= 2 ? [`/api/admin/cities?q=${encodeURIComponent(debounced)}`] : null);
	const rows = data?.data ?? [];

	const merge = async () => {
		if (!keep || !dupe) return;
		if (!(await ask(`Merge "${dupe.name}" into "${keep.name}"? ${dupe.usage} record${dupe.usage === 1 ? '' : 's'} will move to "${keep.name}" and "${dupe.name}" will be deleted. This cannot be undone.`))) return;
		setPending(true);
		try {
			const res = await api('POST', '/api/admin/cities/merge', { from_id: dupe.id, to_id: keep.id }) as { moved: number };
			toast.success(`Merged — ${res.moved} record${res.moved === 1 ? '' : 's'} moved.`);
			setKeep(null); setDupe(null);
			void mutate();
		} catch (e) { toast.error((e as Error).message); }
		finally { setPending(false); }
	};

	const diffCountry = keep && dupe && keep.country_id !== dupe.country_id;

	return (
		<div>
			<p style={{ fontSize: 12, color: 'var(--fg-muted)', margin: '0 0 12px', maxWidth: 680 }}>
				Find two spellings of the same place (e.g. “Bangalore” / “Bengaluru”) and merge the duplicate into the canonical city. New cities are added automatically when you save an entity with a new HQ — there’s nothing to add here. Case-only variants can’t occur anymore; this is for genuine spelling differences.
			</p>

			<div className="filter-bar" style={{ marginBottom: 12 }}>
				<div style={{ position: 'relative' }}>
					<Search size={12} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--fg-muted)' }} />
					<input className="search-input" style={{ height: 30, paddingLeft: 26, width: 280 }} placeholder="Search cities (min 2 chars)…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
				</div>
				<div style={{ flex: 1 }} />
				{rows.length > 0 && <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>{rows.length} match{rows.length === 1 ? '' : 'es'}</span>}
			</div>

			{(keep || dupe) && (
				<div className="card" style={{ padding: 12, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
					<span style={{ fontSize: 13 }}>
						<strong>Merge</strong>{' '}
						<span style={{ color: 'var(--accent)' }}>{dupe ? `${dupe.name} (${dupe.usage})` : '— pick a duplicate —'}</span>
						{' → '}
						<span style={{ color: 'var(--fg)' }}>{keep ? `${keep.name} (${keep.usage})` : '— pick the canonical —'}</span>
					</span>
					{diffCountry && <span style={{ fontSize: 11, color: 'var(--warning, #c47f00)' }}>⚠ different countries — double-check</span>}
					<div style={{ flex: 1 }} />
					<button className="btn ghost" onClick={() => { setKeep(null); setDupe(null); }}>Clear</button>
					<button className="btn" disabled={!keep || !dupe || pending} onClick={() => void merge()}>{pending ? 'Merging…' : 'Merge'}</button>
				</div>
			)}

			<div className="card" style={{ padding: 0, overflow: 'hidden' }}>
				<table className="data-table" style={{ width: '100%' }}>
					<thead>
						<tr><th>City</th><th>State</th><th>Country</th><th style={{ textAlign: 'right' }}>Records</th><th /></tr>
					</thead>
					<tbody>
						{rows.length === 0 ? (
							<tr><td colSpan={5} style={{ textAlign: 'center', padding: 24, color: 'var(--fg-muted)' }}>{debounced.length >= 2 ? 'No matches.' : 'Type to search.'}</td></tr>
						) : rows.map((c) => {
							const isKeep = keep?.id === c.id, isDupe = dupe?.id === c.id;
							return (
								<tr key={c.id} style={{ background: isKeep ? 'color-mix(in srgb, var(--accent) 8%, transparent)' : isDupe ? 'color-mix(in srgb, var(--accent) 14%, transparent)' : undefined }}>
									<td style={{ fontWeight: 600 }}>{c.name}</td>
									<td style={{ color: 'var(--fg-muted)', fontSize: 12 }}>{c.state ?? '—'}</td>
									<td style={{ color: 'var(--fg-muted)', fontSize: 12 }}>{c.country ?? '—'}</td>
									<td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 12 }}>{c.usage}</td>
									<td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
										<button className="btn ghost" disabled={isDupe} onClick={() => setKeep(isKeep ? null : c)}>{isKeep ? 'Canonical ✓' : 'Keep'}</button>
										<button className="btn ghost" style={{ color: 'var(--accent)', marginLeft: 6 }} disabled={isKeep} onClick={() => setDupe(isDupe ? null : c)}>{isDupe ? 'Duplicate ✓' : 'Merge away'}</button>
									</td>
								</tr>
							);
						})}
					</tbody>
				</table>
			</div>
		</div>
	);
}
