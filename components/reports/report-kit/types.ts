// GENERATED — copied from client/components/features/reports/report-kit/types.ts by scripts/sync-report-renderer.mjs. Edit the client file, then re-run the script.
/** Mirrors the server `/api/reports/:slug/sections` response (sections.repository.ts). */
export type Tier = 'explore' | 'raise' | 'scout';

interface BaseSection {
	id: string;
	report_id: string;
	kind: string;
	position: number;
	access_tier: Tier;
	title: string | null;
	slug: string | null;
}
export interface VisibleSection extends BaseSection {
	is_locked: false;
	is_published: boolean;
	is_live_data: boolean;
	content: Record<string, unknown>;
	poll_id: string | null;
}
export interface LockedSection extends BaseSection {
	is_locked: true;
	preview: string;
	content: null;
}
export type Section = VisibleSection | LockedSection;

/** The report row from `GET /api/reports/:slug`. */
export interface ReportDetail {
	id: string;
	slug: string | null;
	title: string;
	short_title: string | null;
	report_month: number | null;
	report_year: number | null;
	has_sections: boolean;
	/** Some edition has a PDF the server can serve (false = nothing uploaded yet). */
	has_pdf?: boolean;
	is_published: boolean;
	tags: string[];
	theme: import('./report-theme').ReportThemeOverride | null;
	/** Custom page template (gster26 / ftabr26 / benchmark26) — null for a section or PDF report. */
	template?: string | null;
	/** false = opens by URL but stays out of the reports library. */
	is_listed?: boolean;
}
