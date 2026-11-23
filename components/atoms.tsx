'use client';

import React from 'react';
import Link from 'next/link';

/**
 * Tiny shared atoms for admin pages. Mirrors the small subset of components
 * the (app) client uses, scoped down to what admin pages actually need:
 *
 *   - <PageHeader/>   page title + kicker + optional subtitle/action
 *   - <Empty/>        centered placeholder for empty/loading states
 *   - <Tag/>          uppercase pill (status badge etc.)
 *   - <Chip/>         filter chip with active state
 *   - <Section/>      card with section head + body
 *
 * Anything more complex (Logo, Sparkline, WorldMap, …) belongs in the main
 * client app, not here — admin pages are deliberately spartan.
 */

interface PageHeaderProps {
	kicker?: string;
	title: string;
	subtitle?: string;
	action?: React.ReactNode;
}

export function PageHeader({ kicker, title, subtitle, action }: PageHeaderProps) {
	return (
		<div
			style={{
				display: 'flex',
				alignItems: 'flex-end',
				justifyContent: 'space-between',
				marginBottom: 'var(--space-5)',
				flexWrap: 'wrap',
				gap: 16,
			}}
		>
			<div>
				{kicker && (
					<div
						style={{
							fontFamily: 'var(--font-mono)',
							fontSize: 11,
							color: 'var(--fg-muted)',
							textTransform: 'uppercase',
							letterSpacing: '0.1em',
							marginBottom: 6,
						}}
					>
						{kicker}
					</div>
				)}
				<h1
					style={{
						fontFamily: 'var(--font-display)',
						fontSize: 38,
						fontWeight: 800,
						letterSpacing: '-0.02em',
						lineHeight: 1,
						margin: '0 0 6px',
					}}
				>
					{title}
				</h1>
				{subtitle && (
					<p style={{ fontSize: 14, color: 'var(--fg-2)', maxWidth: 640, margin: 0 }}>
						{subtitle}
					</p>
				)}
			</div>
			{action}
		</div>
	);
}

export function Empty({ msg }: { msg: string }) {
	return (
		<div
			style={{
				padding: 'var(--space-5)',
				textAlign: 'center',
				color: 'var(--fg-muted)',
				fontSize: 13,
				fontFamily: 'var(--font-mono)',
				textTransform: 'uppercase',
				letterSpacing: '0.08em',
			}}
		>
			{msg}
		</div>
	);
}

/** Indeterminate loading placeholder with a subtle pulsing bar. */
export function Loading({ msg = 'Loading…' }: { msg?: string }) {
	return (
		<div style={{ padding: 'var(--space-5)', display: 'grid', placeItems: 'center', gap: 12 }}>
			<div className="skeleton-bar" style={{ width: 160, height: 8 }} />
			<div style={{ color: 'var(--fg-muted)', fontSize: 12, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
				{msg}
			</div>
		</div>
	);
}

/** Error state with the message and an optional retry. */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
	const message = error instanceof Error ? error.message : 'Something went wrong.';
	return (
		<div style={{ padding: 'var(--space-5)', textAlign: 'center', display: 'grid', gap: 10, placeItems: 'center' }}>
			<div style={{ color: 'var(--neg)', fontSize: 13, maxWidth: 480 }}>{message}</div>
			{onRetry && <button className="btn ghost" onClick={onRetry}>Retry</button>}
		</div>
	);
}

/**
 * Wrap any data view. Renders the right placeholder for loading / error / empty
 * and only shows `children` once there's data. Keeps every page's async
 * handling identical instead of each reinventing it.
 */
export function AsyncState({
	loading,
	error,
	empty,
	emptyMsg = 'Nothing here yet.',
	onRetry,
	children,
}: {
	loading?: boolean;
	error?: unknown;
	empty?: boolean;
	emptyMsg?: string;
	onRetry?: () => void;
	children: React.ReactNode;
}) {
	// Any error shows the error screen. (Keeping "the last loaded data" on error was tried and
	// reverted: with keepPreviousData that data can belong to another filter / page / month.)
	if (error) return <ErrorState error={error} onRetry={onRetry} />;
	if (loading) return <Loading />;
	if (empty) return <Empty msg={emptyMsg} />;
	return <>{children}</>;
}

/** A single KPI tile. Optionally a link; shows a skeleton while loading. */
export function StatCard({
	label,
	value,
	href,
	loading,
	urgent,
	delta,
	tone,
	sub,
}: {
	label: string;
	value: React.ReactNode;
	href?: string;
	loading?: boolean;
	urgent?: boolean;
	/** Optional period-over-period change (%). Renders a colored ▲/▼ sub-line. */
	delta?: number | null;
	/** Accent tone (STAT_TONES key or CSS color) — colors the value + top stripe. */
	tone?: StatTone;
	/** Optional caption under the value (e.g. "Gap €12,000"). */
	sub?: React.ReactNode;
}) {
	const c = tone ? toneColor(tone) : null;
	// Numbers stay in the default text colour; the tone only tints the top stripe.
	const valueColor = urgent ? 'var(--accent)' : 'var(--fg)';
	const inner = (
		<>
			<div className="co-stat-label">{label}</div>
			{loading ? (
				<div className="skeleton-bar" style={{ width: 64, height: 22, marginTop: 8 }} />
			) : (
				<div
					style={{
						fontFamily: 'var(--font-display)',
						fontSize: 28,
						fontWeight: 800,
						letterSpacing: '-0.02em',
						marginTop: 4,
						color: valueColor,
					}}
				>
					{value}
				</div>
			)}
			{!loading && delta != null && Number.isFinite(delta) && (
				<div style={{ fontSize: 11, marginTop: 4, color: delta >= 0 ? 'var(--pos)' : 'var(--neg)' }}>
					{delta >= 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(1)}% vs prev
				</div>
			)}
			{sub && <div style={{ fontSize: 11, marginTop: 3, color: 'var(--fg-muted)' }}>{sub}</div>}
		</>
	);
	const style: React.CSSProperties = {
		padding: 'var(--space-4)',
		textDecoration: 'none',
		color: 'inherit',
		display: 'block',
		borderTop: `2px solid ${urgent ? 'var(--accent)' : c ?? 'transparent'}`,
	};
	return href
		? <Link href={href} className="card" style={style}>{inner}</Link>
		: <div className="card" style={style}>{inner}</div>;
}

/**
 * Curated, theme-agnostic accent tones for color-coding stat cards. Each pop
 * is legible on both light and dark surfaces (oklch, high chroma). Pages pick a
 * distinct tone per KPI so the panel reads like the dashboard's colored data.
 */
export const STAT_TONES = {
	// Tuned for ≥3:1 large-text contrast on BOTH a white card and a near-black
	// dark card (kept vibrant, mid-lightness). Icon badge uses a 15% tint of these.
	brand: 'var(--accent)',
	blue: 'oklch(55% 0.18 250)',
	green: 'oklch(54% 0.15 155)',
	amber: 'oklch(57% 0.13 65)',
	purple: 'oklch(53% 0.20 305)',
	teal: 'oklch(54% 0.11 200)',
	indigo: 'oklch(51% 0.17 270)',
	rose: 'oklch(56% 0.20 18)',
} as const;
export type StatTone = keyof typeof STAT_TONES | (string & {});
const toneColor = (t?: StatTone): string => (t && t in STAT_TONES ? STAT_TONES[t as keyof typeof STAT_TONES] : (t as string) || 'var(--accent)');

/**
 * Rich stat card matching the old admin's anatomy: label + big value + optional
 * icon, an optional This Year / Last Year / YoY block with a colored up/down
 * badge, and an optional `tone` that color-codes the icon badge, value, and a
 * top accent stripe.
 */
export function RichStatCard({
	label, value, Icon, loading, totalRows, thisYear, lastYear, yoy, period = 'year', tone,
}: {
	label: string;
	value: React.ReactNode;
	Icon?: React.ComponentType<{ size?: number; style?: React.CSSProperties }>;
	loading?: boolean;
	totalRows?: number | null;
	thisYear?: number | null;
	lastYear?: number | null;
	yoy?: number | null;
	/** 'year' → This Year / Last Year / YoY; 'month' → This Month / Last Month / MoM. */
	period?: 'year' | 'month';
	/** Accent tone (a STAT_TONES key or any CSS color). Defaults to brand. */
	tone?: StatTone;
}) {
	const hasYear = thisYear != null || lastYear != null;
	const thisLabel = period === 'month' ? 'This Month' : 'This Year';
	const lastLabel = period === 'month' ? 'Last Month' : 'Last Year';
	const deltaLabel = period === 'month' ? 'MoM Change' : 'YoY Change';
	const c = toneColor(tone);
	void totalRows; // deprecated — redundant with the headline value; no longer shown.
	return (
		<div className="card" style={{ padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', borderTop: `3px solid ${c}` }}>
			<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
				<div style={{ minWidth: 0 }}>
					<div className="co-stat-label">{label}</div>
					{loading
						? <div className="skeleton-bar" style={{ width: 72, height: 30, marginTop: 10 }} />
						: <div style={{ fontFamily: 'var(--font-display)', fontSize: 30, fontWeight: 800, letterSpacing: '-0.02em', marginTop: 6, lineHeight: 1.05 }}>{value}</div>}
				</div>
				{Icon && (
					<div style={{ width: 36, height: 36, borderRadius: 10, display: 'grid', placeItems: 'center', background: `color-mix(in srgb, ${c} 15%, transparent)`, color: c, flexShrink: 0 }}>
						<Icon size={18} />
					</div>
				)}
			</div>
			{hasYear && (
				<div style={{ borderTop: '1px solid var(--border)', marginTop: 14, paddingTop: 12, display: 'grid', gap: 9 }}>
					<div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
						<span style={{ color: 'var(--fg-muted)' }}>{thisLabel}</span>
						<span style={{ fontWeight: 600 }}>{(thisYear ?? 0).toLocaleString()}</span>
					</div>
					<div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
						<span style={{ color: 'var(--fg-muted)' }}>{lastLabel}</span>
						<span style={{ fontWeight: 600 }}>{(lastYear ?? 0).toLocaleString()}</span>
					</div>
					{yoy != null && (
						<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
							<span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{deltaLabel}</span>
							<span className={`tag ${yoy >= 0 ? 'pos' : 'neg'}`}>{yoy >= 0 ? '▲' : '▼'} {yoy >= 0 ? '+' : ''}{yoy}%</span>
						</div>
					)}
				</div>
			)}
		</div>
	);
}

/**
 * Collapsible "Statistics" panel — a card with a clickable header (title +
 * optional action + chevron) that expands/collapses its body. Mirrors the old
 * admin's Statistics section.
 */
export function StatsPanel({
	title = 'Statistics', action, children,
}: {
	title?: string;
	action?: React.ReactNode;
	children: React.ReactNode;
}) {
	return (
		<div className="card" style={{ marginBottom: 'var(--space-5)' }}>
			<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px var(--space-4)', borderBottom: '1px solid var(--border)', gap: 12 }}>
				<div style={{ fontWeight: 700, fontSize: 15 }}>{title}</div>
				{action && <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>{action}</div>}
			</div>
			<div style={{ padding: 'var(--space-4)' }}>{children}</div>
		</div>
	);
}

type TagVariant = '' | 'pos' | 'neg' | 'warn' | 'pill';

export function Tag({ children, variant = '' }: { children: React.ReactNode; variant?: TagVariant }) {
	return <span className={`tag ${variant}`}>{children}</span>;
}

interface ChipProps {
	active?: boolean;
	count?: number | string;
	onClick?: () => void;
	children: React.ReactNode;
}

export function Chip({ active, count, onClick, children }: ChipProps) {
	return (
		<button type="button" className={`chip ${active ? 'on' : ''}`} onClick={onClick}>
			{children}
			{count != null && <span className="ct">{count}</span>}
		</button>
	);
}

/**
 * Clickable sortable table header. `field` is the backend sort key; the active
 * sort toggles `field` ⇄ `-field` (descending first). Pass the page's current
 * `sort` + setter; the parent should reset to page 1 on change.
 */
export function SortableTh({ label, field, sort, onSort, align }: { label: string; field: string; sort: string; onSort: (s: string) => void; align?: 'left' | 'right' }) {
	const desc = sort === `-${field}`;
	const asc = sort === field;
	const next = desc ? field : `-${field}`;
	return (
		<th style={{ cursor: 'pointer', userSelect: 'none', textAlign: align }} onClick={() => onSort(next)}>
			{label} <span style={{ fontSize: 10, color: asc || desc ? 'var(--fg)' : 'var(--fg-muted)' }}>{asc ? '▲' : desc ? '▼' : '↕'}</span>
		</th>
	);
}

/** Prev/Next pager for paginated catalog tables. Renders nothing for a single page. */
export function Pager({ page, totalPages, onPage }: { page: number; totalPages?: number; onPage: (p: number) => void }) {
	if (!totalPages || totalPages <= 1) return null;
	return (
		<div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16, alignItems: 'center' }}>
			<span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-muted)', marginRight: 8 }}>Page {page} of {totalPages}</span>
			<button className="btn ghost" disabled={page <= 1} onClick={() => onPage(page - 1)}>Prev</button>
			<button className="btn ghost" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>Next</button>
		</div>
	);
}

interface SectionProps {
	title: string;
	meta?: string;
	action?: React.ReactNode;
	children: React.ReactNode;
	padded?: boolean;
	/**
	 * Fill the (equal-height) grid cell and vertically centre the body. Use for
	 * short charts sitting beside a taller card, so they sit centred instead of
	 * leaving dead space at the bottom. Opt-in — default layout is unchanged.
	 */
	center?: boolean;
}

export function Section({ title, meta, action, children, padded = true, center = false }: SectionProps) {
	return (
		<div className="card" style={center ? { display: 'flex', flexDirection: 'column', height: '100%' } : undefined}>
			<div
				style={{
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'space-between',
					padding: '12px var(--space-4)',
					borderBottom: '1px solid var(--border)',
					gap: 12,
				}}
			>
				<div style={{ display: 'flex', alignItems: 'baseline', gap: 12, minWidth: 0 }}>
					<div style={{ fontWeight: 700, fontSize: 14 }}>{title}</div>
					{meta && (
						<div
							style={{
								fontFamily: 'var(--font-mono)',
								fontSize: 11,
								color: 'var(--fg-muted)',
								textTransform: 'uppercase',
								letterSpacing: '0.08em',
							}}
						>
							{meta}
						</div>
					)}
				</div>
				{action}
			</div>
			<div
				style={{
					...(padded ? { padding: 'var(--space-4)' } : {}),
					...(center ? { flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' } : {}),
				}}
			>
				{children}
			</div>
		</div>
	);
}

/**
 * Centered pill-tab segmented control — the STX-WebApp admin tab idiom.
 * Accepts plain string tabs or `{ key, label, count }` objects.
 */
export function PillTabs<T extends string>({
	tabs, value, onChange, center = false,
}: {
	tabs: ReadonlyArray<T | { key: T; label: string; count?: number }>;
	value: T;
	onChange: (t: T) => void;
	center?: boolean;
}) {
	const items = tabs.map((t) =>
		typeof t === 'string' ? { key: t as T, label: t as string } : t,
	) as Array<{ key: T; label: string; count?: number }>;
	return (
		<div className={`pill-tabs-wrap${center ? ' center' : ''}`}>
			<div className="pill-tabs" role="tablist">
				{items.map((it) => (
					<button
						key={it.key}
						type="button"
						role="tab"
						aria-selected={value === it.key}
						className={`pill-tab${value === it.key ? ' on' : ''}`}
						onClick={() => onChange(it.key)}
					>
						{it.label}
						{it.count != null && <span className="pill-tab-ct">{it.count}</span>}
					</button>
				))}
			</div>
		</div>
	);
}