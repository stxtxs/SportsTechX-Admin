'use client';

import { SWRConfig, useSWRConfig, type Cache } from 'swr';
import { useEffect } from 'react';
import { ThemeProvider } from 'next-themes';
import { Toaster } from 'sonner';
import { AuthSessionProvider } from '@/hooks/use-auth-session';
import { swrFetcher, ApiError, onAfterWrite } from '@/lib/api';

/**
 * Bounded (LRU) SWR cache.
 *
 * SWR's default cache is an unbounded `Map`, and with `keepPreviousData: true`
 * every distinct key ever requested is retained for the whole session: each
 * debounced search term (`{q:'a'}`, `{q:'ab'}`, …), every filter permutation,
 * every pagination page, every entity-picker lookup. Over a long admin session
 * of filtering + tab-hopping that Map grows without bound → heap growth → GC
 * pressure → the panel gets progressively laggier the longer it's used. Capping
 * it (evicting the least-recently-written keys past a limit) keeps the
 * keep-previous-data UX while stopping the unbounded growth.
 */
function boundedCache(max = 500): Cache {
	const map = new Map<string, unknown>();
	return {
		get: (key) => map.get(key),
		set: (key, value) => {
			map.delete(key); // re-insert to mark most-recently-used
			map.set(key, value);
			if (map.size > max) {
				const oldest = map.keys().next().value;
				if (oldest !== undefined) map.delete(oldest);
			}
		},
		delete: (key) => { map.delete(key); },
		keys: () => map.keys(),
	} as Cache;
}

/**
 * After any successful change, refresh the shared counters (stat cards, tab counts under
 * /api/admin/stats/*). They are read on many pages and no single write knows them all.
 * Mounted ones refetch now; others refetch next time they are shown.
 */
function RefreshCountersAfterWrite() {
	const { mutate } = useSWRConfig();
	useEffect(() => {
		// Debounced: a loop of writes (batch apply, bulk actions) refreshes once, after the burst.
		let t: ReturnType<typeof setTimeout> | undefined;
		onAfterWrite((path) => {
			// The work-session timer pings every 45s; that changes no counters or records.
			if (path.includes('/work-sessions/')) return;
			clearTimeout(t);
			// Stat cards / tab counts, plus open record views (/edit — e.g. the ecosystem drill-down),
			// which would otherwise keep showing pre-save values. Refetch only: shown data stays until
			// the new data arrives, and an open form keeps what the admin typed.
			t = setTimeout(() => { void mutate((k) => Array.isArray(k) && typeof k[0] === 'string' && (k[0].startsWith('/api/admin/stats/') || k[0].endsWith('/edit'))); }, 500);
		});
		return () => { clearTimeout(t); onAfterWrite(null); };
	}, [mutate]);
	return null;
}

/**
 * App-wide providers. Two global concerns:
 *
 *   1. `SWRConfig` — wires the global fetcher and sane defaults. The fetcher
 *      accepts string-or-tuple keys (see `swrFetcher` in lib/api.ts). Cache
 *      identity follows the tuple shape, so two queries with different params
 *      live in different slots.
 *
 *   2. `AuthSessionProvider` — single owner of the Supabase auth session
 *      subscription. Per-component `useAuthSession()` reads share the same
 *      subscription instead of each creating one.
 *
 * Previously used `@tanstack/react-query` (`5.100.10` — affected by the
 * upstream supply-chain incident). Migrated to SWR; the existing query-key
 * shape `[path, params?]` is preserved so call sites barely change.
 */
export function Providers({ children }: { children: React.ReactNode }) {
	return (
		<ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
			<SWRConfig
				value={{
					fetcher: swrFetcher,
					// `() =>` so SWR's `provider(prevCache)` arg doesn't land on `max`.
					provider: () => boundedCache(),
					dedupingInterval: 60_000,
					revalidateOnFocus: false,
					revalidateOnReconnect: false,
					errorRetryCount: 1,
					keepPreviousData: true,
					// Don't retry auth/client errors — api() already handled the 401
					// refresh+redirect, and retrying a 4xx just spams the server.
					onErrorRetry: (error, _key, _config, revalidate, { retryCount }) => {
						const status = (error as ApiError)?.status;
						if (typeof status === 'number' && status >= 400 && status < 500) return;
						if (retryCount >= 1) return;
						setTimeout(() => revalidate({ retryCount }), 1000);
					},
				}}
			>
				<RefreshCountersAfterWrite />
				<AuthSessionProvider>{children}</AuthSessionProvider>
				<Toaster position="top-right" />
			</SWRConfig>
		</ThemeProvider>
	);
}
