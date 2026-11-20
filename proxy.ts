import { type NextRequest, NextResponse } from 'next/server';

/**
 * Next.js 16 edge proxy. Lightweight cookie-presence check — does NOT validate
 * the Supabase session. Real session + admin-role enforcement happens inside
 * `<AdminShell>` once React mounts and `useAuthSession()` has resolved.
 *
 * Public routes (no cookie required): /login, /forbidden, /auth callback.
 * Everything else: must carry an `sb-*-auth-token` cookie or we redirect to
 * /login with a redirectTo param so the user lands back where they wanted.
 *
 * Signed-in users (have the cookie) who hit /login get bounced to /dashboard
 * so a forgotten tab doesn't sit on the auth page forever.
 */

const PUBLIC_PATHS = ['/login', '/forbidden', '/auth'];
const AUTH_PAGES = ['/login'];

const AUTH_COOKIE_PREFIX = 'sb-';
const AUTH_COOKIE_SUFFIX = '-auth-token';

function hasAuthCookie(request: NextRequest): boolean {
	for (const cookie of request.cookies.getAll()) {
		if (
			cookie.name.startsWith(AUTH_COOKIE_PREFIX) &&
			cookie.name.includes(AUTH_COOKIE_SUFFIX) &&
			cookie.value
		) {
			return true;
		}
	}
	return false;
}

export async function proxy(request: NextRequest) {
	const { pathname } = request.nextUrl;
	const isPublic = PUBLIC_PATHS.some(
		(p) => pathname === p || pathname.startsWith(`${p}/`),
	);
	const isAuthPage = AUTH_PAGES.some(
		(p) => pathname === p || pathname.startsWith(`${p}/`),
	);
	const authed = hasAuthCookie(request);

	if (authed && isAuthPage) {
		const redirectTo = request.nextUrl.searchParams.get('redirectTo') || '/dashboard';
		const url = request.nextUrl.clone();
		url.pathname = redirectTo;
		url.searchParams.delete('redirectTo');
		return NextResponse.redirect(url);
	}

	if (!authed && !isPublic) {
		const url = request.nextUrl.clone();
		url.pathname = '/login';
		url.searchParams.set('redirectTo', pathname);
		return NextResponse.redirect(url);
	}

	return NextResponse.next({ request });
}

export const config = {
	matcher: [
		// Pages only: not static assets/files, and not /api/* — that is a rewrite to the API,
		// which checks the bearer token itself; running this on every API call only adds latency.
		'/((?!api/|_next/static|_next/image|favicon\\.ico|favicon\\.svg|robots\\.txt|sitemap\\.xml|.*\\.).*)',
	],
};
