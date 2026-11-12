'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { PageHeader, AsyncState, Section } from '@/components/atoms';

/**
 * Old → new data migration. While both systems run, the pipeline
 * (server/scripts/migration/pipeline) re-syncs the old database into this one:
 * old-side edits flow across, new-side edits are never overwritten, and a field
 * changed on both sides lands here as a conflict (the new value stays until an
 * admin chooses). The cutover phase tracks the move off the old system.
 */
type Phase = 'dual_running' | 'old_frozen' | 'final_sync' | 'verified' | 'complete';
interface TableRow { table_name: string; mode: 'dry_run' | 'apply'; started_at: string; extract_at: string | null; inserted: number; updated: number; skipped: number; reviewed: number; conflicts: number }
interface UnresolvedDeal { source_id?: string; name: string; website: string; date: string | null; amount_usd: number | null; round: string | null; country: string | null;
	/** An Atlas deal this one may already be (server: GET admin/migration/unresolved-deals). */
	in_atlas?: { company: string; slug: string | null; date: string; amount_usd: number | null; by: 'name' | 'amount' } | null }
interface Run { id: string; kind: string; mode: string; status: string; started_at: string; finished_at: string | null; extract_at: string | null; summary?: { unresolved_deals?: UnresolvedDeal[] } | null }
interface Status {
	ready: boolean;
	cutover?: { phase: Phase; frozen_at: string | null; verified_at: string | null; notes: string | null; updated_at: string; updated_by: string | null };
	runs?: Run[];
	tables?: TableRow[];
	conflicts?: { entity: string; open: number }[];
	reviews?: { entity: string; pending: number; total: number }[];
}
interface Snap { name?: string | null; website?: string | null; linkedin_url?: string | null; founded_year?: number | null; description?: string | null; status?: string | null; slug?: string | null }
type Decision = 'pending' | 'same' | 'separate' | 'use_old' | 'discard';
interface Review {
	entity: string; source_id: string; target_id: string | null; match_key: string; source: Snap; target: Snap | null;
	decision: Decision; decided_by: string | null; decided_at: string | null;
	/** The Atlas record's editable fields, raw — pre-fills the row's inputs. */
	editable?: Record<string, unknown> | null;
}
interface Conflict { id: number; entity: string; target_id: string; label: string | null; col: string; base_value: unknown; old_value: unknown; new_value: unknown; created_at: string }

const PHASES: { key: Phase; label: string; hint: string }[] = [
	{ key: 'dual_running', label: 'Both systems live', hint: 'Re-sync as often as needed.' },
	{ key: 'old_frozen', label: 'Old system frozen', hint: 'Signups and edits stopped on the old system.' },
	{ key: 'final_sync', label: 'Final sync', hint: 'Last extract taken after the freeze, synced and applied.' },
	{ key: 'verified', label: 'Verified', hint: 'Cutover check passed: nothing left to move, no open conflicts.' },
	{ key: 'complete', label: 'Complete', hint: 'The old database is retired.' },
];

const ATLAS = process.env.NEXT_PUBLIC_ATLAS_URL ?? 'https://www.atlas.sportstechx.com';
const ENTITY_LABEL: Record<string, string> = { companies: 'Company', investors: 'Investor', ecosystem_entities: 'Ecosystem', deals: 'Deal', acquisitions: 'Acquisition' };
const WHY: Record<string, string> = { name: 'Same name, different or missing website', duplicate_source: 'Two old records share this one (same website)', no_company: 'Deal waiting for a company' };
// Deals and acquisitions match on their own keys, not a website (pipeline/entities/{deals,acquisitions}.ts).
const WHY_BY_ENTITY: Record<string, string> = {
	deals: 'Two old deals match this one (same company, round and date)',
	acquisitions: 'Two old acquisitions match this one (same companies, year and amount)',
};
const why = (r: { entity: string; match_key: string }) => (r.match_key === 'duplicate_source' && WHY_BY_ENTITY[r.entity]) || WHY[r.match_key] || r.match_key;
/**
 * The two answers, named by what they do. Underneath they are still 'same' and
 * 'separate'; the effects mirror server/scripts/migration/pipeline/upsert.ts:
 * a "same" never overwrites a value Atlas has (it can only fill an empty one,
 * and a disagreement is raised as a conflict), and when two old rows point at
 * one Atlas record the old row is simply dropped.
 */
interface Choice { label: string; result: string }
const CHOICES: Record<string, { same: Choice; diff: Choice }> = {
	name: {
		same: { label: 'Same — link to Atlas', result: 'Treated as the Atlas record. It only fills fields that are empty in Atlas, never changes them.' },
		diff: { label: 'Add as new record', result: 'Added to Atlas as a separate record.' },
	},
	duplicate_source: {
		same: { label: 'Keep Atlas only', result: 'Keeps the Atlas record and its values. The old one is not added.' },
		diff: { label: 'Add as new record', result: 'Added to Atlas as a separate record, next to this one.' },
	},
};
const CHOICE_FALLBACK = { same: { label: 'Same — keep Atlas', result: 'Treated as the Atlas record; Atlas values are kept.' }, diff: { label: 'Add as new record', result: 'Added to Atlas as a separate record.' } };
const choices = (r: { entity: string; match_key: string }) => {
	const c = CHOICES[r.match_key] ?? CHOICE_FALLBACK;
	// A website belongs to one company only, so the new one is added without it (upsert.ts).
	return r.entity === 'companies' && r.match_key === 'duplicate_source'
		? { ...c, diff: { ...c.diff, result: 'Added as a new company, without the shared website (it stays with the Atlas one).' } } : c;
};
/** The third answer: the old record is the right one. Same link as "same", but its
 *  values are written over Atlas's (pipeline/upsert.ts, decision 'use_old'). */
const USE_OLD: Choice = {
	label: 'Use old record',
	result: 'The old record is right: its values replace the Atlas record’s at the next sync (a field it leaves empty keeps Atlas’s). Same Atlas record, so its links stay.',
};
/** The way out: the old record is wrong or unwanted, so it is dropped from the migration
 *  (pipeline/upsert.ts skips it on every sync). Atlas is left exactly as it is. */
const DISCARD: Choice = {
	label: 'Discard old record',
	result: 'Dropped from the migration: never added to Atlas or linked, and later syncs skip it. Atlas stays as it is.',
};
const DECIDED_LABEL = (r: Review) => (r.decision === 'same' ? choices(r).same.label : r.decision === 'use_old' ? USE_OLD.label : r.decision === 'discard' ? 'Discarded' : choices(r).diff.label);
// A deal's "name" is its company, so a deal links to the company page.
const atlasHref = (entity: string, id: string, t: Snap) =>
	entity === 'companies' ? `${ATLAS}/companies/${t.slug ?? id}` : entity === 'investors' ? `${ATLAS}/investors/${t.slug ?? id}`
		: entity === 'deals' && t.slug ? `${ATLAS}/companies/${t.slug}` : null;
const Hint = ({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) => (
	<p style={{ fontSize: 12.5, color: 'var(--fg-2)', margin: '0 0 12px', lineHeight: 1.5, ...style }}>{children}</p>
);

/** The fields that tell two records apart, labelled. A deal's or acquisition's
 *  details line ("round · date · amount") is split so each part compares. */
const DETAIL_LABELS: Record<string, string[]> = { deals: ['Round', 'Date', 'Amount'], acquisitions: ['Date', 'Amount'] };
function fieldsOf(entity: string, s: Snap | null): [string, string][] {
	if (!s) return [];
	const out: [string, string][] = [['Name', s.name ?? ''], ['Website', s.website ?? s.linkedin_url ?? '']];
	const labels = DETAIL_LABELS[entity];
	if (labels) {
		// Parts are recognised, not counted: a missing one (often the amount) is
		// simply absent from the line, so it shows as empty on that side.
		const parts = (s.description ?? '').split(' · ').filter(Boolean);
		const kind = (v: string) => (v.startsWith('$') ? 'Amount' : /^\d{4}(-\d{2}){0,2}$/.test(v) ? 'Date' : 'Round');
		for (const l of labels) out.push([l, parts.find((v) => kind(v) === l) ?? '']);
	} else {
		if (s.founded_year) out.push(['Founded', String(s.founded_year)]);
		if (s.status && s.status !== 'active') out.push(['Status', s.status]);
		if (s.description) out.push(['About', s.description]);
	}
	return out;
}
const norm = (v: string) => v.trim().toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');

/** One side of the comparison; a value that differs from the other side is highlighted. */
function CompareSide({ title, entity, s, other, href, emptyMsg = 'This record no longer exists in Atlas.' }: { title: string; entity: string; s: Snap | null; other: Snap | null; href?: string | null; emptyMsg?: string }) {
	const theirs = new Map(fieldsOf(entity, other));
	return (
		<div style={{ flex: '1 1 260px', minWidth: 0, background: 'var(--bg-2)', border: '1px solid var(--border)', padding: '10px 12px' }}>
			<div style={{ fontSize: 10.5, color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>{title}</div>
			{!s ? <em style={{ color: 'var(--fg-muted)', fontSize: 12.5 }}>{emptyMsg}</em> : (
				<dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '3px 10px', margin: 0, fontSize: 12.5 }}>
					{fieldsOf(entity, s).map(([label, value]) => {
						const diff = other != null && theirs.has(label) && norm(theirs.get(label) ?? '') !== norm(value);
						const isName = label === 'Name';
						return (
							<div key={label} style={{ display: 'contents' }}>
								<dt style={{ color: 'var(--fg-muted)' }}>{label}</dt>
								<dd style={{ margin: 0, minWidth: 0, overflowWrap: 'anywhere', fontWeight: isName ? 600 : 400, color: diff ? 'var(--warn)' : undefined, ...(label === 'About' ? { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' } : {}) }}
									title={diff ? 'Differs from the other side' : undefined}>
									{isName && href ? <a href={href} target="_blank" rel="noopener noreferrer">{value || '—'}</a> : value || <em style={{ color: 'var(--fg-muted)' }}>empty</em>}
									{diff && <span style={{ fontSize: 10.5, marginLeft: 6, fontWeight: 600 }}>differs</span>}
								</dd>
							</div>
						);
					})}
				</dl>
			)}
		</div>
	);
}

function DiscardButton({ disabled, onClick }: { disabled: boolean; onClick: () => void }) {
	return (
		<div>
			<button className="btn ghost" style={{ width: '100%', color: 'var(--danger, #dc2626)' }} disabled={disabled} onClick={onClick}>{DISCARD.label}</button>
			<div style={{ fontSize: 11.5, color: 'var(--fg-muted)', marginTop: 3, lineHeight: 1.4 }}>{DISCARD.result}</div>
		</div>
	);
}

/** The Atlas fields an admin can type into from a review row (server: EDITABLE in admin-migration.controller.ts). */
type EditKind = 'text' | 'long' | 'year' | 'date' | 'money' | 'round';
const EDIT_FIELDS: Record<string, { col: string; label: string; kind: EditKind }[]> = {
	companies: [{ col: 'name', label: 'Name', kind: 'text' }, { col: 'website', label: 'Website', kind: 'text' }, { col: 'founded_year', label: 'Founded', kind: 'year' }, { col: 'description', label: 'About', kind: 'long' }],
	investors: [{ col: 'name', label: 'Name', kind: 'text' }, { col: 'website', label: 'Website', kind: 'text' }, { col: 'year_launched', label: 'Launched', kind: 'year' }, { col: 'description', label: 'About', kind: 'long' }],
	ecosystem_entities: [{ col: 'name', label: 'Name', kind: 'text' }, { col: 'website', label: 'Website', kind: 'text' }, { col: 'founded_year', label: 'Founded', kind: 'year' }, { col: 'description', label: 'About', kind: 'long' }],
	deals: [{ col: 'round_type_id', label: 'Round', kind: 'round' }, { col: 'announced_date', label: 'Date', kind: 'date' }, { col: 'amount_usd', label: 'Amount (USD)', kind: 'money' }],
	acquisitions: [{ col: 'acquisition_date', label: 'Date', kind: 'date' }, { col: 'acquisition_year', label: 'Year', kind: 'year' }, { col: 'amount_usd', label: 'Amount (USD)', kind: 'money' }],
};

/**
 * Type the right values straight into the Atlas record. Pre-filled with what
 * Atlas holds now; saving writes the changed fields immediately and answers the
 * item "same", so the next sync only links the old record and never overwrites
 * what was typed. The buttons beside it stay as one-click answers.
 */
function EditAtlas({ r, onSaved }: { r: Review; onSaved: () => Promise<unknown> }) {
	const fields = EDIT_FIELDS[r.entity] ?? [];
	const initial: Record<string, string> = Object.fromEntries(fields.map((f) => [f.col, r.editable?.[f.col] == null ? '' : String(r.editable[f.col])]));
	const [vals, setVals] = useState(initial);
	const [saving, setSaving] = useState(false);
	const rounds = useSWR<{ id: string; name: string }[]>(fields.some((f) => f.kind === 'round') ? '/api/round-types' : null);
	if (!fields.length) return null;
	const changed = fields.filter((f) => vals[f.col] !== initial[f.col]);
	const set = (col: string, v: string) => setVals((p) => ({ ...p, [col]: v }));
	const save = async () => {
		setSaving(true);
		try {
			const values = Object.fromEntries(changed.map((f) => [f.col, vals[f.col].trim() === '' ? null : vals[f.col]]));
			await api('POST', '/api/admin/migration/reviews/save', { entity: r.entity, source_id: r.source_id, values });
			toast.success('Saved to Atlas');
			await onSaved();
		} catch (e) { toast.error((e as Error).message); } finally { setSaving(false); }
	};
	const label: React.CSSProperties = { display: 'grid', gap: 3, fontSize: 11.5, color: 'var(--fg-muted)', minWidth: 0 };
	return (
		<div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed var(--border)' }}>
			<div style={{ fontSize: 10.5, color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Edit the Atlas record</div>
			<div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }}>
				{fields.map((f) => (
					<label key={f.col} style={{ ...label, ...(f.kind === 'long' ? { gridColumn: '1 / -1' } : {}) }}>
						{f.label}
						{f.kind === 'round' ? (
							<select className="search-input" value={vals[f.col]} onChange={(e) => set(f.col, e.target.value)}>
								<option value="">—</option>
								{(rounds.data ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
							</select>
						) : f.kind === 'long' ? (
							<textarea className="search-input" rows={3} value={vals[f.col]} onChange={(e) => set(f.col, e.target.value)} style={{ resize: 'vertical', height: 'auto' }} />
						) : (
							<input
								className="search-input"
								// Text, not type=number: a number input reads "1,000,000" as '' and the
								// save would clear the field. The server strips $ and commas itself.
								type={f.kind === 'date' ? 'date' : 'text'}
								inputMode={f.kind === 'money' ? 'decimal' : f.kind === 'year' ? 'numeric' : undefined}
								value={vals[f.col]}
								onChange={(e) => set(f.col, e.target.value)}
							/>
						)}
					</label>
				))}
			</div>
			<div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
				<button className="btn" disabled={saving || changed.length === 0} onClick={() => void save()}>{saving ? 'Saving…' : 'Save to Atlas'}</button>
				{changed.length > 0 && <button className="btn ghost" disabled={saving} onClick={() => setVals(initial)}>Reset</button>}
				<span style={{ fontSize: 11.5, color: 'var(--fg-muted)', lineHeight: 1.4 }}>
					{changed.length
						? `Writes ${changed.length} field${changed.length > 1 ? 's' : ''} to the Atlas record now and answers “same”: the next sync only links the old record and never overwrites what you typed.`
						: 'Change any field to correct the Atlas record directly.'}
				</span>
			</div>
		</div>
	);
}

const when = (s: string | null | undefined) => (s ? new Date(s).toLocaleString() : '—');
const show = (v: unknown) => (v === null || v === undefined || v === '' ? <em style={{ color: 'var(--fg-muted)' }}>empty</em> : typeof v === 'object' ? JSON.stringify(v) : String(v));

export default function DataMigrationPage() {
	const status = useSWR<Status>('/api/admin/migration/status');
	const conflicts = useSWR<Conflict[]>(status.data?.ready ? '/api/admin/migration/conflicts' : null);
	const [busy, setBusy] = useState<string | null>(null);
	const [view, setView] = useState<Decision>('pending');
	const [entity, setEntity] = useState('');
	const reviews = useSWR<Review[]>(status.data?.ready ? `/api/admin/migration/reviews?decision=${view}` : null);
	const shown = (reviews.data ?? []).filter((r) => !entity || r.entity === entity);
	const waiting = useSWR<{ run_at: string | null; rows: UnresolvedDeal[] }>(status.data?.ready ? '/api/admin/migration/unresolved-deals' : null);

	const tables = status.data?.tables ?? [];
	const byTable = new Map<string, { dry?: TableRow; apply?: TableRow }>();
	for (const t of tables) byTable.set(t.table_name, { ...byTable.get(t.table_name), [t.mode === 'apply' ? 'apply' : 'dry']: t });
	const openBy = new Map((status.data?.conflicts ?? []).map((c) => [c.entity, c.open]));
	const phase = status.data?.cutover?.phase ?? 'dual_running';

	const setPhase = async (next: Phase) => {
		setBusy('phase');
		try {
			await api('POST', '/api/admin/migration/cutover', { phase: next });
			await status.mutate();
			toast.success('Cutover phase updated');
		} catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
	};
	const resolve = async (id: number, action: 'use_old' | 'keep_new') => {
		setBusy(`c${id}`);
		try {
			await api('POST', `/api/admin/migration/conflicts/${id}/resolve`, { action });
			await Promise.all([conflicts.mutate(), status.mutate()]);
			toast.success(action === 'use_old' ? 'Old value applied' : 'Kept the new value');
		} catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
	};

	const decide = async (r: Review, decision: Decision) => {
		setBusy(`r${r.entity}${r.source_id}`);
		try {
			await api('POST', '/api/admin/migration/reviews/decide', { entity: r.entity, source_id: r.source_id, decision });
			await Promise.all([reviews.mutate(), status.mutate(), waiting.mutate()]);
			toast.success(decision === 'same' ? 'Marked as the same record' : decision === 'use_old' ? 'The old record will replace the Atlas values' : decision === 'separate' ? 'Marked as a different record' : decision === 'discard' ? 'Discarded. Undo it under “Answered: discarded”.' : 'Back to pending');
		} catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
	};
	const discardDeal = async (d: UnresolvedDeal) => {
		if (!d.source_id) return;
		setBusy(`d${d.source_id}`);
		try {
			await api('POST', '/api/admin/migration/unresolved-deals/discard', { source_id: d.source_id });
			await Promise.all([waiting.mutate(), reviews.mutate()]);
			toast.success('Discarded. Undo it under Possible duplicates → “Answered: discarded”.');
		} catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
	};
	const pendingBy = status.data?.reviews ?? [];

	return (
		<>
			<PageHeader kicker="System" title="Data migration" subtitle="Moving data from the old system into this one while both run. Old-side edits sync across; changes made here are never overwritten." />
			<AsyncState loading={status.isLoading} error={status.error} onRetry={() => void status.mutate()}>
				{status.data && !status.data.ready ? (
					<Section title="Not set up yet">
						<p style={{ fontSize: 13, color: 'var(--fg-2)' }}>The migration tracking tables don’t exist yet. Apply migration <code>20261030102851_migration_tracking</code> (<code>npx supabase db push</code> in <code>server/</code>).</p>
					</Section>
				) : (
					<>
						<div style={{ border: '1px solid var(--border)', background: 'var(--bg-2)', borderRadius: 8, padding: '12px 16px', marginBottom: 'var(--space-4)', fontSize: 13, lineHeight: 1.55 }}>
							<b>What you need to do here:</b> answer the <b>Possible duplicates</b> below, and any <b>Conflicts</b> if they appear. Each row says what its buttons do.
							If you’re not sure about a row, leave it. The record simply stays out of Atlas, and nothing breaks.
							Cutover, Tables and Runs are the dev team’s; there’s nothing there for you to click.
						</div>

						<Section title="Cutover" meta={PHASES.find((p) => p.key === phase)?.label}>
							<Hint>Dev team only. These steps record how far the switch-off from the old system has got. Marking a step doesn’t run or change anything by itself.</Hint>
							<ol style={{ display: 'flex', gap: 8, flexWrap: 'wrap', listStyle: 'none', padding: 0, margin: 0 }}>
								{PHASES.map((p, i) => {
									const idx = PHASES.findIndex((x) => x.key === phase);
									return (
										<li key={p.key} style={{ flex: '1 1 160px', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', background: i === idx ? 'var(--bg-3)' : 'var(--bg-1)', opacity: i > idx ? 0.6 : 1 }}>
											<div style={{ fontSize: 12, fontWeight: 700 }}>{i + 1}. {p.label}{i < idx ? ' ✓' : ''}</div>
											<div style={{ fontSize: 11.5, color: 'var(--fg-muted)', marginTop: 4 }}>{p.hint}</div>
											{i === idx + 1 && (
												<button className="btn ghost" style={{ marginTop: 8, fontSize: 12 }} disabled={busy === 'phase'} onClick={() => void setPhase(p.key)} title="Dev team only: records that this step is done. Runs nothing.">Mark as reached</button>
											)}
										</li>
									);
								})}
							</ol>
							<div style={{ fontSize: 11, color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)', marginTop: 10 }}>
								updated {when(status.data?.cutover?.updated_at)}{status.data?.cutover?.updated_by ? ` by ${status.data.cutover.updated_by}` : ''}
								{status.data?.cutover?.frozen_at ? ` · frozen ${when(status.data.cutover.frozen_at)}` : ''}
							</div>
						</Section>

						<Section title="Tables" meta="Read-only · latest apply vs latest dry run" padded={false}>
							<table className="data-table">
								<thead><tr><th>Table</th><th>Status</th><th>Last applied</th><th>Applied +new / ~updated</th><th>Last dry run</th><th>Pending +new / ~updated</th><th>Open conflicts</th></tr></thead>
								<tbody>
									{[...byTable.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, t]) => {
										const pendingRun = t.dry && (!t.apply || t.dry.started_at > t.apply.started_at) ? t.dry : undefined;
										const pending = pendingRun ? pendingRun.inserted + pendingRun.updated : 0;
										const open = openBy.get(name) ?? 0;
										const state = open ? 'Conflicts to review' : pending ? 'Behind' : 'In sync';
										const color = open ? 'var(--warn, #d97706)' : pending ? 'var(--accent)' : 'var(--success, #16a34a)';
										return (
											<tr key={name}>
												<td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{name}</td>
												<td><span className="tag" style={{ color }}>{state}</span></td>
												<td>{when(t.apply?.started_at)}</td>
												<td>{t.apply ? `+${t.apply.inserted} / ~${t.apply.updated}` : '—'}</td>
												<td>{when(t.dry?.started_at)}</td>
												<td>{pendingRun ? `+${pendingRun.inserted} / ~${pendingRun.updated}` : '0'}</td>
												<td>{open || '—'}</td>
											</tr>
										);
									})}
									{byTable.size === 0 && <tr><td colSpan={7} style={{ color: 'var(--fg-muted)' }}>No sync runs recorded yet.</td></tr>}
								</tbody>
							</table>
						</Section>

						<Section title="Conflicts" meta="Changed on both sides — the new value is kept until you choose" padded={false}>
							{(conflicts.data ?? []).length > 0 && (
								<Hint style={{ margin: '0 16px 10px' }}>
									Someone edited this field in both systems since the last sync. Atlas shows <b>This system now</b>.{' '}
									<b>Use old</b> replaces it with the old system’s value right away. <b>Keep new</b> keeps what Atlas has and closes the conflict.
								</Hint>
							)}
							<AsyncState loading={conflicts.isLoading} error={conflicts.error} empty={(conflicts.data ?? []).length === 0} emptyMsg="No open conflicts" onRetry={() => void conflicts.mutate()}>
								<table className="data-table">
									<thead><tr><th>Record</th><th>Field</th><th>Was</th><th>Old system now</th><th>This system now</th><th /></tr></thead>
									<tbody>
										{(conflicts.data ?? []).map((k) => (
											<tr key={k.id}>
												<td><div style={{ fontWeight: 600 }}>{k.label ?? k.target_id}</div><div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{k.entity}</div></td>
												<td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{k.col}</td>
												<td style={{ maxWidth: 220 }}>{show(k.base_value)}</td>
												<td style={{ maxWidth: 220 }}>{show(k.old_value)}</td>
												<td style={{ maxWidth: 220 }}>{show(k.new_value)}</td>
												<td style={{ whiteSpace: 'nowrap' }}>
													{/* A tier isn't a column to copy back — it's set (with its end date) on the Users page. */}
													{k.entity === 'profile_tier'
														? <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>Set the tier in Users, then </span>
														: <button className="btn ghost" disabled={busy === `c${k.id}`} onClick={() => void resolve(k.id, 'use_old')} title="Writes the old system’s value into Atlas now">Use old</button>}{' '}
													<button className="btn ghost" disabled={busy === `c${k.id}`} onClick={() => void resolve(k.id, 'keep_new')} title="Keeps Atlas’s value and closes this conflict">Keep new</button>
												</td>
											</tr>
										))}
									</tbody>
								</table>
							</AsyncState>
						</Section>

						<Section
							title="Possible duplicates"
							meta={`${pendingBy.reduce((n, r) => n + r.pending, 0)} to verify — the next sync applies your answers`}
							action={
								<div style={{ display: 'flex', gap: 6 }}>
									<select className="search-input" value={entity} onChange={(e) => setEntity(e.target.value)} aria-label="Record type">
										<option value="">All types</option>
										{pendingBy.map((r) => <option key={r.entity} value={r.entity}>{ENTITY_LABEL[r.entity] ?? r.entity} ({r.pending})</option>)}
									</select>
									<select className="search-input" value={view} onChange={(e) => setView(e.target.value as Decision)} aria-label="Show">
										<option value="pending">To verify</option>
										<option value="same">Answered: same / keep Atlas</option>
										<option value="use_old">Answered: use old record</option>
										<option value="separate">Answered: add as new</option>
										<option value="discard">Answered: discarded</option>
									</select>
								</div>
							}
							padded={false}
						>
							<div style={{ margin: '0 16px 12px', padding: '10px 12px', background: 'var(--bg-2)', border: '1px solid var(--border)', fontSize: 12.5, color: 'var(--fg-2)', lineHeight: 1.55 }}>
								<div style={{ color: 'var(--fg)', fontWeight: 600, marginBottom: 4 }}>Is the old record the same thing as the one in Atlas?</div>
								<div>• Differences are highlighted. If <b>Atlas</b> has the right values, choose <b>Keep Atlas only</b> / <b>Same</b>. If the <b>old record</b> is right, choose <b>Use old record</b>: its values replace Atlas’s.</div>
								<div>• <b>Add as new record</b> only when they are genuinely two things (two funds of one firm, two different rounds). Deals: same company, round and date means the same deal.</div>
								<div>• The old record is wrong or unwanted? <b>Discard old record</b>: it is dropped from the migration for good, and Atlas stays as it is.</div>
								<div>• Not sure? Leave it: it stays out of Atlas. Answers apply at the next sync (run by the dev team); until then you can <b>Undo</b>.</div>
							</div>
							<AsyncState loading={reviews.isLoading} error={reviews.error} empty={shown.length === 0} emptyMsg={view === 'pending' ? 'Nothing to verify' : 'None yet'} onRetry={() => void reviews.mutate()}>
								<div style={{ display: 'grid', gap: 10, padding: '0 16px 16px' }}>
									{shown.map((r) => {
										const k = `r${r.entity}${r.source_id}`;
										const c = choices(r);
										return (
											<div key={`${r.entity}|${r.source_id}`} style={{ border: '1px solid var(--border)', padding: 12 }}>
												<div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8, fontSize: 12 }}>
													<span className="tag">{ENTITY_LABEL[r.entity] ?? r.entity}</span>
													<span style={{ color: 'var(--fg-2)' }}>{why(r)}</span>
													{r.decided_by && <span style={{ color: 'var(--fg-muted)', marginLeft: 'auto' }}>{DECIDED_LABEL(r)} · {r.decided_by} · {when(r.decided_at)}</span>}
												</div>
												<div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'stretch' }}>
													<CompareSide title="Old system" entity={r.entity} s={r.source} other={r.target} />
													<CompareSide title="In Atlas" entity={r.entity} s={r.target} other={r.source} href={r.target && r.target_id ? atlasHref(r.entity, r.target_id, r.target) : null}
														emptyMsg={r.match_key === 'no_company' ? 'Not in Atlas: its company is missing.' : undefined} />
													<div style={{ flex: '0 1 230px', display: 'grid', gap: 8, alignContent: 'start' }}>
														{view === 'pending' ? (
															<>
																<div>
																	<button className="btn" style={{ width: '100%' }} disabled={busy === k || !r.target} onClick={() => void decide(r, 'same')}>{c.same.label}</button>
																	<div style={{ fontSize: 11.5, color: 'var(--fg-muted)', marginTop: 3, lineHeight: 1.4 }}>{r.target ? c.same.result : 'Not possible: the Atlas record no longer exists.'}</div>
																</div>
																<div>
																	<button className="btn ghost" style={{ width: '100%' }} disabled={busy === k || !r.target} onClick={() => void decide(r, 'use_old')}>{USE_OLD.label}</button>
																	<div style={{ fontSize: 11.5, color: 'var(--fg-muted)', marginTop: 3, lineHeight: 1.4 }}>{r.target ? USE_OLD.result : 'Not possible: the Atlas record no longer exists.'}</div>
																</div>
																<div>
																	<button className="btn ghost" style={{ width: '100%' }} disabled={busy === k} onClick={() => void decide(r, 'separate')}>{c.diff.label}</button>
																	<div style={{ fontSize: 11.5, color: 'var(--fg-muted)', marginTop: 3, lineHeight: 1.4 }}>{c.diff.result}</div>
																</div>
																<DiscardButton disabled={busy === k} onClick={() => void decide(r, 'discard')} />
															</>
														) : (
															<>
																<div>
																	<button className="btn ghost" style={{ width: '100%' }} disabled={busy === k} onClick={() => void decide(r, 'pending')}>Undo</button>
																	<div style={{ fontSize: 11.5, color: 'var(--fg-muted)', marginTop: 3, lineHeight: 1.4 }}>
																		{r.match_key === 'no_company' ? 'Puts it back on “Deals waiting for a company”.' : 'Moves it back to “To verify”. Only matters before the next sync applies it.'}
																	</div>
																</div>
																{view !== 'discard' && <DiscardButton disabled={busy === k} onClick={() => void decide(r, 'discard')} />}
															</>
														)}
													</div>
												</div>
												{view === 'pending' && r.target && r.editable && <EditAtlas key={`${r.entity}|${r.source_id}|${JSON.stringify(r.editable)}`} r={r} onSaved={() => Promise.all([reviews.mutate(), status.mutate()])} />}
											</div>
										);
									})}
								</div>
							</AsyncState>
						</Section>

						{waiting.data?.run_at && (() => {
							const rows = waiting.data.rows;
							return (
								<Section title="Deals waiting for a company" meta={`${rows.length} · from the ${when(waiting.data.run_at)} sync`} padded={false}>
									<p style={{ fontSize: 12.5, color: 'var(--fg-2)', margin: 'var(--space-3) var(--space-4)', lineHeight: 1.5 }}>
										These old deals are not in Atlas because their company is missing, or exists under a different website. To bring one over, open <b>Companies</b>: either create the company with the website shown, or set the existing company&apos;s website to it. The next sync then adds the deal on its own. You can also add the deal by hand on the company.
										{' '}<b>Already in Atlas?</b> points at an Atlas deal that looks like the same one (a renamed company, a new website). If it is, or the old deal is wrong, <b>Discard</b> it: it leaves this list and is never added.
									</p>
									<table className="data-table">
										<thead><tr><th>Company (old name)</th><th>Website on the deal</th><th>Date</th><th>Round</th><th>Amount</th><th>Country</th><th>Already in Atlas?</th><th /></tr></thead>
										<tbody>
											{rows.map((d, i) => (
												<tr key={d.source_id ?? `${d.website}-${d.date}-${i}`}>
													<td>{d.name || '—'}</td>
													<td style={{ fontSize: 12 }}>{d.website || <span style={{ color: 'var(--fg-muted)' }}>none on the old deal</span>}</td>
													<td style={{ whiteSpace: 'nowrap', fontSize: 12 }}>{d.date ? d.date.slice(0, 10) : '—'}</td>
													<td style={{ fontSize: 12 }}>{d.round ?? '—'}</td>
													<td style={{ whiteSpace: 'nowrap' }}>{d.amount_usd ? `$${(Number(d.amount_usd) / 1e6).toFixed(1)}M` : 'Undisclosed'}</td>
													<td style={{ fontSize: 12 }}>{d.country ?? '—'}</td>
													<td style={{ fontSize: 12 }}>
														{d.in_atlas ? (
															<span title={d.in_atlas.by === 'name' ? 'Same company name, within a month' : 'Different company name, same date and amount: check it is the same company'}>
																{d.in_atlas.by === 'name' ? 'Likely: ' : 'Maybe: '}
																{d.in_atlas.slug ? <a href={`${ATLAS}/companies/${d.in_atlas.slug}`} target="_blank" rel="noopener noreferrer">{d.in_atlas.company}</a> : d.in_atlas.company}
																{' · '}{String(d.in_atlas.date).slice(0, 10)}{' · '}{Number(d.in_atlas.amount_usd) > 0 ? `$${(Number(d.in_atlas.amount_usd) / 1e6).toFixed(1)}M` : 'Undisclosed'}
															</span>
														) : <span style={{ color: 'var(--fg-muted)' }}>No</span>}
													</td>
													<td>{d.source_id && <button className="btn ghost" disabled={busy === `d${d.source_id}`} onClick={() => void discardDeal(d)} title={DISCARD.result}>Discard</button>}</td>
												</tr>
											))}
											{rows.length === 0 && <tr><td colSpan={8} style={{ color: 'var(--fg-muted)' }}>Every old deal has a company in Atlas.</td></tr>}
										</tbody>
									</table>
								</Section>
							);
						})()}

						<Section title="Runs" meta="Read-only · most recent 30" padded={false}>
							<table className="data-table">
								<thead><tr><th>Started</th><th>What</th><th>Mode</th><th>Result</th><th>Old snapshot</th></tr></thead>
								<tbody>
									{(status.data?.runs ?? []).map((r) => (
										<tr key={r.id}>
											<td>{when(r.started_at)}</td>
											<td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{r.kind}</td>
											<td>{r.mode === 'apply' ? 'Applied' : 'Dry run'}</td>
											<td>{r.status === 'committed' ? 'Committed' : r.status === 'rolled_back' ? 'Dry run (nothing written)' : r.status}</td>
											<td>{when(r.extract_at)}</td>
										</tr>
									))}
								</tbody>
							</table>
						</Section>
					</>
				)}
			</AsyncState>
		</>
	);
}
