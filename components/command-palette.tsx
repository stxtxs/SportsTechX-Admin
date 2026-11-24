'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import { api } from '@/lib/api';
import { ALL_NAV_ITEMS } from '@/lib/admin-nav';
import { useDebouncedValue } from '@/hooks/use-debounced-value';

interface Hit { id: string; title: string; sub: string | null; href: string }
type Results = Record<string, Hit[]>;

/** Result groups in display order, with the label shown beside each row. */
const KINDS: Array<[string, string]> = [
	['pages', 'Page'], ['users', 'User'], ['companies', 'Company'], ['investors', 'Investor'],
	['ecosystem', 'Ecosystem'], ['deals', 'Deal'], ['reports', 'Report'], ['claims', 'Claim'],
];

/** Group headings in the results list. */
const GROUP_TITLE: Record<string, string> = { Page: 'Pages', User: 'Users', Company: 'Companies', Investor: 'Investors', Ecosystem: 'Ecosystem', Deal: 'Deals', Report: 'Reports', Claim: 'Open claims' };

/**
 * Global admin search: pages, users, companies, investors, ecosystem entries, deals, reports and
 * open claims. Opens with ⌘K / Ctrl+K, "/" (outside a text field) or the topbar box; arrow keys
 * move, Enter opens, Esc closes.
 */
export function CommandPalette() {
	const router = useRouter();
	const [open, setOpen] = useState(false);
	const [q, setQ] = useState('');
	const [sel, setSel] = useState(0);
	const [results, setResults] = useState<Results>({});
	const [loading, setLoading] = useState(false);
	const input = useRef<HTMLInputElement>(null);
	const list = useRef<HTMLDivElement>(null);
	const wrap = useRef<HTMLDivElement>(null);
	const term = useDebouncedValue(q.trim(), 200);

	// Shortcuts: ⌘K / Ctrl+K anywhere; "/" when not typing somewhere.
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName));
			if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) { e.preventDefault(); setOpen((o) => !o); }
			else if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); setOpen(true); }
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, []);
	useEffect(() => {
		if (!open) return;
		const onDown = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
		document.addEventListener('mousedown', onDown);
		return () => document.removeEventListener('mousedown', onDown);
	}, [open]);
	useEffect(() => {
		if (open) { setSel(0); setTimeout(() => input.current?.focus(), 0); }
		else { setQ(''); setResults({}); }
	}, [open]);

	// Server matches for 2+ characters; pages match in the browser.
	useEffect(() => {
		if (!open || term.length < 2) { setResults({}); return; }
		let live = true;
		setLoading(true);
		api<Results>('GET', `/api/admin/search?q=${encodeURIComponent(term)}`)
			.then((r) => { if (live) { setResults(r); setSel(0); } })
			.catch(() => { if (live) setResults({}); })
			.finally(() => { if (live) setLoading(false); });
		return () => { live = false; };
	}, [term, open]);

	const pages = useMemo<Hit[]>(() => {
		const t = q.trim().toLowerCase();
		const items = t ? ALL_NAV_ITEMS.filter((n) => `${n.label} ${n.keywords ?? ''}`.toLowerCase().includes(t)) : ALL_NAV_ITEMS.slice(0, 8);
		return items.slice(0, 6).map((n) => ({ id: n.href, title: n.label, sub: null, href: n.href }));
	}, [q]);

	const rows = useMemo(() => {
		const all: Results = { pages, ...results };
		return KINDS.flatMap(([k, label]) => (all[k] ?? []).map((h) => ({ ...h, kind: label })));
	}, [pages, results]);

	const go = useCallback((h: Hit | undefined) => {
		if (!h) return;
		setOpen(false);
		router.push(h.href);
	}, [router]);

	useEffect(() => {
		list.current?.querySelector<HTMLElement>(`[data-row="${sel}"]`)?.scrollIntoView({ block: 'nearest' });
	}, [sel]);

	const onKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(rows.length - 1, s + 1)); }
		else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
		else if (e.key === 'Enter') { e.preventDefault(); go(rows[sel]); }
		else if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
	};

	// Group the flat, keyboard-ordered rows under their type for display.
	const groups = KINDS.map(([, label]) => ({ label, items: rows.map((h, i) => ({ h, i })).filter((r) => r.h.kind === label) })).filter((g) => g.items.length);

	return (
		<div className="adm-search" ref={wrap}>
			{open ? (
				<div className="adm-search-box is-open">
					<Search size={15} aria-hidden />
					<input
						ref={input}
						autoFocus
						value={q}
						onChange={(e) => setQ(e.target.value)}
						onKeyDown={onKeyDown}
						placeholder="Search users, companies, investors, deals, reports, pages…"
						aria-label="Search the admin"
						role="combobox"
						aria-expanded
						aria-controls="adm-search-results"
					/>
					<kbd className="adm-kbd">Esc</kbd>
				</div>
			) : (
				<button type="button" className="adm-search-box admin-search-trigger" onClick={() => setOpen(true)} aria-label="Search the admin (Ctrl+K)">
					<Search size={15} aria-hidden />
					<span className="adm-search-ph">Search users, companies, deals, pages…</span>
					<kbd className="adm-kbd">Ctrl K</kbd>
				</button>
			)}
			{open && (
				<div className="adm-search-pop" id="adm-search-results" role="listbox" ref={list}>
					{groups.map((g) => (
						<div key={g.label} className="adm-search-group">
							<div className="adm-search-group-label">{GROUP_TITLE[g.label] ?? g.label}</div>
							{g.items.map(({ h, i }) => (
								<div
									key={`${h.kind}:${h.id}`}
									data-row={i}
									role="option"
									aria-selected={i === sel}
									className={`adm-search-row${i === sel ? ' sel' : ''}`}
									onMouseEnter={() => setSel(i)}
									onMouseDown={(e) => { e.preventDefault(); go(h); }}
								>
									<div className="adm-search-title">{h.title}</div>
									{h.sub && <div className="adm-search-sub">{h.sub}</div>}
								</div>
							))}
						</div>
					))}
					{!rows.length && (
						<div className="adm-search-empty">{loading ? 'Searching…' : q.trim().length < 2 ? 'Type at least 2 characters to search records.' : `Nothing matches “${q.trim()}”.`}</div>
					)}
					<div className="adm-search-foot">
						<span><kbd className="adm-kbd">↑</kbd><kbd className="adm-kbd">↓</kbd> move</span>
						<span><kbd className="adm-kbd">Enter</kbd> open</span>
						<span><kbd className="adm-kbd">Esc</kbd> close</span>
						{loading && <span style={{ marginLeft: 'auto' }}>Searching…</span>}
					</div>
				</div>
			)}
		</div>
	);
}
