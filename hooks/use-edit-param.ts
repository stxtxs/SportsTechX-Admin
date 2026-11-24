'use client';

import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';

/**
 * An id held in the URL (`?edit=<id>` by default), so a record's edit / detail view can be linked
 * to — e.g. from the global search. Opening sets local state; closing also removes the param.
 */
export function useEditParam(param = 'edit'): [string | null, (v: string | null) => void] {
	const sp = useSearchParams();
	const fromUrl = sp.get(param);
	const [id, setId] = useState<string | null>(fromUrl);
	const lastWritten = useRef(fromUrl);
	// A navigation to this same page with a new ?edit= (e.g. picking a record in global search while
	// already on its list) doesn't remount the page: adopt the URL's id.
	useEffect(() => {
		if (fromUrl !== lastWritten.current) { lastWritten.current = fromUrl; setId(fromUrl); }
	}, [fromUrl]);
	const set = (v: string | null) => {
		lastWritten.current = v;
		setId(v);
		const q = new URLSearchParams(window.location.search);
		if (v) q.set(param, v); else q.delete(param);
		const qs = q.toString();
		window.history.replaceState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
	};
	return [id, set];
}
