'use client';

import { useRef } from 'react';
import useSWR, { useSWRConfig, unstable_serialize, type SWRConfiguration } from 'swr';

/**
 * The payload an edit form is seeded from, always fetched fresh when the form opens.
 *
 * A cached copy can predate the last save (the global 60s dedupe even reuses the old request),
 * and a form seeded from it writes the old values back on the next Save. So the cached entry is
 * dropped the first time each key is used here (before useSWR reads it), and requests are never
 * deduped. Another view still showing that record keeps its data until the fresh copy lands.
 */
export function useEditPayload<T>(path: string | null, opts?: SWRConfiguration<T>) {
	const { cache } = useSWRConfig();
	const key = path ? [path] : null;
	const dropped = useRef<string | null>(null);
	const sk = key ? unstable_serialize(key) : null;
	if (sk && dropped.current !== sk) { cache.delete(sk); dropped.current = sk; }
	return useSWR<T>(key, { revalidateOnFocus: false, dedupingInterval: 0, ...opts });
}
