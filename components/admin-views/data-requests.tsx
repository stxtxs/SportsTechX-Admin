'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import useSWR, { useSWRConfig } from 'swr';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { PageHeader, AsyncState, StatCard, StatsPanel, Section, Pager, SortableTh } from '@/components/atoms';
import { businessModelLabel, entityTypeLabel, investorCategoryLabel, requestEntityLabel, requestStatusLabel, tidy } from '@/lib/labels';
import { Funnel } from '@/components/charts';
import { FilterBar, FilterSelect, StatStrip } from '@/components/filters';
import { Modal } from '@/components/modal';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useInitialQuery } from '@/hooks/use-initial-query';
import { useUrlState, useUrlNumber } from '@/hooks/use-url-state';
import { useEditPayload } from '@/hooks/use-edit-payload';
import { useTableColumns } from '@/hooks/use-table-columns';

type DcrStatus = 'open' | 'picked_up' | 'resolved' | 'rejected';
interface QueueStats { data_requests: Array<{ label: string; value: number }> }

interface Dcr {
	id: string;
	entity_type: string | null;
	entity_id: string | null;
	target_company_id: string | null;
	target_investor_id?: string | null;
	target_ecosystem_entity_id?: string | null;
	target_deal_id?: string | null;
	ecosystem_type?: string | null;
	profile_id?: string | null;
	target_name_snapshot: string | null;
	field_change: string | null;
	old_value: string | null;
	requested_value: string | null;
	change_type: string | null;
	user_email: string | null;
	resolution_notes: string | null;
	context: Record<string, unknown> | null;
	status: DcrStatus;
	created_at: string;
}
const APPLYABLE = new Set(['company', 'investor', 'deal', 'ecosystem']);
interface DcrResponse { data: Dcr[]; total: number; totalPages: number }

// A verified user's edit lands here as a `claim_edit` "Profile update" bundle
// (`context.changes` = { details, funding_rounds, mna, funds, portfolio, thesis_* }).
// Raw JSON of that is unreadable for an admin, so it's rendered as a labelled
// summary below; funding rounds also get a one-click "Add as deal".
interface FundingRound { round_type_id?: string | null; round_label?: string | null; amount_usd?: number | null; round_date?: string | null; investors?: string | null; investor_refs?: Array<Record<string, unknown>> | null; source_url?: string | null }

// A company / investor the user ADDED because search didn't find it: not in Atlas.
// Edit requests are applied by hand, so it's flagged for the admin to create (or
// match) before using it; a claim, by contrast, creates it on verify.
function userAdded(id: unknown, details: unknown, name?: unknown) {
	if (id || !details || typeof details !== 'object') return null;
	const d = details as Record<string, unknown>;
	const tip = ['Not in Atlas — added by the user, unverified.', d.website, [d.hq_city, d.hq_country].filter(Boolean).join(', '), d.description].filter(Boolean).join(' · ');
	return <span className="tag warn" title={tip}>{name ? `${String(name)} · ` : ''}added by user</span>;
}
interface ClaimEditCtx { kind?: string; role?: string; changes?: Record<string, unknown> }
const asClaimEdit = (ctx: Record<string, unknown> | null): ClaimEditCtx | null => {
	const c = ctx as ClaimEditCtx | null;
	return c?.kind === 'claim_edit' ? c : null;
};
const claimEditRounds = (ctx: Record<string, unknown> | null): FundingRound[] => {
	const rounds = asClaimEdit(ctx)?.changes?.funding_rounds;
	return Array.isArray(rounds) ? (rounds as FundingRound[]) : [];
};
// A one-line tally for the list cell: "12 fields · 1 round · 1 M&A".
const claimEditTally = (ctx: Record<string, unknown> | null): string | null => {
	const ce = asClaimEdit(ctx);
	if (!ce) return null;
	const ch = (ce.changes ?? {}) as Record<string, unknown>;
	const details = (ch.details ?? {}) as Record<string, unknown>;
	const nFields = Object.values(details).filter((v) => v != null && v !== '' && !(Array.isArray(v) && v.length === 0)).length;
	const nRounds = Array.isArray(ch.funding_rounds) ? ch.funding_rounds.length : 0;
	const nMna = Array.isArray(ch.mna) ? ch.mna.length : 0;
	const parts = [`${nFields} field${nFields === 1 ? '' : 's'}`];
	if (nRounds) parts.push(`${nRounds} round${nRounds === 1 ? '' : 's'}`);
	if (nMna) parts.push(`${nMna} M&A`);
	return parts.join(' · ');
};

// Internal detail keys → human labels, in the order they should read.
const DETAIL_FIELDS: Array<[string, string]> = [
	['description', 'Description'], ['website', 'Website'], ['sector_id', 'Sector'],
	['business_model', 'Business model'], ['founded_year', 'Founded'], ['sport', 'Sport'],
	['hq_city', 'HQ city'], ['hq_country', 'HQ country'], ['location', 'Location'],
	['country', 'Country'], ['program_participation', 'Programs'],
	['actively_raising', 'Actively raising'], ['round_type_id', 'Current round'],
	['round_names', 'Round names'], ['raising_amount_min_usd', 'Raising (min)'],
	['raising_amount_max_usd', 'Raising (max)'], ['raising_valuation_note', 'Valuation'],
	['pitch_deck_url', 'Pitch deck'], ['actively_investing', 'Actively investing'],
	['category', 'Investor type'], ['year_launched', 'Year launched'],
	['thesis_amount_min_usd', 'Cheque (min)'], ['thesis_amount_max_usd', 'Cheque (max)'],
	['fund_data', 'Fund data'], ['entity_type', 'Entity type'], ['op_type', 'Type'],
	['applications_open', 'Applications open'], ['next_intake', 'Next intake'],
	['key_date', 'Key date'], ['offer', 'Offer'], ['public_email', 'Public email'],
	['twitter_url', 'Twitter'], ['instagram_url', 'Instagram'], ['facebook_url', 'Facebook'],
	['linkedin_url', 'LinkedIn'], ['contact_name', 'Contact'], ['contact_first_name', 'Contact first name'],
	['contact_last_name', 'Contact last name'], ['contact_position', 'Contact role'],
	['contact_email', 'Contact email'], ['contact_linkedin', 'Contact LinkedIn'],
];
// Plain-string thesis arrays (no id resolution needed). Sectors + tech tags are
// arrays of UUIDs and are resolved to names separately, in ClaimEditSummary.
const THESIS_STR_FIELDS: Array<[string, string]> = [
	['thesis_revenue_stages', 'Revenue stages'], ['thesis_continents', 'Regions'],
	['thesis_funding_stages', 'Funding stages'],
];
const MONEY_KEYS = new Set(['raising_amount_min_usd', 'raising_amount_max_usd', 'thesis_amount_min_usd', 'thesis_amount_max_usd']);

const fmtMoney = (n: number): string => {
	const [div, suffix] = n >= 1e9 ? [1e9, 'B'] as const : n >= 1e6 ? [1e6, 'M'] as const : n >= 1e3 ? [1e3, 'K'] as const : [1, ''] as const;
	return `$${(n / div).toFixed(1).replace(/\.0$/, '')}${suffix}`;
};

// One detail value → a readable string, or null to skip the row entirely.
function fmtDetail(key: string, val: unknown, sectorMap: Map<string, string>, roundMap: Map<string, string>): string | null {
	if (val == null || val === '' || (Array.isArray(val) && val.length === 0)) return null;
	if (key === 'sector_id') return sectorMap.get(String(val)) ?? null;
	if (key === 'round_type_id') return roundMap.get(String(val)) ?? null;
	if (key === 'pitch_deck_url') return 'Attached';
	if (key === 'business_model') return businessModelLabel(String(val));
	if (key === 'category') return investorCategoryLabel(String(val));
	if (key === 'entity_type') return entityTypeLabel(String(val));
	if (typeof val === 'boolean') return val ? 'Yes' : 'No';
	if (MONEY_KEYS.has(key) && typeof val === 'number') return fmtMoney(val);
	if (Array.isArray(val)) return val.map(String).join(', ');
	if (typeof val === 'object') {
		const parts = Object.entries(val as Record<string, unknown>).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}: ${v}`);
		return parts.length ? parts.join(', ') : null;
	}
	return String(val);
}

type RefRow = { id?: string; name?: string };
const idNameMap = (resp: unknown): Map<string, string> => {
	const list = Array.isArray(resp) ? resp : ((resp as { data?: RefRow[] })?.data ?? []);
	const m = new Map<string, string>();
	for (const o of list as RefRow[]) if (o?.id && o?.name) m.set(String(o.id), String(o.name));
	return m;
};

// The live record's editable fields (`GET /api/admin/{companies|investors|ecosystem-entities}/:id/edit`)
// — only the ones that map to a claim_edit detail key, for the current→requested diff.
interface CompanyEditLite {
	description?: string | null; sector_id?: string | null; business_model?: string | null;
	founded_year?: number | null; hq_city?: string | null; hq_country?: string | null;
	is_actively_raising?: boolean; actively_raising_round?: string | null;
	actively_raising_valuation?: string | number | null; actively_raising_pitch_deck_url?: string | null;
	email?: string | null; twitter_url?: string | null; instagram_url?: string | null;
	facebook_url?: string | null; linkedin_url?: string | null;
	poc_first_name?: string | null; poc_last_name?: string | null; poc_job_position?: string | null;
	poc_email?: string | null; poc_linkedin?: string | null;
	// investor
	category?: string | null; year_launched?: number | null; actively_investing?: boolean | null;
	thesis_amount_min?: string | number | null; thesis_amount_max?: string | number | null;
	poc_name?: string | null; poc_position?: string | null;
	// ecosystem
	entity_type?: string | null; program?: { entries_open?: boolean | null } | null;
}
type LiveKind = 'company' | 'investor' | 'ecosystem';
/** The live record a request points at: its kind, id, edit payload path and (investor /
 *  ecosystem) the admin link that opens its edit form. null when it isn't linked to one. */
function liveKind(r: Dcr): LiveKind | null {
	return r.entity_type === 'company' || r.entity_type === 'investor' || r.entity_type === 'ecosystem' ? r.entity_type : null;
}
function liveTarget(r: Dcr): { id: string; editPath: string; openHref: string | null } | null {
	const kind = liveKind(r);
	const id = kind === 'company' ? r.target_company_id : kind === 'investor' ? r.target_investor_id : kind === 'ecosystem' ? r.target_ecosystem_entity_id : null;
	if (!kind || !id) return null;
	const api = { company: 'companies', investor: 'investors', ecosystem: 'ecosystem-entities' }[kind];
	return { id, editPath: `/api/admin/${api}/${id}/edit`, openHref: recordHref(r) };
}
const ECO_TAB: Record<string, string> = { program: 'programs', event: 'events', initiative: 'initiatives', organization: 'organizations' };
/** An ecosystem entry's admin page, on its own tab. */
const ecoHref = (id: string, type?: string | null) => `/ecosystem?tab=${ECO_TAB[type ?? ''] ?? 'programs'}&open=${id}`;
/** The admin page of the record a request is about (a deal opens the deal; a fund / portfolio row → its investor). */
function recordHref(r: Dcr): string | null {
	if (r.entity_type === 'ecosystem') return r.target_ecosystem_entity_id ? ecoHref(r.target_ecosystem_entity_id, r.ecosystem_type) : null;
	if (r.entity_type === 'deal' && r.target_deal_id) return `/companies?tab=deals&edit=${r.target_deal_id}`;
	if (r.entity_type?.startsWith('investor')) return r.target_investor_id ? `/ecosystem?tab=investors&edit=${r.target_investor_id}` : null;
	return r.target_company_id ? `/companies?edit=${r.target_company_id}` : null;
}
// Batch "apply as submitted" can only write one plain column; a profile-update bundle or a
// fund / portfolio row always needs the edit form, so those are skipped instead of failing.
const batchApplyable = (r: Dcr) => APPLYABLE.has(r.entity_type ?? '') && !asClaimEdit(r.context) && r.status !== 'resolved';
// Current value of a detail key on the live record, formatted like the requested
// value so the two compare as strings. null = no clean mapping (show requested only).
function companyCurrent(key: string, c: CompanyEditLite | null | undefined, sectorMap: Map<string, string>, kind: LiveKind = 'company'): string | null {
	if (!c) return null;
	const str = (v: unknown): string | null => (v == null || v === '' ? null : String(v));
	const money = (v: unknown): string | null => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : fmtMoney(Number(v)));
	const yn = (v: unknown): string | null => (v == null ? null : v ? 'Yes' : 'No');
	if (kind === 'investor') {
		switch (key) {
			case 'category': return c.category ? investorCategoryLabel(c.category) : null;
			case 'year_launched': return str(c.year_launched);
			case 'actively_investing': return yn(c.actively_investing);
			case 'thesis_amount_min_usd': return money(c.thesis_amount_min);
			case 'thesis_amount_max_usd': return money(c.thesis_amount_max);
			case 'contact_name': return str(c.poc_name);
			case 'contact_position': return str(c.poc_position);
			case 'contact_email': return str(c.poc_email);
			case 'contact_linkedin': return str(c.poc_linkedin);
		}
	}
	if (kind === 'ecosystem') {
		switch (key) {
			case 'entity_type': return c.entity_type ? entityTypeLabel(c.entity_type) : null;
			case 'op_type': return str(c.category);
			case 'location': return str(c.hq_city);
			case 'country': return str(c.hq_country);
			case 'applications_open': return c.entity_type === 'program' ? yn(c.program?.entries_open) : null;
		}
	}
	switch (key) {
		case 'description': return str(c.description);
		case 'sector_id': return c.sector_id ? sectorMap.get(String(c.sector_id)) ?? null : null;
		case 'business_model': return c.business_model ? businessModelLabel(c.business_model) : null;
		case 'founded_year': return str(c.founded_year);
		case 'hq_city': return str(c.hq_city);
		case 'hq_country': return str(c.hq_country);
		case 'actively_raising': return c.is_actively_raising ? 'Yes' : 'No';
		case 'round_type_id': return str(c.actively_raising_round);
		case 'raising_valuation_note': return str(c.actively_raising_valuation);
		case 'pitch_deck_url': return c.actively_raising_pitch_deck_url ? 'Attached' : null;
		case 'public_email': return str(c.email);
		case 'twitter_url': return str(c.twitter_url);
		case 'instagram_url': return str(c.instagram_url);
		case 'facebook_url': return str(c.facebook_url);
		case 'linkedin_url': return str(c.linkedin_url);
		case 'contact_first_name': return str(c.poc_first_name);
		case 'contact_last_name': return str(c.poc_last_name);
		case 'contact_position': return str(c.poc_job_position);
		case 'contact_email': return str(c.poc_email);
		case 'contact_linkedin': return str(c.poc_linkedin);
		default: return null; // sport, program_participation, round_names, raising min/max — no 1:1 live field
	}
}

interface DiffRow { label: string; current: string | null; requested: string }
function DiffSection({ title, rows }: { title: string; rows: DiffRow[] }) {
	if (!rows.length) return null;
	return (
		<div>
			<div className="co-stat-label" style={{ marginBottom: 6 }}>{title}</div>
			<div style={{ display: 'grid', gap: 2 }}>
				{rows.map(({ label, current, requested }) => {
					const changed = current !== null && current !== requested;
					return (
						<div key={label} style={{ display: 'grid', gridTemplateColumns: '150px 1fr', gap: 12, fontSize: 12.5, alignItems: 'baseline', padding: '3px 0 3px 8px', borderLeft: `2px solid ${changed ? 'var(--pos)' : 'transparent'}` }}>
							<span style={{ color: 'var(--fg-muted)' }}>{label}</span>
							<span style={{ wordBreak: 'break-word' }}>
								{changed ? (
									<>
										<span style={{ color: 'var(--fg-muted)', textDecoration: 'line-through' }}>{current || '∅'}</span>
										<span style={{ color: 'var(--fg-muted)' }}>{' → '}</span>
										<span style={{ fontWeight: 600, color: 'var(--pos)' }}>{requested}</span>
									</>
								) : (
									<span style={{ color: 'var(--fg-2)' }}>{requested}</span>
								)}
							</span>
						</div>
					);
				})}
			</div>
		</div>
	);
}

function SummarySection({ title, rows }: { title: string; rows: Array<[string, string]> }) {
	if (!rows.length) return null;
	return (
		<div>
			<div className="co-stat-label" style={{ marginBottom: 6 }}>{title}</div>
			<div style={{ display: 'grid', gap: 6 }}>
				{rows.map(([k, v]) => (
					<div key={k} style={{ display: 'grid', gridTemplateColumns: '150px 1fr', gap: 12, fontSize: 12.5, alignItems: 'baseline' }}>
						<span style={{ color: 'var(--fg-muted)' }}>{k}</span>
						<span style={{ wordBreak: 'break-word' }}>{v}</span>
					</div>
				))}
			</div>
		</div>
	);
}

/** Readable render of a `claim_edit` bundle — the admin can see exactly what the
 *  user wants changed without reading raw JSON. */
function ClaimEditSummary({ r, sectorMap, roundMap, techMap, rounds, current, dealPending, addedDeals, onAddDeal }: {
	r: Dcr;
	sectorMap: Map<string, string>;
	roundMap: Map<string, string>;
	techMap: Map<string, string>;
	rounds: FundingRound[];
	current?: CompanyEditLite | null;
	dealPending: string | null;
	addedDeals: Set<string>;
	onAddDeal: (r: Dcr, fr: FundingRound, i: number) => void;
}) {
	const ctx = asClaimEdit(r.context);
	const changes = (ctx?.changes ?? {}) as Record<string, unknown>;
	const details = (changes.details ?? {}) as Record<string, unknown>;
	const detailRows: DiffRow[] = DETAIL_FIELDS
		.map(([k, label]) => ({ label, current: companyCurrent(k, current, sectorMap, liveKind(r) ?? 'company'), requested: fmtDetail(k, details[k], sectorMap, roundMap) }))
		.filter((row): row is DiffRow => row.requested != null);
	const changedCount = detailRows.filter((row) => row.current !== null && row.current !== row.requested).length;
	// Thesis sectors + tech tags are UUID arrays → resolve to names; the rest are plain strings.
	const nameList = (ids: unknown, map: Map<string, string>): string | null =>
		Array.isArray(ids) && ids.length ? ids.map((id) => map.get(String(id)) ?? String(id)).join(', ') : null;
	const thesisRows: Array<[string, string]> = [];
	const ts = nameList(changes.thesis_sectors, sectorMap); if (ts) thesisRows.push(['Thesis sectors', ts]);
	const tt = nameList(changes.thesis_tech_tags, techMap); if (tt) thesisRows.push(['Tech tags', tt]);
	for (const [k, label] of THESIS_STR_FIELDS) {
		const v = changes[k];
		if (Array.isArray(v) && v.length) thesisRows.push([label, v.map((x) => tidy(String(x))).join(', ')]);
	}
	const mna = (Array.isArray(changes.mna) ? changes.mna : []) as Array<Record<string, unknown>>;
	const funds = (Array.isArray(changes.funds) ? changes.funds : []) as Array<Record<string, unknown>>;
	const portfolio = (Array.isArray(changes.portfolio) ? changes.portfolio : []) as Array<Record<string, unknown>>;
	const line = (parts: Array<unknown>) => parts.filter((p) => p != null && p !== '').join(' · ') || '—';
	const empty = !detailRows.length && !thesisRows.length && !rounds.length && !mna.length && !funds.length && !portfolio.length;

	return (
		<div style={{ display: 'grid', gap: 14 }}>
			<div style={{ fontSize: 12, color: 'var(--fg-muted)' }}>
				{ctx?.role ? `${ctx.role[0].toUpperCase()}${ctx.role.slice(1)} is requesting these profile updates.` : 'Requested profile updates.'}
				{current ? (changedCount > 0 ? ` ${changedCount} field${changedCount === 1 ? '' : 's'} changed vs the live profile (highlighted).` : ' Nothing differs from the live profile.') : ''}
			</div>
			<DiffSection title="Profile & details" rows={detailRows} />
			<SummarySection title="Investment thesis" rows={thesisRows} />
			{rounds.length > 0 && (
				<div style={{ display: 'grid', gap: 6 }}>
					<div className="co-stat-label">Funding rounds</div>
					{rounds.map((fr, i) => {
						const key = `${r.id}:${i}`;
						const added = addedDeals.has(key);
						const label = fr.round_label || (fr.round_type_id ? roundMap.get(String(fr.round_type_id)) : null) || 'Round';
						return (
							<div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5, flexWrap: 'wrap' }}>
								<span style={{ fontWeight: 600 }}>{label}</span>
								<span style={{ color: 'var(--fg-muted)' }}>{line([fr.round_date, typeof fr.amount_usd === 'number' ? fmtMoney(fr.amount_usd) : null, fr.investors])}</span>
								{(fr.investor_refs ?? []).map((x, k) => <span key={k}>{userAdded(x.investor_id, x.new_investor, x.name)}</span>)}
								<div style={{ flex: 1 }} />
								{r.target_company_id && (
									<button className="btn ghost" disabled={added || dealPending === key} onClick={() => onAddDeal(r, fr, i)}>
										{added ? 'Added ✓' : dealPending === key ? 'Adding…' : 'Add as deal'}
									</button>
								)}
							</div>
						);
					})}
					{r.target_company_id && <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>Creates a deal on the company. Set the raising amount/round + toggle “actively raising” from the claim, then resolve.</div>}
				</div>
			)}
			{mna.length > 0 && (
				<div style={{ display: 'grid', gap: 6 }}>
					<div className="co-stat-label">M&amp;A</div>
					{mna.map((m, i) => <div key={i} style={{ fontSize: 12.5 }}>{line([m.deal_type, m.counterparty, typeof m.amount_usd === 'number' ? fmtMoney(m.amount_usd) : null, m.deal_date])} {userAdded(m.counterparty_company_id, m.new_counterparty)}</div>)}
				</div>
			)}
			{funds.length > 0 && (
				<div style={{ display: 'grid', gap: 6 }}>
					<div className="co-stat-label">Funds</div>
					{funds.map((f, i) => <div key={i} style={{ fontSize: 12.5 }}>{line([f.name, typeof f.size_usd === 'number' ? fmtMoney(f.size_usd) : null, f.fund_year])}</div>)}
				</div>
			)}
			{portfolio.length > 0 && (
				<div style={{ display: 'grid', gap: 6 }}>
					<div className="co-stat-label">Portfolio</div>
					{portfolio.map((p, i) => <div key={i} style={{ fontSize: 12.5 }}>{line([p.company_name, p.stage, p.invest_year])} {userAdded(p.company_id, p.new_company)}</div>)}
				</div>
			)}
			{empty && <div style={{ fontSize: 12, color: 'var(--fg-muted)' }}>No field values in this request.</div>}
		</div>
	);
}

const STATUSES: DcrStatus[] = ['open', 'picked_up', 'resolved', 'rejected'];

export function DataRequestsView({ embedded = false }: { embedded?: boolean }) {
	const cols = useTableColumns('data-changes');
	const { mutate } = useSWRConfig();
	const [status, setStatus] = useUrlState('dcr', 'status', '');
	const [entity, setEntity] = useUrlState('dcr', 'entity', '');
	const [search, setSearch] = useUrlState('dcr', 'q', '', 'q');
	const debouncedSearch = useDebouncedValue(search);
	const [sort, setSort] = useUrlState('dcr', 'sort', '-created');
	const [page, setPage] = useUrlNumber('dcr', 'page', 1);
	const [pendingId, setPendingId] = useState<string | null>(null);
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const activeFilters = (status ? 1 : 0) + (entity ? 1 : 0) + (search ? 1 : 0);
	/** Change a filter or the sort: back to page 1, and drop a selection the new view may hide. */
	const f = (set: (v: string) => void) => (v: string) => { set(v); setPage(1); setSelected(new Set()); };
	const clearFilters = () => { for (const set of [setStatus, setEntity, setSearch]) set(''); setPage(1); setSelected(new Set()); };

	const { data, error, isLoading } = useSWR<DcrResponse>(
		['/api/admin/data-change-requests', { status: status || undefined, q: debouncedSearch || undefined, entity_type: entity || undefined, sort, page, limit: 30 }],
		{ dedupingInterval: 15_000 },
	);
	const stats = useSWR<QueueStats>(['/api/admin/stats/queues'], { dedupingInterval: 60_000 });
	const dq: Record<string, number> = Object.fromEntries((stats.data?.data_requests ?? []).map((b) => [b.label, b.value]));

	// Reference lists resolve the UUIDs a claim_edit bundle stores (sector_id,
	// round_type_id) to readable names. Public + cached, shared with the pickers.
	const sectorsRef = useSWR(['/api/sectors'], { dedupingInterval: 300_000 });
	const roundsRef = useSWR(['/api/round-types'], { dedupingInterval: 300_000 });
	const techRef = useSWR(['/api/tech-tags'], { dedupingInterval: 300_000 });
	const sectorMap = useMemo(() => idNameMap(sectorsRef.data), [sectorsRef.data]);
	const roundMap = useMemo(() => idNameMap(roundsRef.data), [roundsRef.data]);
	const techMap = useMemo(() => idNameMap(techRef.data), [techRef.data]);

	const refresh = () => mutate((key) => Array.isArray(key) && key[0] === '/api/admin/data-change-requests');

	const update = async (id: string, next: DcrStatus, notes?: string) => {
		setPendingId(id);
		try {
			await api('POST', `/api/admin/data-change-requests/${id}/status`, { status: next, ...(notes !== undefined ? { notes } : {}) });
			toast.success('Updated');
			void mutate((key) => Array.isArray(key) && key[0] === '/api/admin/data-change-requests');
		} catch (e) {
			toast.error((e as Error).message);
		} finally {
			setPendingId(null);
		}
	};

	const resolveWithNotes = (id: string, next: 'resolved' | 'rejected') => {
		const notes = window.prompt(next === 'rejected' ? 'Reason for rejection (optional):' : 'Resolution notes (optional):') ?? undefined;
		if (notes === undefined) return; // cancelled
		void update(id, next, notes);
	};

	// The full request now opens in a modal (bigger view, no long inline scroll).
	const [modalRow, setModalRow] = useState<Dcr | null>(null);
	const [editVal, setEditVal] = useState('');
	const [applyPending, setApplyPending] = useState<string | null>(null);
	const [showRaw, setShowRaw] = useState(false);
	const openModal = (r: Dcr) => { setShowRaw(false); setEditVal(r.requested_value ?? ''); setModalRow(r); };
	const closeModal = () => setModalRow(null);
	// Live record fields (company / investor / ecosystem), for the current→requested diff on a claim_edit.
	const modalTarget = modalRow ? liveTarget(modalRow) : null;
	const { data: currentCompany } = useEditPayload<CompanyEditLite>(modalRow && modalTarget && asClaimEdit(modalRow.context) ? modalTarget.editPath : null);
	const applyChange = async (r: Dcr) => {
		setApplyPending(r.id);
		try {
			await api('POST', `/api/admin/data-change-requests/${r.id}/apply`, { value: editVal, field: r.field_change ?? undefined });
			toast.success('Applied to the record');
			closeModal();
			void refresh();
		} catch (e) { toast.error((e as Error).message); }
		finally { setApplyPending(null); }
	};

	const [dealPending, setDealPending] = useState<string | null>(null);
	const [addedDeals, setAddedDeals] = useState<Set<string>>(new Set());
	const addRoundAsDeal = async (r: Dcr, fr: FundingRound, idx: number) => {
		if (!r.target_company_id) { toast.error('This request has no linked company.'); return; }
		const key = `${r.id}:${idx}`;
		setDealPending(key);
		try {
			const investors = (fr.investors ?? '').split(',').map((s) => s.trim()).filter(Boolean).map((investor_name) => ({ investor_name }));
			await api('POST', '/api/admin/deals', {
				company_id: r.target_company_id,
				round_type_id: fr.round_type_id ?? undefined,
				announced_date: fr.round_date ?? undefined,
				amount_usd: typeof fr.amount_usd === 'number' ? fr.amount_usd : undefined,
				source_url: fr.source_url ?? undefined,
				...(investors.length ? { investors } : {}),
			});
			toast.success('Funding round added as a deal');
			setAddedDeals((s) => new Set(s).add(key));
		} catch (e) { toast.error((e as Error).message); }
		finally { setDealPending(null); }
	};

	const toggleSel = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
	const batch = async (label: string, fn: (id: string) => Promise<unknown>, only?: (r: Dcr) => boolean) => {
		let ok = 0, fail = 0, skipped = 0;
		let firstError = '';
		const byId = new Map((data?.data ?? []).map((r) => [r.id, r]));
		for (const id of [...selected]) {
			const r = byId.get(id);
			if (r && only && !only(r)) { skipped++; continue; }
			try { await fn(id); ok++; } catch (e) { fail++; firstError ||= `${r?.target_name_snapshot ?? 'A request'}: ${(e as Error).message}`; }
		}
		const skip = skipped ? ` · ${skipped} skipped (profile updates / funds / portfolio / already resolved — use Review)` : '';
		if (fail) toast.error(`${label}: ${ok} succeeded, ${fail} failed${skip}`, { description: firstError });
		else if (ok || skipped) (ok ? toast.success : toast.warning)(`${label}: ${ok}${skip}`);
		setSelected(new Set());
		void refresh();
	};
	// Batch apply uses each row's submitted value as-is (apply-as-submitted); rows that can only
	// be applied from the edit form are skipped rather than counted as failures.
	const batchApply = () => batch('Applied', (id) => api('POST', `/api/admin/data-change-requests/${id}/apply`, {}), batchApplyable);
	const batchReject = () => batch('Rejected', (id) => api('POST', `/api/admin/data-change-requests/${id}/status`, { status: 'rejected' }));

	const items = data?.data ?? [];
	const allSelected = items.length > 0 && items.every((r) => selected.has(r.id));
	const toggleAll = () => setSelected(allSelected ? new Set() : new Set(items.map((r) => r.id)));
	return (
		<div>
			{!embedded && <PageHeader kicker={`Queues · ${(data?.total ?? 0).toLocaleString()} requests`} title="Data change requests" />}

			{!embedded && (
				<StatsPanel>
					<StatStrip cols={4}>
						<StatCard label="Open" loading={stats.isLoading} value={(dq.open ?? 0).toLocaleString()} urgent={(dq.open ?? 0) > 0} />
						<StatCard label="Picked up" loading={stats.isLoading} value={(dq.picked_up ?? 0).toLocaleString()} />
						<StatCard label="Resolved" loading={stats.isLoading} value={(dq.resolved ?? 0).toLocaleString()} />
						<StatCard label="Rejected" loading={stats.isLoading} value={(dq.rejected ?? 0).toLocaleString()} />
					</StatStrip>
				</StatsPanel>
			)}

			{!embedded && (
				<Section title="Request funnel" meta="open → resolved">
					<Funnel stages={[
						{ label: 'Open', value: dq.open ?? 0 },
						{ label: 'Picked up', value: dq.picked_up ?? 0 },
						{ label: 'Resolved', value: dq.resolved ?? 0, color: 'var(--pos)' },
						{ label: 'Rejected', value: dq.rejected ?? 0, color: 'var(--neg)' },
					]} />
				</Section>
			)}

			<div style={{ height: 'var(--space-4)' }} />

			<FilterBar>
				<input className="search-input" style={{ flex: '0 0 260px', height: 32 }} placeholder="Search target / requester / field…" aria-label="Search data change requests" value={search} onChange={(e) => f(setSearch)(e.target.value)} />
				<FilterSelect ariaLabel="Status" value={status} onChange={f(setStatus)} options={STATUSES.map((s) => ({ value: s, label: requestStatusLabel(s) }))} allLabel="All statuses" />
				<FilterSelect ariaLabel="Entity" value={entity} onChange={f(setEntity)} allLabel="All entities" options={[
					{ value: 'company,deal', label: 'Companies & deals' },
					{ value: 'investor,investor_fund,investor_portfolio', label: 'Investors' },
					{ value: 'ecosystem', label: 'Ecosystem' },
					{ value: 'investor,ecosystem,investor_fund,investor_portfolio', label: 'Investors & ecosystem' },
				]} />
				{activeFilters > 0 && <button className="btn ghost" onClick={clearFilters}>Clear {activeFilters} filter{activeFilters === 1 ? '' : 's'}</button>}
			</FilterBar>

			{selected.size > 0 && (
				<div className="card" style={{ padding: 12, marginBottom: 'var(--space-4)', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
					<strong>{selected.size} selected</strong>
					<button className="btn" onClick={() => void batchApply()}>Apply selected (as submitted)</button>
					<button className="btn ghost" onClick={() => void batchReject()}>Reject selected</button>
					<div style={{ flex: 1 }} />
					<button className="btn ghost" onClick={() => setSelected(new Set())}>Clear</button>
				</div>
			)}

			<div className="card" ref={cols.ref}>
				<div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px var(--space-4)', borderBottom: '1px solid var(--border)', fontSize: 12, color: 'var(--fg-muted)' }}>
					{data ? `${data.total.toLocaleString()} request${data.total === 1 ? '' : 's'}${activeFilters ? ' match these filters' : ''}` : 'Loading…'} · click a column header to sort
					<span style={{ marginLeft: 'auto' }}>{cols.menu}</span>
</div>
				<AsyncState loading={isLoading} error={error} empty={items.length === 0} emptyMsg={activeFilters ? 'No matching requests.' : 'No data change requests.'} onRetry={() => void refresh()}>
				<table className="data-table">
					<thead>
						<tr>
							<th style={{ width: 28 }}><input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all" /></th>
							<SortableTh label="Created" field="created" sort={sort} onSort={f(setSort)} />
							<SortableTh label="Target" field="target" sort={sort} onSort={f(setSort)} />
							<SortableTh label="Requested change" field="field" sort={sort} onSort={f(setSort)} />
							<SortableTh label="Requester" field="requester" sort={sort} onSort={f(setSort)} />
							<SortableTh label="Status" field="status" sort={sort} onSort={f(setSort)} />
							<th style={{ textAlign: 'right' }}>Actions</th>
						</tr>
					</thead>
					<tbody>
						{items.map((r) => (
							<tr key={r.id}>
								<td><input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleSel(r.id)} aria-label="Select row" /></td>
								<td className="num">{new Date(r.created_at).toLocaleDateString()}</td>
								<td>
									{recordHref(r)
										? <Link href={recordHref(r)!} title="Open the record" style={{ fontWeight: 600, color: 'inherit', textDecoration: 'underline', textDecorationColor: 'var(--border)', textUnderlineOffset: 2 }}>{r.target_name_snapshot ?? 'Unnamed record'}</Link>
										: <span style={{ fontWeight: 600 }}>{r.target_name_snapshot ?? '—'}</span>}
									<div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{r.entity_type ? requestEntityLabel(r.entity_type) : ''}</div>
								</td>
								<td style={{ maxWidth: 320 }}>
									{asClaimEdit(r.context) ? (
										<div style={{ fontSize: 13 }}>
											<span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-muted)' }}>profile update</span>
											<div style={{ color: 'var(--fg-2)' }}>{claimEditTally(r.context)}</div>
										</div>
									) : r.field_change ? (
										<div style={{ fontSize: 13 }}>
											<span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-muted)' }}>{tidy(r.change_type ?? 'edit')} · {tidy(r.field_change)}</span>
											<div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
												<span style={{ color: 'var(--fg-muted)', textDecoration: 'line-through' }}>{r.old_value || '∅'}</span>
												{' → '}
												<span style={{ fontWeight: 600 }}>{r.requested_value || '∅'}</span>
											</div>
										</div>
									) : '—'}
									{r.resolution_notes && <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 4 }}>note: {r.resolution_notes}</div>}
								</td>
								<td style={{ fontSize: 12 }}>{r.profile_id ? <Link href={`/users/${r.profile_id}`} title="Open the user" style={{ color: 'inherit', textDecoration: 'underline', textDecorationColor: 'var(--border)', textUnderlineOffset: 2 }}>{r.user_email ?? 'Open user'}</Link> : (r.user_email ?? '—')}</td>
								<td><span className="tag">{requestStatusLabel(r.status)}</span></td>
								<td style={{ textAlign: 'right' }}>
									<div style={{ display: 'inline-flex', gap: 6 }}>
										<button className="btn ghost" onClick={() => openModal(r)}>Review</button>
										{r.status !== 'picked_up' && r.status !== 'resolved' && (
											<button className="btn ghost" disabled={pendingId === r.id} onClick={() => void update(r.id, 'picked_up')}>Pick up</button>
										)}
										{r.status !== 'resolved' && (
											<button className="btn" disabled={pendingId === r.id} onClick={() => resolveWithNotes(r.id, 'resolved')}>Resolve</button>
										)}
										{r.status !== 'rejected' && (
											<button className="btn ghost" disabled={pendingId === r.id} onClick={() => resolveWithNotes(r.id, 'rejected')}>Reject</button>
										)}
										{r.status !== 'open' && (
											<button className="btn ghost" disabled={pendingId === r.id} onClick={() => void update(r.id, 'open')}>Re-open</button>
										)}
									</div>
								</td>
							</tr>
						))}
					</tbody>
				</table>
				</AsyncState>
			</div>
			<Pager page={page} totalPages={data?.totalPages} onPage={setPage} />

			{modalRow && (() => {
				const r = modalRow;
				const ce = asClaimEdit(r.context);
				return (
					<Modal
						title={`${r.target_name_snapshot ?? 'Request'} — ${ce ? 'profile update' : (r.field_change ? tidy(r.field_change) : 'change request')}`}
						width={780}
						onClose={closeModal}
						footer={
							<div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
								{r.status !== 'picked_up' && r.status !== 'resolved' && (
									<button className="btn ghost" disabled={pendingId === r.id} onClick={() => void update(r.id, 'picked_up')}>Pick up</button>
								)}
								{r.status !== 'open' && (
									<button className="btn ghost" disabled={pendingId === r.id} onClick={() => void update(r.id, 'open')}>Re-open</button>
								)}
								{r.status !== 'rejected' && (
									<button className="btn ghost" disabled={pendingId === r.id} onClick={() => { resolveWithNotes(r.id, 'rejected'); closeModal(); }}>Reject</button>
								)}
								{r.status !== 'resolved' && (
									<button className="btn" disabled={pendingId === r.id} onClick={() => { resolveWithNotes(r.id, 'resolved'); closeModal(); }}>Resolve</button>
								)}
							</div>
						}
					>
						<div style={{ display: 'grid', gap: 14 }}>
							<div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, fontSize: 12 }}>
								<div><div className="co-stat-label">Entity</div>{requestEntityLabel(r.entity_type)}</div>
								<div><div className="co-stat-label">Status</div>{requestStatusLabel(r.status)}</div>
								<div><div className="co-stat-label">Change type</div>{tidy(r.change_type ?? 'edit')}</div>
								<div><div className="co-stat-label">Requested by</div>{r.profile_id ? <Link href={`/users/${r.profile_id}`} style={{ color: 'var(--accent)' }}>{r.user_email ?? 'Open user'} ↗</Link> : (r.user_email ?? '—')}</div>
								<div><div className="co-stat-label">Submitted</div>{new Date(r.created_at).toLocaleString()}</div>
								{r.resolution_notes && <div><div className="co-stat-label">Note</div>{r.resolution_notes}</div>}
								{modalTarget?.openHref && (
									<div><div className="co-stat-label">Record</div><a href={modalTarget.openHref} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>Open {r.target_name_snapshot ?? 'the record'} ↗</a></div>
								)}
							</div>
							{ce ? (
								<>
									<ClaimEditSummary
										r={r}
										sectorMap={sectorMap}
										roundMap={roundMap}
										techMap={techMap}
										rounds={claimEditRounds(r.context)}
										current={currentCompany}
										dealPending={dealPending}
										addedDeals={addedDeals}
										onAddDeal={(row, fr, i) => void addRoundAsDeal(row, fr, i)}
									/>
									<div>
										<button className="btn ghost" style={{ fontSize: 11 }} onClick={() => setShowRaw((v) => !v)}>{showRaw ? 'Hide raw JSON' : 'Show raw JSON'}</button>
										{showRaw && <pre style={{ margin: '6px 0 0', whiteSpace: 'pre-wrap', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-2)' }}>{JSON.stringify(r.context, null, 2)}</pre>}
									</div>
									<div style={{ fontSize: 12, color: 'var(--fg-muted)', borderTop: '1px solid var(--border)', paddingTop: 10 }}>
										Apply the changed fields from the {requestEntityLabel(r.entity_type).toLowerCase()}’s edit form (use “Add as deal” for any funding rounds), then <strong>Resolve</strong>. The requester is notified on pick-up and on resolve.
									</div>
								</>
							) : (
								<>
									{r.context && Object.keys(r.context).length > 0 && (
										<div style={{ fontSize: 12 }}>
											<div className="co-stat-label">Extra context</div>
											<pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-2)' }}>{JSON.stringify(r.context, null, 2)}</pre>
										</div>
									)}
									{APPLYABLE.has(r.entity_type ?? '') ? (
										<div style={{ display: 'grid', gap: 6 }}>
											<div className="co-stat-label">Value to apply (edit before applying if needed)</div>
											<div style={{ fontSize: 12 }}><span style={{ color: 'var(--fg-muted)' }}>Current: </span><span style={{ textDecoration: 'line-through', color: 'var(--fg-muted)' }}>{r.old_value || '∅'}</span></div>
											<div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
												<textarea className="search-input" style={{ flex: 1, minHeight: 38, resize: 'vertical' }} value={editVal} onChange={(e) => setEditVal(e.target.value)} />
												<button className="btn" disabled={applyPending === r.id || r.status === 'resolved'} onClick={() => void applyChange(r)}>
													{applyPending === r.id ? 'Applying…' : 'Apply to record'}
												</button>
											</div>
											<div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>Writes <strong>{tidy(r.field_change)}</strong> on the {requestEntityLabel(r.entity_type).toLowerCase()} and marks this request resolved.</div>
										</div>
									) : (
										<div style={{ fontSize: 12, color: 'var(--fg-muted)' }}>
											{r.entity_type === 'investor_fund'
												? 'Fund changes carry derived values (USD, year) — edit on the investor’s Funds tab, then resolve this request.'
												: r.entity_type === 'investor_portfolio'
													? 'Portfolio change — review against the investor’s record and resolve manually.'
													: 'This request type can’t be auto-applied — review and resolve manually.'}
										</div>
									)}
								</>
							)}
						</div>
					</Modal>
				);
			})()}
		</div>
	);
}

