// GENERATED — copied from client/components/features/reports/report-kit/rewrite-href.ts by scripts/sync-report-renderer.mjs. Edit the client file, then re-run the script.
/**
 * Rewrite a link found in report content so it points at Atlas, not the old
 * Intelligence Hub.
 *
 * Reports were authored against the hub, so their inline links point at hub
 * routes — and sometimes the hub's own domain — which sent readers out of Atlas
 * entirely. This keeps them in-app: any `*.sportstechx.com` URL is reduced to a
 * relative path, and the hub's first path segment is mapped to the matching
 * Atlas route (per the feedback: companies→companies, ecosystem→investors,
 * analytics→analytics, …). Genuinely external links (LinkedIn, a company's own
 * site, etc.) and `#`/`mailto:`/`tel:` are returned untouched.
 */

// Hub first-path-segment → Atlas path. Everything else on a sportstechx host is
// kept as a relative path (stays in Atlas) rather than guessed.
const SEGMENT_MAP: Record<string, string> = {
	companies: '/companies',
	startups: '/companies',
	investors: '/investors',
	ecosystem: '/investors',
	analytics: '/analytics',
	funding: '/recently-funded',
	'recently-funded': '/recently-funded',
	dealflow: '/deal-flow',
	'deal-flow': '/deal-flow',
	ma: '/ma',
	investments: '/ma',
	programs: '/programs',
	events: '/events',
	framework: '/framework',
	reports: '/reports',
	roundup: '/roundup',
	'monthly-roundup': '/roundup',
	newsletter: '/newsletter',
	subscriptions: '/billing',
};

const isSportsTechX = (host: string): boolean => /(^|\.)sportstechx\.com$/i.test(host);

function mapPath(path: string, rest: string): string {
	const segs = path.split('/').filter(Boolean);
	if (segs.length === 0) return '/';
	const mapped = SEGMENT_MAP[segs[0]!.toLowerCase()];
	if (!mapped) return path + rest; // unknown hub route — keep it relative, in Atlas
	const tail = segs.slice(1).join('/');
	return (tail ? `${mapped}/${tail}` : mapped) + rest;
}

function rewriteInAtlas(href: string | null | undefined): string {
	if (!href) return '#';
	const raw = href.trim();
	if (!raw || raw.startsWith('#') || /^(mailto:|tel:)/i.test(raw)) return raw || '#';

	// Protocol-relative (`//host/path`) — resolve against https so the host check
	// runs; otherwise it would fall through to the `/`-path branch and a hub host
	// like `//hub.sportstechx.com/companies` would leak out unchanged.
	if (raw.startsWith('//')) {
		try {
			const u = new URL('https:' + raw);
			return isSportsTechX(u.hostname) ? mapPath(u.pathname, u.search + u.hash) : raw;
		} catch { return raw; }
	}

	if (/^https?:\/\//i.test(raw)) {
		let u: URL;
		try { u = new URL(raw); } catch { return raw; }
		if (!isSportsTechX(u.hostname)) return raw; // external domain — leave alone
		return mapPath(u.pathname, u.search + u.hash);
	}
	if (raw.startsWith('/')) {
		const i = raw.search(/[?#]/);
		return i >= 0 ? mapPath(raw.slice(0, i), raw.slice(i)) : mapPath(raw, '');
	}
	// Protocol-relative, bare word, or an unknown scheme — don't touch it.
	return raw;
}

// Admin preview: Atlas paths live on the client app, not in the admin.
export function rewriteReportHref(href: string | null | undefined): string {
	const h = rewriteInAtlas(href);
	return h.startsWith('/') && !h.startsWith('//') ? `${process.env.NEXT_PUBLIC_ATLAS_URL ?? 'https://www.atlas.sportstechx.com'}${h}` : h;
}
