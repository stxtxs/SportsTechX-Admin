'use client';

import Link from 'next/link';
import { use, useState } from 'react';
import useSWR from 'swr';
import { ArrowLeft, Eye, Lock, Moon, Sun, Smartphone, Tablet, Monitor } from 'lucide-react';
import { ReportPage } from '@/components/reports/report-page';
import type { Section, Tier } from '@/components/reports/report-kit/types';
import type { ReportThemeOverride } from '@/components/reports/report-kit/report-theme';
import { useEditPayload } from '@/hooks/use-edit-payload';

/**
 * Preview-as-tier page for sections-based reports.
 *
 * Renders with the REAL client report renderers (`@/components/reports/*`), so
 * what the admin sees is pixel-identical to the public app — not the old
 * approximate admin-only renderer. Sections come from the SAME public endpoint
 * a real user hits (`/api/reports/:id/sections`) with the admin-only
 * `?as=explore|raise|scout` override, so tier gating + locked cards match
 * production exactly (the server honours `?as` only for `Principal.isAdmin`).
 *
 * Chrome adds what a real report page has: a theme (from `reports.theme`), a
 * dark/light toggle, and a device-width frame so the admin can check mobile.
 */

const TIERS: Tier[] = ['explore', 'raise', 'scout'];
const DEVICES = [
	{ key: 'desktop', label: 'Desktop', icon: Monitor, width: 0 },
	{ key: 'tablet', label: 'Tablet', icon: Tablet, width: 834 },
	{ key: 'phone', label: 'Phone', icon: Smartphone, width: 390 },
] as const;
type DeviceKey = (typeof DEVICES)[number]['key'];

export default function ReportPreviewPage({ params }: { params: Promise<{ id: string }> }) {
	const { id } = use(params);
	const [tier, setTier] = useState<Tier>('scout');
	const [device, setDevice] = useState<DeviceKey>('desktop');

	// The report row carries the theme + its default dark/light preference.
	const { data: report } = useEditPayload<{ title: string; theme: ReportThemeOverride | null }>(`/api/admin/reports/${id}/edit`);
	const [isDark, setIsDark] = useState<boolean | null>(null);
	const dark = isDark ?? report?.theme?.default_dark ?? true;

	const { data, isLoading, error } = useSWR<{ data: Section[] }>(
		[`/api/reports/${id}/sections`, { as: tier }],
		{ dedupingInterval: 15_000 },
	);
	const sections = data?.data ?? [];
	const visibleCount = sections.filter((s) => !s.is_locked).length;
	const lockedCount = sections.filter((s) => s.is_locked).length;
	const frameWidth = DEVICES.find((d) => d.key === device)!.width;

	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: 0, minHeight: 'calc(100vh - var(--topbar-h) - 40px)' }}>
			{/* ── Toolbar ─────────────────────────────────────────────────────── */}
			<div
				style={{
					position: 'sticky', top: 0, zIndex: 5, padding: '10px 0', marginBottom: 16,
					background: 'var(--bg-1)', borderBottom: '1px solid var(--border)',
					display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
				}}
			>
				<div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
					<Link href={`/reports/${id}`} className="btn ghost"><ArrowLeft size={12} /> Editor</Link>
					<div>
						<div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Previewing as</div>
						<div style={{ fontSize: 16, fontWeight: 700, textTransform: 'capitalize' }}>{tier} user</div>
					</div>
				</div>

				<div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
					<span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>
						<Eye size={11} style={{ verticalAlign: -1 }} /> {visibleCount}
						{lockedCount > 0 && <> · <Lock size={11} style={{ verticalAlign: -1 }} /> {lockedCount} locked</>}
					</span>

					{/* Tier */}
					<Segmented>
						{TIERS.map((t) => (
							<SegBtn key={t} active={tier === t} onClick={() => setTier(t)}>{t}</SegBtn>
						))}
					</Segmented>

					{/* Device width */}
					<Segmented>
						{DEVICES.map(({ key, label, icon: Icon }) => (
							<SegBtn key={key} active={device === key} onClick={() => setDevice(key)} title={label}><Icon size={13} /></SegBtn>
						))}
					</Segmented>

					{/* Dark / light */}
					<button className="btn ghost" onClick={() => setIsDark(!dark)} title={dark ? 'Switch to light' : 'Switch to dark'}>
						{dark ? <Sun size={13} /> : <Moon size={13} />}
					</button>
				</div>
			</div>

			{/* ── Render surface ──────────────────────────────────────────────── */}
			{error && <div className="card" style={{ padding: 12, color: '#dc2626' }}>Failed to load: {(error as Error).message}</div>}
			{isLoading && sections.length === 0 && <div className="card" style={{ padding: 12 }}>Loading…</div>}

			<div style={{ display: 'flex', justifyContent: 'center', background: 'var(--bg-2)', borderRadius: 'var(--radius)', padding: frameWidth ? 20 : 0 }}>
				<div
					style={{
						width: frameWidth ? frameWidth : '100%',
						maxWidth: '100%',
						boxShadow: frameWidth ? '0 8px 40px rgba(0,0,0,0.25)' : 'none',
						borderRadius: frameWidth ? 12 : 0,
						overflow: 'hidden',
					}}
				>
					<ReportPage sections={sections} theme={report?.theme ?? null} isDark={dark} onToggleDark={() => setIsDark(!dark)} />
				</div>
			</div>

			{!isLoading && sections.length === 0 && !error && (
				<div className="card" style={{ padding: 16, color: 'var(--fg-muted)', maxWidth: 900, margin: '16px auto' }}>
					No sections are visible to {tier} users — either nothing is published yet, or every section is gated above {tier}.
				</div>
			)}
		</div>
	);
}

function Segmented({ children }: { children: React.ReactNode }) {
	return <div style={{ display: 'flex', gap: 2, padding: 3, background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>{children}</div>;
}
function SegBtn({ active, onClick, children, title }: { active: boolean; onClick: () => void; children: React.ReactNode; title?: string }) {
	return (
		<button
			onClick={onClick}
			title={title}
			style={{
				padding: '5px 12px', background: active ? 'var(--accent)' : 'transparent', color: active ? 'var(--accent-fg)' : 'var(--fg)',
				border: 'none', borderRadius: 'calc(var(--radius) - 3px)', cursor: 'pointer', fontWeight: 600, fontSize: 12,
				textTransform: 'capitalize', display: 'inline-flex', alignItems: 'center', gap: 4,
			}}
		>
			{children}
		</button>
	);
}
