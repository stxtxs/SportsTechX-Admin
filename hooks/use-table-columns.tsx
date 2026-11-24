'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Columns3 } from 'lucide-react';

const clean = (s: string | null) => (s ?? '').replace(/[↕▲▼]/g, '').trim();

/**
 * Lets admins choose which table columns they see.
 *
 * Usage: `const cols = useTableColumns('users');` then put `ref={cols.ref}` on an
 * element wrapping the table and render `{cols.menu}` in the toolbar.
 *
 * Column names are read from the table's header row, so pages don't list them twice.
 * Hiding is pure CSS (nth-child), so cells need no changes. The first column and
 * unlabelled ones (action buttons) can't be hidden. The choice is a per-browser
 * display preference, like the sidebar's open groups.
 */
export function useTableColumns(id: string): { ref: (el: HTMLElement | null) => void; menu: ReactNode } {
	const storeKey = `admin.cols.${id}`;
	const [hidden, setHidden] = useState<string[]>([]);
	const [labels, setLabels] = useState<string[]>([]);
	const [box, setBox] = useState<HTMLElement | null>(null);
	const [open, setOpen] = useState(false);
	const loaded = useRef(false);
	const pop = useRef<HTMLDivElement>(null);

	useEffect(() => {
		try { setHidden(JSON.parse(localStorage.getItem(storeKey) ?? '[]')); } catch { /* private mode: show all */ }
		loaded.current = true;
	}, [storeKey]);
	useEffect(() => {
		if (!loaded.current) return;
		try { localStorage.setItem(storeKey, JSON.stringify(hidden)); } catch { /* ignore */ }
	}, [hidden, storeKey]);

	// Re-read the header whenever the table renders (it usually mounts after data loads).
	useEffect(() => {
		if (!box) return;
		const read = () => {
			// The first list table's header; a second table in the same box (e.g. pending + completed) shares its columns.
			const table = box.querySelector('table.data-table:not(td *)');
			const ths = table ? table.querySelectorAll(':scope > thead > tr:first-child > th') : [];
			const next = Array.from(ths).map((th) => clean(th.textContent));
			setLabels((prev) => (prev.join('\u0000') === next.join('\u0000') ? prev : next));
		};
		read();
		const mo = new MutationObserver(read);
		mo.observe(box, { childList: true, subtree: true });
		return () => mo.disconnect();
	}, [box]);

	useEffect(() => {
		if (!open) return;
		const onDown = (e: MouseEvent) => { if (!pop.current?.contains(e.target as Node)) setOpen(false); };
		const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
		document.addEventListener('mousedown', onDown);
		document.addEventListener('keydown', onKey);
		return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
	}, [open]);

	const ref = useCallback((el: HTMLElement | null) => { if (el) el.dataset.cols = id; setBox(el); }, [id]);

	// The first named column identifies the row (a leading checkbox column has no name): never hideable.
	const firstNamed = labels.findIndex((l) => !!l);
	const hideable = labels.map((label, i) => ({ label, i })).filter((c) => c.i > firstNamed && c.label);
	const hiddenIdx = hideable.filter((c) => hidden.includes(c.label)).map((c) => c.i + 1);
	// Only the list's own table (not tables nested inside an expanded detail row).
	const css = hiddenIdx.length
		? `${hiddenIdx.map((n) => `[data-cols="${id}"] table.data-table:not(td *) > * > tr > :nth-child(${n}):not([colspan])`).join(',\n')} { display: none; }`
		: '';
	const toggle = (label: string) => setHidden((h) => (h.includes(label) ? h.filter((x) => x !== label) : [...h, label]));

	const menu = (
		<>
			{css && <style>{css}</style>}
			{(hideable.length >= 3 || hiddenIdx.length > 0) && (
				<div className="cols-menu" ref={pop}>
					<button type="button" className="btn ghost" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
						<Columns3 size={14} /> Columns{hiddenIdx.length ? ` · ${hiddenIdx.length} hidden` : ''}
					</button>
					{open && (
						<div className="cols-pop" role="menu" aria-label="Choose columns">
							<div className="cols-pop-title">Show columns</div>
							{hideable.map((c) => (
								<label key={c.i} className="cols-pop-item">
									<input type="checkbox" checked={!hidden.includes(c.label)} onChange={() => toggle(c.label)} />
									<span>{c.label}</span>
								</label>
							))}
							<button type="button" className="btn ghost" style={{ width: '100%', justifyContent: 'center', marginTop: 6 }} disabled={!hiddenIdx.length} onClick={() => setHidden([])}>
								Show all
							</button>
						</div>
					)}
				</div>
			)}
		</>
	);
	return { ref, menu };
}
