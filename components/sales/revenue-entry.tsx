'use client';

import { useMemo, useRef, useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { toast } from 'sonner';
import { Plus, Trash2, Download, Upload, Search, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useConfirm } from '@/components/confirm';
import { Modal } from '@/components/modal';
import { Field } from '@/components/tabbed-form';
import { AsyncState, StatCard, Pager, SortableTh } from '@/components/atoms';
import { FilterBar, FilterSelect, StatStrip } from '@/components/filters';
import { Select } from '@/components/select';
import { tidy } from '@/lib/labels';

// Sales Entry — CRUD over sales_revenue (ported from revenue-entry-tab). Add
// form (with graceful Attio company search) + bulk CSV import + a
// filter/sort/paginate table with CSV export.
interface Entry {
	id: string; invoice_date: string | null; product_id: string | null; product_name: string | null;
	audience_segment: string | null; amount_net_eur: number | null; source: string | null;
	company_name: string | null; client_name: string | null; client_email: string | null;
	client_website: string | null; client_city: string | null; client_country: string | null;
}
interface Options { products: Array<{ id: string; name: string; slug: string }>; audience_segments: string[] }

const fmtEur = (n: number) => '€' + Math.round(n || 0).toLocaleString('de-DE');
const fmtDate = (s: string | null) => s ? s.slice(0, 10) : '—';
const PER = [25, 50, 100];
const CSV_HEADER = ['product', 'invoice_date', 'net_amount_eur', 'audience_segment', 'company_name', 'client_name', 'client_email', 'client_website', 'client_city', 'client_country'];

type Form = {
	product_id: string; invoice_date: string; audience_segment: string; amount_net_eur: string;
	company_name: string; client_name: string; client_email: string; client_website: string; client_city: string; client_country: string;
};
const EMPTY: Form = { product_id: '', invoice_date: '', audience_segment: '', amount_net_eur: '', company_name: '', client_name: '', client_email: '', client_website: '', client_city: '', client_country: '' };

export function RevenueEntry() {
	const { mutate: gmutate } = useSWRConfig();
	const ask = useConfirm();
	const { data, error, isLoading } = useSWR<{ data: Entry[] }>(['/api/admin/revenue-entry'], { dedupingInterval: 15_000 });
	const opts = useSWR<Options>(['/api/admin/revenue-entry/options'], { dedupingInterval: 5 * 60_000 });

	const [search, setSearch] = useState('');
	const debSearch = useDebouncedValue(search);
	const [product, setProduct] = useState('');
	const [segment, setSegment] = useState('');
	const [from, setFrom] = useState('');
	const [to, setTo] = useState('');
	const [sort, setSort] = useState('-invoice_date');
	const [page, setPage] = useState(1);
	const [per, setPer] = useState(25);
	const [editing, setEditing] = useState<Entry | null>(null);
	const [creating, setCreating] = useState(false);
	const [importing, setImporting] = useState(false);

	const refresh = () => gmutate((k) => Array.isArray(k) && String(k[0]).startsWith('/api/admin/revenue-entry'));

	const rows = data?.data ?? [];
	const filtered = useMemo(() => {
		let r = rows;
		if (debSearch) { const q = debSearch.toLowerCase(); r = r.filter((x) => `${x.company_name ?? ''} ${x.client_name ?? ''} ${x.client_email ?? ''}`.toLowerCase().includes(q)); }
		if (product) r = r.filter((x) => x.product_id === product);
		if (segment) r = r.filter((x) => (x.audience_segment ?? '') === segment);
		if (from) r = r.filter((x) => (x.invoice_date ?? '') >= from);
		if (to) r = r.filter((x) => (x.invoice_date ?? '') <= to);
		const desc = sort.startsWith('-'); const col = (desc ? sort.slice(1) : sort) as keyof Entry;
		r = [...r].sort((a, b) => {
			const av = a[col] ?? '', bv = b[col] ?? '';
			const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv));
			return desc ? -cmp : cmp;
		});
		return r;
	}, [rows, debSearch, product, segment, from, to, sort]);

	const total = filtered.reduce((s, r) => s + Number(r.amount_net_eur ?? 0), 0);
	const totalPages = Math.max(1, Math.ceil(filtered.length / per));
	const pageRows = filtered.slice((page - 1) * per, page * per);
	const anyFilter = !!(search || product || segment || from || to);

	const remove = async (id: string) => {
		if (!(await ask({ message: 'Delete this revenue entry?', danger: true, confirmLabel: 'Delete' }))) return;
		try { await api('DELETE', `/api/admin/revenue-entry/${id}`); toast.success('Deleted'); refresh(); }
		catch (e) { toast.error((e as Error).message); }
	};

	const exportCsv = () => {
		const lines = [CSV_HEADER.join(',')];
		for (const r of filtered) {
			const prod = opts.data?.products.find((p) => p.id === r.product_id)?.name ?? '';
			lines.push([prod, r.invoice_date ?? '', r.amount_net_eur ?? '', r.audience_segment ?? '', r.company_name ?? '', r.client_name ?? '', r.client_email ?? '', r.client_website ?? '', r.client_city ?? '', r.client_country ?? '']
				.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','));
		}
		const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
		const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'revenue-entries.csv'; a.click();
	};

	return (
		<div>
			<StatStrip cols={3}>
				<StatCard label="Entries" loading={isLoading} value={rows.length.toLocaleString()} />
				<StatCard label="Revenue (filtered)" value={fmtEur(total)} />
				<StatCard label="Showing" value={`${filtered.length.toLocaleString()}`} />
			</StatStrip>

			<FilterBar>
				<input className="search-input" style={{ flex: '0 0 220px', height: 32 }} placeholder="Search company / client / email…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
				<FilterSelect ariaLabel="Product" value={product} onChange={(v) => { setProduct(v); setPage(1); }} allLabel="All products" options={(opts.data?.products ?? []).map((p) => ({ value: p.id, label: p.name }))} />
				<FilterSelect ariaLabel="Segment" value={segment} onChange={(v) => { setSegment(v); setPage(1); }} allLabel="All segments" options={(opts.data?.audience_segments ?? []).map((s) => ({ value: s, label: tidy(s) }))} />
				<input className="search-input" type="date" style={{ height: 32 }} value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} aria-label="From" />
				<input className="search-input" type="date" style={{ height: 32 }} value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} aria-label="To" />
				{anyFilter && <button className="btn ghost" onClick={() => { setSearch(''); setProduct(''); setSegment(''); setFrom(''); setTo(''); setPage(1); }}><X size={12} /> Clear</button>}
				<div style={{ flex: 1 }} />
				<button className="btn ghost" onClick={exportCsv}><Download size={12} /> Export</button>
				<button className="btn ghost" onClick={() => setImporting(true)}><Upload size={12} /> Import</button>
				<button className="btn" onClick={() => setCreating(true)}><Plus size={12} /> Add entry</button>
			</FilterBar>

			{(creating || editing) && <EntryModal entry={editing} options={opts.data} onClose={() => { setCreating(false); setEditing(null); }} onSaved={() => { setCreating(false); setEditing(null); refresh(); }} />}
			{importing && <ImportModal options={opts.data} onClose={() => setImporting(false)} onDone={() => { setImporting(false); refresh(); }} />}

			<div className="card">
				<AsyncState loading={isLoading} error={error} empty={filtered.length === 0} emptyMsg={anyFilter ? 'No entries match.' : 'No revenue entries yet.'} onRetry={refresh}>
					<div className="table-scroll">
						<table className="data-table">
							<thead>
								<tr>
									<SortableTh label="Date" field="invoice_date" sort={sort} onSort={setSort} />
									<SortableTh label="Product" field="product_name" sort={sort} onSort={setSort} />
									<SortableTh label="Audience" field="audience_segment" sort={sort} onSort={setSort} />
									<SortableTh label="Company" field="company_name" sort={sort} onSort={setSort} />
									<SortableTh label="Client" field="client_name" sort={sort} onSort={setSort} />
									<SortableTh label="Amount" field="amount_net_eur" sort={sort} onSort={setSort} align="right" />
									<th />
								</tr>
							</thead>
							<tbody>
								{pageRows.map((r) => (
									<tr key={r.id}>
										<td>{fmtDate(r.invoice_date)}</td>
										<td>{r.product_name ?? '—'}</td>
										<td>{tidy(r.audience_segment)}</td>
										<td>{r.client_website
											? <a href={r.client_website.startsWith('http') ? r.client_website : `https://${r.client_website}`} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>{r.company_name ?? '—'}</a>
											: (r.company_name ?? '—')}</td>
										<td>{r.client_name ?? '—'}</td>
										<td className="num" style={{ textAlign: 'right' }}>{r.amount_net_eur != null ? fmtEur(r.amount_net_eur) : '—'}</td>
										<td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
											<button className="btn ghost" onClick={() => setEditing(r)}>Edit</button>
											<button className="btn ghost" style={{ color: 'var(--accent)', marginLeft: 6 }} onClick={() => void remove(r.id)}><Trash2 size={12} /></button>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</AsyncState>
			</div>
			<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, gap: 12, flexWrap: 'wrap' }}>
				<span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>Total (filtered): <strong style={{ color: 'var(--fg)' }}>{fmtEur(total)}</strong> · {filtered.length} entries</span>
				<div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
					<Select value={String(per)} onChange={(v) => { setPer(Number(v)); setPage(1); }} width={90} ariaLabel="Per page" options={PER.map((n) => ({ value: String(n), label: `${n} / page` }))} />
					<Pager page={page} totalPages={totalPages} onPage={setPage} />
				</div>
			</div>
		</div>
	);
}

function EntryModal({ entry, options, onClose, onSaved }: { entry: Entry | null; options?: Options; onClose: () => void; onSaved: () => void }) {
	const [f, setF] = useState<Form>(entry ? {
		product_id: entry.product_id ?? '', invoice_date: entry.invoice_date?.slice(0, 10) ?? '', audience_segment: entry.audience_segment ?? '',
		amount_net_eur: entry.amount_net_eur != null ? String(entry.amount_net_eur) : '', company_name: entry.company_name ?? '', client_name: entry.client_name ?? '',
		client_email: entry.client_email ?? '', client_website: entry.client_website ?? '', client_city: entry.client_city ?? '', client_country: entry.client_country ?? '',
	} : { ...EMPTY });
	const [saving, setSaving] = useState(false);
	const set = <K extends keyof Form>(k: K, v: string) => setF((s) => ({ ...s, [k]: v }));

	const save = async () => {
		if (!f.product_id) { toast.error('Pick a product'); return; }
		setSaving(true);
		try {
			const body = { ...f, amount_net_eur: f.amount_net_eur === '' ? null : Number(f.amount_net_eur), product_id: f.product_id || null };
			if (entry) await api('PATCH', `/api/admin/revenue-entry/${entry.id}`, body);
			else await api('POST', '/api/admin/revenue-entry', body);
			toast.success(entry ? 'Updated' : 'Entry added');
			onSaved();
		} catch (e) { toast.error((e as Error).message); } finally { setSaving(false); }
	};

	const text = (k: keyof Form, ph = '') => <input className="search-input" style={{ height: 34, width: '100%' }} placeholder={ph} value={f[k]} onChange={(e) => set(k, e.target.value)} />;

	return (
		<Modal title={entry ? 'Edit revenue entry' : 'Add revenue entry'} width={640} onClose={onClose}
			footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn" disabled={saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save'}</button></>}>
			<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
				<Field label="Product">
					<Select value={f.product_id} onChange={(v) => set('product_id', v)} width="100%" style={{ display: 'block', width: '100%' }} placeholder="Select product…"
						options={(options?.products ?? []).map((p) => ({ value: p.id, label: p.name }))} />
				</Field>
				<Field label="Invoice date"><input className="search-input" type="date" style={{ height: 34, width: '100%' }} value={f.invoice_date} onChange={(e) => set('invoice_date', e.target.value)} /></Field>
				<Field label="Audience segment">
					<input className="search-input" list="rev-segs" style={{ height: 34, width: '100%' }} value={f.audience_segment} onChange={(e) => set('audience_segment', e.target.value)} placeholder="startups / investors / others" />
					<datalist id="rev-segs">{[...new Set(['startups', 'investors', 'others', ...(options?.audience_segments ?? [])])].map((s) => <option key={s} value={s} />)}</datalist>
				</Field>
				<Field label="Net amount (€)"><input className="search-input" type="number" style={{ height: 34, width: '100%' }} value={f.amount_net_eur} onChange={(e) => set('amount_net_eur', e.target.value)} /></Field>
				<Field label="Company name"><CompanyField value={f.company_name} onChange={(v) => set('company_name', v)} onPick={(c) => setF((s) => ({ ...s, company_name: c.name ?? s.company_name, client_website: c.domain ?? s.client_website, client_city: c.city ?? s.client_city }))} /></Field>
				<Field label="Client name">{text('client_name')}</Field>
				<Field label="Client email">{text('client_email')}</Field>
				<Field label="Website">{text('client_website', 'example.com')}</Field>
				<Field label="City">{text('client_city')}</Field>
				<Field label="Country">{text('client_country')}</Field>
			</div>
		</Modal>
	);
}

// Company name input with a graceful Attio search (degrades when not configured).
function CompanyField({ value, onChange, onPick }: { value: string; onChange: (v: string) => void; onPick: (c: { name: string | null; domain: string | null; city: string | null }) => void }) {
	const [results, setResults] = useState<Array<{ id: string | null; name: string | null; domain: string | null; city: string | null }> | null>(null);
	const [searching, setSearching] = useState(false);
	const search = async () => {
		if (!value.trim()) return;
		setSearching(true);
		try {
			const r = await api<{ companies: Array<{ id: string | null; name: string | null; domain: string | null; city: string | null }>; unavailable?: boolean }>('POST', '/api/admin/revenue-entry/attio-search', { name: value.trim() });
			if (r.unavailable) { toast.message('Attio search isn’t configured'); setResults([]); }
			else setResults(r.companies);
		} catch (e) { toast.error((e as Error).message); } finally { setSearching(false); }
	};
	return (
		<div style={{ position: 'relative' }}>
			<div style={{ display: 'flex', gap: 6 }}>
				<input className="search-input" style={{ height: 34, flex: 1 }} value={value} onChange={(e) => { onChange(e.target.value); setResults(null); }} />
				<button type="button" className="btn ghost" style={{ height: 34 }} disabled={searching} onClick={() => void search()} title="Search on Attio"><Search size={13} /></button>
			</div>
			{results && results.length > 0 && (
				<div className="card" style={{ position: 'absolute', top: 38, left: 0, right: 0, zIndex: 20, maxHeight: 200, overflow: 'auto', padding: 4 }}>
					{results.map((c, i) => (
						<button key={c.id ?? i} type="button" className="btn ghost" style={{ width: '100%', justifyContent: 'flex-start', height: 30 }} onClick={() => { onPick(c); setResults(null); }}>
							{c.name ?? 'Unnamed'}{c.domain ? ` · ${c.domain}` : ''}
						</button>
					))}
				</div>
			)}
		</div>
	);
}

// Bulk CSV import — parse client-side, insert sequentially via the create endpoint.
function ImportModal({ options, onClose, onDone }: { options?: Options; onClose: () => void; onDone: () => void }) {
	const fileRef = useRef<HTMLInputElement>(null);
	const [rows, setRows] = useState<Array<Record<string, string>>>([]);
	const [errors, setErrors] = useState<string[]>([]);
	const [busy, setBusy] = useState(false);

	const parse = async (file: File) => {
		const text = await file.text();
		const lines = text.split(/\r?\n/).filter((l) => l.trim());
		if (!lines.length) return;
		const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
		const out: Array<Record<string, string>> = [];
		const errs: string[] = [];
		for (let i = 1; i < lines.length; i++) {
			const cells = splitCsv(lines[i]);
			const row: Record<string, string> = {};
			header.forEach((h, j) => { row[h] = (cells[j] ?? '').trim(); });
			const prod = options?.products.find((p) => p.name.toLowerCase() === (row.product ?? '').toLowerCase());
			if (!prod) { errs.push(`Row ${i}: unknown product "${row.product}"`); continue; }
			row.__product_id = prod.id;
			out.push(row);
		}
		setRows(out); setErrors(errs);
	};

	const commit = async () => {
		setBusy(true);
		let ok = 0;
		try {
			for (const r of rows) {
				await api('POST', '/api/admin/revenue-entry', {
					product_id: r.__product_id, invoice_date: r.invoice_date || null, audience_segment: r.audience_segment || null,
					amount_net_eur: r.net_amount_eur ? Number(r.net_amount_eur) : null, company_name: r.company_name || null,
					client_name: r.client_name || null, client_email: r.client_email || null, client_website: r.client_website || null,
					client_city: r.client_city || null, client_country: r.client_country || null,
				});
				ok++;
			}
			toast.success(`Imported ${ok} entries`);
			onDone();
		} catch (e) { toast.error(`Imported ${ok}, then failed: ${(e as Error).message}`); } finally { setBusy(false); }
	};

	return (
		<Modal title="Bulk import revenue (CSV)" width={620} onClose={onClose}
			footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn" disabled={busy || rows.length === 0} onClick={() => void commit()}>{busy ? 'Importing…' : `Import ${rows.length}`}</button></>}>
			<div style={{ display: 'grid', gap: 12 }}>
				<div style={{ fontSize: 12, color: 'var(--fg-muted)' }}>Header: <code>{CSV_HEADER.join(', ')}</code>. Product is matched by name.</div>
				<input ref={fileRef} type="file" accept=".csv" onChange={(e) => { const f = e.target.files?.[0]; if (f) void parse(f); }} />
				{rows.length > 0 && <div style={{ fontSize: 13 }}>{rows.length} valid rows ready.</div>}
				{errors.length > 0 && <div style={{ fontSize: 12, color: 'var(--neg)', maxHeight: 120, overflow: 'auto' }}>{errors.map((e, i) => <div key={i}>{e}</div>)}</div>}
			</div>
		</Modal>
	);
}

function splitCsv(line: string): string[] {
	const out: string[] = []; let cur = ''; let q = false;
	for (let i = 0; i < line.length; i++) {
		const ch = line[i];
		if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
		else { if (ch === '"') q = true; else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch; }
	}
	out.push(cur); return out;
}
