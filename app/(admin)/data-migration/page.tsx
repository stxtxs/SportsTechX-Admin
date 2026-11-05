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
interface UnresolvedDeal { name: string; website: string; date: string | null; amount_usd: number | null; round: string | null; country: string | null }
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
type Decision = 'pending' | 'same' | 'separate';
interface Review { entity: string; source_id: string; target_id: string | null; match_key: string; source: Snap; target: Snap | null; decision: Decision; decided_by: string | null; decided_at: string | null }
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
const WHY: Record<string, string> = { name: 'Same name, different or missing website', duplicate_source: 'Two old records share this one (same website)' };
// Deals and acquisitions match on their own keys, not a website (pipeline/entities/{deals,acquisitions}.ts).
const WHY_BY_ENTITY: Record<string, string> = {
	deals: 'Two old deals match this one (same company, round and date)',
	acquisitions: 'Two old acquisitions match this one (same companies, year and amount)',
};
const why = (r: { entity: string; match_key: string }) => (r.match_key === 'duplicate_source' && WHY_BY_ENTITY[r.entity]) || WHY[r.match_key] || r.match_key;
/** What each answer does, per reason — mirrors server/scripts/migration/pipeline/upsert.ts. */
const EFFECT: Record<string, { same: string; diff: string }> = {
	name: { same: 'Links them. The old record fills empty fields here and never overwrites what Atlas has.', diff: 'Adds it to Atlas as a new record.' },
	duplicate_source: { same: 'It’s a duplicate. Nothing is added.', diff: 'Adds it to Atlas as its own record.' },
};
const EFFECT_FALLBACK = { same: 'Treats them as one record.', diff: 'Adds it to Atlas as a new record.' };
const effect = (r: { entity: string; match_key: string }) => {
	const fx = EFFECT[r.match_key] ?? EFFECT_FALLBACK;
	// A website belongs to one company only, so the new one is added without it (upsert.ts).
	return r.entity === 'companies' && r.match_key === 'duplicate_source' ? { ...fx, diff: 'Adds it as a new company, without the shared website (it stays with the one here).' } : fx;
};
// A deal's "name" is its company, so a deal links to the company page.
const atlasHref = (entity: string, id: string, t: Snap) =>
	entity === 'companies' ? `${ATLAS}/companies/${t.slug ?? id}` : entity === 'investors' ? `${ATLAS}/investors/${t.slug ?? id}`
		: entity === 'deals' && t.slug ? `${ATLAS}/companies/${t.slug}` : null;
const Hint = ({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) => (
	<p style={{ fontSize: 12.5, color: 'var(--fg-2)', margin: '0 0 12px', lineHeight: 1.5, ...style }}>{children}</p>
);

/** One side of a possible duplicate: just what tells two records apart. */
function SnapCell({ s, href }: { s: Snap | null; href?: string | null }) {
	if (!s) return <em style={{ color: 'var(--fg-muted)' }}>record no longer exists</em>;
	return (
		<div style={{ maxWidth: 340 }}>
			<div style={{ fontWeight: 600 }}>{href ? <a href={href} target="_blank" rel="noopener noreferrer">{s.name ?? '—'}</a> : s.name ?? '—'}</div>
			<div style={{ fontSize: 11.5, color: 'var(--fg-muted)' }}>
				{[s.website, s.founded_year && `founded ${s.founded_year}`, s.status && s.status !== 'active' && s.status].filter(Boolean).join(' · ') || 'no website'}
			</div>
			{s.description && <div style={{ fontSize: 11.5, color: 'var(--fg-2)', marginTop: 4, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{s.description}</div>}
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
			await Promise.all([reviews.mutate(), status.mutate()]);
			toast.success(decision === 'same' ? 'Marked as the same record' : decision === 'separate' ? 'Marked as a different record' : 'Back to pending');
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
										<option value="same">Marked same</option>
										<option value="separate">Marked different</option>
									</select>
								</div>
							}
							padded={false}
						>
							<Hint style={{ margin: '0 16px 6px' }}>
								Each row is a record from the old system that might already be in Atlas. Until someone answers, it’s kept out of Atlas.
								Answers take effect at the <b>next sync</b>, which the dev team runs; until then you can <b>Undo</b>. Each row says what its buttons will do.
							</Hint>
							<details style={{ margin: '0 16px 12px', fontSize: 12.5, color: 'var(--fg-2)', lineHeight: 1.55 }}>
								<summary style={{ cursor: 'pointer', color: 'var(--fg)' }}>How to decide</summary>
								<ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
									<li><b>Same</b> when it’s clearly one thing: the same organisation under a slightly different name or website, matching founded year or description. Where the name on the right is a link, open it to see the record in Atlas.</li>
									<li><b>Different</b> when they’re separate things that happen to share a website. Two events by one organiser, or two funds of one firm, are different.</li>
									<li>Deals and acquisitions: <b>Same</b> only if it’s the same company, round and date.</li>
									<li>Not sure? Skip it. A wrong <b>Different</b> creates a duplicate someone has to delete; a skipped row costs nothing.</li>
								</ul>
							</details>
							<AsyncState loading={reviews.isLoading} error={reviews.error} empty={shown.length === 0} emptyMsg={view === 'pending' ? 'Nothing to verify' : 'None yet'} onRetry={() => void reviews.mutate()}>
								<table className="data-table">
									<thead><tr><th>Old system</th><th>Already here</th><th>Why flagged</th><th /></tr></thead>
									<tbody>
										{shown.map((r) => {
											const k = `r${r.entity}${r.source_id}`;
											const fx = effect(r);
											return (
												<tr key={`${r.entity}|${r.source_id}`}>
													<td><div style={{ fontSize: 10.5, color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{ENTITY_LABEL[r.entity] ?? r.entity}</div><SnapCell s={r.source} /></td>
													<td><SnapCell s={r.target} href={r.target && r.target_id ? atlasHref(r.entity, r.target_id, r.target) : null} /></td>
													<td style={{ fontSize: 12, color: 'var(--fg-2)', maxWidth: 240 }}>
														{why(r)}
														{view === 'pending' && (
															<div style={{ fontSize: 11.5, color: 'var(--fg-muted)', marginTop: 6, lineHeight: 1.45 }}>
																<div><b>Same:</b> {fx.same}</div>
																<div><b>Different:</b> {fx.diff}</div>
															</div>
														)}
														{r.decided_by && <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 4 }}>{r.decided_by} · {when(r.decided_at)}</div>}
													</td>
													<td style={{ whiteSpace: 'nowrap' }}>
														{view === 'pending' ? (
															<>
																<button className="btn ghost" disabled={busy === k || !r.target} onClick={() => void decide(r, 'same')} title={r.target ? `Same: ${fx.same}` : 'The record here no longer exists'}>Same</button>{' '}
																<button className="btn ghost" disabled={busy === k} onClick={() => void decide(r, 'separate')} title={`Different: ${fx.diff}`}>Different</button>
															</>
														) : (
															<button className="btn ghost" disabled={busy === k} onClick={() => void decide(r, 'pending')} title="Moves it back to “To verify”. Only matters before the next sync applies the answer.">Undo</button>
														)}
													</td>
												</tr>
											);
										})}
									</tbody>
								</table>
							</AsyncState>
						</Section>

						{(() => {
							// From the newest catalog run that recorded them (dry runs record them too).
							const run = (status.data?.runs ?? []).find((r) => Array.isArray(r.summary?.unresolved_deals));
							const rows = run?.summary?.unresolved_deals ?? [];
							if (!run) return null;
							return (
								<Section title="Deals waiting for a company" meta={`${rows.length} · from the ${when(run.started_at)} sync`} padded={false}>
									<p style={{ fontSize: 12.5, color: 'var(--fg-2)', margin: 'var(--space-3) var(--space-4)', lineHeight: 1.5 }}>
										These old deals are not in Atlas because their company is missing, or exists under a different website. To bring one over, open <b>Companies</b>: either create the company with the website shown, or set the existing company&apos;s website to it. The next sync then adds the deal on its own. You can also add the deal by hand on the company.
									</p>
									<table className="data-table">
										<thead><tr><th>Company (old name)</th><th>Website on the deal</th><th>Date</th><th>Round</th><th>Amount</th><th>Country</th></tr></thead>
										<tbody>
											{rows.map((d, i) => (
												<tr key={`${d.website}-${d.date}-${i}`}>
													<td>{d.name || '—'}</td>
													<td style={{ fontSize: 12 }}>{d.website || <span style={{ color: 'var(--fg-muted)' }}>none on the old deal</span>}</td>
													<td style={{ whiteSpace: 'nowrap', fontSize: 12 }}>{d.date ? d.date.slice(0, 10) : '—'}</td>
													<td style={{ fontSize: 12 }}>{d.round ?? '—'}</td>
													<td style={{ whiteSpace: 'nowrap' }}>{d.amount_usd ? `$${(d.amount_usd / 1e6).toFixed(1)}M` : 'Undisclosed'}</td>
													<td style={{ fontSize: 12 }}>{d.country ?? '—'}</td>
												</tr>
											))}
											{rows.length === 0 && <tr><td colSpan={6} style={{ color: 'var(--fg-muted)' }}>Every old deal has a company in Atlas.</td></tr>}
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
