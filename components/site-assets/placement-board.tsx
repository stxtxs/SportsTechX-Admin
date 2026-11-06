'use client';

import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Eye, EyeOff, GripVertical, ImageOff, Loader2, Plus, Trash2, Upload } from 'lucide-react';
import {
	DndContext, DragOverlay, PointerSensor, closestCenter, pointerWithin,
	useDraggable, useDroppable, useSensor, useSensors,
	type CollisionDetection, type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { api } from '@/lib/api';
import { useConfirm } from '@/components/confirm';
import { AsyncState, Section } from '@/components/atoms';
import { Modal } from '@/components/modal';
import {
	ACCEPT, ASSETS_KEY, PLACEMENTS_KEY, discardUpload, uploadOne, uploadsDisabled,
	type Asset, type Placement, type SectionSpec,
} from './shared';

/* eslint-disable @next/next/no-img-element */

/**
 * Placements: which asset shows where, on one site.
 *
 * One DndContext covers three drop interactions:
 *   library tile -> a section          adds a card at the end
 *   library tile -> a card's logo box  sets that card's company logo
 *   card -> card (same section)        reorders
 *
 * Drag ids are namespaced so onDragEnd can tell them apart: `lib:<assetId>` for
 * a tray tile, `logo:<placementId>` for a logo drop box, `sec:<section>` for a
 * section body, and a bare uuid for a placed card (which is what useSortable
 * registers).
 */
export function PlacementBoard({
	site, sections, placements, assets, loading, error, reload, mutatePlacements,
}: {
	site: string;
	sections: [string, SectionSpec][];
	placements: Placement[];
	assets: Asset[];
	loading: boolean;
	error: unknown;
	reload: () => void;
	mutatePlacements: (next: Placement[]) => void;
}) {
	const [dragging, setDragging] = useState<string | null>(null);
	const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

	const bySection = (name: string) =>
		placements.filter((p) => p.section === name).sort((a, b) => a.position - b.position);

	const addCard = async (section: string, assetId: string | null) => {
		try {
			await api('POST', PLACEMENTS_KEY, { site, section, asset_id: assetId });
			reload();
		} catch (e) {
			toast.error((e as Error).message);
		}
	};

	const setOverlay = async (placementId: string, assetId: string | null) => {
		try {
			await api('PATCH', `${PLACEMENTS_KEY}/${placementId}`, { overlay_asset_id: assetId });
			reload();
		} catch (e) {
			toast.error((e as Error).message);
		}
	};

	const reorder = async (section: string, orderedIds: string[]) => {
		// Optimistic: rewrite positions locally so the card lands where it was
		// dropped instead of snapping back for the round trip.
		const rank = new Map(orderedIds.map((id, i) => [id, i] as const));
		mutatePlacements(placements.map((p) => (rank.has(p.id) ? { ...p, position: rank.get(p.id)! } : p)));
		try {
			await api('POST', `${PLACEMENTS_KEY}/reorder`, { site, section, ordered_ids: orderedIds });
		} catch (e) {
			toast.error((e as Error).message);
		} finally {
			// Always reconcile. Two reorders dragged in quick succession race, and
			// without a revalidation on the SUCCESS path the loser's order sticks
			// on screen while the database - and the live site - holds the other.
			reload();
		}
	};

	const onDragEnd = (e: DragEndEvent) => {
		setDragging(null);
		const activeId = String(e.active.id);
		const overId = e.over ? String(e.over.id) : null;
		if (!overId) return;

		if (activeId.startsWith('lib:')) {
			const assetId = activeId.slice(4);
			if (overId.startsWith('logo:')) return void setOverlay(overId.slice(5), assetId);
			if (overId.startsWith('sec:')) return void addCard(overId.slice(4), assetId);
			// Dropped onto an existing card - treat it as "add to that section".
			const target = placements.find((p) => p.id === overId);
			if (target) void addCard(target.section, assetId);
			return;
		}

		// A card is being dragged. It can only move within its own section -
		// changing section would be a different request, so the drop targets of
		// other sections refuse to highlight for it (see SectionDrop).
		if (activeId === overId) return;
		const moved = placements.find((p) => p.id === activeId);
		if (!moved) return;
		const ids = bySection(moved.section).map((p) => p.id);
		const from = ids.indexOf(activeId);
		if (from < 0) return;

		// Released on the section body rather than on a sibling card. That covers
		// the 8px padding and every gap BETWEEN cards, which is a large share of
		// the drop area - discarding it made reordering feel broken unless you
		// landed exactly inside another card. Treat it as "move to the end".
		if (overId === `sec:${moved.section}`) {
			if (from === ids.length - 1) return;
			return void reorder(moved.section, arrayMove(ids, from, ids.length - 1));
		}

		const to = ids.indexOf(overId);
		if (to < 0) return;   // a card or logo box belonging to another section
		void reorder(moved.section, arrayMove(ids, from, to));
	};

	const draggedAsset = dragging?.startsWith('lib:')
		? assets.find((a) => a.id === dragging.slice(4))
		: undefined;

	return (
		<DndContext
			sensors={sensors}
			collisionDetection={collision}
			onDragStart={(e: DragStartEvent) => setDragging(String(e.active.id))}
			onDragCancel={() => setDragging(null)}
			onDragEnd={onDragEnd}
		>
			{/* The spinner keyframes live on the Library tab, which is not mounted
			    here - the logo slots need their own copy. */}
			<style>{`@keyframes site-assets-spin { to { transform: rotate(360deg); } }`}</style>

			<div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 260px) 1fr', gap: 'var(--space-4)', alignItems: 'start' }}>
				<Tray assets={assets} />

				<div style={{ display: 'grid', gap: 'var(--space-4)', minWidth: 0 }}>
					<AsyncState loading={loading} error={error} onRetry={reload}>
						<>
							{sections.map(([name, spec]) => (
								<SectionDrop
									key={name}
									name={name}
									spec={spec}
									cards={bySection(name)}
									assets={assets}
									onAdd={(assetId) => void addCard(name, assetId)}
									onSetOverlay={setOverlay}
									reload={reload}
								/>
							))}
						</>
					</AsyncState>
				</div>
			</div>

			<DragOverlay dropAnimation={null}>
				{draggedAsset ? (
					<img src={draggedAsset.url} alt="" style={{ width: 90, height: 68, objectFit: 'cover', border: '2px solid var(--accent)' }} />
				) : null}
			</DragOverlay>
		</DndContext>
	);
}

/* Prefer whatever the pointer is actually inside - that is what lets a card's
   small logo box win over the section body it sits in.
   The fallback is deliberately limited to CARDS. closestCenter scores every
   registered droppable with no distance threshold, so it never returns empty:
   applied to tray tiles, releasing one over whitespace snapped to the nearest
   droppable and silently added a card - or overwrote a company logo. Cards do
   need it, because the pointer leaves every droppable while one is lifted and
   reordering would stall without it. */
const collision: CollisionDetection = (args) => {
	const hits = pointerWithin(args);
	if (hits.length > 0) return hits;
	return isTrayDrag(args.active.id) ? [] : closestCenter(args);
};

const isTrayDrag = (id: string | number | null | undefined) =>
	typeof id === 'string' && id.startsWith('lib:');

// ---- library tray -----------------------------------------------------------

function Tray({ assets }: { assets: Asset[] }) {
	return (
		<div className="card" style={{ position: 'sticky', top: 12 }}>
			<div style={{ padding: '10px var(--space-4)', borderBottom: '1px solid var(--border)', fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--fg-2)' }}>
				Library · drag onto a section
			</div>
			<div style={{ padding: 10, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, maxHeight: '70vh', overflowY: 'auto' }}>
				{assets.length === 0 && (
					<div style={{ gridColumn: '1 / -1', fontSize: 11, color: 'var(--fg-muted)', padding: 8 }}>
						Nothing uploaded yet — see the Library tab.
					</div>
				)}
				{assets.map((a) => <TrayTile key={a.id} asset={a} />)}
			</div>
		</div>
	);
}

function TrayTile({ asset }: { asset: Asset }) {
	const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `lib:${asset.id}` });
	return (
		<div
			ref={setNodeRef}
			{...attributes}
			{...listeners}
			title={asset.filename ?? asset.url}
			style={{ cursor: 'grab', opacity: isDragging ? 0.3 : 1, border: '1px solid var(--border)', lineHeight: 0 }}
		>
			<img src={asset.url} alt="" style={{ width: '100%', aspectRatio: '4 / 3', objectFit: 'cover', background: 'var(--bg-3)', pointerEvents: 'none' }} />
		</div>
	);
}

// ---- a section ---------------------------------------------------------------

function SectionDrop({
	name, spec, cards, assets, onAdd, onSetOverlay, reload,
}: {
	name: string;
	spec: SectionSpec;
	cards: Placement[];
	assets: Asset[];
	onAdd: (assetId: string | null) => void;
	onSetOverlay: (placementId: string, assetId: string | null) => void;
	reload: () => void;
}) {
	const { setNodeRef, isOver, active } = useDroppable({ id: `sec:${name}` });
	const [picking, setPicking] = useState(false);
	const ids = cards.map((c) => c.id);
	const full = spec.max != null && cards.length >= spec.max;
	// Only highlight for a drag this section can actually take: a tray tile (when
	// a slot is free), or one of its own cards being reordered. Lighting up for
	// another section's card promised a move that onDragEnd then discarded.
	const accepts = (isTrayDrag(active?.id) && !full) || (active != null && ids.includes(String(active.id)));
	const armed = isOver && accepts;
	const hidden = cards.filter((c) => !c.is_active).length;

	return (
		<Section
			title={spec.label}
			meta={sectionMeta(spec, cards.length, hidden)}
			action={(
				<button
					type="button"
					className="btn ghost"
					disabled={full}
					title={full ? `All ${spec.max} slots are filled. Replace a card's image, or remove one.` : undefined}
					onClick={() => setPicking(true)}
				>
					<Plus size={12} /> Add
				</button>
			)}
		>
			{picking && (
				<LibraryPicker
					title={`Add to ${spec.label}`}
					assets={assets}
					noneLabel={spec.imageOptional ? 'Add without photo' : undefined}
					onPick={(assetId) => { setPicking(false); onAdd(assetId); }}
					onClose={() => setPicking(false)}
				/>
			)}
			<div style={{ fontSize: 11, color: 'var(--fg-muted)', marginBottom: 10 }}>{spec.hint}</div>
			<div
				ref={setNodeRef}
				style={{
					display: 'grid', gap: 8, padding: 8, minHeight: 72,
					border: `1px dashed ${armed ? 'var(--accent)' : 'var(--border)'}`,
					background: armed ? 'var(--bg-3)' : 'transparent',
				}}
			>
				{cards.length === 0 && (
					<div style={{ display: 'grid', placeItems: 'center', fontSize: 11, color: 'var(--fg-muted)', padding: 12 }}>
						Drop an image here. While this stays empty the site renders its own placeholders.
					</div>
				)}
				<SortableContext items={ids} strategy={verticalListSortingStrategy}>
					{cards.map((c) => (
						<Card key={c.id} card={c} spec={spec} assets={assets} onSetOverlay={onSetOverlay} reload={reload} />
					))}
				</SortableContext>
			</div>
		</Section>
	);
}

// ---- one placed card ---------------------------------------------------------

function Card({
	card, spec, assets, onSetOverlay, reload,
}: {
	card: Placement;
	spec: SectionSpec;
	assets: Asset[];
	onSetOverlay: (placementId: string, assetId: string | null) => void;
	reload: () => void;
}) {
	const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: card.id });
	const ask = useConfirm();
	const copy = card as unknown as Record<string, string | null>;

	const saveField = async (field: string, value: string) => {
		if (value === (copy[field] ?? '')) return;
		try {
			await api('PATCH', `${PLACEMENTS_KEY}/${card.id}`, { [field]: value || null });
			reload();
		} catch (e) {
			toast.error((e as Error).message);
		}
	};

	const [picking, setPicking] = useState(false);
	const patch = async (body: Record<string, unknown>) => {
		try {
			await api('PATCH', `${PLACEMENTS_KEY}/${card.id}`, body);
			reload();
		} catch (e) {
			toast.error((e as Error).message);
		}
	};

	const remove = async () => {
		if (!(await ask({ message: 'Remove this card from the section? The image stays in the library.', danger: true }))) return;
		try {
			await api('DELETE', `${PLACEMENTS_KEY}/${card.id}`);
			reload();
		} catch (e) {
			toast.error((e as Error).message);
		}
	};

	return (
		<div
			ref={setNodeRef}
			style={{
				transform: CSS.Transform.toString(transform),
				transition,
				opacity: isDragging ? 0.4 : 1,
				display: 'flex', gap: 10, alignItems: 'flex-start',
				border: `1px ${card.is_active ? 'solid' : 'dashed'} var(--border)`,
				background: card.is_active ? 'var(--bg-1)' : 'var(--bg-2)', padding: 8,
			}}
		>
			<span {...attributes} {...listeners} style={{ cursor: 'grab', color: 'var(--fg-muted)', paddingTop: 4 }}>
				<GripVertical size={14} />
			</span>

			{picking && (
				<LibraryPicker
					title="Choose the image for this card"
					assets={assets}
					noneLabel={spec.imageOptional && card.asset_url ? 'Remove photo' : undefined}
					onPick={(assetId) => { setPicking(false); void patch({ asset_id: assetId }); }}
					onClose={() => setPicking(false)}
				/>
			)}

			<button
				type="button"
				onClick={() => setPicking(true)}
				title="Click to choose a different image from the library"
				style={{ flex: 'none', padding: 0, border: 0, background: 'none', cursor: 'pointer', lineHeight: 0, opacity: card.is_active ? 1 : 0.45 }}
			>
				{card.asset_url ? (
					<img src={card.asset_url} alt="" style={{ width: 96, height: 72, objectFit: 'cover', background: 'var(--bg-3)' }} />
				) : (
					<span style={{ width: 96, height: 72, display: 'grid', placeItems: 'center', background: 'var(--bg-3)', color: 'var(--fg-muted)' }}>
						<ImageOff size={16} />
					</span>
				)}
			</button>

			<div style={{ flex: 1, minWidth: 0, display: 'grid', gap: 6, opacity: card.is_active ? 1 : 0.6 }}>
				{!card.is_active && (
					<div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--fg-muted)' }}>
						Hidden · not shown on the site
					</div>
				)}
				{spec.fields.map((f) => (
					f.multiline ? (
						<textarea
							key={f.name}
							className="search-input"
							rows={3}
							placeholder={f.label}
							defaultValue={copy[f.name] ?? ''}
							onBlur={(e) => void saveField(f.name, e.target.value)}
							style={{ fontSize: 12, height: 'auto', resize: 'vertical', padding: 6 }}
						/>
					) : (
						<input
							key={f.name}
							className="search-input"
							placeholder={f.label}
							defaultValue={copy[f.name] ?? ''}
							onBlur={(e) => void saveField(f.name, e.target.value)}
							onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
							style={{ fontSize: 12, height: 28 }}
						/>
					)
				))}
			</div>

			{spec.overlay && <LogoSlot card={card} onSetOverlay={onSetOverlay} />}

			<button
				type="button"
				className="btn ghost"
				onClick={() => void patch({ is_active: !card.is_active })}
				title={card.is_active ? 'Hide from the site (stays in this list)' : 'Show on the site again'}
				aria-label={card.is_active ? 'Hide' : 'Show'}
			>
				{card.is_active ? <EyeOff size={12} /> : <Eye size={12} />}
			</button>
			<button type="button" className="btn ghost" onClick={() => void remove()} title="Remove from section" aria-label="Remove">
				<Trash2 size={12} />
			</button>
		</div>
	);
}

/** The company logo drawn at the middle bottom of a gallery image. Its own drop
 *  target so a logo can be dragged straight onto the card it belongs to. */
function LogoSlot({
	card, onSetOverlay,
}: {
	card: Placement;
	onSetOverlay: (placementId: string, assetId: string | null) => void;
}) {
	const { setNodeRef, isOver, active } = useDroppable({ id: `logo:${card.id}` });
	const fileRef = useRef<HTMLInputElement>(null);
	const [busy, setBusy] = useState(false);
	// Only a library tile can become a logo; a dragged card can't.
	const armed = isOver && isTrayDrag(active?.id);
	const canUpload = !uploadsDisabled();

	/* Click-to-upload as well as drag-from-tray. Dragging alone meant a logo had
	   to be uploaded on the Library tab FIRST and only then dragged over here -
	   so with an empty library there was simply nothing to drag and the slot
	   looked broken. This puts the whole flow on the card itself. */
	const pick = async (file: File | undefined) => {
		if (!file || busy || !canUpload) return;
		setBusy(true);
		try {
			const uploaded = await uploadOne(file);
			if (!uploaded) return;
			try {
				const asset = await api<Asset>('POST', ASSETS_KEY, { ...uploaded, alt_text: '' });
				onSetOverlay(card.id, asset.id);
			} catch (e) {
				toast.error((e as Error).message);
				await discardUpload(uploaded.storage_path);
			}
		} finally {
			setBusy(false);
		}
	};

	return (
		<div style={{ flex: 'none', display: 'grid', gap: 3, justifyItems: 'center' }}>
			<input
				ref={fileRef}
				type="file"
				accept={ACCEPT}
				style={{ display: 'none' }}
				onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ''; }}
			/>
			<div
				ref={setNodeRef}
				onClick={() => !busy && canUpload && fileRef.current?.click()}
				// A file dragged straight off the desktop uses native HTML5 drag
				// events, which dnd-kit never sees - so both paths can coexist.
				onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); }}
				onDrop={(e) => {
					if (!e.dataTransfer.files?.length) return;
					e.preventDefault();
					void pick(e.dataTransfer.files[0]);
				}}
				title={canUpload
					? 'Click to upload a company logo, or drag one from the library'
					: 'Uploads are disabled in local dev'}
				style={{
					width: 72, height: 46, display: 'grid', placeItems: 'center',
					border: `1px dashed ${armed ? 'var(--accent)' : 'var(--border)'}`,
					background: armed ? 'var(--bg-3)' : 'var(--bg-2)',
					fontSize: 9, color: 'var(--fg-muted)', textAlign: 'center', padding: 2,
					cursor: busy || !canUpload ? 'default' : 'pointer',
				}}
			>
				{busy
					? <Loader2 size={14} style={{ animation: 'site-assets-spin 0.9s linear infinite' }} />
					: card.overlay_url
						? <img src={card.overlay_url} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
						: <span style={{ display: 'grid', justifyItems: 'center', gap: 1 }}>
							<Upload size={11} />
							<span>logo</span>
						</span>}
			</div>
			{card.overlay_url && (
				<button
					type="button"
					className="btn ghost"
					style={{ fontSize: 9, padding: '1px 6px' }}
					onClick={() => onSetOverlay(card.id, null)}
				>
					clear
				</button>
			)}
		</div>
	);
}

/** Section header line: count (or slots used), how many are hidden, and what
 *  the site does when nothing visible is left. */
function sectionMeta(spec: SectionSpec, total: number, hidden: number): string {
	if (total === 0) return `empty → the site shows ${spec.placeholderCount} placeholders`;
	const count = spec.max ? `${total} / ${spec.max} slots` : `${total} card${total === 1 ? '' : 's'}`;
	if (hidden === 0) return count;
	if (hidden === total) return `${count} · all hidden → the site shows its placeholders`;
	return `${count} · ${hidden} hidden`;
}

// ---- library picker ----------------------------------------------------------

/** Click-to-choose alternative to dragging from the tray: pick an image already
 *  in the library, upload a new one, or (image-optional sections) go without. */
function LibraryPicker({
	title, assets, noneLabel, onPick, onClose,
}: {
	title: string;
	assets: Asset[];
	noneLabel?: string;
	onPick: (assetId: string | null) => void;
	onClose: () => void;
}) {
	const fileRef = useRef<HTMLInputElement>(null);
	const [busy, setBusy] = useState(false);
	const canUpload = !uploadsDisabled();

	const upload = async (file: File | undefined) => {
		if (!file || busy) return;
		setBusy(true);
		try {
			const uploaded = await uploadOne(file);
			if (!uploaded) return;
			try {
				const asset = await api<Asset>('POST', ASSETS_KEY, { ...uploaded, alt_text: '' });
				onPick(asset.id);
			} catch (e) {
				toast.error((e as Error).message);
				await discardUpload(uploaded.storage_path);
			}
		} finally {
			setBusy(false);
		}
	};

	return (
		<Modal
			title={title}
			onClose={onClose}
			width={760}
			footer={(
				<div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', width: '100%' }}>
					{noneLabel && (
						<button type="button" className="btn ghost" onClick={() => onPick(null)} disabled={busy}>
							<ImageOff size={12} /> {noneLabel}
						</button>
					)}
					<input
						ref={fileRef}
						type="file"
						accept={ACCEPT}
						style={{ display: 'none' }}
						onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ''; }}
					/>
					<button
						type="button"
						className="btn"
						disabled={busy || !canUpload}
						title={canUpload ? undefined : 'Uploads are disabled in local dev'}
						onClick={() => fileRef.current?.click()}
					>
						{busy ? <Loader2 size={12} style={{ animation: 'site-assets-spin 0.9s linear infinite' }} /> : <Upload size={12} />} Upload new
					</button>
				</div>
			)}
		>
			{assets.length === 0 ? (
				<div style={{ fontSize: 12, color: 'var(--fg-muted)', padding: 12 }}>
					The library is empty. Upload a new image below.
				</div>
			) : (
				<div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 8 }}>
					{assets.map((a) => (
						<button
							key={a.id}
							type="button"
							disabled={busy}
							onClick={() => onPick(a.id)}
							title={a.filename ?? a.url}
							style={{ padding: 0, border: '1px solid var(--border)', background: 'var(--bg-2)', cursor: 'pointer', textAlign: 'left' }}
						>
							<img src={a.url} alt={a.alt_text} style={{ width: '100%', aspectRatio: '4 / 3', objectFit: 'cover', display: 'block', background: 'var(--bg-3)' }} />
							<span style={{ display: 'block', padding: '4px 6px', fontSize: 10, color: 'var(--fg-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
								{a.filename ?? 'image'}{a.usage_count ? ` · used ${a.usage_count}×` : ''}
							</span>
						</button>
					))}
				</div>
			)}
		</Modal>
	);
}
