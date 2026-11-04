'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ChevronDown, ChevronRight, ChevronUp, ExternalLink, GripVertical, Plus, RotateCcw, Trash2, X } from 'lucide-react';
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { api } from '@/lib/api';
import { useConfirm } from '@/components/confirm';
import { useLeaveGuard } from '@/hooks/use-leave-guard';
import { ImageInput } from '@/components/image-input';

/**
 * Editor for the custom-built report pages (GSTER26, FTABR26) — not section reports.
 *
 * Each page renders `reports.content.<block> ?? <default>` for each editable
 * block, so this edits that `content` document, part by part. The forms are
 * inferred from each block's real shape (the defaults the page itself ships),
 * and Preview is the real page: a hidden iframe of the client's
 * /report-preview/<slug>, which re-renders from the draft as you type and is
 * shown full screen on demand.
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
	{ id: 'peak', label: 'PEAK 2026', hint: 'PEAK copy, the Startup World Cup finalists, Groundbreakers and the partner logo wall.', anchor: '#peak2026', keys: ['peakCopy', 'peakSwcFinalists', 'groundbreakersOrgs', 'peakPartnersTier1', 'peakPartnersTier2', 'peakPartnersTier3'] },
	{ id: 'innovators', label: 'Innovators', hint: 'The heading, the three questions, the innovators themselves (name, role, photo, answers) and answer overrides keyed by exact name.', anchor: '#innovators', keys: ['innovatorsHeader', 'innovators', 'innovatorResponses'] },
	{ id: 'startups', label: 'Startups to Watch', hint: 'The heading, tab intros, call to action, and the three tabs of companies.', anchor: '#ecosystem', keys: ['startupsHeader', 'watchInnovators', 'watchPeak', 'watchStxRecommends'] },
	{ id: 'ecomap', label: 'Ecosystem map', hint: 'The map’s heading. Leave the intro empty to use the automatic counts.', anchor: '#ecomap', keys: ['ecomap'] },
	{ id: 'ngsc', label: 'NGSC', hint: 'The New Global Sport Conference panel: copy, images and links.', anchor: '#ngsc', keys: ['ngsc'] },
	{ id: 'data', label: 'Data in Full', hint: 'The section heading, tab names, chart titles and call to action. The data itself comes from the report dataset.', anchor: '#dealflow', keys: ['dataHeader'] },
	{ id: 'closing', label: 'Closing quote', hint: 'The quote that closes the report.', anchor: '#closing', keys: ['closing'] },
];

/** FTABR26's parts. `facts`, `ecosystem` and `startups` are the report's data as published by STX. */
export const FTABR26_PARTS: { id: string; label: string; hint: string; anchor: string; keys: string[] }[] = [
	{ id: 'hero', label: 'Hero & about', hint: 'The hero standfirst, edition and hashtag, and the “about this report” paragraph.', anchor: '#stx-hero', keys: ['hero', 'about'] },
	{ id: 'insights', label: 'Insights', hint: 'The Insights articles (one per tab), the creators-with-live-rights list and the women’s multi-club ownership groups.', anchor: '#trends', keys: ['insights', 'creatorDeals', 'womensMcoGroups'] },
	{ id: 'worldcup', label: 'FIFA WC26 Recap', hint: 'The World Cup recap tab: copy, figures and the tech list, and the order of the tech categories.', anchor: '#trends', keys: ['worldcup', 'worldcupTechCategories'] },
	{ id: 'featured', label: 'Featured company', hint: 'The featured company panel.', anchor: '#featured', keys: ['featured'] },
	{ id: 'innovators', label: 'Innovators', hint: 'The three questions and the innovators (name, role, photo, answers).', anchor: '#innovators', keys: ['questions', 'innovators'] },
	{ id: 'startups', label: 'Startups to Watch', hint: 'The Playmakers roster shown here, the note under it, and the startup records it reads (description, sector, logo, site).', anchor: '#ecosystem', keys: ['playmakerCompanies', 'startupsNote', 'startups'] },
	{ id: 'soccerment', label: 'Soccerment feature', hint: 'The Soccerment partner feature.', anchor: '#soccerment', keys: ['soccerment'] },
	{ id: 'ecosystem', label: 'Ecosystem', hint: 'The initiatives and programs on the map and in its tables.', anchor: '#ecomap', keys: ['ecosystem'] },
	{ id: 'data', label: 'Data in Full', hint: 'The report’s figures as published (dealflow by year, region and sector, leaderboards, top companies) and the methodology note. Resetting the figures falls back to the snapshot in the page’s code.', anchor: '#dealflow', keys: ['facts', 'methodology'] },
];

/** The VC Deal Sourcing Benchmark: its whole published document, block by block. */
export const BENCHMARK26_PARTS: { id: string; label: string; hint: string; anchor: string; keys: string[] }[] = [
	{ id: 'meta', label: 'Cover & facts', hint: 'Title, subtitle, edition, dates and the counts shown on the cover and in charts.', anchor: '#why-now', keys: ['meta'] },
	{ id: 'intro', label: 'Why now', hint: 'The opening section and the contributor counts.', anchor: '#why-now', keys: ['intro'] },
	{ id: 'sections', label: 'Findings', hint: 'The numbered sections: headings, intros, figures, charts and takeaways.', anchor: '#deal-sourcing-reality', keys: ['sections'] },
	{ id: 'closing', label: 'Implications & call to action', hint: 'The closing points and the call-to-action card above the footer.', anchor: '#closing', keys: ['closing'] },
	{ id: 'method', label: 'Method', hint: 'The method notes and data note.', anchor: '#method', keys: ['methodology'] },
];

/** The custom-built report pages this editor serves, by slug. */
export const CUSTOM_REPORT_PARTS: Record<string, typeof GSTER26_PARTS> = { gster26: GSTER26_PARTS, ftabr26: FTABR26_PARTS, 'investors-survey26': BENCHMARK26_PARTS };

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

// ---- page order (drag to reorder the parts between the hero and the closing quote) ----

const ORDER_LABELS: Record<string, string> = { trends: 'Trends', peak: 'PEAK 2026', innovators: 'Innovators', startups: 'Startups to Watch', ecomap: 'Ecosystem map', ngsc: 'NGSC', data: 'Data in Full' };

function PageOrder({ order, onChange }: { order: string[]; onChange: (next: string[]) => void }) {
	const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
	const onDragEnd = ({ active, over }: DragEndEvent) => {
		if (!over || active.id === over.id) return;
		onChange(arrayMove(order, order.indexOf(String(active.id)), order.indexOf(String(over.id))));
	};
	return (
		<DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
			<SortableContext items={order} strategy={verticalListSortingStrategy}>
				<div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
					{order.map((id) => <OrderRow key={id} id={id} />)}
				</div>
			</SortableContext>
		</DndContext>
	);
}

function OrderRow({ id }: { id: string }) {
	const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
	return (
		<div ref={setNodeRef} {...attributes} {...listeners} className="g26-order"
			style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1, cursor: 'grab', display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', background: 'var(--bg-1)', border: '1px solid var(--border)', fontSize: 12, fontWeight: 600, touchAction: 'none' }}>
			<GripVertical size={14} style={{ color: 'var(--fg-muted)' }} />
			<span>{ORDER_LABELS[id] ?? id}</span>
		</div>
	);
}

// ---- the editor ----------------------------------------------------------------

export function Gster26Editor({ reportId, slug = 'gster26', saved, previewOpen, onClosePreview, onSaved }: {
	reportId: string;
	/** Which custom page: its parts, preview frame and message prefix. */
	slug?: string;
	saved: Content | null;
	previewOpen: boolean;
	onClosePreview: () => void;
	onSaved: () => void;
}) {
	const ask = useConfirm();
	const [draft, setDraft] = useState<Content>(saved ?? {});
	const [defaults, setDefaults] = useState<Content | null>(null);
	const PARTS = CUSTOM_REPORT_PARTS[slug] ?? GSTER26_PARTS;
	const [partId, setPartId] = useState(PARTS[0]!.id);
	const [saving, setSaving] = useState(false);
	const frame = useRef<HTMLIFrameElement>(null);
	const part = PARTS.find((p) => p.id === partId)!;
	const dirty = JSON.stringify(draft) !== JSON.stringify(saved ?? {});
	const partDirty = (p: (typeof PARTS)[number]) => p.keys.some((k) => JSON.stringify(draft[k]) !== JSON.stringify((saved ?? {})[k]));

	// Reset only when the saved content itself changes — publishing or a Details/theme save refetches
	// the report (new object, same content) and must not wipe unsaved edits.
	const savedKey = JSON.stringify(saved ?? {});
	// eslint-disable-next-line react-hooks/exhaustive-deps
	useEffect(() => { setDraft(saved ?? {}); }, [savedKey]);

	// Preview frame: say hello on load, take its defaults, then stream the draft.
	const post = useCallback((msg: unknown) => frame.current?.contentWindow?.postMessage(msg, ATLAS_ORIGIN), []);
	useEffect(() => {
		const onMessage = (e: MessageEvent) => {
			if (e.origin !== ATLAS_ORIGIN || e.source !== frame.current?.contentWindow) return;
			const m = e.data as { type?: string; defaults?: Content };
			if (m?.type === `${slug}:ready` && m.defaults) setDefaults(m.defaults);
		};
		window.addEventListener('message', onMessage);
		return () => window.removeEventListener('message', onMessage);
	}, [slug]);
	// Keep saying hello until the frame answers (it may hydrate after onLoad).
	useEffect(() => {
		if (defaults) return;
		const t = setInterval(() => post({ type: `${slug}:hello` }), 800);
		return () => clearInterval(t);
	}, [defaults, post, slug]);
	useEffect(() => {
		if (!defaults) return;
		const t = setTimeout(() => post({ type: `${slug}:content`, content: draft }), 120);
		return () => clearTimeout(t);
	}, [draft, defaults, post, slug]);
	useEffect(() => {
		if (previewOpen) post({ type: `${slug}:jump`, anchor: part.anchor });
	}, [previewOpen, part.anchor, post, slug]);
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
	const resetPart = async () => {
		if (!(await ask(`Reset "${part.label}" to the report’s original copy? Your edits to this part are discarded when you save.`))) return;
		setDraft((d) => Object.fromEntries(Object.entries(d).filter(([k]) => !part.keys.includes(k))) as Content);
	};

	return (
		<SlugContext.Provider value={slug}>
			<div className="rep-editor">
				<aside className="rep-editor__list">
					<div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>Page parts</div>
					<div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
						{PARTS.map((p) => (
							<button key={p.id} type="button" className={`g26-part${p.id === partId ? ' is-active' : ''}`} onClick={() => setPartId(p.id)}>
								<span className="g26-part__label">{p.label}</span>
								<span className="g26-part__meta">{p.keys.length} block{p.keys.length === 1 ? '' : 's'}{partDirty(p) ? ' · edited' : ''}</span>
							</button>
						))}
					</div>
					{defaults && Array.isArray(defaults.partOrder) && (
						<>
							<div style={{ fontWeight: 700, fontSize: 14, margin: '16px 0 4px' }}>Page order</div>
							<div style={{ fontSize: 11, color: 'var(--fg-muted)', marginBottom: 8 }}>Drag to reorder. The hero stays first and the closing quote last.</div>
							<PageOrder
								order={[...new Set([...((Array.isArray(draft.partOrder) ? draft.partOrder : []) as string[]), ...(defaults.partOrder as string[])])]}
								onChange={(next) => setDraft((d) => {
									if (!(saved && 'partOrder' in saved) && JSON.stringify(next) === JSON.stringify(defaults.partOrder)) { const { partOrder: _, ...rest } = d; return rest; }
									return { ...d, partOrder: next };
								})}
							/>
						</>
					)}
				</aside>

				<main style={{ minWidth: 0 }}>
					<div className="rep-sec">
						<div className="card rep-sec__head">
							<div className="rep-sec__top">
								<span className="rep-sec__kind">{part.label}</span>
								<span className={`rep-chip${dirty ? ' rep-chip--warn' : ''}`}>{dirty ? 'Unsaved changes' : 'All changes saved'}</span>
								<div style={{ flex: 1 }} />
								<button className="btn ghost" onClick={() => void resetPart()} title="Back to the report’s original copy"><RotateCcw size={12} /> Reset part</button>
								<button className="btn" disabled={saving || !dirty} onClick={() => void save()}>{saving ? 'Saving…' : 'Save'}</button>
							</div>
							<div className="rep-sec__hint">{part.hint} Saving publishes straight to the live report.</div>
						</div>
						<div className="card" style={{ padding: 16 }}>
							{!defaults ? (
								<div style={{ color: 'var(--fg-muted)', fontSize: 13 }}>Loading the report’s content…</div>
							) : part.keys.map((k) => (
								<Field key={k} name={k} value={draft[k]} like={defaults[k]} depth={0} onChange={(v) => setDraft((d) => {
									// Back to the original copy on a never-saved block: drop it, so it isn't "edited" and isn't saved as a frozen copy.
									if (!(saved && k in saved) && JSON.stringify(v) === JSON.stringify(defaults[k])) { const { [k]: _, ...rest } = d; return rest; }
									return { ...d, [k]: v };
								})} />
							))}
						</div>
					</div>
				</main>
			</div>

			{/* Always mounted so Preview opens instantly and is always current. */}
			<div className={`g26-preview${previewOpen ? ' is-open' : ''}`} aria-hidden={!previewOpen} role={previewOpen ? 'dialog' : undefined} aria-label="Report preview">
				<iframe ref={frame} title="Report preview" src={`${ATLAS}/report-preview/${slug}`} onLoad={() => post({ type: `${slug}:hello` })} />
				{previewOpen && (
					<div className="preview-bar">
						<span className="preview-bar__label">Preview · the live page with your unsaved edits</span>
						<a href={`${ATLAS}/reports/${slug}`} target="_blank" rel="noopener noreferrer" className="preview-bar__btn" title="The saved, live version">Live page <ExternalLink size={11} /></a>
						<button type="button" className="preview-bar__btn preview-bar__btn--primary" onClick={onClosePreview}><X size={12} /> Close</button>
					</div>
				)}
			</div>
		</SlugContext.Provider>
	);
}
