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

	return (
		<>
			<button type="button" className="cmd-trigger admin-search-trigger" onClick={() => setOpen(true)} aria-label="Search the admin (Ctrl+K)">
				<Search size={14} />
				<span>Search users, companies, deals, pages…</span>
				<span className="kbd">Ctrl K</span>
			</button>
			{open && (
				<div className="cmd-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
					<div className="cmd-modal" role="dialog" aria-modal="true" aria-label="Search the admin">
						<input
							ref={input}
							className="cmd-input"
							value={q}
							onChange={(e) => setQ(e.target.value)}
							onKeyDown={onKeyDown}
							placeholder="Search users, companies, investors, deals, reports, claims, pages…"
							aria-label="Search"
						/>
						<div className="cmd-list" ref={list} role="listbox">
							{rows.map((h, i) => (
								<div
									key={`${h.kind}:${h.id}`}
									data-row={i}
									role="option"
									aria-selected={i === sel}
									className={`cmd-row${i === sel ? ' sel' : ''}`}
									onMouseEnter={() => setSel(i)}
									onMouseDown={(e) => { e.preventDefault(); go(h); }}
								>
									<div style={{ minWidth: 0 }}>
										<div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.title}</div>
										{h.sub && <div style={{ fontSize: 11, opacity: 0.75, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.sub}</div>}
									</div>
									<span className="cmd-cat">{h.kind}</span>
								</div>
							))}
							{!rows.length && (
								<div style={{ padding: '14px', fontSize: 13, color: 'var(--fg-muted)' }}>
									{loading ? 'Searching…' : q.trim().length < 2 ? 'Type at least 2 characters.' : 'Nothing found.'}
								</div>
							)}
						</div>
						<div style={{ display: 'flex', gap: 14, padding: '8px 14px', borderTop: '1px solid var(--border)', fontSize: 11, color: 'var(--fg-muted)' }}>
							<span><span className="kbd" style={{ marginLeft: 0 }}>↑↓</span> move</span>
							<span><span className="kbd" style={{ marginLeft: 0 }}>Enter</span> open</span>
							<span><span className="kbd" style={{ marginLeft: 0 }}>Esc</span> close</span>
							<span style={{ marginLeft: 'auto' }}>{loading ? 'Searching…' : ''}</span>
						</div>
					</div>
				</div>
			)}
		</>
	);
}
