'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import useSWR, { useSWRConfig } from 'swr';
import { toast } from 'sonner';
import { ChevronDown, Plus, Search, Star, X } from 'lucide-react';
import { qk } from '@/lib/query-keys';
import { api } from '@/lib/api';
import { Select } from '@/components/select';
import dynamic from 'next/dynamic';
import { AddCandidateModal } from '@/components/investor-candidate-modal';

// Lazy: admin-views/investors imports this file, so a static import would be a cycle.
const CompanyModal = dynamic(() => import('@/app/(admin)/companies/page').then((m) => m.CompanyModal), { ssr: false });
const InvestorModal = dynamic(() => import('@/components/admin-views/investors').then((m) => m.InvestorModal), { ssr: false });

// ─── inline reference creation ───────────────────────────────────────────────
// Lets admins create a sector / sport / tech-tag / round-type in place instead
// of leaving the form to manage reference data. POSTs to the admin reference
// endpoint and returns the new row so the caller can select it immediately.

function slugify(s: string): string {
	return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

async function createRef(kind: string, name: string, parentId?: string | null): Promise<{ id: string; name: string } | null> {
	const n = name.trim();
	if (!n) return null;
	try {
		return await api<{ id: string; name: string }>('POST', `/api/admin/reference/${kind}`, {
			name: n, slug: slugify(n), ...(parentId ? { parent_id: parentId } : {}),
		});
	} catch (e) {
		toast.error((e as Error).message);
		return null;
	}
}

/** Small "+ add new" inline input shown at the foot of a picker dropdown. */
function InlineCreate({ label, onCreate }: { label: string; onCreate: (name: string) => Promise<void> }) {
	const [name, setName] = useState('');
	const [busy, setBusy] = useState(false);
	const submit = async () => {
		if (!name.trim() || busy) return;
		setBusy(true);
		await onCreate(name);
		setName('');
		setBusy(false);
	};
	return (
		<div style={{ display: 'flex', gap: 6, padding: 8, borderTop: '1px solid var(--border)', background: 'var(--bg-2)' }}>
			<input
				className="search-input"
				style={{ flex: 1, height: 28, fontSize: 12 }}
				placeholder={label}
				value={name}
				onChange={(e) => setName(e.target.value)}
				onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void submit(); } }}
				onMouseDown={(e) => e.stopPropagation()}
			/>
			<button type="button" className="btn" style={{ height: 28 }} disabled={busy || !name.trim()} onClick={(e) => { e.preventDefault(); void submit(); }}>
				<Plus size={12} /> Add
			</button>
		</div>
	);
}

/**
 * Reference-data pickers for the rich admin entity forms (company / deal /
 * acquisition / investor / ecosystem). They take/return plain ids (or, for
 * investors, `{investor_id?, investor_name, is_lead}`) so the parent form
 * just holds arrays and the backend stores them in the junction tables.
 *
 * Built on the same conventions as `section-pickers.tsx`:
 *   • SWR tuple keys via `qk.reference.*`
 *   • CSS-variable styling + `.search-input` / `.chip` classes
 */

// ─── shared hooks ────────────────────────────────────────────────────────────

function useClickOutside<T extends HTMLElement>(onOutside: () => void) {
	const ref = useRef<T>(null);
	useEffect(() => {
		const fn = (e: MouseEvent) => {
			const el = ref.current;
			if (!el) return;
			if (e.target instanceof Node && !el.contains(e.target)) onOutside();
		};
		document.addEventListener('mousedown', fn);
		return () => document.removeEventListener('mousedown', fn);
	}, [onOutside]);
	return ref;
}

function useDebounced<T>(value: T, ms = 200): T {
	const [v, setV] = useState(value);
	useEffect(() => {
		const t = setTimeout(() => setV(value), ms);
		return () => clearTimeout(t);
	}, [value, ms]);
	return v;
}

interface RefRow { id: string; name: string; slug: string; parent_id: string | null; is_bulk_sport?: boolean }

// ─── generic multi-select checkbox dropdown ──────────────────────────────────

function MultiCheckPicker({
	rows, value, onChange, placeholder, loadingMsg, onCreate, createLabel,
}: {
	rows: RefRow[];
	value: string[];
	onChange: (ids: string[]) => void;
	placeholder: string;
	loadingMsg: string;
	onCreate?: (name: string) => Promise<void>;
	createLabel?: string;
}) {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState('');
	const [pos, setPos] = useState<{ top?: number; bottom?: number; left: number; width: number; maxH: number } | null>(null);
	const ref = useRef<HTMLDivElement>(null);
	const menuRef = useRef<HTMLDivElement>(null);
	const byId = new Map(rows.map((s) => [s.id, s] as const));
	const selectedNames = value.map((id) => byId.get(id)?.name).filter(Boolean) as string[];
	// Summary shown on the collapsed control. Keyed off value.length (the real
	// selection), not just resolvable names — so when the reference list is still
	// loading (or a selected id can't be matched yet) it reads "N selected" rather
	// than the misleading "nothing selected" placeholder.
	const summary = value.length === 0 ? placeholder
		: selectedNames.length === 0 ? `${value.length} selected`
			: selectedNames.length === value.length && value.length <= 3 ? selectedNames.join(', ')
				: `${selectedNames.slice(0, 2).join(', ')} +${value.length - Math.min(2, selectedNames.length)} more`;
	const toggle = (id: string) =>
		onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
	const shown = query ? rows.filter((r) => r.name.toLowerCase().includes(query.toLowerCase())) : rows;

	// Portaled popover positioned against the trigger, so it floats above modals
	// (no overflow clipping) and flips up when there's no room below.
	const place = () => {
		const el = ref.current;
		if (!el) return;
		const r = el.getBoundingClientRect();
		const below = window.innerHeight - r.bottom - 8;
		const above = r.top - 8;
		const openUp = below < 240 && above > below;
		const width = Math.min(Math.max(r.width, 200), window.innerWidth - 16);
		const left = Math.max(8, Math.min(r.left, window.innerWidth - 8 - width));
		setPos(openUp
			? { bottom: window.innerHeight - r.top + 4, left, width, maxH: Math.min(320, above) }
			: { top: r.bottom + 4, left, width, maxH: Math.min(320, below) });
	};
	useEffect(() => { if (open) { place(); setQuery(''); } }, [open]);
	useEffect(() => {
		if (!open) return;
		const onDown = (e: MouseEvent) => {
			const target = e.target as Node;
			if (ref.current?.contains(target) || menuRef.current?.contains(target)) return;
			setOpen(false);
		};
		const reposition = () => place();
		document.addEventListener('mousedown', onDown);
		window.addEventListener('resize', reposition);
		window.addEventListener('scroll', reposition, true);
		return () => {
			document.removeEventListener('mousedown', onDown);
			window.removeEventListener('resize', reposition);
			window.removeEventListener('scroll', reposition, true);
		};
	}, [open]);

	return (
		<div ref={ref} style={{ position: 'relative' }}>
			<button
				type="button"
				className="search-input"
				onClick={() => setOpen(!open)}
				style={{ width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
			>
				<span style={{ color: value.length === 0 ? 'var(--fg-muted)' : 'var(--fg)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
					{summary}
				</span>
				<ChevronDown size={12} style={{ flexShrink: 0, transition: 'transform .15s', transform: open ? 'rotate(180deg)' : 'none' }} />
			</button>
			{open && pos && createPortal(
				<div
					ref={menuRef}
					style={{
						position: 'fixed', left: pos.left, width: pos.width, top: pos.top, bottom: pos.bottom,
						maxHeight: pos.maxH, overflow: 'hidden', zIndex: 2000,
						background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)',
						boxShadow: 'var(--shadow-lg, var(--shadow-md))', display: 'flex', flexDirection: 'column',
					}}
				>
					<div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', borderBottom: '1px solid var(--border)' }}>
						<Search size={13} style={{ color: 'var(--fg-muted)', flexShrink: 0 }} />
						{/* eslint-disable-next-line jsx-a11y/no-autofocus */}
						<input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search…"
							style={{ flex: 1, border: 0, outline: 'none', background: 'transparent', color: 'var(--fg)', fontSize: 13 }} />
					</div>
					<div style={{ overflow: 'auto', padding: 4 }}>
						{rows.length === 0 && <div style={{ padding: 10, fontSize: 12, color: 'var(--fg-muted)' }}>{loadingMsg}</div>}
						{rows.length > 0 && shown.length === 0 && <div style={{ padding: 10, fontSize: 12, color: 'var(--fg-muted)' }}>No matches</div>}
						{shown.map((s) => {
							const isOn = value.includes(s.id);
							return (
								<label key={s.id} style={{
									display: 'flex', alignItems: 'center', gap: 8,
									padding: '6px 8px', cursor: 'pointer', fontSize: 13, borderRadius: 6,
									background: isOn ? 'var(--bg-2)' : 'transparent',
								}}>
									<input type="checkbox" checked={isOn} onChange={() => toggle(s.id)} />
									<span>{s.name}</span>
									{s.is_bulk_sport && <span style={{ color: 'var(--fg-muted)', fontSize: 11 }}>· group</span>}
								</label>
							);
						})}
						{onCreate && <InlineCreate label={createLabel ?? 'New item name…'} onCreate={onCreate} />}
					</div>
				</div>,
				document.body,
			)}
		</div>
	);
}

// ─── Sports / Tech-tags multi-select ─────────────────────────────────────────

export function SportsPicker({ value, onChange }: { value: string[]; onChange: (ids: string[]) => void }) {
	const { data } = useSWR<RefRow[]>(qk.reference.sports(), { dedupingInterval: 60 * 60_000 });
	const { mutate } = useSWRConfig();
	const onCreate = async (name: string) => {
		const row = await createRef('sports', name);
		if (!row) return;
		await mutate(qk.reference.sports());
		onChange([...value, row.id]);
		toast.success(`Added sport “${row.name}”`);
	};
	return <MultiCheckPicker rows={data ?? []} value={value} onChange={onChange} placeholder="No sports — select…" loadingMsg="Loading sports…" onCreate={onCreate} createLabel="New sport name…" />;
}

export function TechTagsPicker({ value, onChange }: { value: string[]; onChange: (ids: string[]) => void }) {
	const { data } = useSWR<RefRow[]>(qk.reference.techTags(), { dedupingInterval: 60 * 60_000 });
	const { mutate } = useSWRConfig();
	const onCreate = async (name: string) => {
		const row = await createRef('tech-tags', name);
		if (!row) return;
		await mutate(qk.reference.techTags());
		onChange([...value, row.id]);
		toast.success(`Added tech tag “${row.name}”`);
	};
	return <MultiCheckPicker rows={data ?? []} value={value} onChange={onChange} placeholder="No tech tags — select…" loadingMsg="Loading tech tags…" onCreate={onCreate} createLabel="New tech tag name…" />;
}

/** Multi-select round types (e.g. investor thesis preferred rounds). */
export function RoundTypesPicker({ value, onChange }: { value: string[]; onChange: (ids: string[]) => void }) {
	const { data } = useSWR<RefRow[]>(qk.reference.roundTypes(), { dedupingInterval: 60 * 60_000 });
	const { mutate } = useSWRConfig();
	const onCreate = async (name: string) => {
		const row = await createRef('round-types', name);
		if (!row) return;
		await mutate(qk.reference.roundTypes());
		onChange([...value, row.id]);
		toast.success(`Added round “${row.name}”`);
	};
	return <MultiCheckPicker rows={data ?? []} value={value} onChange={onChange} placeholder="No rounds — select…" loadingMsg="Loading rounds…" onCreate={onCreate} createLabel="New round type name…" />;
}

// ─── Round type / currency single selects ────────────────────────────────────

export function RoundTypeSelect({ value, onChange }: { value: string; onChange: (id: string) => void }) {
	const { data } = useSWR<RefRow[]>(qk.reference.roundTypes(), { dedupingInterval: 60 * 60_000 });
	const { mutate } = useSWRConfig();
	const [adding, setAdding] = useState(false);
	const onCreate = async (name: string) => {
		const row = await createRef('round-types', name);
		if (!row) return;
		await mutate(qk.reference.roundTypes());
		onChange(row.id);
		setAdding(false);
		toast.success(`Added round “${row.name}”`);
	};
	return (
		<div style={{ display: 'grid', gap: 6 }}>
			<div style={{ display: 'flex', gap: 6 }}>
				<Select value={value} onChange={onChange} width="100%" style={{ flex: 1 }} placeholder="— round —" searchable
					options={(data ?? []).map((r) => ({ value: r.id, label: r.name }))} />
				<button type="button" className="btn ghost" style={{ flex: '0 0 auto' }} onClick={() => setAdding((v) => !v)} title="Add a new round type">
					<Plus size={12} />
				</button>
			</div>
			{adding && <InlineCreate label="New round type name…" onCreate={onCreate} />}
		</div>
	);
}

interface CurrencyRow { code: string; name: string; symbol: string | null }
export function CurrencySelect({ value, onChange }: { value: string; onChange: (code: string) => void }) {
	const { data } = useSWR<CurrencyRow[]>(qk.reference.currencies(), { dedupingInterval: 60 * 60_000 });
	return (
		<Select value={value} onChange={onChange} width="100%" style={{ width: '100%' }} placeholder="—" searchable
			options={(data ?? []).map((c) => ({ value: c.code, label: `${c.code}${c.symbol ? ` (${c.symbol})` : ''}` }))} />
	);
}

// ─── Sector cascade (Sector → Sub-sector → Sub-sub-sector) ───────────────────
// The rewrite stores a single `sector_id` which may be a leaf. This picker lets
// the admin drill the parent→child hierarchy; the value is always the deepest
// node the admin selected.

export function SectorCascade({ value, onChange }: { value: string; onChange: (sectorId: string) => void }) {
	const { data } = useSWR<RefRow[]>(qk.reference.sectors(), { dedupingInterval: 60 * 60_000 });
	const { mutate } = useSWRConfig();
	const [adding, setAdding] = useState(false);
	const [q, setQ] = useState('');
	const [searchOpen, setSearchOpen] = useState(false);
	const searchRef = useClickOutside<HTMLDivElement>(() => setSearchOpen(false));
	const all = data ?? [];
	const byId = new Map(all.map((s) => [s.id, s] as const));
	const childrenOf = (pid: string | null) => all.filter((s) => s.parent_id === pid);
	// Full "Sector › Sub › Sub-sub" label so a search hit shows its whole chain.
	const pathLabel = (id: string): string => {
		const parts: string[] = [];
		let n = byId.get(id);
		while (n) { parts.unshift(n.name); n = n.parent_id ? byId.get(n.parent_id) : undefined; }
		return parts.join(' › ');
	};
	const matches = q.trim().length >= 1
		? all.filter((s) => s.name.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 25)
		: [];

	// Reconstruct the chosen path (root → … → value) from the flat list.
	const path: string[] = [];
	let cur = value ? byId.get(value) : undefined;
	while (cur) { path.unshift(cur.id); cur = cur.parent_id ? byId.get(cur.parent_id) : undefined; }

	// Render one <select> per level that has options. Level 0 = roots; each
	// subsequent level = children of the previously-chosen node.
	const levels: Array<{ options: RefRow[]; selected: string }> = [];
	let parentId: string | null = null;
	for (let depth = 0; depth < 4; depth++) {
		const options = childrenOf(parentId);
		if (options.length === 0) break;
		const selected = path[depth] ?? '';
		levels.push({ options, selected });
		if (!selected) break;
		parentId = selected;
	}

	const pick = (depth: number, id: string) => {
		// Selecting at a level discards any deeper selection; value becomes the
		// chosen node (or its parent when cleared).
		if (!id) { onChange(path[depth - 1] ?? ''); return; }
		onChange(id);
	};

	// New node is created as a child of the deepest selected node (so "+ new"
	// under a chosen sector adds a sub-sector); with nothing selected it adds a
	// top-level sector.
	const onCreate = async (name: string) => {
		const row = await createRef('sectors', name, value || null);
		if (!row) return;
		await mutate(qk.reference.sectors());
		onChange(row.id);
		setAdding(false);
		toast.success(`Added sector “${row.name}”`);
	};

	return (
		<div style={{ display: 'grid', gap: 6 }}>
			{/* Jump straight to any sub-sector / sub-sub-sector — picking it fills the
			    parent chain in the dropdowns below. */}
			<div ref={searchRef} style={{ position: 'relative' }}>
				<div style={{ position: 'relative' }}>
					<Search size={12} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--fg-muted)' }} />
					<input className="search-input" style={{ width: '100%', paddingLeft: 26 }} placeholder="Find a sector / sub-sector…"
						value={q} onChange={(e) => { setQ(e.target.value); setSearchOpen(true); }} onFocus={() => setSearchOpen(true)} />
				</div>
				{searchOpen && matches.length > 0 && (
					<div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20, marginTop: 2, maxHeight: 240, overflowY: 'auto', background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 4, boxShadow: '0 6px 24px rgba(0,0,0,0.15)' }}>
						{matches.map((m) => (
							<button key={m.id} type="button" onClick={() => { onChange(m.id); setQ(''); setSearchOpen(false); }}
								style={{ display: 'block', width: '100%', padding: '7px 10px', textAlign: 'left', background: 'transparent', border: 0, cursor: 'pointer', color: 'var(--fg)', fontSize: 13 }}
								onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-3)')} onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
								{pathLabel(m.id)}
							</button>
						))}
					</div>
				)}
			</div>
			{levels.map((lvl, depth) => (
				<Select key={depth} value={lvl.selected} onChange={(v) => pick(depth, v)} searchable width="100%" style={{ display: 'block', width: '100%' }} placeholder={depth === 0 ? '— sector —' : '— more specific (optional) —'} options={[{ value: '', label: depth === 0 ? '— sector —' : '— more specific (optional) —' }, ...lvl.options.map((o) => ({ value: o.id, label: o.name }))]} />
			))}
			<button type="button" className="btn ghost" style={{ justifySelf: 'start', height: 28 }} onClick={() => setAdding((v) => !v)}>
				<Plus size={12} /> {value ? 'New sub-sector here' : 'New sector'}
			</button>
			{adding && <InlineCreate label={value ? 'New sub-sector name…' : 'New sector name…'} onCreate={onCreate} />}
		</div>
	);
}

// ─── Location fields — city typeahead auto-fills country/continent/region ─────
// Picking a known city back-fills country, continent, region and state from the
// locations table; everything stays editable for custom entries. The backend
// persists all of these to the locations row.

export interface LocationValue { country: string; city: string; continent: string; region: string; state: string; report_region?: string }
export const EMPTY_LOCATION: LocationValue = { country: '', city: '', continent: '', region: '', state: '', report_region: '' };

interface LocHit { city: string | null; state: string | null; country: string | null; continent: string | null; region: string | null; report_region: string | null }

export function LocationFields({ value, onChange, prefix }: { value: LocationValue; onChange: (v: LocationValue) => void; prefix?: string }) {
	const [q, setQ] = useState(value.city);
	const [open, setOpen] = useState(false);
	const debouncedQ = useDebounced(q, 200);
	const ref = useClickOutside<HTMLDivElement>(() => setOpen(false));
	// No geo scoping here. In the admin the workflow is city-FIRST: picking a city
	// auto-fills country / region / continent (see pickCity). Scoping the search by
	// the entity's EXISTING country/region/continent hid cities that belong
	// elsewhere — e.g. editing any non-UAE entity made "Dubai" unfindable
	// (`?q=dubai&geo=India` → []). Power users see every match; the pick sets geo.
	const { data } = useSWR<LocHit[]>(
		open && debouncedQ.length >= 2 ? ['/api/locations/search', { q: debouncedQ }] : null,
		{ dedupingInterval: 30_000, keepPreviousData: true },
	);
	const hits = data ?? [];
	const lbl = (s: string) => (prefix ? `${prefix} ${s}` : s.charAt(0).toUpperCase() + s.slice(1));
	// HQ geo dropdowns — distinct values from the locations table, cascaded by the
	// current continent/country. Uses the searchable Select combobox (search box
	// over the options) so 150-country lists stay usable.
	const geoOpts = { dedupingInterval: 60 * 60_000, keepPreviousData: true } as const;
	const countries = useSWR<string[]>(['/api/locations/values', { field: 'country' }], geoOpts);
	const continents = useSWR<string[]>(['/api/locations/values', { field: 'continent' }], geoOpts);
	const regions = useSWR<string[]>(['/api/locations/values', { field: 'region', ...(value.continent ? { continent: value.continent } : {}) }], geoOpts);
	const reportRegions = useSWR<string[]>(['/api/locations/values', { field: 'report_region', ...(value.continent ? { continent: value.continent } : {}) }], geoOpts);
	const states = useSWR<string[]>(['/api/locations/values', { field: 'state', ...(value.country ? { country: value.country } : {}) }], geoOpts);
	const geoField = (key: keyof LocationValue, label: string, opts: string[] | undefined) => {
		const cur = value[key] ?? '';
		const options = (opts ?? []).map((o) => ({ value: o, label: o }));
		// Keep an already-saved value selectable even if it's absent from the list.
		if (cur && !options.some((o) => o.value === cur)) options.unshift({ value: cur, label: cur });
		return (
			<div>
				<div className="co-stat-label" style={{ marginBottom: 6 }}>{lbl(label)}</div>
				<Select value={cur} onChange={(v) => onChange({ ...value, [key]: v })} options={options} searchable placeholder="Select…" width="100%" style={{ display: 'block', width: '100%' }} />
			</div>
		);
	};
	const pickCity = (h: LocHit) => {
		onChange({
			city: h.city ?? '',
			country: h.country ?? value.country,
			continent: h.continent ?? value.continent,
			region: h.region ?? value.region,
			state: h.state ?? value.state,
			report_region: h.report_region ?? value.report_region ?? '',
		});
		setQ(h.city ?? '');
		setOpen(false);
	};
	return (
		<div style={{ display: 'grid', gap: 12 }}>
			<div ref={ref} style={{ position: 'relative' }}>
				<div className="co-stat-label" style={{ marginBottom: 6 }}>{lbl('city')} <span style={{ textTransform: 'none', letterSpacing: 0, color: 'var(--fg-muted)', fontWeight: 400 }}>· pick to auto-fill country / region / continent / report region</span></div>
				<div style={{ position: 'relative' }}>
					<Search size={12} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--fg-muted)' }} />
					<input className="search-input" style={{ width: '100%', paddingLeft: 26 }} placeholder="Search a city…"
						value={q}
						onChange={(e) => { setQ(e.target.value); onChange({ ...value, city: e.target.value }); setOpen(true); }}
						onFocus={() => setOpen(true)} />
				</div>
				{open && debouncedQ.length >= 2 && hits.length > 0 && (
					<div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20, marginTop: 2, maxHeight: 240, overflowY: 'auto', background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 4, boxShadow: '0 6px 24px rgba(0,0,0,0.15)' }}>
						{hits.map((h, i) => (
							<button key={`${h.city}-${h.country}-${i}`} type="button" onClick={() => pickCity(h)}
								style={{ display: 'block', width: '100%', padding: '7px 10px', textAlign: 'left', background: 'transparent', border: 0, cursor: 'pointer', color: 'var(--fg)', fontSize: 13 }}
								onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-3)')} onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
								<span style={{ fontWeight: 500 }}>{h.city}</span>
								<span style={{ color: 'var(--fg-muted)' }}>{h.state ? ` · ${h.state}` : ''}{h.country ? ` · ${h.country}` : ''}{h.region ? ` · ${h.region}` : ''}</span>
							</button>
						))}
					</div>
				)}
			</div>
			<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
				{geoField('country', 'country', countries.data)}
				{geoField('state', 'state', states.data)}
				{geoField('region', 'region', regions.data)}
				{geoField('continent', 'continent', continents.data)}
				{geoField('report_region', 'report region', reportRegions.data)}
			</div>
		</div>
	);
}

// ─── Social links ────────────────────────────────────────────────────────────

export interface SocialValue {
	twitter_url: string;
	instagram_url: string;
	facebook_url: string;
	linkedin_url: string;
	youtube_url: string;
	email: string;
}
export const EMPTY_SOCIAL: SocialValue = { twitter_url: '', instagram_url: '', facebook_url: '', linkedin_url: '', youtube_url: '', email: '' };

export function SocialLinks({ value, onChange }: { value: SocialValue; onChange: (v: SocialValue) => void }) {
	const field = (key: keyof SocialValue, label: string, placeholder: string) => (
		<div>
			<div className="co-stat-label" style={{ marginBottom: 6 }}>{label}</div>
			<input className="search-input" value={value[key]} placeholder={placeholder} onChange={(e) => onChange({ ...value, [key]: e.target.value })} />
		</div>
	);
	return (
		<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
			{field('linkedin_url', 'LinkedIn', 'https://linkedin.com/company/…')}
			{field('twitter_url', 'X / Twitter', 'https://x.com/…')}
			{field('instagram_url', 'Instagram', 'https://instagram.com/…')}
			{field('facebook_url', 'Facebook', 'https://facebook.com/…')}
			{field('youtube_url', 'YouTube', 'https://youtube.com/…')}
			{field('email', 'Email', 'contact@…')}
		</div>
	);
}

// ─── Single company picker (for deal.company_id / acquisition parties) ───────

interface CompanyHit { id: string; name: string; slug: string | null; primary_sector: string | null; hq_country: string | null; status?: string | null; is_hidden?: boolean | null }

export function CompanySelectOne({
	value, onChange, placeholder = 'Search companies…', locked = false,
}: { value: string; onChange: (id: string) => void; placeholder?: string; locked?: boolean }) {
	const [q, setQ] = useState('');
	const [open, setOpen] = useState(false);
	const debouncedQ = useDebounced(q, 200);
	const ref = useClickOutside<HTMLDivElement>(() => setOpen(false));

	const { data: selectedResp } = useSWR<{ data: CompanyHit[] }>(
		value ? ['/api/companies', { ids: value, limit: 1, include_hidden: 'true' }] : null,
		{ dedupingInterval: 5 * 60_000 },
	);
	const selected = selectedResp?.data?.[0];

	const { data: searchResp, isLoading } = useSWR<{ data: CompanyHit[] }>(
		// include_hidden (admins only): acquirers are often "not sportstech" companies and
		// must still be linkable, not retyped as free text.
		debouncedQ.length >= 2 ? ['/api/companies', { q: debouncedQ, limit: 12, include_hidden: 'true' }] : null,
		{ dedupingInterval: 30_000, keepPreviousData: true },
	);
	const hits = searchResp?.data ?? [];
	const exact = hits.some((h) => nameKey(h.name) === nameKey(q));
	const [creating, setCreating] = useState<string | null>(null);

	// `locked`: the company is fixed by context (e.g. adding an M&A deal from a
	// company's own profile), so show it read-only with no clear button.
	if (value && selected && (locked || !open)) {
		return (
			<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
				<div className="search-input" style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
					<span style={{ fontWeight: 500 }}>{selected.name}</span>
					{selected.primary_sector && <span style={{ color: 'var(--fg-muted)', marginLeft: 6 }}>· {selected.primary_sector}</span>}
				</div>
				{!locked && <button type="button" className="btn ghost" onClick={() => { onChange(''); setOpen(true); }}><X size={12} /></button>}
			</div>
		);
	}

	return (
		<div ref={ref} style={{ position: 'relative' }}>
			<div style={{ position: 'relative' }}>
				<Search size={12} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--fg-muted)' }} />
				<input
					className="search-input"
					placeholder={placeholder}
					value={q}
					onChange={(e) => { setQ(e.target.value); setOpen(true); }}
					onFocus={() => setOpen(true)}
					style={{ width: '100%', paddingLeft: 26 }}
				/>
			</div>
			{open && q.length >= 2 && (
				<div style={{
					position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20,
					marginTop: 2, maxHeight: 280, overflowY: 'auto',
					background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 4,
					boxShadow: '0 6px 24px rgba(0,0,0,0.15)',
				}}>
					{isLoading && <div style={{ padding: 10, fontSize: 12, color: 'var(--fg-muted)' }}>Searching…</div>}
					{hits.map((h) => (
						<button key={h.id} type="button"
							onClick={() => { onChange(h.id); setQ(''); setOpen(false); }}
							style={{ display: 'block', width: '100%', padding: '8px 10px', textAlign: 'left', background: 'transparent', border: 0, cursor: 'pointer', color: 'var(--fg)', fontSize: 13 }}
							onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-3)')}
							onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
							<span style={{ fontWeight: 500 }}>{h.name}</span>
							<span style={{ color: 'var(--fg-muted)' }}>{h.primary_sector ? ` · ${h.primary_sector}` : ''}{h.hq_country ? ` · ${h.hq_country}` : ''}</span>
							{h.status === 'not_sportstech' && <span style={{ color: 'var(--fg-muted)', fontSize: 11 }}> · not sportstech</span>}
							{h.is_hidden && <span style={{ color: 'var(--fg-muted)', fontSize: 11 }}> · hidden</span>}
						</button>
					))}
					{!isLoading && hits.length === 0 && <div style={{ padding: 10, fontSize: 12, color: 'var(--fg-muted)' }}>No matches.</div>}
					{!isLoading && !exact && (
						<button type="button" onClick={() => { setCreating(q.trim()); setOpen(false); }} style={addRowStyle(true)}>
							<Plus size={12} /> Create company &ldquo;{q.trim()}&rdquo;
						</button>
					)}
				</div>
			)}
			{creating !== null && (
				<CompanyModal id={null} seed={{ name: creating }} onClose={() => setCreating(null)}
					onSaved={(id) => { setCreating(null); setQ(''); if (id) onChange(id); }} />
			)}
		</div>
	);
}

// ─── Investor picker — typeahead, free-text, lead toggle ─────────────────────

export interface DealInvestor { investor_id?: string; investor_name: string; is_lead: boolean }
interface InvestorHit { id: string; name: string; slug: string | null }

export function InvestorPicker({ value, onChange }: { value: DealInvestor[]; onChange: (v: DealInvestor[]) => void }) {
	const [q, setQ] = useState('');
	const [open, setOpen] = useState(false);
	const debouncedQ = useDebounced(q, 200);
	const containerRef = useClickOutside<HTMLDivElement>(() => setOpen(false));

	const { data: searchResp, isLoading: searching } = useSWR<{ data: InvestorHit[] }>(
		debouncedQ.length >= 2 ? ['/api/investors', { q: debouncedQ, limit: 12 }] : null,
		{ dedupingInterval: 30_000, keepPreviousData: true },
	);
	const selectedIds = new Set(value.map((v) => v.investor_id).filter(Boolean));
	const hits = (searchResp?.data ?? []).filter((h) => !selectedIds.has(h.id));

	const addLinked = (h: InvestorHit) => {
		onChange([...value, { investor_id: h.id, investor_name: h.name, is_lead: false }]);
		setQ(''); setOpen(false);
	};
	const addFreeText = (raw = q) => {
		const name = raw.trim();
		if (!name) return;
		onChange([...value, { investor_name: name, is_lead: false }]);
		setQ(''); setOpen(false);
	};
	// Same rule as the DB's investor_name_key(): case, spaces and punctuation ignored.
	const exact = hits.find((h) => nameKey(h.name) === nameKey(q));
	const [adding, setAdding] = useState<null | { mode: 'queue' | 'create'; name: string }>(null);
	// Enter: link the profile with exactly this name if there is one. Asks the API itself
	// rather than trusting `hits` (debounced, and it hides investors already on the deal),
	// so fast typing never stores an existing investor as unlinked text.
	const submitTyped = async () => {
		const name = q.trim();
		if (!name) return;
		let match: InvestorHit | null = exact ?? null;
		if (!match) {
			const r = await api<{ data: InvestorHit[] }>('GET', `/api/investors?q=${encodeURIComponent(name)}&limit=12`).catch(() => null);
			match = r?.data?.find((h) => nameKey(h.name) === nameKey(name)) ?? null;
		}
		if (match && selectedIds.has(match.id)) { toast(`${match.name} is already on this deal`); setQ(''); return; }
		if (match) addLinked(match); else addFreeText(name);
	};
	const startAdding = (mode: 'queue' | 'create') => { setAdding({ mode, name: q.trim() }); setOpen(false); };
	const createdProfile = async (id?: string) => {
		const typed = adding?.name ?? '';
		setAdding(null); setQ('');
		if (!id) return;
		const r = await api<{ data: InvestorHit[] }>('GET', `/api/investors?ids=${id}&limit=1`).catch(() => null);
		onChange([...value, { investor_id: id, investor_name: r?.data?.[0]?.name ?? typed, is_lead: false }]);
	};
	const remove = (idx: number) => onChange(value.filter((_, i) => i !== idx));
	const toggleLead = (idx: number) => onChange(value.map((v, i) => i === idx ? { ...v, is_lead: !v.is_lead } : v));

	return (
		<div ref={containerRef} style={{ display: 'grid', gap: 6 }}>
			{value.length > 0 && (
				<div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
					{value.map((v, idx) => (
						<div key={`${v.investor_id ?? v.investor_name}-${idx}`} style={{
							display: 'inline-flex', alignItems: 'center', gap: 6,
							padding: '4px 6px', background: 'var(--bg-2)', border: '1px solid var(--border)', fontSize: 12,
						}}>
							<button type="button" onClick={() => toggleLead(idx)} title={v.is_lead ? 'Lead investor' : 'Mark as lead'}
								style={{ background: 'none', border: 0, cursor: 'pointer', padding: 0, display: 'inline-flex', color: v.is_lead ? 'var(--accent)' : 'var(--fg-muted)' }}>
								<Star size={12} fill={v.is_lead ? 'var(--accent)' : 'none'} />
							</button>
							<span style={{ fontWeight: 500 }}>{v.investor_name}</span>
							{!v.investor_id && <span style={{ color: 'var(--fg-muted)' }}>· text</span>}
							<button type="button" onClick={() => remove(idx)} title="Remove"
								style={{ background: 'none', border: 0, color: 'var(--fg-muted)', cursor: 'pointer', padding: 2, display: 'inline-flex' }}>
								<X size={12} />
							</button>
						</div>
					))}
				</div>
			)}
			<div style={{ position: 'relative' }}>
				<Search size={12} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--fg-muted)' }} />
				<input
					className="search-input"
					placeholder="Search investors, or type a name + Enter…"
					value={q}
					onChange={(e) => { setQ(e.target.value); setOpen(true); }}
					onFocus={() => setOpen(true)}
					onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void submitTyped(); } }}
					style={{ width: '100%', paddingLeft: 26 }}
				/>
				{open && q.length >= 2 && (
					<div style={{
						position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20,
						marginTop: 2, maxHeight: 280, overflowY: 'auto',
						background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 4,
						boxShadow: '0 6px 24px rgba(0,0,0,0.15)',
					}}>
						{searching && <div style={{ padding: 10, fontSize: 12, color: 'var(--fg-muted)' }}>Searching…</div>}
						{hits.map((h) => (
							<button key={h.id} type="button" onClick={() => addLinked(h)}
								style={{ display: 'block', width: '100%', padding: '8px 10px', textAlign: 'left', background: 'transparent', border: 0, cursor: 'pointer', color: 'var(--fg)', fontSize: 13 }}
								onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-3)')}
								onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
								{h.name}
							</button>
						))}
						{!exact && !searching && (
							<>
								<button type="button" onClick={() => startAdding('queue')} style={addRowStyle(true)}>
									<Plus size={12} /> Add &ldquo;{q.trim()}&rdquo; to Investors to add
								</button>
								<button type="button" onClick={() => startAdding('create')} style={addRowStyle(false)}>
									<Plus size={12} /> Create investor profile &ldquo;{q.trim()}&rdquo; now
								</button>
							</>
						)}
						<button type="button" onClick={() => addFreeText()} style={{ ...addRowStyle(exact != null || searching), color: 'var(--fg-muted)' }}>
							Add &ldquo;{q.trim()}&rdquo; as text only
						</button>
					</div>
				)}
			</div>
			<div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{value.length} investor(s) · star marks the lead · names left as text are queued in Investors to add on save</div>
			{adding?.mode === 'queue' && (
				<AddCandidateModal initialName={adding.name} onClose={() => setAdding(null)}
					onSaved={(name) => { setAdding(null); addFreeText(name); }} />
			)}
			{adding?.mode === 'create' && (
				<InvestorModal id={null} seed={{ name: adding.name }} onClose={() => setAdding(null)} onSaved={(id) => void createdProfile(id)} />
			)}
		</div>
	);
}

const nameKey = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const addRowStyle = (divider: boolean): React.CSSProperties => ({
	display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: '8px 10px', textAlign: 'left', background: 'transparent', border: 0,
	borderTop: divider ? '1px solid var(--border)' : 0, cursor: 'pointer', color: 'var(--fg)', fontSize: 12,
});

// ─── User pickers (search by name/email → profile_id) ────────────────────────
// Admins never type UUIDs — they search a person and we hand back the id(s).

interface UserHit { id: string; email: string | null; display_name: string | null }
const userLabel = (u: UserHit): string => u.display_name || u.email || `${u.id.slice(0, 8)}…`;

export function UserSelectOne({
	value, onChange, placeholder = 'Search users by name or email…',
}: { value: string; onChange: (id: string) => void; placeholder?: string }) {
	const [q, setQ] = useState('');
	const [open, setOpen] = useState(false);
	const debouncedQ = useDebounced(q, 200);
	const ref = useClickOutside<HTMLDivElement>(() => setOpen(false));

	// Remember the label of the picked user so the chosen state reads as a name,
	// not a UUID (the admin users list has no by-id lookup).
	const [pickedLabel, setPickedLabel] = useState<string | null>(null);
	const { data: searchResp, isLoading } = useSWR<{ data: UserHit[] }>(
		debouncedQ.length >= 2 ? ['/api/admin/users', { q: debouncedQ, limit: 12 }] : null,
		{ dedupingInterval: 30_000, keepPreviousData: true },
	);
	const hits = searchResp?.data ?? [];

	if (value && !open) {
		return (
			<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
				<div className="search-input" style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
					<span style={{ fontWeight: 500 }}>{pickedLabel ?? `${value.slice(0, 8)}…`}</span>
				</div>
				<button type="button" className="btn ghost" onClick={() => { onChange(''); setPickedLabel(null); setOpen(true); }}><X size={12} /></button>
			</div>
		);
	}
	return (
		<div ref={ref} style={{ position: 'relative' }}>
			<div style={{ position: 'relative' }}>
				<Search size={12} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--fg-muted)' }} />
				<input className="search-input" placeholder={placeholder} value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} style={{ width: '100%', paddingLeft: 26 }} />
			</div>
			{open && q.length >= 2 && (
				<div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20, marginTop: 2, maxHeight: 280, overflowY: 'auto', background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 4, boxShadow: '0 6px 24px rgba(0,0,0,0.15)' }}>
					{isLoading && <div style={{ padding: 10, fontSize: 12, color: 'var(--fg-muted)' }}>Searching…</div>}
					{hits.map((h) => (
						<button key={h.id} type="button" onClick={() => { onChange(h.id); setPickedLabel(userLabel(h)); setQ(''); setOpen(false); }}
							style={{ display: 'block', width: '100%', padding: '8px 10px', textAlign: 'left', background: 'transparent', border: 0, cursor: 'pointer', color: 'var(--fg)', fontSize: 13 }}
							onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-3)')} onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
							<span style={{ fontWeight: 500 }}>{h.display_name || h.email}</span>
							{h.display_name && h.email && <span style={{ color: 'var(--fg-muted)' }}> · {h.email}</span>}
						</button>
					))}
					{!isLoading && hits.length === 0 && <div style={{ padding: 10, fontSize: 12, color: 'var(--fg-muted)' }}>No matches.</div>}
				</div>
			)}
		</div>
	);
}

export function UserMultiPicker({ value, onChange }: { value: string[]; onChange: (ids: string[]) => void }) {
	const [q, setQ] = useState('');
	const [open, setOpen] = useState(false);
	const debouncedQ = useDebounced(q, 200);
	const ref = useClickOutside<HTMLDivElement>(() => setOpen(false));

	// Labels captured at pick time (admin users list has no by-id lookup).
	const [labels, setLabels] = useState<Record<string, string>>({});
	const { data: searchResp, isLoading } = useSWR<{ data: UserHit[] }>(
		debouncedQ.length >= 2 ? ['/api/admin/users', { q: debouncedQ, limit: 12 }] : null,
		{ dedupingInterval: 30_000, keepPreviousData: true },
	);
	const hits = (searchResp?.data ?? []).filter((h) => !value.includes(h.id));
	const remove = (id: string) => onChange(value.filter((x) => x !== id));

	return (
		<div ref={ref} style={{ display: 'grid', gap: 6 }}>
			{value.length > 0 && (
				<div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
					{value.map((id) => (
						<div key={id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 6px', background: 'var(--bg-2)', border: '1px solid var(--border)', fontSize: 12 }}>
							<span style={{ fontWeight: 500 }}>{labels[id] ?? `${id.slice(0, 8)}…`}</span>
							<button type="button" onClick={() => remove(id)} style={{ background: 'none', border: 0, color: 'var(--fg-muted)', cursor: 'pointer', padding: 2, display: 'inline-flex' }}><X size={12} /></button>
						</div>
					))}
				</div>
			)}
			<div style={{ position: 'relative' }}>
				<Search size={12} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--fg-muted)' }} />
				<input className="search-input" placeholder="Search users to add…" value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} style={{ width: '100%', paddingLeft: 26 }} />
				{open && q.length >= 2 && (
					<div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20, marginTop: 2, maxHeight: 280, overflowY: 'auto', background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 4, boxShadow: '0 6px 24px rgba(0,0,0,0.15)' }}>
						{isLoading && <div style={{ padding: 10, fontSize: 12, color: 'var(--fg-muted)' }}>Searching…</div>}
						{hits.map((h) => (
							<button key={h.id} type="button" onClick={() => { onChange([...value, h.id]); setLabels((m) => ({ ...m, [h.id]: userLabel(h) })); setQ(''); setOpen(false); }}
								style={{ display: 'block', width: '100%', padding: '8px 10px', textAlign: 'left', background: 'transparent', border: 0, cursor: 'pointer', color: 'var(--fg)', fontSize: 13 }}
								onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-3)')} onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
								<span style={{ fontWeight: 500 }}>{h.display_name || h.email}</span>
								{h.display_name && h.email && <span style={{ color: 'var(--fg-muted)' }}> · {h.email}</span>}
							</button>
						))}
						{!isLoading && hits.length === 0 && <div style={{ padding: 10, fontSize: 12, color: 'var(--fg-muted)' }}>No matches.</div>}
					</div>
				)}
			</div>
			<div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{value.length} selected</div>
		</div>
	);
}

// ─── Single investor picker (jobs · Apollo enrich) ───────────────────────────

export function InvestorSelectOne({
	value, onChange, placeholder = 'Search investors…',
}: { value: string; onChange: (id: string) => void; placeholder?: string }) {
	const [q, setQ] = useState('');
	const [open, setOpen] = useState(false);
	const debouncedQ = useDebounced(q, 200);
	const ref = useClickOutside<HTMLDivElement>(() => setOpen(false));

	const { data: selResp } = useSWR<{ data: InvestorHit[] }>(value ? ['/api/investors', { ids: value, limit: 1 }] : null, { dedupingInterval: 60_000 });
	const selected = selResp?.data?.[0];
	const { data: searchResp, isLoading } = useSWR<{ data: InvestorHit[] }>(
		debouncedQ.length >= 2 ? ['/api/investors', { q: debouncedQ, limit: 12 }] : null,
		{ dedupingInterval: 30_000, keepPreviousData: true },
	);
	const hits = searchResp?.data ?? [];

	if (value && selected && !open) {
		return (
			<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
				<div className="search-input" style={{ flex: 1 }}><span style={{ fontWeight: 500 }}>{selected.name}</span></div>
				<button type="button" className="btn ghost" onClick={() => { onChange(''); setOpen(true); }}><X size={12} /></button>
			</div>
		);
	}
	return (
		<div ref={ref} style={{ position: 'relative' }}>
			<div style={{ position: 'relative' }}>
				<Search size={12} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--fg-muted)' }} />
				<input className="search-input" placeholder={placeholder} value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} style={{ width: '100%', paddingLeft: 26 }} />
			</div>
			{open && q.length >= 2 && (
				<div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20, marginTop: 2, maxHeight: 280, overflowY: 'auto', background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 4, boxShadow: '0 6px 24px rgba(0,0,0,0.15)' }}>
					{isLoading && <div style={{ padding: 10, fontSize: 12, color: 'var(--fg-muted)' }}>Searching…</div>}
					{hits.map((h) => (
						<button key={h.id} type="button" onClick={() => { onChange(h.id); setQ(''); setOpen(false); }}
							style={{ display: 'block', width: '100%', padding: '8px 10px', textAlign: 'left', background: 'transparent', border: 0, cursor: 'pointer', color: 'var(--fg)', fontSize: 13 }}
							onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-3)')} onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
							<span style={{ fontWeight: 500 }}>{h.name}</span>
						</button>
					))}
					{!isLoading && hits.length === 0 && <div style={{ padding: 10, fontSize: 12, color: 'var(--fg-muted)' }}>No matches.</div>}
				</div>
			)}
		</div>
	);
}
