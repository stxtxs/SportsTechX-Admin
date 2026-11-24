'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';

/**
 * An id held in the URL (`?edit=<id>` by default), so a record's edit / detail view can be linked
 * to — e.g. from the global search. Opening sets local state; closing also removes the param.
 */
export function useEditParam(param = 'edit'): [string | null, (v: string | null) => void] {
	const sp = useSearchParams();
	const [id, setId] = useState<string | null>(() => sp.get(param));
	const set = (v: string | null) => {
		setId(v);
		const q = new URLSearchParams(window.location.search);
		if (v) q.set(param, v); else q.delete(param);
		const qs = q.toString();
		window.history.replaceState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
	};
	return [id, set];
}
