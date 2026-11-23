'use client';

import { getSupabaseBrowser } from './supabase';

/**
 * Thin fetch wrapper with Supabase auth.
 *
 * Paths are intentionally relative (e.g. `/api/admin/claims`). Next.js's
 * rewrite in `next.config.ts` forwards `/api/*` to the NestJS server at
 * `BACKEND_URL` (defaults to `http://localhost:5000`). Same-origin requests
 * also avoid CORS preflight overhead in dev. Absolute URLs are still
 * supported for the rare case of cross-host requests.
 */
/** Error carrying the HTTP status so callers / SWR onError can branch on 401. */
export class ApiError extends Error {
	constructor(public readonly status: number, message: string) {
		super(message);
		this.name = 'ApiError';
	}
}

async function getAuthHeader(forceRefresh = false): Promise<Record<string, string>> {
	const supabase = getSupabaseBrowser();
	if (forceRefresh) {
		// Hard refresh the access token using the stored refresh token.
		const { data } = await supabase.auth.refreshSession();
		return data.session?.access_token ? { Authorization: `Bearer ${data.session.access_token}` } : {};
	}
	const { data: { session } } = await supabase.auth.getSession();
	return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
}

/** Redirect to the login page, preserving where we came from. */
function redirectToLogin(): void {
	if (typeof window === 'undefined') return;
	if (window.location.pathname === '/login') return;
	window.location.assign('/login');
}

/**
 * Turn a failed Response into a single human-readable sentence. The NestJS API
 * wraps errors as `{ error: { code, message } }`; Nest's own exceptions use
 * `{ message }` (string or string[]). We surface that message — never the raw
 * JSON envelope or a bare status code — and fall back to a friendly default
 * keyed off the HTTP status so the admin never sees machine noise in a toast.
 */
async function friendlyError(res: Response): Promise<string> {
	const fallback: Record<number, string> = {
		400: 'That didn’t look right — please check the form and try again.',
		401: 'Your session expired — please sign in again.',
		403: 'You don’t have permission to do that.',
		404: 'We couldn’t find that record — it may have been deleted.',
		409: 'That conflicts with an existing record (a duplicate, perhaps).',
		422: 'Some fields are invalid — please review and try again.',
		429: 'Too many requests — give it a moment and try again.',
	};
	let body: unknown;
	try { body = await res.json(); } catch { body = null; }
	const err = (body as { error?: { details?: { issues?: Array<{ path?: unknown[]; message?: string }> } } } | null)?.error;
	// Validation failures: name the field(s) instead of the generic "request validation failed".
	const issues = err?.details?.issues;
	if (Array.isArray(issues) && issues.length) {
		const field = (p?: unknown[]) => (p ?? []).filter((x) => typeof x === 'string').join(' › ').replace(/_/g, ' ');
		const lines = issues.slice(0, 3).map((i) => (field(i.path) ? `${field(i.path)}: ${i.message ?? 'invalid'}` : i.message ?? 'invalid'));
		return lines.join('; ') + (issues.length > 3 ? ` (+${issues.length - 3} more)` : '');
	}
	// A server error carries a request id: show it so the admin can report which failure they hit.
	const ref = res.status >= 500 ? (body as { requestId?: string } | null)?.requestId : undefined;
	const withRef = (m: string) => (ref ? `${m} (ref ${ref})` : m);
	const pick = (v: unknown): string | null => {
		if (!v) return null;
		if (typeof v === 'string') return v;
		if (Array.isArray(v)) return v.filter((x) => typeof x === 'string').join(', ') || null;
		if (typeof v === 'object') {
			const o = v as Record<string, unknown>;
			return pick(o.message) ?? pick((o.error as Record<string, unknown>)?.message) ?? pick(o.error);
		}
		return null;
	};
	const msg = pick(body);
	if (msg) return withRef(msg);
	return withRef(fallback[res.status] ?? `Something went wrong (${res.status}). Please try again.`);
}

/** Called after every successful change (POST/PUT/PATCH/DELETE); the providers refresh shared counters from it. */
let afterWrite: ((path: string) => void) | null = null;
export function onAfterWrite(fn: ((path: string) => void) | null): void { afterWrite = fn; }

async function doFetch(method: string, url: string, body: unknown, forceRefresh: boolean): Promise<Response> {
	const auth = await getAuthHeader(forceRefresh);
	return fetch(url, {
		method,
		headers: {
			...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
			...auth,
		},
		body: body !== undefined ? JSON.stringify(body) : undefined,
	});
}

export async function api<T = unknown>(
	method: string,
	path: string,
	body?: unknown,
): Promise<T> {
	const url = path.startsWith('http')
		? path
		: path.startsWith('/') ? path : `/${path}`;
	let res = await doFetch(method, url, body, false);

	// Session likely expired — try one hard token refresh and retry. If still
	// unauthorized, the refresh token is dead too: bounce to /login.
	if (res.status === 401) {
		res = await doFetch(method, url, body, true);
		if (res.status === 401) {
			redirectToLogin();
			throw new ApiError(401, 'Session expired — please sign in again.');
		}
	}

	if (!res.ok) {
		throw new ApiError(res.status, await friendlyError(res));
	}
	if (method.toUpperCase() !== 'GET') afterWrite?.(url);
	const ct = res.headers.get('content-type') ?? '';
	if (ct.includes('application/json')) return (await res.json()) as T;
	return undefined as T;
}

/**
 * Every row of a paged list endpoint, for CSV exports. List endpoints cap `limit` at 200,
 * so asking for 5000 in one call was a 400; this walks the pages instead (up to `max` rows).
 */
export async function fetchAllPages<T>(path: string, params: Record<string, string>, max = 5000): Promise<{ rows: T[]; capped: boolean }> {
	const rows: T[] = [];
	for (let page = 1; rows.length < max; page++) {
		const qs = new URLSearchParams({ ...params, limit: '200', page: String(page) });
		const r = await api<{ data?: T[] }>('GET', `${path}?${qs}`);
		const batch = r?.data ?? [];
		rows.push(...batch);
		if (batch.length < 200) return { rows, capped: false };
	}
	return { rows: rows.slice(0, max), capped: true };
}

/**
 * Build a URL from an SWR-style key tuple `[path, params?]`. Mirrors the
 * client's `buildUrl` so both apps share the same key→URL convention.
 */
function buildUrl(queryKey: readonly unknown[]): string {
	const [path, params] = queryKey as [string, Record<string, unknown> | undefined];
	if (!params || typeof params !== 'object') return path;
	const sp = new URLSearchParams();
	for (const [k, v] of Object.entries(params)) {
		if (v == null || v === '') continue;
		if (Array.isArray(v)) {
			for (const item of v) sp.append(k, String(item));
		} else {
			sp.set(k, String(v));
		}
	}
	const qs = sp.toString();
	if (!qs) return path;
	return `${path}${path.includes('?') ? '&' : '?'}${qs}`;
}

/**
 * Global SWR fetcher. Accepts either a string URL or a key tuple `[path, params?]`.
 * Tuple form is preferred so that two queries with different params land in
 * different cache slots — same convention as `qk.*` on the user-facing client.
 */
export async function swrFetcher<T = unknown>(key: string | readonly unknown[]): Promise<T> {
	const url = Array.isArray(key) ? buildUrl(key) : (key as string);
	return api<T>('GET', url);
}
