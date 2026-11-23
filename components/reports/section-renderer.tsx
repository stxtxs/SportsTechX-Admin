'use client';
// GENERATED — copied from client/components/features/reports/section-renderer.tsx by scripts/sync-report-renderer.mjs. Edit the client file, then re-run the script.

import { Lock } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Section, VisibleSection, LockedSection } from './report-kit/types';
import { RichText } from './report-kit/tiptap';
import { HeroSection } from './sections/hero';
import { KpiGridSection } from './sections/kpi-grid';
import { NarrativeSection } from './sections/narrative';
import { QuoteSection } from './sections/quote';
import { EmbedSection } from './sections/embed';
import { PeopleGridSection } from './sections/people-grid';
import { CompanyGridSection } from './sections/company-grid';
import { DealTableSection } from './sections/deal-table';
import { DataChartSection } from './sections/data-chart';
import { PollSection } from './sections/poll';
import { TrendCardListSection } from './sections/trend-card-list';
import { AccordionSection } from './sections/accordion';
import { SectorBubbleSection } from './sections/sector-bubble';
import { EcosystemMapSection } from './sections/ecosystem-map';

/**
 * Dispatch a report section to its renderer. Hero is full-bleed (no section
 * chrome); every other kind sits in a padded `.rk-section` with an editorial
 * header (mono eyebrow + display title + accent bar). Locked sections (tier
 * above the viewer) render a blurred preview + upgrade CTA.
 */
export function SectionRenderer({ section }: { section: Section }) {
	if (section.is_locked) return <LockedCard section={section} />;
	if (section.kind === 'hero') return <div id={section.slug ?? undefined}><HeroSection content={section.content} title={section.title} /></div>;

	const eyebrow = section.content.eyebrow ?? section.content.kicker;
	return (
		<section className="rk-section" id={section.slug ?? undefined}>
			{(eyebrow != null || section.title) && (
				<header style={{ marginBottom: 28 }}>
					{eyebrow != null && <div className="rk-eyebrow"><RichText value={eyebrow} inline /></div>}
					{section.title && <h2 className="rk-title">{section.title}</h2>}
					<div className="rk-accent-bar" />
				</header>
			)}
			{renderKind(section)}
		</section>
	);
}

function renderKind(section: VisibleSection): ReactNode {
	switch (section.kind) {
		case 'kpi_grid': return <KpiGridSection content={section.content} />;
		case 'narrative': return <NarrativeSection content={section.content} />;
		case 'quote': return <QuoteSection content={section.content} />;
		case 'embed': return <EmbedSection content={section.content} />;
		case 'people_grid': return <PeopleGridSection content={section.content} />;
		case 'company_grid': return <CompanyGridSection section={section} />;
		case 'deal_table': return <DealTableSection section={section} />;
		case 'data_chart': return <DataChartSection section={section} />;
		case 'poll': return <PollSection section={section} />;
		case 'trend_card_list': return <TrendCardListSection content={section.content} />;
		case 'accordion': return <AccordionSection content={section.content} />;
		case 'sector_bubble': return <SectorBubbleSection content={section.content} />;
		case 'ecosystem_map': return <EcosystemMapSection section={section} />;
		default: return <Placeholder kind={section.kind} />;
	}
}

function Placeholder({ kind }: { kind: string }) {
	return (
		<div style={{ padding: 20, borderRadius: 12, border: '1px dashed var(--rk-border)', color: 'var(--rk-fg-muted)', fontFamily: 'var(--rk-font-mono)', fontSize: 12 }}>
			Section “{kind}” — renderer coming in a later phase.
		</div>
	);
}

function LockedCard({ section }: { section: LockedSection }) {
	return (
		// A gated section (fix brief N2, 17 Nov): its heading and one line of
		// what's inside, readable, then the unlock panel. The server sends no
		// content for it (`content: null`) — only the title and `preview`.
		<section className="rk-section" id={section.slug ?? undefined}>
			<header style={{ marginBottom: 18 }}>
				{section.title && <h2 className="rk-title">{section.title}</h2>}
				<div className="rk-accent-bar" />
			</header>
			{section.preview && (
				<p style={{ margin: '0 0 18px', fontSize: 15, lineHeight: 1.5, color: 'var(--rk-fg-sec)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{section.preview}</p>
			)}
			<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', padding: '18px 22px', borderRadius: 14, border: '1px solid var(--rk-border)', background: 'var(--rk-bg-card)' }}>
				<span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, fontFamily: 'var(--rk-font-display)', fontSize: 18, color: 'var(--rk-title)' }}>
					<Lock size={16} aria-hidden="true" /> Unlocked with Raise or Scout
				</span>
				<a href={`${process.env.NEXT_PUBLIC_ATLAS_URL ?? 'https://www.atlas.sportstechx.com'}/solutions`} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-block', padding: '10px 18px', borderRadius: 999, background: 'var(--rk-accent)', color: '#fff', fontFamily: 'var(--rk-font-mono)', fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase', textDecoration: 'none' }}>See solutions</a>
			</div>
		</section>
	);
}
