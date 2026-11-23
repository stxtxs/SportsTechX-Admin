'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Upload, AlertTriangle, FileDown, FileCheck2 } from 'lucide-react';
import { api } from '@/lib/api';
import { Modal } from '@/components/modal';

/**
 * Reusable CSV importer for catalog entities. Parses the file client-side and
 * POSTs a JSON row array to /api/admin/import/<entity>. Headers are normalized
 * to snake_case and mapped through per-entity aliases, so human CSVs (e.g.
 * "Company Name", "Round Amount") line up with the backend's expected keys.
 */

type Entity = 'companies' | 'deals' | 'acquisitions' | 'ecosystem';

type RowIssue = { index: number; name: string; message: string };
interface ImportResult { created: number; failed: number; errors: RowIssue[]; warnings?: RowIssue[] }

// Rows go up in batches: the API body limit is 1 MB and each row is its own transaction.
const CHUNK = 500;
/** POST `rows` in CHUNK-sized batches; `index` in the replies is mapped back to the row's file position. */
async function postChunked<T>(url: string, rows: Record<string, string>[], positions: number[], merge: (acc: T | null, res: T, toFile: (i: number) => number) => T): Promise<T | null> {
	let acc: T | null = null;
	for (let off = 0; off < rows.length; off += CHUNK) {
		const res = await api<T>('POST', url, { rows: rows.slice(off, off + CHUNK) });
		acc = merge(acc, res, (i) => positions[off + i] ?? off + i);
	}
	return acc;
}
const mergeImport = (acc: ImportResult | null, r: ImportResult, toFile: (i: number) => number): ImportResult => {
	const fix = (xs?: RowIssue[]) => (xs ?? []).map((x) => ({ ...x, index: toFile(x.index) }));
	return {
		created: (acc?.created ?? 0) + r.created, failed: (acc?.failed ?? 0) + r.failed,
		errors: [...(acc?.errors ?? []), ...fix(r.errors)], warnings: [...(acc?.warnings ?? []), ...fix(r.warnings)],
	};
};
/** Catalog-duplicate row positions (file order) for the whole file. */
async function catalogDupes(entity: Entity, rows: Record<string, string>[]): Promise<number[]> {
	const r = await postChunked<{ existing: number[] }>(`/api/admin/import/${entity}/check-duplicates`, rows, rows.map((_, i) => i),
		(acc, res, toFile) => ({ existing: [...(acc?.existing ?? []), ...res.existing.map(toFile)] }));
	return r?.existing ?? [];
}

// Canonical columns per entity + the help text shown to the admin.
const COLUMNS: Record<Entity, { keys: string[]; help: string }> = {
	companies: { keys: ['name', 'website', 'description', 'sector', 'business_model', 'founded_year', 'country', 'city', 'region', 'continent', 'status'], help: 'name (required), website (required, unique), description, sector, business_model, founded_year, country, city, region, continent, status' },
	deals: { keys: ['company', 'round_type', 'announced_date', 'amount', 'currency_code', 'status', 'investors'], help: 'company (required — name or website), round_type, announced_date, amount (in currency_code, USD if blank — converted to USD like the deal form), currency_code, status, investors (separate with ; — end a name with * for the lead)' },
	acquisitions: { keys: ['acquiree', 'acquirer', 'acquisition_date', 'amount_usd', 'acquisition_type'], help: 'acquiree (required), acquirer, acquisition_date, amount_usd, acquisition_type' },
	ecosystem: { keys: ['name', 'entity_type', 'description', 'website', 'category', 'founded_year', 'country', 'city', 'region', 'continent', 'status'], help: 'name (required), entity_type, description, website, category, founded_year, country, city, region, continent, status' },
};

// Header aliases → canonical key (applied after snake_case normalization).
const ALIASES: Record<string, string> = {
	business_model: 'business_model', biz_model: 'business_model', model: 'business_model',
	founded: 'founded_year', founded_year: 'founded_year', year: 'founded_year', year_founded: 'founded_year',
	company_name: 'company', startup: 'company', company: 'company',
	round: 'round_type', round_type: 'round_type', funding_round: 'round_type', round_name: 'round_type',
	date: 'announced_date', vc_date: 'announced_date', announced_date: 'announced_date', deal_date: 'announced_date',
	// `amount` is in currency_code; an explicit *_usd column is taken as USD as-is.
	amount: 'amount', round_amount: 'amount', amount_usd: 'amount_usd', round_amount_usd: 'amount_usd',
	investor: 'investors', investors: 'investors', investor_names: 'investors',
	currency: 'currency_code', currency_code: 'currency_code',
	target: 'acquiree', acquiree: 'acquiree', acquiree_name: 'acquiree',
	buyer: 'acquirer', acquirer: 'acquirer', acquirer_name: 'acquirer',
	type: 'entity_type', entity_type: 'entity_type', acquisition_type: 'acquisition_type',
};

/** Minimal RFC-4180 CSV parser (handles quotes, escaped quotes, CRLF). */
function parseCsv(text: string): Record<string, string>[] {
	const rows: string[][] = [];
	let field = ''; let row: string[] = []; let inQuotes = false;
	const s = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
	for (let i = 0; i < s.length; i++) {
		const c = s[i];
		if (inQuotes) {
			if (c === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
			else field += c;
		} else if (c === '"') inQuotes = true;
		else if (c === ',') { row.push(field); field = ''; }
		else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
		else field += c;
	}
	if (field !== '' || row.length) { row.push(field); rows.push(row); }
	if (rows.length < 2) return [];
	const norm = (h: string) => { const k = h.trim().toLowerCase().replace(/[\s-]+/g, '_'); return ALIASES[k] ?? k; };
	const headers = rows[0]!.map(norm);
	return rows.slice(1)
		.filter((r) => r.some((v) => v.trim() !== ''))
		.map((r) => Object.fromEntries(headers.map((h, idx) => [h, (r[idx] ?? '').trim()])));
}

// ── Downloadable templates (header + a couple of sample rows) ────────────────
const SAMPLES: Record<Entity, string[][]> = {
	companies: [
		['Pitchside Analytics', 'https://pitchside.io', 'Real-time match analytics for football clubs', 'Performance Analytics', 'b2b', '2017', 'United Kingdom', 'London', 'Europe', 'Europe', 'active'],
		['StrideWear', 'https://stridewear.com', 'Smart running apparel with embedded sensors', 'Wearables', 'd2c', '2019', 'United States', 'Portland', 'North America', 'Americas', 'active'],
	],
	deals: [
		['https://pitchside.io', 'Series A', '2023-03-14', '8000000', 'USD', 'active', 'Atlas Ventures*; Kickoff Capital'],
		['https://courtvision.ai', 'Seed', '2022-11-02', '2300000', 'EUR', 'active', 'Baseline Angels'],
	],
	acquisitions: [
		['StrideWear', 'Nike', '2023-07-01', '120000000', 'acquisition'],
		['TurfIQ', 'John Deere', '2022-04-15', '45000000', 'acquisition'],
	],
	ecosystem: [
		['SportsTech Hub Berlin', 'organization', 'Accelerator and coworking for sportstech startups', 'https://sportstechhub.berlin', 'Accelerator', '2017', 'Germany', 'Berlin', 'Europe', 'Europe', 'active'],
		['Global SportsTech Summit', 'event', 'Annual conference for sportstech founders and investors', 'https://gstsummit.com', 'Conference', '2015', 'United States', 'New York', 'North America', 'Americas', 'active'],
	],
};

function csvCell(v: string): string { return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; }
export function downloadCsv(filename: string, header: string[], rows: string[][]): void {
	const body = [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
	const url = URL.createObjectURL(new Blob([body], { type: 'text/csv;charset=utf-8' }));
	const a = document.createElement('a');
	a.href = url; a.download = filename; a.click();
	URL.revokeObjectURL(url);
}

// ── Duplicate detection (client-side in-file key + server-side DB check) ──────
// Same identity as the server's websiteKey(): case, scheme, leading www. and trailing slashes ignored.
const normWebsite = (v?: string): string => (v ?? '').trim().toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '');
const slugifyName = (v?: string): string => (v ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
function rowKey(entity: Entity, r: Record<string, string>): string {
	if (entity === 'companies') return normWebsite(r.website);
	if (entity === 'ecosystem') return slugifyName(r.name);
	if (entity === 'deals') return [r.company, r.announced_date, r.amount || r.amount_usd].map((x) => (x ?? '').trim().toLowerCase()).join('|');
	return [r.acquiree, r.acquirer, r.acquisition_date].map((x) => (x ?? '').trim().toLowerCase()).join('|'); // acquisitions
}

export function CsvImportButton({ entity, onDone }: { entity: Entity; onDone: () => void }) {
	const [open, setOpen] = useState(false);
	const [rows, setRows] = useState<Record<string, string>[]>([]);
	const [fileName, setFileName] = useState('');
	const [pending, setPending] = useState(false);
	const [result, setResult] = useState<ImportResult | null>(null);
	// Duplicate review state.
	const [dupInfo, setDupInfo] = useState<Map<number, string>>(new Map());
	const [reviewed, setReviewed] = useState(false);
	const [checking, setChecking] = useState(false);
	const [onlyDupes, setOnlyDupes] = useState(false);
	const [skipDupes, setSkipDupes] = useState(false);

	const cols = COLUMNS[entity].keys;
	const reset = () => { setRows([]); setFileName(''); setResult(null); setDupInfo(new Map()); setReviewed(false); setOnlyDupes(false); setSkipDupes(false); };
	const onFile = async (file: File) => {
		setResult(null); setDupInfo(new Map()); setReviewed(false); setOnlyDupes(false);
		try {
			const parsed = parseCsv(await file.text());
			if (parsed.length === 0) { toast.error('No data rows found in that CSV.'); return; }
			setFileName(file.name); setRows(parsed);
		} catch (e) { toast.error((e as Error).message); }
	};

	const review = async () => {
		setChecking(true);
		const info = new Map<number, string>();
		// In-file duplicates: flag the 2nd+ occurrence of a repeated key.
		const seen = new Map<string, number>();
		rows.forEach((r, i) => {
			const k = rowKey(entity, r);
			if (!k) return;
			if (seen.has(k)) info.set(i, 'Repeated in this file');
			else seen.set(k, i);
		});
		// DB duplicates (companies/ecosystem have a unique key); takes precedence.
		try {
			for (const idx of await catalogDupes(entity, rows)) info.set(idx, 'Already in catalog');
		} catch (e) { toast.error((e as Error).message); }
		setDupInfo(info);
		setReviewed(true);
		setChecking(false);
		toast[info.size ? 'warning' : 'success'](info.size ? `${info.size} duplicate row${info.size === 1 ? '' : 's'} found` : 'No duplicates found');
	};

	const submit = async () => {
		setPending(true);
		try {
			const positions = rows.map((_, i) => i).filter((i) => !(skipDupes && dupInfo.has(i)));
			const res = await postChunked<ImportResult>(`/api/admin/import/${entity}`, positions.map((i) => rows[i]!), positions, mergeImport);
			if (!res) return;
			setResult(res);
			toast[res.failed ? 'warning' : 'success'](`Imported ${res.created}${res.failed ? ` · ${res.failed} failed` : ''}`);
			if (res.created > 0) onDone();
			// The file is done: clear it so a second click can't import the same rows again.
			setRows([]); setDupInfo(new Map()); setReviewed(false);
		} catch (e) { toast.error((e as Error).message); }
		finally { setPending(false); }
	};

	const indexed = rows.map((r, i) => ({ r, i }));
	const shown = (onlyDupes ? indexed.filter((x) => dupInfo.has(x.i)) : indexed).slice(0, 500);
	const importCount = skipDupes && dupInfo.size ? rows.length - dupInfo.size : rows.length;

	return (
		<>
			<button className="btn ghost" onClick={() => { reset(); setOpen(true); }}><Upload size={12} /> Import CSV</button>
			{open && (
				<Modal title={`Import ${entity} from CSV`} width={rows.length ? 920 : 620} onClose={() => setOpen(false)} footer={
					<>
						<button className="btn ghost" onClick={() => setOpen(false)}>Close</button>
						{rows.length > 0 && (
							<button className="btn ghost" disabled={checking} onClick={() => void review()}>
								<AlertTriangle size={12} /> {checking ? 'Reviewing…' : 'Review duplicates'}
							</button>
						)}
						<button className="btn" disabled={importCount === 0 || pending} onClick={() => void submit()}>
							{pending ? 'Importing…' : `Import ${importCount} row${importCount === 1 ? '' : 's'}`}
						</button>
					</>
				}>
					<div style={{ display: 'grid', gap: 12 }}>
						<div style={{ fontSize: 12, color: 'var(--fg-muted)' }}>
							Columns (case-insensitive, common aliases accepted):<br />
							<span style={{ fontFamily: 'var(--font-mono)' }}>{COLUMNS[entity].help}</span>
						</div>
						<div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
							<input type="file" accept=".csv,text/csv" className="search-input" style={{ flex: 1 }} onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); }} />
							<button className="btn ghost" onClick={() => downloadCsv(`${entity}_template.csv`, cols, SAMPLES[entity])} title="Download a CSV template with sample rows"><FileDown size={12} /> Template</button>
						</div>

						{rows.length > 0 && (
							<>
								<div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', fontSize: 13 }}>
									<span><strong>{rows.length}</strong> rows parsed from {fileName}</span>
									{reviewed && (
										<span style={{ color: dupInfo.size ? 'var(--accent)' : 'var(--pos)', fontWeight: 600 }}>
											· {dupInfo.size} duplicate{dupInfo.size === 1 ? '' : 's'}
										</span>
									)}
									<div style={{ flex: 1 }} />
									{reviewed && dupInfo.size > 0 && (
										<>
											<label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
												<input type="checkbox" checked={onlyDupes} onChange={(e) => setOnlyDupes(e.target.checked)} /> Only duplicates
											</label>
											<label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
												<input type="checkbox" checked={skipDupes} onChange={(e) => setSkipDupes(e.target.checked)} /> Skip duplicates on import
											</label>
										</>
									)}
								</div>

								<div style={{ maxHeight: 360, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 6 }}>
									<table className="data-table" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
										<thead style={{ position: 'sticky', top: 0, zIndex: 1, background: 'var(--bg-1)' }}>
											<tr>
												<th style={{ position: 'sticky', left: 0, background: 'var(--bg-1)' }}>#</th>
												{reviewed && <th>Status</th>}
												{cols.map((k) => <th key={k}>{k}</th>)}
											</tr>
										</thead>
										<tbody>
											{shown.map(({ r, i }) => {
												const dup = dupInfo.get(i);
												return (
													<tr key={i} style={dup ? { background: 'color-mix(in srgb, var(--accent) 14%, transparent)' } : undefined}>
														<td className="num" style={{ position: 'sticky', left: 0, background: dup ? 'color-mix(in srgb, var(--accent) 14%, transparent)' : 'var(--bg-1)', color: 'var(--fg-muted)' }}>{i + 1}</td>
														{reviewed && <td style={{ color: dup ? 'var(--accent)' : 'var(--pos)', fontWeight: 600 }}>{dup ?? 'OK'}</td>}
														{cols.map((k) => <td key={k}>{r[k] ?? ''}</td>)}
													</tr>
												);
											})}
										</tbody>
									</table>
								</div>
								{shown.length < (onlyDupes ? dupInfo.size : rows.length) && (
									<div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>Showing first {shown.length} of {onlyDupes ? dupInfo.size : rows.length} rows.</div>
								)}
							</>
						)}

						{result && (
							<div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, fontSize: 12 }}>
								<div style={{ fontWeight: 600 }}>{result.created} created · {result.failed} failed</div>
								{result.errors.length > 0 && (
									<div style={{ marginTop: 6, maxHeight: 160, overflow: 'auto', color: 'var(--accent)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
										{result.errors.map((er) => <div key={er.index}>row {er.index + 1} ({er.name}): {er.message}</div>)}
									</div>
								)}
								{!!result.warnings?.length && (
									<div style={{ marginTop: 6, maxHeight: 160, overflow: 'auto', color: 'var(--warn)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
										<div style={{ fontWeight: 600 }}>Imported with warnings (check these rows):</div>
										{result.warnings.map((w, k) => <div key={k}>row {w.index + 1} ({w.name}): {w.message}</div>)}
									</div>
								)}
							</div>
						)}
					</div>
				</Modal>
			)}
		</>
	);
}

// ── Standalone action-row buttons (old-admin parity) ─────────────────────────
/** One-click download of the entity's CSV template with sample rows. */
export function CsvTemplateButton({ entity }: { entity: Entity }) {
	return (
		<button className="btn ghost" onClick={() => downloadCsv(`${entity}_template.csv`, COLUMNS[entity].keys, SAMPLES[entity])} title="Download a CSV template with sample rows">
			<FileDown size={12} /> Download Template
		</button>
	);
}

function CheckLine({ ok, warn, label }: { ok?: boolean; warn?: boolean; label: string }) {
	const color = warn ? 'var(--warn)' : ok ? 'var(--pos)' : 'var(--neg)';
	return (
		<div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
			<span style={{ fontWeight: 700, color }}>{warn ? '!' : ok ? '✓' : '✕'}</span>
			<span>{label}</span>
		</div>
	);
}

/** Validate a CSV (headers, required field, duplicates) without importing. */
export function CsvCheckButton({ entity }: { entity: Entity }) {
	const [open, setOpen] = useState(false);
	const [fileName, setFileName] = useState('');
	const [rows, setRows] = useState<Record<string, string>[]>([]);
	const [dupInfo, setDupInfo] = useState<Map<number, string>>(new Map());
	const [checked, setChecked] = useState(false);
	const [checking, setChecking] = useState(false);

	const cols = COLUMNS[entity].keys;
	const requiredKey = entity === 'deals' ? 'company' : entity === 'acquisitions' ? 'acquiree' : 'name';
	const reset = () => { setFileName(''); setRows([]); setDupInfo(new Map()); setChecked(false); };

	const onFile = async (file: File) => {
		setChecked(false); setDupInfo(new Map());
		try {
			const parsed = parseCsv(await file.text());
			setFileName(file.name); setRows(parsed);
			if (parsed.length === 0) toast.error('No data rows found in that CSV.');
		} catch (e) { toast.error((e as Error).message); }
	};

	const runCheck = async () => {
		setChecking(true);
		const info = new Map<number, string>();
		const seen = new Map<string, number>();
		rows.forEach((r, i) => {
			const k = rowKey(entity, r);
			if (!k) return;
			if (seen.has(k)) info.set(i, 'Repeated in file'); else seen.set(k, i);
		});
		try {
			for (const idx of await catalogDupes(entity, rows)) info.set(idx, 'Already in catalog');
		} catch (e) { toast.error((e as Error).message); }
		setDupInfo(info); setChecked(true); setChecking(false);
	};

	const presentKeys = rows.length ? Object.keys(rows[0]!) : [];
	const missingCols = cols.filter((k) => !presentKeys.includes(k));
	const unknownCols = presentKeys.filter((k) => !cols.includes(k));
	const missingRequired = rows.filter((r) => !(r[requiredKey] ?? '').trim()).length;

	return (
		<>
			<button className="btn ghost" onClick={() => { reset(); setOpen(true); }}><FileCheck2 size={12} /> CSV Check</button>
			{open && (
				<Modal title={`Check ${entity} CSV`} width={560} onClose={() => setOpen(false)} footer={
					<>
						<button className="btn ghost" onClick={() => setOpen(false)}>Close</button>
						<button className="btn" disabled={rows.length === 0 || checking} onClick={() => void runCheck()}>{checking ? 'Checking…' : 'Run check'}</button>
					</>
				}>
					<div style={{ display: 'grid', gap: 12 }}>
						<div style={{ fontSize: 12, color: 'var(--fg-muted)' }}>
							Validates headers, the required field and duplicates — without importing.<br />
							Expected columns: <span style={{ fontFamily: 'var(--font-mono)' }}>{cols.join(', ')}</span>
						</div>
						<input type="file" accept=".csv,text/csv" className="search-input" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); }} />
						{rows.length > 0 && <div style={{ fontSize: 13 }}><strong>{rows.length}</strong> rows parsed from {fileName}</div>}
						{checked && (
							<div style={{ display: 'grid', gap: 8, fontSize: 13, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
								<CheckLine ok={missingCols.length === 0} label={missingCols.length === 0 ? 'All expected columns present' : `Missing columns: ${missingCols.join(', ')}`} />
								{unknownCols.length > 0 && <CheckLine warn label={`Unrecognized columns (ignored): ${unknownCols.join(', ')}`} />}
								<CheckLine ok={missingRequired === 0} label={missingRequired === 0 ? `Required field "${requiredKey}" present on all rows` : `${missingRequired} row(s) missing required "${requiredKey}"`} />
								<CheckLine ok={dupInfo.size === 0} label={dupInfo.size === 0 ? 'No duplicates found' : `${dupInfo.size} duplicate row(s) — in-file or already in catalog`} />
							</div>
						)}
					</div>
				</Modal>
			)}
		</>
	);
}
