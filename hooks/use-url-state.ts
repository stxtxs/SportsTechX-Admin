'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

/**
 * List-page state (filters, search, sort, page) kept in the URL query string, so a reload,
 * a shared link or coming back to the page keeps the view. Drop-in for useState:
 *
 *   const [status, setStatus] = useUrlState('co', 'status');          // ?co.status=…
 *   const [page, setPage] = useUrlNumber('co', 'page', 1);              // ?co.page=3
 *
 * Keys are namespaced per list (`co.`, `deal.`, `eco-program.` …) because several lists share
 * one URL as tabs of the same page. Defaults are left out of the URL.
 *
 * The value shown is local React state, updated synchronously (typing never lags or jumps);
 * the URL follows. URL changes from elsewhere (restore, back/forward) flow back in.
 * history.replaceState is called with `null` state: Next 16 ignores calls that pass its own
 * history state (`__NA`) and would not update useSearchParams.
 */
function write(key: string, value: string, fallback: string, legacyKey?: string) {
	const p = new URLSearchParams(window.location.search);
	// Only the default is left out. An empty choice on a list whose default isn't empty
	// (e.g. status "All" where the default is "pending") is kept as `key=` so it sticks.
	if (value === fallback) p.delete(key); else p.set(key, value);
	// The first edit takes over from a deep-link param (e.g. ?q= from the dashboard), so
	// clearing the box doesn't fall back to it.
	if (legacyKey) p.delete(legacyKey);
	const qs = p.toString();
	window.history.replaceState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
}

export function useUrlState(ns: string, key: string, fallback = '', legacyKey?: string): [string, (v: string) => void] {
	const sp = useSearchParams();
	const name = `${ns}.${key}`;
	const fromUrl = sp.get(name) ?? (legacyKey ? sp.get(legacyKey) : null) ?? fallback;
	const [value, setValue] = useState(fromUrl);
	const lastWritten = useRef(fromUrl);
	// The URL changed from outside this setter (restore on arrival, back/forward): adopt it.
	useEffect(() => {
		if (fromUrl !== lastWritten.current) { lastWritten.current = fromUrl; setValue(fromUrl); }
	}, [fromUrl]);
	const set = useCallback((v: string) => {
		setValue(v);
		lastWritten.current = v;
		write(name, v, fallback, legacyKey);
	}, [name, fallback, legacyKey]);
	return [value, set];
}

const toNum = (raw: string | null, fallback: number) => { const n = Number(raw); return raw !== null && raw !== '' && Number.isFinite(n) && n > 0 ? n : fallback; };

export function useUrlNumber(ns: string, key: string, fallback: number): [number, (v: number | ((prev: number) => number)) => void] {
	const [raw, setRaw] = useUrlState(ns, key, String(fallback));
	const current = toNum(raw, fallback);
	const currentRef = useRef(current);
	currentRef.current = current;
	const set = useCallback((v: number | ((prev: number) => number)) => {
		setRaw(String(typeof v === 'function' ? v(currentRef.current) : v));
	}, [setRaw]);
	return [current, set];
}

const STORE = 'admin:list-query:';
// Only list state is remembered: namespaced keys (`co.page`, `eco-program.q` …) and the tab.
// One-off deep-link params (?focus=…, ?q=…) must never come back on a later visit.
const isListParam = (k: string) => k === 'tab' || /^[a-z][a-z-]*\.[A-Za-z]+$/.test(k);
const listOnly = (qs: string) => {
	const out = new URLSearchParams();
	new URLSearchParams(qs).forEach((v, k) => { if (isListParam(k)) out.set(k, v); });
	return out.toString();
};

/**
 * Mounted once in the admin shell: remembers each page's last list query (per browser tab,
 * sessionStorage) and, when you come back to a page through a link without a query, restores
 * it — so leaving a filtered list and returning doesn't lose the filters or the page.
 */
/** Drop a page's saved list view (e.g. it holds a tab that no longer exists and would redirect again). */
export function forgetListQuery(pathname: string): void {
	// Deferred: the shell's save effect runs after the page's effects and would store it again.
	setTimeout(() => { try { sessionStorage.removeItem(STORE + pathname); } catch { /* ignore */ } }, 0);
}

export function useRestoreListQuery(): void {
	const pathname = usePathname();
	const sp = useSearchParams();
	const qs = listOnly(sp.toString());
	const restoring = useRef(false);
	useEffect(() => {
		try {
			if (window.location.search) return;
			const saved = sessionStorage.getItem(STORE + pathname);
			if (saved) { restoring.current = true; window.history.replaceState(null, '', `${pathname}?${saved}`); }
		} catch { /* storage unavailable: nothing to restore */ }
		// Only on arrival at a page; later changes are saved below.
	}, [pathname]);
	useEffect(() => {
		// Skip the empty render right after a restore so it can't wipe what it is restoring.
		if (restoring.current && !qs) return;
		restoring.current = false;
		try {
			if (qs) sessionStorage.setItem(STORE + pathname, qs);
			// Clear only when the URL is truly empty (filters cleared). Arriving through a one-off
			// link (?q=…, ?focus=…) has no list params but must not wipe the saved view.
			else if (!window.location.search) sessionStorage.removeItem(STORE + pathname);
		} catch { /* ignore */ }
	}, [pathname, qs]);
}
