'use client';

import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import { qk } from '@/lib/query-keys';
import { Select } from '@/components/select';

/**
 * Lightweight filter primitives for admin list pages. `FilterBar` is the row
 * container (reuses the existing `.filter-bar` style); `FilterSelect` is a
 * labelled dropdown that always offers an "all" option (empty value).
 *
 * Keep filter state in the page via useState and pass value/onChange — the
 * page is responsible for threading the values into its SWR list key.
 */

export function FilterBar({ children }: { children: React.ReactNode }) {
	return (
		<div className="filter-bar" style={{ marginBottom: 'var(--space-4)', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
			{children}
		</div>
	);
}

export interface FilterOption { value: string; label: string }

export function FilterSelect({
	value, onChange, options, allLabel = 'All', ariaLabel,
}: {
	value: string;
	onChange: (v: string) => void;
	options: Array<FilterOption | string>;
	allLabel?: string;
	ariaLabel?: string;
}) {
	const opts = [
		{ value: '', label: allLabel },
		...options.map((o) => (typeof o === 'string' ? { value: o, label: o.replace(/_/g, ' ') } : o)),
	];
	return <Select value={value} onChange={onChange} options={opts} ariaLabel={ariaLabel} placeholder={allLabel} />;
}

/** Tri-state boolean filter: All / Yes / No. Value is '' | 'true' | 'false'. */
export function BoolFilter({
	value, onChange, ariaLabel, yesLabel = 'Yes', noLabel = 'No', allLabel = 'Any',
}: { value: string; onChange: (v: string) => void; ariaLabel?: string; yesLabel?: string; noLabel?: string; allLabel?: string }) {
	return <FilterSelect ariaLabel={ariaLabel} value={value} onChange={onChange} options={[{ value: 'true', label: yesLabel }, { value: 'false', label: noLabel }]} allLabel={allLabel} />;
}

/** Compact min–max numeric range (two inputs). Values are kept as strings. */
export function FilterRange({
	label, min, max, onMin, onMax, width = 78,
}: { label: string; min: string; max: string; onMin: (v: string) => void; onMax: (v: string) => void; width?: number }) {
	return (
		<span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--fg-muted)' }}>
			{label}
			<input className="search-input" style={{ height: 32, width }} type="number" placeholder="min" value={min} onChange={(e) => onMin(e.target.value)} aria-label={`${label} min`} />
			<span>–</span>
			<input className="search-input" style={{ height: 32, width }} type="number" placeholder="max" value={max} onChange={(e) => onMax(e.target.value)} aria-label={`${label} max`} />
		</span>
	);
}

interface RefRow { id: string; name: string; slug: string }
const REF_KEY = {
	sectors: qk.reference.sectors, sports: qk.reference.sports,
	'tech-tags': qk.reference.techTags, 'round-types': qk.reference.roundTypes,
} as const;

/** Single-select filter populated from a reference taxonomy; emits the slug. */
export function RefSlugFilter({
	kind, value, onChange, allLabel, ariaLabel,
}: { kind: keyof typeof REF_KEY; value: string; onChange: (v: string) => void; allLabel: string; ariaLabel?: string }) {
	const { data } = useSWR<RefRow[]>(REF_KEY[kind](), { dedupingInterval: 60 * 60_000 });
	return <FilterSelect ariaLabel={ariaLabel} value={value} onChange={onChange} options={(data ?? []).map((r) => ({ value: r.slug, label: r.name }))} allLabel={allLabel} />;
}

interface SectorRow { id: string; name: string; slug: string; parent_id?: string | null }

/**
 * Cascading sector filter: Sector (pillar) → Sub-sector → Sub-sub-sector,
 * replacing the old flat "all sectors in one" dropdown. Selecting a level emits
 * that slug plus every descendant slug as a comma-joined string via `onChange`,
 * because the list endpoints match `sector_id` by an exact slug list — a pillar
 * selection must expand to all leaves beneath it. `value === ''` (a page-level
 * clear) resets all three selects. Mirrors the client list pages' sector facets.
 */
export function SectorTierFilter({
	value, onChange, allTopLabel = 'All sectors',
}: { value: string; onChange: (csv: string) => void; allTopLabel?: string }) {
	const { data } = useSWR<SectorRow[]>(qk.reference.sectors(), { dedupingInterval: 60 * 60_000 });
	const rows = useMemo(() => data ?? [], [data]);
	const [top, setTop] = useState('');
	const [sub, setSub] = useState('');
	const [subSub, setSubSub] = useState('');

	// Page-level "clear filters" sets the value back to '' — mirror that here.
	useEffect(() => { if (!value) { setTop(''); setSub(''); setSubSub(''); } }, [value]);

	const { bySlug, childrenByParent, tops } = useMemo(() => {
		const byId = new Map(rows.map((r) => [r.id, r]));
		const bySlug = new Map(rows.map((r) => [r.slug, r]));
		const childrenByParent = new Map<string, SectorRow[]>();
		rows.forEach((r) => { if (r.parent_id) { const a = childrenByParent.get(r.parent_id) ?? []; a.push(r); childrenByParent.set(r.parent_id, a); } });
		// Roots = no parent OR a dangling parent (deleted/missing). Including
		// orphans keeps a sector selectable instead of vanishing from the filter
		// (matches the reference page's orderTree, and the old flat filter).
		const tops = rows.filter((r) => !r.parent_id || !byId.has(r.parent_id));
		return { bySlug, childrenByParent, tops };
	}, [rows]);

	const topRow = top ? bySlug.get(top) : undefined;
	const subRow = sub ? bySlug.get(sub) : undefined;
	const subs = topRow ? (childrenByParent.get(topRow.id) ?? []) : [];
	const subSubs = subRow ? (childrenByParent.get(subRow.id) ?? []) : [];

	// A slug plus every descendant slug beneath it.
	const expand = (slug: string): string[] => {
		const root = bySlug.get(slug); if (!root) return [slug];
		const out = [slug]; const stack = [root.id];
		while (stack.length) { const id = stack.pop()!; for (const c of childrenByParent.get(id) ?? []) { out.push(c.slug); stack.push(c.id); } }
		return out;
	};
	const emit = (t: string, s: string, ss: string) => {
		const deepest = ss || s || t;
		onChange(deepest ? expand(deepest).join(',') : '');
	};

	return (
		<>
			<FilterSelect ariaLabel="Sector" value={top} onChange={(v) => { setTop(v); setSub(''); setSubSub(''); emit(v, '', ''); }} options={tops.map((r) => ({ value: r.slug, label: r.name }))} allLabel={allTopLabel} />
			<FilterSelect ariaLabel="Sub-sector" value={sub} onChange={(v) => { setSub(v); setSubSub(''); emit(top, v, ''); }} options={subs.map((r) => ({ value: r.slug, label: r.name }))} allLabel="All sub-sectors" />
			<FilterSelect ariaLabel="Sub-sub-sector" value={subSub} onChange={(v) => { setSubSub(v); emit(top, sub, v); }} options={subSubs.map((r) => ({ value: r.slug, label: r.name }))} allLabel="All sub-sub-sectors" />
		</>
	);
}

/** A reusable strip of KPI StatCards using the admin grid. */
export function StatStrip({ children, cols }: { children: React.ReactNode; cols?: number }) {
	return (
		<div
			className="stat-strip"
			style={{
				display: 'grid',
				gridTemplateColumns: `repeat(${cols ?? 4}, minmax(0, 1fr))`,
				gap: 'var(--space-3)',
				marginBottom: 'var(--space-4)',
			}}
		>
			{children}
		</div>
	);
}

// ── Catalog list helpers, shared by the companies / deals / M&A / investors / ecosystem lists.

type GeoKind = 'countries' | 'continents' | 'regions';
/** Country / continent / region filter fed by the location facets; emits the name the list endpoints match on. */
export function GeoFacetFilter({ kind, value, onChange, allLabel }: { kind: GeoKind; value: string; onChange: (v: string) => void; allLabel: string }) {
	const { data } = useSWR<Record<GeoKind, string[]>>(qk.reference.locationFacets(), { dedupingInterval: 60 * 60_000 });
	const opts = (data?.[kind] ?? []).map((v) => ({ value: v, label: v }));
	return <Select value={value} onChange={onChange} searchable ariaLabel={allLabel} placeholder={allLabel} options={[{ value: '', label: allLabel }, ...opts]} />;
}

/** From–to date pair (YYYY-MM-DD strings). */
export function DateRangeFilter({ label, from, to, onFrom, onTo }: { label: string; from: string; to: string; onFrom: (v: string) => void; onTo: (v: string) => void }) {
	return (
		<span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--fg-muted)' }}>
			{label}
			<input className="search-input" type="date" style={{ height: 32, width: 140 }} value={from} onChange={(e) => onFrom(e.target.value)} aria-label={`${label} from`} title={`${label} from`} />
			<span>–</span>
			<input className="search-input" type="date" style={{ height: 32, width: 140 }} value={to} onChange={(e) => onTo(e.target.value)} aria-label={`${label} to`} title={`${label} to`} />
		</span>
	);
}

/** Count line at the top of a list card, with a "Clear N filters" button when filters are on. */
export function ListCount({ total, noun, filters, onClear, right }: { total?: number; noun: [string, string]; filters: number; onClear: () => void; right?: React.ReactNode }) {
	return (
		<div style={{ padding: '8px var(--space-4)', borderBottom: '1px solid var(--border)', fontSize: 12, color: 'var(--fg-muted)', display: 'flex', alignItems: 'center', gap: 8, minHeight: 44 }}>
			<span>{total === undefined ? 'Loading…' : `${total.toLocaleString()} ${total === 1 ? noun[0] : noun[1]}${filters ? ' match these filters' : ''}`} · click a column header to sort</span>
			<span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 8, alignItems: 'center' }}>
				{filters > 0 && <button className="btn ghost" onClick={onClear}>Clear {filters} filter{filters === 1 ? '' : 's'}</button>}
				{right}
			</span>
		</div>
	);
}

/** Short date for list cells. */
export const fmtListDate = (s?: string | null) => (s ? new Date(s).toLocaleDateString(undefined, { year: '2-digit', month: 'short', day: 'numeric' }) : '—');
