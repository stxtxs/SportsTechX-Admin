'use client';

import React from 'react';
import { toast } from 'sonner';
import { Download, X } from 'lucide-react';

/**
 * Row selection for a list table: a checkbox column plus a bar of bulk actions.
 *
 *   const sel = useRowSelection(pageRows.map((r) => r.id), filtersKey);
 *   <thead><tr>{sel.headCell}...</tr></thead>
 *   <tr>{sel.cell(r.id)}...</tr>
 *   <SelectionBar sel={sel} exportName="companies">...action buttons...</SelectionBar>
 *
 * Selection covers the rows on screen: it clears when the page, filters or sort
 * change (resetKey), so a bulk action never touches rows the admin can't see.
 */
export function useRowSelection(pageIds: string[], resetKey = '') {
	const [st, setSt] = React.useState<{ key: string; ids: Set<string> }>({ key: resetKey, ids: new Set() });
	const onPage = new Set(pageIds);
	// Drop ids that left the page (deleted, filtered out) and everything on a reset.
	const ids = st.key === resetKey ? new Set([...st.ids].filter((id) => onPage.has(id))) : new Set<string>();
	const set = (next: Set<string>) => setSt({ key: resetKey, ids: next });
	const allOnPage = pageIds.length > 0 && pageIds.every((id) => ids.has(id));
	const toggle = (id: string) => { const n = new Set(ids); if (n.has(id)) n.delete(id); else n.add(id); set(n); };
	const headCell = (
		<th className="sel-col">
			<input type="checkbox" aria-label="Select all rows on this page" checked={allOnPage} disabled={!pageIds.length}
				ref={(el) => { if (el) el.indeterminate = ids.size > 0 && !allOnPage; }}
				onChange={() => set(allOnPage ? new Set() : new Set(pageIds))} />
		</th>
	);
	const cell = (id: string) => (
		<td className="sel-col" onClick={(e) => e.stopPropagation()}>
			<input type="checkbox" className="row-sel" aria-label="Select row" checked={ids.has(id)} onChange={() => toggle(id)} />
		</td>
	);
	return { ids: [...ids], size: ids.size, clear: () => set(new Set()), headCell, cell };
}
export type RowSelection = ReturnType<typeof useRowSelection>;

/** Download the selected rows as CSV, exactly as the table shows them (visible columns only). */
function exportSelected(bar: HTMLElement | null, name: string) {
	const table = bar?.parentElement?.querySelector<HTMLTableElement>('table.data-table:not(td *)');
	if (!table) return;
	const visible = (el: Element) => getComputedStyle(el).display !== 'none' && !el.classList.contains('sel-col');
	const heads = [...table.querySelectorAll(':scope > thead > tr:first-child > th')];
	const cols = heads.map((th, i) => ({ i, label: (th.textContent ?? '').replace(/[↕▲▼]/g, '').trim() })).filter((c) => c.label && visible(heads[c.i]!));
	const rows = [...table.querySelectorAll<HTMLTableRowElement>(':scope > tbody > tr')].filter((tr) => tr.querySelector('input.row-sel:checked'));
	// A leading = + @ (or - not starting a number) would run as a formula in Excel: neutralise it.
	const esc = (v: string) => { const t = v.replace(/\s+/g, ' ').trim(); return `"${(/^[=+@]|^-(?![\d.])/.test(t) ? `'${t}` : t).replace(/"/g, '""')}"`; };
	const csv = [cols.map((c) => esc(c.label)).join(','), ...rows.map((tr) => cols.map((c) => esc((tr.cells[c.i] as HTMLElement | undefined)?.innerText ?? '')).join(','))].join('\n');
	const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
	const a = document.createElement('a'); a.href = url; a.download = `${name}-selected-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(url);
	toast.success(`Exported ${rows.length} row${rows.length === 1 ? '' : 's'}`);
}

/**
 * The bulk-action bar. Shown only while rows are selected. Must sit in the same
 * container as the table (it finds the table next to it for "Export selected").
 */
export function SelectionBar({ sel, exportName, children }: { sel: RowSelection; exportName: string; children?: React.ReactNode }) {
	const ref = React.useRef<HTMLDivElement>(null);
	return (
		<div ref={ref} className="selection-bar" hidden={!sel.size} role="toolbar" aria-label="Bulk actions">
			<strong>{sel.size} selected</strong>
			{children}
			<button type="button" className="btn ghost" onClick={() => exportSelected(ref.current, exportName)}><Download size={12} /> Export selected</button>
			<div style={{ flex: 1 }} />
			<button type="button" className="btn ghost" onClick={sel.clear}><X size={12} /> Clear selection</button>
		</div>
	);
}

/**
 * Run one request per selected row, a few at a time, then report what happened.
 * Uses the same per-row endpoints as the row buttons, so every server-side check
 * and audit-log entry still applies.
 */
export async function runBulk(ids: string[], fn: (id: string) => Promise<unknown>, verb: string): Promise<number> {
	let ok = 0; const errors: string[] = [];
	for (let i = 0; i < ids.length; i += 4) {
		const res = await Promise.allSettled(ids.slice(i, i + 4).map(fn));
		for (const r of res) { if (r.status === 'fulfilled') ok++; else errors.push((r.reason as Error)?.message ?? 'failed'); }
	}
	if (errors.length) toast.error(`${verb}: ${ok} done, ${errors.length} failed — ${errors[0]}`);
	else toast.success(`${verb}: ${ok} done`);
	return ok;
}
