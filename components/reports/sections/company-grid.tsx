'use client';
// GENERATED — copied from client/components/features/reports/sections/company-grid.tsx by scripts/sync-report-renderer.mjs. Edit the client file, then re-run the script.

import useSWR from 'swr';
import type { VisibleSection } from '../report-kit/types';
import { useLiveSectionData } from '../report-kit/live-data';
import { formatBig } from '../report-kit/format';

/**
 * company_grid — curated/live company cards. Static: `content.company_ids` →
 * `/api/companies?ids=`. Live: `content.query` resolved via section-data.
 */
interface Co {
	id: string; name: string; slug: string | null; custom_logo_url: string | null;
	primary_sector?: string | null; sector_name?: string | null; hq_country?: string | null;
	country?: string | null; total_funding_usd: string | null;
}

function Card({ c }: { c: Co }) {
	const sector = c.primary_sector ?? c.sector_name ?? null;
	const country = c.hq_country ?? c.country ?? null;
	const inner = (
		<>
			<div style={{ height: 3, background: `linear-gradient(90deg, var(--rk-accent), color-mix(in srgb, var(--rk-accent) 27%, transparent))` }} />
			<div style={{ padding: '18px 20px 20px' }}>
				<div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
					{c.custom_logo_url
						/* eslint-disable-next-line @next/next/no-img-element */
						? <img src={c.custom_logo_url} alt="" style={{ width: 40, height: 40, objectFit: 'contain', borderRadius: 8, background: 'var(--rk-bg)', padding: 4 }} />
						: <div style={{ width: 40, height: 40, borderRadius: 8, background: 'color-mix(in srgb, var(--rk-accent) 14%, transparent)', display: 'grid', placeItems: 'center', fontFamily: 'var(--rk-font-display)', fontSize: 18, color: 'var(--rk-accent)' }}>{c.name.charAt(0)}</div>}
					<div style={{ fontWeight: 600, fontSize: 15, lineHeight: 1.2, color: 'var(--rk-fg)' }}>{c.name}</div>
				</div>
				<div style={{ fontFamily: 'var(--rk-font-mono)', fontSize: 11, color: 'var(--rk-fg-muted)' }}>{sector ?? '—'}{country ? ` · ${country}` : ''}</div>
				{c.total_funding_usd && <div style={{ fontFamily: 'var(--rk-font-mono)', fontSize: 12, color: 'var(--rk-accent)', fontWeight: 500, marginTop: 6 }}>${formatBig(Number(c.total_funding_usd))} raised</div>}
			</div>
		</>
	);
	const box: React.CSSProperties = { borderRadius: 14, overflow: 'hidden', border: '1px solid var(--rk-border)', background: 'var(--rk-bg-card)', display: 'block', textDecoration: 'none', color: 'inherit' };
	return c.slug || c.id
		? <a href={`${process.env.NEXT_PUBLIC_ATLAS_URL ?? 'https://www.atlas.sportstechx.com'}/companies/${c.slug ?? c.id}`} target="_blank" rel="noopener noreferrer" className="rk-hoverlift" style={box}>{inner}</a>
		: <div className="rk-hoverlift" style={box}>{inner}</div>;
}

function Grid({ items }: { items: Co[] }) {
	return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>{items.map((c) => <Card key={c.id} c={c} />)}</div>;
}

export function CompanyGridSection({ section }: { section: VisibleSection }) {
	const mode = (section.content.mode as string) ?? 'static';
	return mode === 'live' ? <LiveGrid section={section} /> : <StaticGrid ids={(section.content.company_ids as string[]) ?? []} />;
}

function StaticGrid({ ids }: { ids: string[] }) {
	const idsCsv = ids.length ? ids.join(',') : null;
	const { data, isLoading } = useSWR<{ data: Co[] }>(idsCsv ? ['/api/companies', { ids: idsCsv, limit: ids.length }] : null, { dedupingInterval: 300_000 });
	const byId = new Map((data?.data ?? []).map((c) => [c.id, c] as const));
	const sorted = ids.map((id) => byId.get(id)).filter(Boolean) as Co[];
	if (isLoading) return <Muted>Loading…</Muted>;
	if (!sorted.length) return <Muted>No companies to show.</Muted>;
	return <Grid items={sorted} />;
}

function LiveGrid({ section }: { section: VisibleSection }) {
	const { ref, data, isLoading } = useLiveSectionData<Co[]>(section.id);
	return <div ref={ref}>{isLoading ? <Muted>Loading…</Muted> : data && data.length ? <Grid items={data} /> : <Muted>No companies to show.</Muted>}</div>;
}

function Muted({ children }: { children: React.ReactNode }) {
	return <div style={{ padding: 14, color: 'var(--rk-fg-muted)', fontFamily: 'var(--rk-font-mono)', fontSize: 12 }}>{children}</div>;
}
