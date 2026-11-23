'use client';

import { useRef, useState } from 'react';
import { Upload, FileDown } from 'lucide-react';
import { toast } from 'sonner';
import { downloadCsv } from './csv-import';
import { Modal } from './modal';

/**
 * Edit a queued candidate's name / website (both queues). Sends only what changed; a new
 * website re-runs enrichment server-side, which is how a candidate queued without one (most
 * deal-added investors) gets enriched.
 */
export function EditCandidateModal({ name, website, onClose, onSave }: {
	name: string; website: string | null; onClose: () => void;
	onSave: (body: { name?: string; website?: string | null }) => Promise<unknown>;
}) {
	const [n, setN] = useState(name);
	const [w, setW] = useState(website ?? '');
	const [pending, setPending] = useState(false);
	const submit = async () => {
		const body: { name?: string; website?: string | null } = {};
		if (n.trim() !== name) body.name = n.trim();
		if (w.trim() !== (website ?? '')) body.website = w.trim() || null;
		if (!Object.keys(body).length) { onClose(); return; }
		setPending(true);
		try { await onSave(body); } catch (e) { toast.error((e as Error).message); } finally { setPending(false); }
	};
	return (
		<Modal title={`Edit ${name}`} onClose={onClose} width={440} footer={
			<>
				<button className="btn ghost" onClick={onClose}>Cancel</button>
				<button className="btn" disabled={!n.trim() || pending} onClick={() => void submit()}>{pending ? 'Saving…' : 'Save'}</button>
			</>
		}>
			<div style={{ display: 'grid', gap: 12 }}>
				<div><div className="co-stat-label" style={{ marginBottom: 6 }}>Name</div><input className="search-input" value={n} onChange={(e) => setN(e.target.value)} /></div>
				<div>
					<div className="co-stat-label" style={{ marginBottom: 6 }}>Website</div>
					<input className="search-input" value={w} onChange={(e) => setW(e.target.value)} placeholder="acme.com" />
					<div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 4 }}>A new website runs enrichment again (Apollo first, Attio as fallback).</div>
				</div>
			</div>
		</Modal>
	);
}

/**
 * Shared input pane for the lightweight "candidate" importers (startups
 * pipeline, investor review). Accepts pasted lines or an uploaded CSV/TXT,
 * shows a live parsed table preview, and offers a template download. The
 * per-queue dedupe/import flow stays in each page; this only owns the input.
 *
 * Each line is "Name, https://website" (comma/tab splits the two) or a bare
 * URL/name.
 */

export interface Candidate { name: string; website?: string }

export function parseCandidates(text: string): Candidate[] {
	return text.split('\n').map((l) => l.trim()).filter(Boolean).map((line) => {
		const [a, b] = line.split(/[,\t]/).map((s) => s.trim());
		if (b) return { name: a, website: b };
		if (/^https?:\/\//i.test(a)) return { name: a.replace(/^https?:\/\//, '').replace(/\/.*$/, ''), website: a };
		return { name: a };
	});
}

// ─── Rich investor CSV import (header-aware) ─────────────────────────────────
// Supports a full-column CSV (Name, Website, Category, Country, City, Year,
// Description, socials, POC…) when the first line is a recognizable header;
// otherwise falls back to the simple "Name, website" parse.

export interface InvestorCandidate {
	name: string; website?: string; category?: string; country?: string; city?: string; year_launched?: number;
	description?: string; twitter_url?: string; instagram_url?: string; facebook_url?: string; linkedin_url?: string;
	poc_name?: string; poc_position?: string; poc_email?: string; poc_linkedin?: string;
}

/** Split one CSV line, honoring double-quoted fields (so a description may hold commas). */
function splitCsvLine(line: string): string[] {
	const out: string[] = []; let cur = ''; let q = false;
	for (let i = 0; i < line.length; i++) {
		const ch = line[i];
		if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
		else if (ch === '"') q = true;
		else if (ch === ',' || ch === '\t') { out.push(cur); cur = ''; }
		else cur += ch;
	}
	out.push(cur);
	return out.map((s) => s.trim());
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');
const INV_ALIASES: Record<string, keyof InvestorCandidate> = {
	name: 'name', investorname: 'name', website: 'website', url: 'website', site: 'website',
	category: 'category', type: 'category', country: 'country', city: 'city',
	year: 'year_launched', yearlaunched: 'year_launched', founded: 'year_launched', foundedyear: 'year_launched',
	description: 'description', about: 'description', bio: 'description',
	linkedin: 'linkedin_url', linkedinurl: 'linkedin_url', twitter: 'twitter_url', x: 'twitter_url',
	instagram: 'instagram_url', facebook: 'facebook_url',
	pocname: 'poc_name', contactname: 'poc_name',
	pocposition: 'poc_position', position: 'poc_position', title: 'poc_position', contacttitle: 'poc_position',
	pocemail: 'poc_email', contactemail: 'poc_email', email: 'poc_email',
	poclinkedin: 'poc_linkedin', contactlinkedin: 'poc_linkedin',
};

export function parseInvestorCandidates(text: string): InvestorCandidate[] {
	const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
	if (!lines.length) return [];
	const header = splitCsvLine(lines[0]!).map(norm);
	const hasHeader = header.includes('name') && header.some((h) => h !== 'name' && h in INV_ALIASES);
	if (!hasHeader) return parseCandidates(text).map((c) => ({ name: c.name, website: c.website }));
	const map = header.map((h) => INV_ALIASES[h]);
	return lines.slice(1).map((line) => {
		const cells = splitCsvLine(line);
		const row: InvestorCandidate = { name: '' };
		cells.forEach((val, i) => {
			const key = map[i];
			if (!key || !val) return;
			if (key === 'year_launched') { const n = Number(val); if (Number.isFinite(n)) row.year_launched = n; }
			else (row as unknown as Record<string, unknown>)[key] = val;
		});
		return row;
	}).filter((r) => r.name);
}

export function CandidateInput({
	text, onText, placeholder, sampleName, parse = parseCandidates, templateColumns, templateRows,
}: {
	text: string; onText: (t: string) => void; placeholder?: string; sampleName: string;
	/** Preview parser (defaults to the simple Name/Website parse). */
	parse?: (t: string) => Candidate[];
	/** Header + example rows for the downloadable template (defaults to Name/Website). */
	templateColumns?: string[];
	templateRows?: string[][];
}) {
	const fileRef = useRef<HTMLInputElement>(null);
	const onFile = (file: File) => { const r = new FileReader(); r.onload = () => onText(String(r.result ?? '')); r.readAsText(file); };
	const rows = parse(text);
	const template = () => downloadCsv('candidates-template.csv', templateColumns ?? ['Name', 'Website'], templateRows ?? [
		[sampleName, 'https://example.com'],
		[`${sampleName} Two`, 'https://example.io'],
	]);

	return (
		<div style={{ display: 'grid', gap: 8 }}>
			<div style={{ fontSize: 12, color: 'var(--fg-muted)' }}>One per line: <code>Name, https://website</code> or plain URLs. Upload a CSV/TXT or paste below.</div>
			<input ref={fileRef} type="file" accept=".csv,.txt" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
			<div style={{ display: 'flex', gap: 8 }}>
				<button type="button" className="btn ghost" onClick={() => fileRef.current?.click()}><Upload size={12} /> Upload CSV / TXT</button>
				<button type="button" className="btn ghost" onClick={template}><FileDown size={12} /> Download template</button>
			</div>
			<textarea
				className="search-input"
				style={{ minHeight: 150, resize: 'vertical', fontFamily: 'var(--font-mono)', fontSize: 12 }}
				value={text}
				onChange={(e) => onText(e.target.value)}
				placeholder={placeholder}
			/>
			{rows.length > 0 && (
				<div>
					<div style={{ fontSize: 12, color: 'var(--fg-muted)', marginBottom: 4 }}>{rows.length} parsed · preview</div>
					<div style={{ maxHeight: 220, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 6 }}>
						<table className="data-table" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
							<thead style={{ position: 'sticky', top: 0, background: 'var(--bg-1)' }}><tr><th style={{ width: 28 }}>#</th><th>Name</th><th>Website</th></tr></thead>
							<tbody>
								{rows.slice(0, 200).map((r, i) => (
									<tr key={i}>
										<td className="num" style={{ color: 'var(--fg-muted)' }}>{i + 1}</td>
										<td>{r.name || <span style={{ color: 'var(--accent)' }}>—</span>}</td>
										<td style={{ color: 'var(--fg-muted)' }}>{r.website ?? '—'}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
					{rows.length > 200 && <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 4 }}>Showing first 200 of {rows.length}.</div>}
				</div>
			)}
		</div>
	);
}
