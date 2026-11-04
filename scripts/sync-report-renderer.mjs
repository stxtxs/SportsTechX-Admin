#!/usr/bin/env node
/**
 * The admin's report preview IS the client's report renderer, copied.
 *
 * Copies client/components/features/reports/{report-page.tsx, section-renderer.tsx,
 * report-kit/*, sections/*} into admin/components/reports/ and applies the few
 * admin adaptations below — nothing else. The admin must never grow its own
 * version: the old one drifted from what users saw (missing kinds, wrong
 * theming), and a hand-patched port drifted again within a day.
 *
 *   node scripts/sync-report-renderer.mjs          write the copy
 *   node scripts/sync-report-renderer.mjs --check  exit 1 if the copy is stale
 *
 * Needs the client repo next to this one (or CLIENT_REPO=<path>). Every
 * adaptation anchors on exact client text and fails loudly if that text moves,
 * so a client change can't silently skip one.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_REPO = process.env.CLIENT_REPO ?? path.resolve(here, '../../client');
const SRC = path.join(CLIENT_REPO, 'components/features/reports');
const DEST = path.resolve(here, '../components/reports');
const check = process.argv.includes('--check');

// Files the admin owns (editor chrome around the copy). Never touched here.
const ADMIN_OWNED = new Set(['report-details-form.tsx', 'theme-controls.tsx', 'preview-overlay.tsx', 'gster26-editor.tsx']);

const ATLAS = "process.env.NEXT_PUBLIC_ATLAS_URL ?? 'https://www.atlas.sportstechx.com'";

/** [from, to] pairs per file. `from` must occur exactly once in the client file. */
const ADAPT = {
	// The client's query-key factory and API client don't exist in the admin.
	'report-kit/live-data.ts': [
		["import { qk } from '@/lib/query-keys';\n", ''],
		['qk.reports.sectionData(sectionId)', '`/api/reports/sections/${sectionId}/data`'],
	],
	'sections/poll.tsx': [
		["import { qk } from '@/lib/query-keys';\nimport { apiRequest } from '@/lib/query-client';\n", "import { api } from '@/lib/api';\n"],
		['qk.reports.pollResults(pollId)', '`/api/reports/polls/${pollId}/results`'],
		["await apiRequest('POST'", "await api('POST'"],
	],
	// Links into Atlas pages would open admin routes of the same name — in the
	// preview they open the real Atlas page in a new tab instead.
	'report-kit/rewrite-href.ts': [
		['export function rewriteReportHref(', 'function rewriteInAtlas('],
		[null, `\n// Admin preview: Atlas paths live on the client app, not in the admin.\nexport function rewriteReportHref(href: string | null | undefined): string {\n\tconst h = rewriteInAtlas(href);\n\treturn h.startsWith('/') && !h.startsWith('//') ? \`\${${ATLAS}}\${h}\` : h;\n}\n`],
	],
	'sections/company-grid.tsx': [
		["import Link from 'next/link';\n", ''],
		['? <Link href={`/companies/${c.slug ?? c.id}`} className="rk-hoverlift" style={box}>{inner}</Link>',
			`? <a href={\`\${${ATLAS}}/companies/\${c.slug ?? c.id}\`} target="_blank" rel="noopener noreferrer" className="rk-hoverlift" style={box}>{inner}</a>`],
	],
	'section-renderer.tsx': [
		["import Link from 'next/link';\n", ''],
		['<Link href="/plans" ', `<a href={\`\${${ATLAS}}/plans\`} target="_blank" rel="noopener noreferrer" `],
		['>See plans</Link>', '>See plans</a>'],
	],
};

const SKIP = (f) => f.endsWith('.check.ts');
const files = ['report-page.tsx', 'section-renderer.tsx',
	...['report-kit', 'sections'].flatMap((d) => readdirSync(path.join(SRC, d)).filter((f) => !SKIP(f)).map((f) => `${d}/${f}`))];

const BANNER = (f) => (f.endsWith('.css') ? '' : `// GENERATED — copied from client/components/features/reports/${f} by scripts/sync-report-renderer.mjs. Edit the client file, then re-run the script.\n`);

function expected(rel) {
	let src = readFileSync(path.join(SRC, rel), 'utf8').replace(/\r\n/g, '\n');
	for (const [from, to] of ADAPT[rel] ?? []) {
		if (from === null) { src += to; continue; }
		const n = src.split(from).length - 1;
		if (n !== 1) throw new Error(`${rel}: adaptation anchor found ${n}× (expected 1): ${from.slice(0, 80)}`);
		src = src.replace(from, to);
	}
	// Keep 'use client' first: the banner goes after it.
	return src.startsWith("'use client';") ? src.replace("'use client';\n", `'use client';\n${BANNER(rel)}`) : BANNER(rel) + src;
}

const stale = [];
for (const rel of files) {
	const want = expected(rel);
	const dest = path.join(DEST, rel);
	const have = existsSync(dest) ? readFileSync(dest, 'utf8').replace(/\r\n/g, '\n') : null;
	if (have === want) continue;
	stale.push(rel);
	if (!check) { mkdirSync(path.dirname(dest), { recursive: true }); writeFileSync(dest, want); }
}
// Files the client no longer has (a section removed upstream) must go too.
for (const d of ['report-kit', 'sections']) {
	for (const f of readdirSync(path.join(DEST, d))) {
		if (!files.includes(`${d}/${f}`)) { stale.push(`${d}/${f} (not in client)`); if (!check) rmSync(path.join(DEST, d, f)); }
	}
}
for (const f of readdirSync(DEST)) {
	const full = path.join(DEST, f);
	if (f.includes('.') && !files.includes(f) && !ADMIN_OWNED.has(f)) { stale.push(`${f} (not in client)`); if (!check) rmSync(full); }
}

if (stale.length === 0) { console.log(`report renderer in sync with the client (${files.length} files)`); process.exit(0); }
if (check) { console.error(`report renderer out of sync with the client:\n  ${stale.join('\n  ')}\nRun: node scripts/sync-report-renderer.mjs`); process.exit(1); }
console.log(`synced ${stale.length} file(s) from the client:\n  ${stale.join('\n  ')}`);
