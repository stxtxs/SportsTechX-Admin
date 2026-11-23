'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { X } from 'lucide-react';
import { api } from '@/lib/api';
import { ImageInput } from '@/components/image-input';

/**
 * One place to edit everything ABOUT a report (title, slug, period, tags, cover,
 * blurb) — opened as a slide-over from the editor so the admin doesn't have to
 * bounce back to the /reports list. The list page still CREATES reports; this is
 * where you refine them. Saves in one PATCH to /api/admin/reports/:id.
 */
export interface ReportDetailsValue {
	title: string;
	short_title?: string | null;
	slug?: string | null;
	report_month?: number | null;
	report_year?: number | null;
	tags?: string[];
	description?: string | null;
	cover_url?: string | null;
	show_on_dashboard?: boolean;
}

export function ReportDetailsForm({
	reportId, initial, onClose, onSaved,
}: {
	reportId: string;
	initial: ReportDetailsValue;
	onClose: () => void;
	onSaved: () => void;
}) {
	const [title, setTitle] = useState(initial.title ?? '');
	const [shortTitle, setShortTitle] = useState(initial.short_title ?? '');
	const [slug, setSlug] = useState(initial.slug ?? '');
	const [month, setMonth] = useState(initial.report_month ?? '');
	const [year, setYear] = useState(initial.report_year ?? '');
	const [tags, setTags] = useState((initial.tags ?? []).join(', '));
	const [description, setDescription] = useState(initial.description ?? '');
	const [cover, setCover] = useState(initial.cover_url ?? '');
	const [onDash, setOnDash] = useState(!!initial.show_on_dashboard);
	const [saving, setSaving] = useState(false);

	const save = async () => {
		if (!title.trim()) { toast.error('Title is required.'); return; }
		setSaving(true);
		try {
			await api('PATCH', `/api/admin/reports/${reportId}`, {
				title: title.trim(),
				short_title: shortTitle.trim() || null,   // null clears it
				slug: slug.trim() || undefined,
				report_month: month === '' ? null : Number(month),
				report_year: year === '' ? null : Number(year),
				tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
				description: description.trim() || null,
				cover_url: cover || null,
				show_on_dashboard: onDash,
			});
			toast.success('Details saved');
			onSaved();
			onClose();
		} catch (e) {
			toast.error((e as Error).message);
		} finally {
			setSaving(false);
		}
	};

	return (
		<div style={{ display: 'grid', gap: 14 }}>
			<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
				<div style={{ fontWeight: 700, flex: 1 }}>Report details</div>
				<button className="btn ghost" onClick={onClose} aria-label="Close"><X size={14} /></button>
			</div>

			<Field label="Cover image" hint="Shown on the reports listing card.">
				<ImageInput value={cover} onChange={setCover} pathPrefix={`reports/${reportId}`} placeholder="https://… or upload" />
			</Field>

			<Field label="Title" required>
				<input className="search-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Full report title" />
			</Field>
			<Field label="Short title" hint="Compact label for cards and nav.">
				<input className="search-input" value={shortTitle} onChange={(e) => setShortTitle(e.target.value)} placeholder="e.g. GSTER26" />
			</Field>
			<Field label="Slug" hint="URL segment — /reports/<slug>.">
				<input className="search-input" value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="auto from title if blank" />
			</Field>

			<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
				<Field label="Month"><input className="search-input" type="number" min={1} max={12} value={month} onChange={(e) => setMonth(e.target.value)} placeholder="1–12" /></Field>
				<Field label="Year"><input className="search-input" type="number" min={2000} max={2100} value={year} onChange={(e) => setYear(e.target.value)} placeholder="YYYY" /></Field>
			</div>

			<Field label="Tags" hint="Comma-separated facets for the library.">
				<input className="search-input" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="funding, europe, benchmark" />
			</Field>
			<Field label="Description" hint="Short blurb on the listing card.">
				<textarea className="search-input" style={{ minHeight: 70, resize: 'vertical', padding: 8 }} value={description} onChange={(e) => setDescription(e.target.value)} />
			</Field>

			<label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
				<input type="checkbox" checked={onDash} onChange={(e) => setOnDash(e.target.checked)} />
				Feature on the dashboard
			</label>

			<div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
				<div style={{ flex: 1 }} />
				<button className="btn" disabled={saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save details'}</button>
			</div>
		</div>
	);
}

function Field({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: React.ReactNode }) {
	return (
		<div style={{ display: 'grid', gap: 4 }}>
			<div style={{ fontSize: 12, fontWeight: 600 }}>{label}{required && <span style={{ color: '#dc2626' }}> *</span>}</div>
			{children}
			{hint && <div style={{ fontSize: 10, color: 'var(--fg-muted)' }}>{hint}</div>}
		</div>
	);
}
