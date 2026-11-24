'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ChevronDown, ChevronRight, ChevronUp, ExternalLink, GripVertical, Lock, Plus, RotateCcw, Trash2, Unlock, X } from 'lucide-react';
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { api } from '@/lib/api';
import { useConfirm } from '@/components/confirm';
import { useLeaveGuard } from '@/hooks/use-leave-guard';
import { ImageInput } from '@/components/image-input';
import { ReportDatasetsPanel } from './report-datasets-panel';

/**
 * Editor for custom-designed reports (reports.template: GSTER26, FTABR26, the VC Benchmark,
 * Methodology) — not section reports.
 *
 * A template has no content of its own: the page draws `reports.content` — every word, figure,
 * image and link — so this edits that document, part by part. The forms follow the shape of the
 * saved document itself, and Preview is the real page: a hidden iframe of the client's
 * /report-preview/<template>?slug=…, which re-renders from the draft as you type and is shown
 * full screen on demand. Frozen chart / map data (report_datasets) is under Data.
 */

const ATLAS = process.env.NEXT_PUBLIC_ATLAS_URL ?? 'https://www.atlas.sportstechx.com';
const ATLAS_ORIGIN = new URL(ATLAS).origin;

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };
type Content = Record<string, Json>;

/** The page's parts, in page order, and the content blocks each one owns. */
export const GSTER26_PARTS: { id: string; label: string; hint: string; anchor: string; keys: string[] }[] = [
	{ id: 'hero', label: 'Header & hero', hint: 'Top navigation labels, the hero title, intro and the six headline figures.', anchor: '#stx-hero', keys: ['nav', 'hero'] },
	{ id: 'trends', label: 'Trends', hint: 'The section heading, tab names and intros, and the three Trends cards.', anchor: '#trends', keys: ['trendsHeader', 'trendCards'] },
	{ id: 'trend-ma', label: 'Trend · M&A article', hint: 'The expanded M&A article. Its figures and charts are computed from the deal data; everything written around them is here.', anchor: '#trend-expanded-ma-sportstech', keys: ['trendMa'] },
	{ id: 'trend-running', label: 'Trend · Running article', hint: 'The expanded competitive-running article: figures, marathons table, drivers and opportunities.', anchor: '#trend-expanded-running-renaissance', keys: ['trendRunning'] },
	{ id: 'trend-dtc', label: 'Trend · DTC article', hint: 'The expanded direct-to-consumer article: figures, the launches table, the three forces, quote and implications.', anchor: '#trend-expanded-dtc-shift', keys: ['trendDtc'] },
	{ id: 'deep-dives', label: 'Trends · Deep Dives', hint: 'The long-form articles under the Deep Dives tab.', anchor: '#deep-dives', keys: ['featuredArticles'] },
	{ id: 'trends-words', label: 'Trends · labels, layout & M&A figures', hint: 'Button and table labels, poll copy, each card’s and article’s number, icon and layout, and the M&A article’s figures and charts (as published, per data filter).', anchor: '#trends', keys: ['trendsLabels', 'trendsCardStyle', 'trendsArticleStyle', 'trendsMaData'] },
	{ id: 'peak', label: 'PEAK 2026', hint: 'PEAK copy, the Startup World Cup finalists, Groundbreakers and the partner logo wall.', anchor: '#peak2026', keys: ['peakCopy', 'peakSwcFinalists', 'groundbreakersOrgs', 'peakPartnersTier1', 'peakPartnersTier2', 'peakPartnersTier3', 'peakLabels'] },
	{ id: 'innovators', label: 'Innovators', hint: 'The heading, the three questions, the innovators themselves (name, role, photo, answers) and answer overrides keyed by exact name.', anchor: '#innovators', keys: ['innovatorsHeader', 'innovators', 'innovatorResponses', 'innovatorsLabels'] },
	{ id: 'startups', label: 'Startups to Watch', hint: 'The heading, tab intros, call to action, and the three tabs of companies.', anchor: '#ecosystem', keys: ['startupsHeader', 'watchInnovators', 'watchPeak', 'watchStxRecommends', 'startupsLabels'] },
	{ id: 'ecomap', label: 'Ecosystem map', hint: 'The map’s heading and labels. Leave the intro empty to use the automatic counts. The map’s entities are under Data.', anchor: '#ecomap', keys: ['ecomap', 'ecomapLabels'] },
	{ id: 'ngsc', label: 'NGSC', hint: 'The New Global Sport Conference panel: copy, images and links.', anchor: '#ngsc', keys: ['ngsc', 'ngscLabels'] },
	{ id: 'data', label: 'Data in Full', hint: 'The section heading, tab names, chart titles and captions, filters and labels. The figures themselves are under Data (frozen as published).', anchor: '#dealflow', keys: ['dataHeader', 'dataLabels'] },
	{ id: 'closing', label: 'Closing quote', hint: 'The quote that closes the report.', anchor: '#closing', keys: ['closing'] },
	{ id: 'page-words', label: 'Page words', hint: 'The PDF link and file name, “Back to top”, the logos in the header and footer, and the titles shown on locked parts.', anchor: '#stx-hero', keys: ['pageLabels'] },
];

/** FTABR26's parts. `facts`, `ecosystem` and `startups` are the report's data as published by STX. */
export const FTABR26_PARTS: { id: string; label: string; hint: string; anchor: string; keys: string[] }[] = [
	{ id: 'hero', label: 'Hero & about', hint: 'The hero standfirst, edition and hashtag, and the “about this report” paragraph.', anchor: '#stx-hero', keys: ['hero', 'about'] },
	{ id: 'insights', label: 'Insights', hint: 'The Insights articles (one per tab), the creators-with-live-rights list and the women’s multi-club ownership groups.', anchor: '#trends', keys: ['insights', 'creatorDeals', 'womensMcoGroups', 'trendsLabels', 'trendsInsightStyle'] },
	{ id: 'worldcup', label: 'FIFA WC26 Recap', hint: 'The World Cup recap tab: copy, figures and the tech list, and the order of the tech categories.', anchor: '#trends', keys: ['worldcup', 'worldcupTechCategories', 'trendsWorldcupColors'] },
	{ id: 'featured', label: 'Featured company', hint: 'The featured company panel.', anchor: '#featured', keys: ['featured', 'featuredLabels'] },
	{ id: 'innovators', label: 'Innovators', hint: 'The three questions and the innovators (name, role, photo, answers).', anchor: '#innovators', keys: ['questions', 'innovators', 'innovatorsLabels'] },
	{ id: 'startups', label: 'Startups to Watch', hint: 'The Playmakers roster shown here, the note under it, and the startup records it reads (description, sector, logo, site).', anchor: '#ecosystem', keys: ['playmakerCompanies', 'startupsNote', 'startups', 'startupsLabels', 'startupsCities'] },
	{ id: 'soccerment', label: 'Soccerment feature', hint: 'The Soccerment partner feature.', anchor: '#soccerment', keys: ['soccerment', 'soccermentLabels', 'soccermentCta'] },
	{ id: 'ecosystem', label: 'Ecosystem', hint: 'The initiatives and programs on the map and in its tables.', anchor: '#ecomap', keys: ['ecosystem', 'ecomapLabels', 'ecomapLogos'] },
	{ id: 'partners', label: 'Partner spotlights', hint: 'The partner spotlights block (hidden while “show” is off) and each partner’s accent.', anchor: '#ecosystem', keys: ['partners', 'partnersLabels', 'partnersAccent'] },
	{ id: 'data', label: 'Data in Full', hint: 'The report’s figures as published (dealflow by year, region and sector, leaderboards, top companies), the written dealflow analysis, key figures, labels and the methodology note.', anchor: '#dealflow', keys: ['facts', 'methodology', 'dataLabels', 'dataCopy', 'dataKeyFigures'] },
	{ id: 'page-words', label: 'Page words & print', hint: 'Navigation labels, the PDF link, the six summary cards, sector names and colours, the imprint (credits), all the copy of the print / PDF layout, and the share card shown when the link is posted (title, description, 1200×630 image).', anchor: '#stx-hero', keys: ['pageLabels', 'pageSummary', 'pageSectors', 'credits', 'pagePrint', 'share'] },
];

/** The VC Deal Sourcing Benchmark: its whole published document, block by block. */
export const BENCHMARK26_PARTS: { id: string; label: string; hint: string; anchor: string; keys: string[] }[] = [
	{ id: 'meta', label: 'Cover & facts', hint: 'Title, subtitle, edition, dates and the counts shown on the cover and in charts.', anchor: '#why-now', keys: ['meta'] },
	{ id: 'intro', label: 'Why now', hint: 'The opening section and the contributor counts.', anchor: '#why-now', keys: ['intro'] },
	{ id: 'sections', label: 'Findings', hint: 'The numbered sections: headings, intros, figures, charts and takeaways.', anchor: '#deal-sourcing-reality', keys: ['sections'] },
	{ id: 'closing', label: 'Implications & call to action', hint: 'The closing points and the call-to-action card above the footer.', anchor: '#closing', keys: ['closing'] },
	{ id: 'method', label: 'Method', hint: 'The method notes and data note.', anchor: '#method', keys: ['methodology'] },
	{ id: 'ui', label: 'Page words', hint: 'The words around the document: header link labels, where each heading turns pink, chart labels, series names, the contributors image, the PDF file name and the contact email. {placeholders} are filled in by the page.', anchor: '#why-now', keys: ['ui'] },
	{ id: 'personal', label: '“Your benchmark” page', hint: 'Block titles, labels and empty states of each contributor’s personal benchmark page. {placeholders} are filled in per fund.', anchor: '#why-now', keys: ['personal'] },
];

/** Methodology: the single note page linked from the reports. */
export const METHODOLOGY_PARTS: { id: string; label: string; hint: string; anchor: string; keys: string[] }[] = [
	{ id: 'note', label: 'Methodology note', hint: 'The title, the back link (label and default target) and the paragraphs.', anchor: '#', keys: ['title', 'backLabel', 'backHref', 'paragraphs'] },
];

/** The report templates this editor serves, by reports.template. */
export const CUSTOM_REPORT_PARTS: Record<string, typeof GSTER26_PARTS> = { gster26: GSTER26_PARTS, ftabr26: FTABR26_PARTS, benchmark26: BENCHMARK26_PARTS, methodology: METHODOLOGY_PARTS };

/** The report being edited — image uploads go to its own folder. */
const SlugContext = createContext('gster26');

const LABELS: Record<string, string> = {
	featuredArticles: 'Deep Dive articles', peakSwcFinalists: 'Startup World Cup finalists', groundbreakersOrgs: 'Groundbreakers organisations',
	peakPartnersTier1: 'Partners — tier 1', peakPartnersTier2: 'Partners — tier 2', peakPartnersTier3: 'Partners — tier 3',
	innovatorResponses: 'Innovator answers', watchInnovators: 'Innovators tab', watchPeak: 'PEAK tab', watchStxRecommends: 'Our Picks tab',
	q_innovators: 'Answer: underserved areas', q_investors: 'Answer: emerging technologies', q_sports_orgs: 'Answer: operational areas',
	nav: 'Navigation', hero: 'Hero', trendsHeader: 'Section heading & tabs', trendCards: 'Trend cards', peakCopy: 'PEAK copy',
	innovatorsHeader: 'Section heading & questions', startupsHeader: 'Section heading, tab intros & call to action', ecomap: 'Map heading',
	ngsc: 'NGSC', dataHeader: 'Headings & call to action', closing: 'Closing quote',
	trendMa: 'M&A article', trendRunning: 'Running article', trendDtc: 'DTC article',
	statLabels: 'Figure labels (the figures are computed)', insightTitle: 'Insight heading', insight: 'Insight paragraphs',
	insightEmphasis: 'Emphasised closing line', acquirerLogos: 'Acquirer logos (name → website domain)', sectorLabels: 'Sector names',
	whyHappeningTitle: '“Why it’s happening” heading', whyHappening: '“Why it’s happening”', whyMattersTitle: '“Why it matters” heading', whyMatters: '“Why it matters”',
	whyMattersIntro: '“Why it matters” intro', marathons: 'Marathons table', footnotes: 'Footnotes', drivers: 'Drivers', impactStats: 'Impact figures',
	opportunities: 'Opportunities', launches: 'DTC launches table', launchesHeaders: 'Launches table headers', points: 'Bulleted points', paragraphs: 'Paragraphs',
	quoteAttribution: 'Quote attribution', closingLine: 'Closing line', g2324: '2023→24 change', g2425: '2024→25 change',
	innovators: 'Innovators', designation: 'Role', continent: 'Region (Europe, North America or APAC)', linkedin: 'LinkedIn URL', photo_url: 'Photo', logo_url: 'Organisation logo',
	'ma-sportstech': 'M&A acquirers', 'running-renaissance': 'Competitive running', 'dtc-shift': 'DTC & streaming',
	kpis: 'Headline figures', num: 'Figure', icon: 'Icon (funding, unicorn, investors, globe, trending or ma)',
	titleLine1: 'Title line 1', titleLine2: 'Title line 2 (pink)', titleLine3: 'Title line 3', titleLine4: 'Title line 4', titleYear: 'Year (pink)',
	ctaUrl: 'Button link', ctaLabel: 'Button label', ctaTitle: 'Call-to-action title', ctaText: 'Call-to-action text', ctaSubtitle: 'Call-to-action subtitle',
	videoUrl: 'Video embed URL', stats: 'Figures', about: 'About paragraphs (the last one is bold)', pillars: 'Pillars',
	insights: 'Insight articles', creatorDeals: 'Creators with live rights', womensMcoGroups: 'Women’s multi-club ownership groups',
	worldcup: 'World Cup recap', worldcupTechCategories: 'Tech categories (order)', featured: 'Featured company', soccerment: 'Soccerment',
	questions: 'Questions', playmakerCompanies: 'Playmakers roster', startupsNote: 'Note under the list', startups: 'Startup records',
	ecosystem: 'Ecosystem rows', facts: 'Figures (as published)', methodology: 'Methodology note',
	meta: 'Cover & facts', takeaways: 'Takeaways', charts: 'Charts', blocks: 'Blocks', cta: 'Call to action', rows: 'Rows',
};
const humanize = (k: string) => LABELS[k] ?? k.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
const isImageKey = (k: string) => /logo|photo|image|avatar|img|cover/i.test(k);
const isObj = (v: unknown): v is Record<string, Json> => !!v && typeof v === 'object' && !Array.isArray(v);
const itemTitle = (v: Json, i: number) => (isObj(v) ? String(v.name ?? v.title ?? v.label ?? v.heading ?? v.company ?? v.creator ?? v.region ?? v.year ?? v.key ?? v.id ?? `Item ${i + 1}`) : String(v).slice(0, 60) || `Item ${i + 1}`);

/** A blank item shaped like `like` — for "Add" on a list. */
function blankLike(like: Json): Json {
	if (typeof like === 'string') return '';
	if (typeof like === 'number') return 0;
	if (typeof like === 'boolean') return false;
	if (Array.isArray(like)) return [];
	if (isObj(like)) return Object.fromEntries(Object.entries(like).map(([k, v]) => [k, k === 'id' ? `new-${Date.now().toString(36)}` : blankLike(v)]));
	return '';
}

// ---- generic, shape-driven form ----------------------------------------------

function Field({ name, value, like, onChange, depth }: { name: string; value: Json | undefined; like: Json | undefined; onChange: (v: Json) => void; depth: number }) {
	const slug = useContext(SlugContext);
	const v = value ?? like ?? '';
	if (Array.isArray(v)) return <ListField name={name} value={v} like={Array.isArray(like) ? like : v} onChange={onChange} depth={depth} />;
	if (isObj(v)) {
		return (
			<fieldset className="g26-group" style={{ marginLeft: depth ? 0 : undefined }}>
				{name && <legend>{humanize(name)}</legend>}
				{Object.keys({ ...(isObj(like) ? like : {}), ...v }).map((k) => (
					<Field key={k} name={k} value={v[k]} like={isObj(like) ? like[k] : undefined} depth={depth + 1} onChange={(nv) => onChange({ ...v, [k]: nv })} />
				))}
			</fieldset>
		);
	}
	if (typeof v === 'boolean') {
		return <label className="g26-check"><input type="checkbox" checked={v} onChange={(e) => onChange(e.target.checked)} /> {humanize(name)}</label>;
	}
	if (typeof v === 'number') {
		return <label className="g26-field"><span>{humanize(name)}</span><input className="search-input" type="number" value={v} onChange={(e) => onChange(Number(e.target.value))} /></label>;
	}
	const s = String(v ?? '');
	if (isImageKey(name)) {
		return (
			<div className="g26-field">
				<span>{humanize(name)}</span>
				<div className="g26-img">
					{s && <img src={s.startsWith('/') ? `${ATLAS}${s}` : s} alt="" />}
					<div style={{ flex: 1, minWidth: 0 }}><ImageInput value={s} onChange={(url) => onChange(url)} pathPrefix={`reports/${slug}`} /></div>
				</div>
			</div>
		);
	}
	// The page keys layouts, anchors and poll votes on ids, so they aren't editable.
	if (name === 'id') return <label className="g26-field"><span>Id (fixed)</span><input className="search-input" value={s} readOnly disabled /></label>;
	const long = s.length > 90 || s.includes('\n');
	return (
		<label className="g26-field">
			<span>{humanize(name)}</span>
			{long
				? <textarea className="search-input" rows={Math.min(12, Math.max(3, Math.ceil(s.length / 110)))} value={s} onChange={(e) => onChange(e.target.value)} />
				: <input className="search-input" value={s} onChange={(e) => onChange(e.target.value)} />}
		</label>
	);
}

function ListField({ name, value, like, onChange, depth }: { name: string; value: Json[]; like: Json[]; onChange: (v: Json) => void; depth: number }) {
	const [open, setOpen] = useState<number | null>(null);
	// Remember the item shape, so emptying a list with no default items and adding again keeps it.
	const shape = useRef<Json | undefined>(undefined);
	shape.current = like[0] ?? value[0] ?? shape.current;
	const template = shape.current ?? '';
	const primitive = !isObj(template) && !Array.isArray(template);
	const move = (i: number, d: number) => { const n = [...value]; const [x] = n.splice(i, 1); n.splice(i + d, 0, x!); onChange(n); setOpen(open === i ? i + d : open); };
	return (
		<div className="g26-list">
			<div className="g26-list__head"><span>{humanize(name)}</span><span className="g26-count">{value.length}</span></div>
			{value.map((item, i) => (
				<div key={i} className="g26-item">
					<div className="g26-item__bar">
						{primitive ? (
							<input className="search-input" value={String(item ?? '')} onChange={(e) => onChange(value.map((x, j) => (j === i ? e.target.value : x)))} />
						) : (
							<button type="button" className="g26-item__toggle" onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i}>
								{open === i ? <ChevronDown size={13} /> : <ChevronRight size={13} />} {itemTitle(item, i)}
							</button>
						)}
						<button type="button" className="btn ghost" disabled={i === 0} onClick={() => move(i, -1)} title="Move up"><ChevronUp size={12} /></button>
						<button type="button" className="btn ghost" disabled={i === value.length - 1} onClick={() => move(i, 1)} title="Move down"><ChevronDown size={12} /></button>
						<button type="button" className="btn ghost" onClick={() => { onChange(value.filter((_, j) => j !== i)); setOpen(null); }} title="Remove"><Trash2 size={12} /></button>
					</div>
					{!primitive && open === i && (
						<div className="g26-item__body"><Field name="" value={item} like={template} depth={depth + 1} onChange={(nv) => onChange(value.map((x, j) => (j === i ? nv : x)))} /></div>
					)}
				</div>
			))}
			<button type="button" className="btn ghost g26-add" onClick={() => { onChange([...value, blankLike(template)]); if (!primitive) setOpen(value.length); }}><Plus size={12} /> Add</button>
		</div>
	);
}

// ---- the page's parts: one list — drag a block to move it, lock a block for Explore ----

/** Names for each report's page blocks (ids as the Atlas page renders them, = content.partOrder). */
const ORDER_LABELS: Record<string, Record<string, string>> = {
	gster26: { trends: 'Trends', peak: 'PEAK 2026', innovators: 'Innovators', startups: 'Startups to Watch', ecomap: 'Ecosystem map', ngsc: 'NGSC', data: 'Data in Full' },
	ftabr26: { trends: 'Insights & FIFA WC26 Recap', featured: 'Featured company', innovators: 'Innovators', startups: 'Startups to Watch', ecomap: 'Ecosystem', soccerment: 'Soccerment feature', partners: 'Partner spotlights', data: 'Data in Full', methodology: 'Methodology note', credits: 'Credits (imprint)' },
	benchmark26: { 'why-now': 'Why now', 'deal-sourcing-reality': 'Deal sources', 'sourcing-process': 'Process', 'outbound-and-tools': 'Outbound', closing: 'Implications', method: 'Method' },
};
const ORDER_NOTE: Record<string, string> = {
	gster26: 'The hero stays first and the closing quote last.',
	ftabr26: 'The hero stays first and the footer last.',
	benchmark26: 'The cover stays first. Section numbers and the header links follow this order.',
};
/** Each part → the page block it sits in; '' = pinned (hero / cover / closing quote); '*' = the
 *  Benchmark's Findings part, which edits every numbered section. Must match the server's
 *  CUSTOM_PART_KEYS (server/src/modules/reports/gated-reports.ts). */
const BLOCK_OF: Record<string, Record<string, string>> = {
	gster26: { hero: '', trends: 'trends', 'trend-ma': 'trends', 'trend-running': 'trends', 'trend-dtc': 'trends', 'deep-dives': 'trends', 'trends-words': 'trends', peak: 'peak', innovators: 'innovators', startups: 'startups', ecomap: 'ecomap', ngsc: 'ngsc', data: 'data', closing: '', 'page-words': '' },
	ftabr26: { hero: '', insights: 'trends', worldcup: 'trends', featured: 'featured', innovators: 'innovators', startups: 'startups', soccerment: 'soccerment', ecosystem: 'ecomap', partners: 'partners', data: 'data', 'page-words': '' },
	benchmark26: { meta: '', intro: 'why-now', sections: '*', closing: 'closing', method: 'method', ui: '', personal: '' },
	methodology: { note: '' },
};

type Part = (typeof GSTER26_PARTS)[number];

function PartsList({ slug, parts, order, locked, lockable, partId, meta, labelOf, onSelect, onReorder, onToggleLock }: {
	slug: string; parts: Part[]; order: string[]; locked: string[];
	/** Blocks the server can lock (from the edit payload) — the only ones with a Paid switch. */
	lockable: string[]; partId: string;
	meta: (p: Part) => string; labelOf: (block: string) => string;
	onSelect: (id: string) => void; onReorder: (next: string[]) => void; onToggleLock: (block: string) => void;
}) {
	const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
	const of = BLOCK_OF[slug] ?? {};
	const named = new Set(Object.values(of));
	const partsOf = (block: string) => parts.filter((p) => of[p.id] === block || (of[p.id] === '*' && !named.has(block)));
	const shown = new Set(order.flatMap((b) => partsOf(b).map((p) => p.id)));
	const firstBlock = parts.findIndex((p) => shown.has(p.id));
	// Pinned parts keep their place; a part no block shows yet (page order still loading) is listed plainly.
	const loose = parts.filter((p) => !shown.has(p.id));
	const top = loose.filter((p) => firstBlock < 0 || parts.indexOf(p) < firstBlock);
	const bottom = loose.filter((p) => !top.includes(p));
	const plain = (p: Part) => (
		<button key={p.id} type="button" className={`g26-part${p.id === partId ? ' is-active' : ''}`} onClick={() => onSelect(p.id)}>
			<span className="g26-part__label">{p.label}</span>
			<span className="g26-part__meta">{meta(p)}</span>
		</button>
	);
	const onDragEnd = ({ active, over }: DragEndEvent) => {
		if (!over || active.id === over.id) return;
		onReorder(arrayMove(order, order.indexOf(String(active.id)), order.indexOf(String(over.id))));
	};
	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
			{top.map(plain)}
			<DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
				<SortableContext items={order} strategy={verticalListSortingStrategy}>
					{order.map((b) => (
						<BlockRow key={b} id={b} label={labelOf(b)} parts={partsOf(b)} partId={partId} meta={meta}
							canLock={lockable.includes(b)} locked={locked.includes(b)} onSelect={onSelect} onToggleLock={() => onToggleLock(b)} />
					))}
				</SortableContext>
			</DndContext>
			{bottom.map(plain)}
		</div>
	);
}

function BlockRow({ id, label, parts, partId, meta, canLock, locked, onSelect, onToggleLock }: {
	id: string; label: string; parts: Part[]; partId: string; meta: (p: Part) => string;
	canLock: boolean; locked: boolean; onSelect: (id: string) => void; onToggleLock: () => void;
}) {
	const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
	const single = parts.length === 1 ? parts[0]! : null;
	return (
		<div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1, display: 'grid', gap: 4 }}>
			<div className={`g26-block${single && single.id === partId ? ' is-active' : ''}${locked ? ' is-locked' : ''}`}>
				<button type="button" className="g26-grip" {...attributes} {...listeners} aria-label={`Drag ${label} to reorder`} title="Drag to reorder"><GripVertical size={14} /></button>
				<button type="button" className="g26-block__label" disabled={!single} onClick={() => single && onSelect(single.id)}>
					<span className="g26-part__label">{label}</span>
					{single && <span className="g26-part__meta">{meta(single)}</span>}
				</button>
				{canLock && (
					<button type="button" className={`g26-lock${locked ? ' is-on' : ''}`} aria-pressed={locked} onClick={onToggleLock}
						title={locked ? 'Paid: Explore readers see only the heading and “Unlocked with Raise or Scout”. Click to open it to everyone.' : 'Open to every reader. Click to lock it for Raise and Scout.'}>
						{locked ? <Lock size={11} /> : <Unlock size={11} />}{locked ? 'Paid' : 'Everyone'}
					</button>
				)}
			</div>
			{!single && parts.map((p) => (
				<button key={p.id} type="button" className={`g26-part g26-part--sub${p.id === partId ? ' is-active' : ''}`} onClick={() => onSelect(p.id)}>
					<span className="g26-part__label">{p.label}</span>
					<span className="g26-part__meta">{meta(p)}</span>
				</button>
			))}
		</div>
	);
}

// ---- the editor ----------------------------------------------------------------

export function Gster26Editor({ reportId, slug, template, saved, lockable, previewOpen, onClosePreview, onSaved }: {
	reportId: string;
	/** The report's URL slug (live link, image folder, frozen data). */
	slug: string;
	/** Its page template (reports.template): parts, blocks, preview frame and message prefix. */
	template: string;
	saved: Content | null;
	/** Blocks the server's lock rules can lock (edit payload `lockable_blocks`). */
	lockable: string[];
	previewOpen: boolean;
	onClosePreview: () => void;
	onSaved: () => void;
}) {
	const ask = useConfirm();
	const [draft, setDraft] = useState<Content>(saved ?? {});
	// The saved document is the shape every form follows (the page has no built-in copy).
	const base = saved ?? {};
	const [frameReady, setFrameReady] = useState(false);
	const PARTS = CUSTOM_REPORT_PARTS[template] ?? GSTER26_PARTS;
	const [partId, setPartId] = useState(PARTS[0]!.id);
	const [saving, setSaving] = useState(false);
	const [asExplore, setAsExplore] = useState(false);
	const frame = useRef<HTMLIFrameElement>(null);
	const part = PARTS.find((p) => p.id === partId)!;
	const dirty = JSON.stringify(draft) !== JSON.stringify(saved ?? {});
	const partDirty = (p: (typeof PARTS)[number]) => p.keys.some((k) => JSON.stringify(draft[k]) !== JSON.stringify((saved ?? {})[k]));

	// Reset only when the saved content itself changes — publishing or a Details/theme save refetches
	// the report (new object, same content) and must not wipe unsaved edits.
	const savedKey = JSON.stringify(saved ?? {});
	// eslint-disable-next-line react-hooks/exhaustive-deps
	useEffect(() => { setDraft(saved ?? {}); }, [savedKey]);

	// Preview frame: say hello until it answers, then stream the draft.
	const post = useCallback((msg: unknown) => frame.current?.contentWindow?.postMessage(msg, ATLAS_ORIGIN), []);
	useEffect(() => {
		const onMessage = (e: MessageEvent) => {
			if (e.origin !== ATLAS_ORIGIN || e.source !== frame.current?.contentWindow) return;
			if ((e.data as { type?: string })?.type === `${template}:ready`) setFrameReady(true);
		};
		window.addEventListener('message', onMessage);
		return () => window.removeEventListener('message', onMessage);
	}, [template]);
	// Keep saying hello until the frame answers (it may hydrate after onLoad).
	useEffect(() => {
		if (frameReady) return;
		const t = setInterval(() => post({ type: `${template}:hello` }), 800);
		return () => clearInterval(t);
	}, [frameReady, post, template]);
	useEffect(() => {
		if (!frameReady) return;
		// `__asExplore` (preview only, never saved) draws the locked blocks as an Explore reader sees them.
		const t = setTimeout(() => post({ type: `${template}:content`, content: asExplore ? { ...draft, __asExplore: true } : draft }), 120);
		return () => clearTimeout(t);
	}, [draft, frameReady, post, template, asExplore]);
	useEffect(() => {
		if (previewOpen && part.anchor !== '#') post({ type: `${template}:jump`, anchor: part.anchor });
	}, [previewOpen, part.anchor, post, template]);
	useEffect(() => {
		if (!previewOpen) return;
		const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClosePreview(); };
		const prev = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		window.addEventListener('keydown', onKey);
		return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey); };
	}, [previewOpen, onClosePreview]);
	useLeaveGuard(dirty);

	const save = async () => {
		setSaving(true);
		try {
			await api('PATCH', `/api/admin/reports/${reportId}`, { content: draft });
			toast.success('Saved — live on the report');
			onSaved();
		} catch (e) { toast.error((e as Error).message); }
		finally { setSaving(false); }
	};
	// Page blocks in page order (the document's partOrder).
	const order = (Array.isArray(draft.partOrder) ? draft.partOrder : Array.isArray(base.partOrder) ? base.partOrder : []) as string[];
	const setOrder = (next: string[]) => setDraft((d) => ({ ...d, partOrder: next }));
	const locked = (Array.isArray(draft.lockedParts) ? draft.lockedParts : []) as string[];
	const toggleLock = (block: string) => setDraft((d) => {
		const cur = (Array.isArray(d.lockedParts) ? d.lockedParts : []) as string[];
		const next = cur.includes(block) ? cur.filter((x) => x !== block) : [...cur, block];
		if (!next.length && !(saved && 'lockedParts' in saved)) { const { lockedParts: _, ...rest } = d; return rest; }
		return { ...d, lockedParts: next };
	});
	// Benchmark findings are named by their own heading; the other pages by ORDER_LABELS.
	const sectionHeading = (id: string) => {
		const secs = (Array.isArray(draft.sections) ? draft.sections : []) as { id?: string; heading?: string }[];
		return secs.find((s) => s?.id === id)?.heading;
	};
	const labelOf = (block: string) => ORDER_LABELS[template]?.[block] ?? sectionHeading(block) ?? block;
	const discardPart = async () => {
		if (!(await ask(`Discard your unsaved changes to "${part.label}"? It goes back to the last saved version.`))) return;
		setDraft((d) => {
			const next = { ...d };
			for (const k of part.keys) { if (k in base) next[k] = base[k]!; else delete next[k]; }
			return next;
		});
	};

	return (
		<SlugContext.Provider value={slug}>
			<div className="rep-editor">
				<aside className="rep-editor__list">
					<div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Page parts</div>
					<div style={{ fontSize: 11, color: 'var(--fg-muted)', marginBottom: 8, lineHeight: 1.45 }}>
						{order.length > 0 && <>Drag <GripVertical size={10} style={{ verticalAlign: -1 }} /> to reorder. {ORDER_NOTE[template] ?? ''}</>}{lockable.length > 0 && <> <strong>Paid</strong> blocks show Explore readers only their heading and “Unlocked with Raise or Scout”.</>}
					</div>
					<PartsList
						slug={template} parts={PARTS} order={order} locked={locked} lockable={lockable} partId={partId} labelOf={labelOf}
						meta={(p) => `${p.keys.length} block${p.keys.length === 1 ? '' : 's'}${partDirty(p) ? ' · edited' : ''}`}
						onSelect={setPartId} onReorder={setOrder} onToggleLock={toggleLock}
					/>
					<ReportDatasetsPanel reportId={reportId} labelOf={labelOf} />
				</aside>

				<main style={{ minWidth: 0 }}>
					<div className="rep-sec">
						<div className="card rep-sec__head">
							<div className="rep-sec__top">
								<span className="rep-sec__kind">{part.label}</span>
								<span className={`rep-chip${dirty ? ' rep-chip--warn' : ''}`}>{dirty ? 'Unsaved changes' : 'All changes saved'}</span>
								<div style={{ flex: 1 }} />
								<button className="btn ghost" disabled={!partDirty(part)} onClick={() => void discardPart()} title="Back to the last saved version of this part"><RotateCcw size={12} /> Discard changes</button>
								<button className="btn" disabled={saving || !dirty} onClick={() => void save()}>{saving ? 'Saving…' : 'Save'}</button>
							</div>
							<div className="rep-sec__hint">{part.hint} Saving publishes straight to the live report.</div>
						</div>
						<div className="card" style={{ padding: 16 }}>
							{part.keys.every((k) => !(k in base)) ? (
								<div style={{ color: 'var(--fg-muted)', fontSize: 13 }}>This report’s document has no content for this part yet.</div>
							) : part.keys.map((k) => (
								<Field key={k} name={k} value={draft[k]} like={base[k]} depth={0} onChange={(v) => setDraft((d) => ({ ...d, [k]: v }))} />
							))}
						</div>
					</div>
				</main>
			</div>

			{/* Always mounted so Preview opens instantly and is always current. */}
			<div className={`g26-preview${previewOpen ? ' is-open' : ''}`} aria-hidden={!previewOpen} role={previewOpen ? 'dialog' : undefined} aria-label="Report preview">
				<iframe ref={frame} title="Report preview" src={`${ATLAS}/report-preview/${template}?slug=${encodeURIComponent(slug)}`} onLoad={() => post({ type: `${template}:hello` })} />
				{previewOpen && (
					<div className="preview-bar">
						<span className="preview-bar__label">Preview · the live page with your unsaved edits{asExplore ? ' · as an Explore reader' : ''}</span>
						{locked.length > 0 && (
							<button type="button" className="preview-bar__btn" aria-pressed={asExplore} onClick={() => setAsExplore((v) => !v)}
								title="Show the locked (Paid) blocks as Explore readers see them">
								{asExplore ? <Unlock size={11} /> : <Lock size={11} />} {asExplore ? 'View as Raise / Scout' : 'View as Explore'}
							</button>
						)}
						<a href={`${ATLAS}/reports/${slug}`} target="_blank" rel="noopener noreferrer" className="preview-bar__btn" title="The saved, live version">Live page <ExternalLink size={11} /></a>
						<button type="button" className="preview-bar__btn preview-bar__btn--primary" onClick={onClosePreview}><X size={12} /> Close</button>
					</div>
				)}
			</div>
		</SlugContext.Provider>
	);
}
