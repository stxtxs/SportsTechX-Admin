'use client';

import { useCallback, useEffect } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

/**
 * List-page state (filters, search, sort, page) kept in the URL query string, so a reload,
 * a shared link or coming back to the page keeps the view. Drop-in for useState:
 *
 *   const [status, setStatus] = useUrlState('co', 'status');          // ?co.status=…
 *   const [page, setPage] = useUrlNumber('co', 'page', 1);              // ?co.page=3
 *
 * Keys are namespaced per list (`co.`, `deal.`, `inv.` …) because several lists share one
 * URL as tabs of the same page. Default values are left out of the URL. Writes use
 * history.replaceState (Next keeps useSearchParams in sync) and read the live
 * window.location each time, so several setters in one handler never overwrite each other.
 */
function write(key: string, value: string, fallback: string) {
	const p = new URLSearchParams(window.location.search);
	// Only the default is left out. An empty choice on a list whose default isn't empty
	// (e.g. status "All" where the default is "pending") is kept as `key=` so it sticks.
	if (value === fallback) p.delete(key); else p.set(key, value);
	const qs = p.toString();
	window.history.replaceState(window.history.state, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
}

export function useUrlState(ns: string, key: string, fallback = '', legacyKey?: string): [string, (v: string) => void] {
	const sp = useSearchParams();
	const name = `${ns}.${key}`;
	// legacyKey: an older un-namespaced param still honoured on arrival (e.g. ?q= deep links).
	const value = sp.get(name) ?? (legacyKey ? sp.get(legacyKey) : null) ?? fallback;
	const set = useCallback((v: string) => write(name, v, fallback), [name, fallback]);
	return [value, set];
}

const toNum = (raw: string | null, fallback: number) => { const n = Number(raw); return raw !== null && Number.isFinite(n) && n > 0 ? n : fallback; };

export function useUrlNumber(ns: string, key: string, fallback: number): [number, (v: number | ((prev: number) => number)) => void] {
	const [raw, setRaw] = useUrlState(ns, key, String(fallback));
	const set = useCallback((v: number | ((prev: number) => number)) => {
		// Updater form reads the live URL, so it never works from a stale render.
		const next = typeof v === 'function' ? v(toNum(new URLSearchParams(window.location.search).get(`${ns}.${key}`), fallback)) : v;
		setRaw(String(next));
	}, [setRaw, ns, key, fallback]);
	return [toNum(raw, fallback), set];
}

const STORE = 'admin:list-query:';

/**
 * Mounted once in the admin shell: remembers each page's last query string (per tab,
 * sessionStorage) and, when you come back to a page through a link without a query,
 * restores it — so leaving a filtered list and returning doesn't lose the filters or page.
 */
export function useRestoreListQuery(): void {
	const pathname = usePathname();
	const sp = useSearchParams();
	const qs = sp.toString();
	useEffect(() => {
		try {
			if (window.location.search) return;
			const saved = sessionStorage.getItem(STORE + pathname);
			if (saved) window.history.replaceState(window.history.state, '', `${pathname}?${saved}`);
		} catch { /* storage unavailable: nothing to restore */ }
		// Only on arrival at a page; later changes are saved below.
	}, [pathname]);
	useEffect(() => {
		try { if (qs) sessionStorage.setItem(STORE + pathname, qs); else sessionStorage.removeItem(STORE + pathname); } catch { /* ignore */ }
	}, [pathname, qs]);
}
