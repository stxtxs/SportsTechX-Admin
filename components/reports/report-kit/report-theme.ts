// GENERATED — copied from client/components/features/reports/report-kit/report-theme.ts by scripts/sync-report-renderer.mjs. Edit the client file, then re-run the script.
/**
 * STX report theme — ported verbatim from the legacy Intelligence Hub
 * (STX-WebApp/client/src/lib/report-theme.ts) so ported reports keep their
 * exact look. A report may override the accent/background via `reports.theme`
 * (jsonb) → `resolveTheme()` merges those over these defaults.
 *
 * These are the REPORT palette, intentionally separate from the Atlas design
 * tokens — report pages are chrome-less and theme themselves.
 */

export const BRAND = {
	pink: '#ED1A5E',
	darkTitle: '#2D3B49',
	peach: '#FDE1D9',
	slate: '#4D5E72',
	lightBlue: '#BED0E3',
	teal: '#76ADA7',
	tealBright: '#6A9DA9',
	navy: '#2B3D8F',
	white: '#FFFFFF',
	black: '#000000',
	green: '#387553',
	greenLight: '#5AA87C',
	athletes: '#4F2484',
	athletesSec: '#9079AD',
	execs: '#1FCC96',
	execsSec: '#7ACBBD',
	fans: '#0482FF',
	fansSec: '#8FD0E8',
	b2b: '#B1597E',
	b2c: '#702C41',
} as const;

export interface Theme {
	bg: string; bgSec: string; bgCard: string; bgCardHover: string;
	text: string; textSec: string; textMuted: string;
	border: string; titleColor: string; navBg: string;
	divider: string; tableRowAlt: string;
	/** Report accent (defaults to brand pink; overridable per report). */
	accent: string;
}

export const DARK: Theme = {
	bg: '#0c0f1a', bgSec: '#111827', bgCard: '#1a2232', bgCardHover: '#212d44',
	text: BRAND.white, textSec: BRAND.lightBlue, textMuted: '#8899aa',
	border: 'rgba(190,208,227,0.1)', titleColor: BRAND.white, navBg: 'rgba(12,15,26,0.9)',
	divider: 'rgba(237,26,94,0.25)', tableRowAlt: 'rgba(255,255,255,0.02)', accent: BRAND.pink,
};

export const LIGHT: Theme = {
	bg: BRAND.white, bgSec: '#F4F6F9', bgCard: BRAND.white, bgCardHover: BRAND.peach,
	text: BRAND.black, textSec: BRAND.darkTitle, textMuted: BRAND.slate,
	border: 'rgba(45,59,73,0.12)', titleColor: BRAND.darkTitle, navBg: 'rgba(255,255,255,0.95)',
	divider: 'rgba(237,26,94,0.2)', tableRowAlt: '#F9FAFB', accent: BRAND.pink,
};

/** Per-report overrides stored on `reports.theme` (jsonb, all optional). */
export interface ReportThemeOverride {
	accent?: string;
	accent_2?: string;
	default_dark?: boolean;
	font_display?: string;
	font_mono?: string;
}

/** Merge a report's overrides onto the base DARK/LIGHT palette for the mode. */
export function resolveTheme(isDark: boolean, override?: ReportThemeOverride | null): Theme {
	const base = isDark ? DARK : LIGHT;
	if (!override) return base;
	const accent = override.accent ?? base.accent;
	return {
		...base,
		accent,
		divider: isDark
			? `color-mix(in srgb, ${accent} 25%, transparent)`
			: `color-mix(in srgb, ${accent} 20%, transparent)`,
	};
}

export const SECTOR_COLORS: Record<string, string> = {
	'Activity & Performance': BRAND.athletes,
	'Fans & Content': BRAND.fans,
	'Management & Organisation': BRAND.execs,
	'For Athletes': BRAND.athletes,
	'For Fans': BRAND.fans,
	'For Executives': BRAND.execs,
	// Platform names since the 18 Nov sector rename (stored names in the database).
	'Athlete Tech': BRAND.athletes,
	'Fan Tech': BRAND.fans,
	'Executive Tech': BRAND.execs,
};

export const WORLDCUP_TECH_COLORS: Record<string, string> = {
	Officiating: BRAND.green,
	'Broadcast & Production': BRAND.fans,
	'Fan Experience': BRAND.pink,
	'Venue Operations & Security': BRAND.athletes,
	'Player Performance & Welfare': BRAND.teal,
};

export function fmtB(m: number): string {
	return `$${(m / 1000).toFixed(1).replace('.0', '')}B`;
}
export function fmt(m: number): string {
	return m >= 1000 ? fmtB(m) : `$${Math.round(m)}M`;
}
