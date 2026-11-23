'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';
import { CalendarPlus, Coins, KeyRound, RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader, Section, StatCard } from '@/components/atoms';
import { StatStrip } from '@/components/filters';
import { UserSelectOne, UserMultiPicker } from '@/components/entity-pickers';

/**
 * Billing ▸ admin support tools. Three manual interventions plus a read-only
 * conversion funnel and the trial-expiry sweep.
 *
 * Schema note: trial state lives on `profile_subscriptions` (is_trial,
 * trial_started_at, trial_ends_at); only the tier (`user_type`) is on
 * `profiles`. Credit grants write the balance cache + an immutable ledger row.
 */
interface TrialGrantResponse { id: string; is_trial: boolean; trial_ends_at: string | null }
interface BulkCreditResponse { granted: number }
interface BulkGrantAccessResponse {
	results: Array<{ email: string; success: boolean; profile_id?: string; error?: string }>;
	summary: { total: number; succeeded: number; failed: number };
}

const Label = ({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) => (
	<div className="co-stat-label" style={{ marginBottom: 6, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
		<span>{children}</span>{aside && <span style={{ color: 'var(--fg-muted)' }}>{aside}</span>}
	</div>
);
const Hint = ({ children }: { children: React.ReactNode }) => (
	<p style={{ fontSize: 12.5, color: 'var(--fg-2)', margin: '0 0 16px', lineHeight: 1.5 }}>{children}</p>
);
const Code = ({ children }: { children: React.ReactNode }) => (
	<code style={{ background: 'var(--bg-2)', padding: '1px 5px', borderRadius: 4, fontSize: 11.5 }}>{children}</code>
);

export default function BillingAdminPage() {
	const [trialProfile, setTrialProfile] = useState('');
	const [trialDays, setTrialDays] = useState(14);

	const [bulkUsers, setBulkUsers] = useState<string[]>([]);
	const [bulkCredits, setBulkCredits] = useState(50);
	const [bulkReason, setBulkReason] = useState('');
	const [bulkExpiry, setBulkExpiry] = useState(0); // 0 = never expires

	const [accessEmails, setAccessEmails] = useState('');
	const [accessTier, setAccessTier] = useState<'raise' | 'scout'>('raise');
	const [accessDays, setAccessDays] = useState(30);
	const [accessReason, setAccessReason] = useState('');
	const [accessResults, setAccessResults] = useState<BulkGrantAccessResponse | null>(null);

	const [trialPending, setTrialPending] = useState(false);
	const [creditPending, setCreditPending] = useState(false);
	const [accessPending, setAccessPending] = useState(false);

	const grantTrial = async () => {
		setTrialPending(true);
		try {
			const res = await api<TrialGrantResponse>('POST', '/api/admin/billing/grant-trial', { profile_id: trialProfile.trim(), days: trialDays });
			const ends = res.trial_ends_at ? new Date(res.trial_ends_at).toLocaleDateString() : 'unknown';
			toast.success(`Trial extended — expires ${ends}`);
			setTrialProfile('');
		} catch (e) { toast.error((e as Error).message ?? 'Could not grant trial'); }
		finally { setTrialPending(false); }
	};

	const bulkCredit = async () => {
		setCreditPending(true);
		try {
			const res = await api<BulkCreditResponse>('POST', '/api/admin/billing/bulk-credit-grant', {
				// One wallet — `credit_type` on a grant only labels the ledger row.
				profile_ids: bulkUsers, credits: bulkCredits, credit_type: 'stx',
				reason: bulkReason || undefined,
				expires_in_days: bulkExpiry > 0 ? bulkExpiry : undefined,
			});
			toast.success(`Granted ${bulkCredits} STX credit(s) to ${res.granted} user(s)`);
			setBulkUsers([]);
		} catch (e) { toast.error((e as Error).message ?? 'Could not grant credits'); }
		finally { setCreditPending(false); }
	};

	const [trialEmails, setTrialEmails] = useState('');
	const [trialPlanKey, setTrialPlanKey] = useState('raise_yearly');
	const [bulkTrialDays, setBulkTrialDays] = useState(14);
	const [bulkTrialPending, setBulkTrialPending] = useState(false);
	const [bulkTrialResults, setBulkTrialResults] = useState<BulkGrantAccessResponse | null>(null);

	const parsedEmails = accessEmails.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);

	/**
	 * The bulk sibling of "Grant trial" above. Profile-only — it sets the tier
	 * and the trial window without creating a Stripe subscription, which is
	 * what you want for comped accounts and pilots.
	 */
	const bulkGrantTrial = async () => {
		const emails = trialEmails.split(/[\n,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);
		if (emails.length === 0) { toast.error('Add at least one email'); return; }
		setBulkTrialPending(true);
		try {
			const res = await api<BulkGrantAccessResponse>('POST', '/api/admin/billing/bulk-grant-trial', {
				emails, planKey: trialPlanKey, trialDays: bulkTrialDays,
			});
			setBulkTrialResults(res);
			toast.success(`Granted ${res.summary.succeeded}/${res.summary.total} trials`);
		} catch (e) { toast.error((e as Error).message ?? 'Could not grant trials'); }
		finally { setBulkTrialPending(false); }
	};

	const bulkGrantAccess = async () => {
		setAccessPending(true);
		try {
			const res = await api<BulkGrantAccessResponse>('POST', '/api/admin/billing/bulk-grant-access', {
				emails: parsedEmails.map((e) => e.toLowerCase()), tier: accessTier, days: accessDays,
				reason: accessReason.trim() || undefined,
			});
			setAccessResults(res);
			toast.success(`Granted ${res.summary.succeeded}/${res.summary.total} successfully`);
		} catch (e) { toast.error((e as Error).message ?? 'Could not grant access'); }
		finally { setAccessPending(false); }
	};

	return (
		<div>
			<PageHeader
				kicker="Billing · admin tools"
				title="Billing tools"
				subtitle="Manual support interventions — extend trials, comp access without Stripe, and drop credits into a user's ledger."
			/>

			<div className="grid-2" style={{ gap: 'var(--space-4)' }}>
				<Section title="Grant trial" meta="Extends a live admin grant or trial for one user">
					<Hint>
						New end date is <b>{trialDays} day{trialDays === 1 ? '' : 's'}</b> from now, or from the current
						trial end if it&apos;s later. Writes <Code>profile_subscriptions.trial_ends_at</Code> — the tier is
						left unchanged (use <b>Bulk grant access</b> to promote a tier). Refused for Explore users, Stripe
						payers and anyone with a permanent tier, since a trial window would make that tier expire.
					</Hint>
					<div style={{ marginBottom: 12 }}>
						<Label>User</Label>
						<UserSelectOne value={trialProfile} onChange={setTrialProfile} />
					</div>
					<div style={{ marginBottom: 16 }}>
						<Label>Trial length (days)</Label>
						<input className="search-input" type="number" min={1} max={365} style={{ width: '100%' }}
							value={trialDays} onChange={(e) => setTrialDays(Math.max(1, Math.min(365, Number(e.target.value) || 1)))} />
					</div>
					<button className="btn" disabled={!trialProfile.trim() || trialPending} onClick={() => void grantTrial()}>
						<CalendarPlus size={13} /> {trialPending ? 'Granting…' : `Grant ${trialDays}-day trial`}
					</button>

					<div style={{ marginTop: 20, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
						<Label>Bulk — by email</Label>
						<p style={{ fontSize: 12.5, color: 'var(--fg-2)', margin: '6px 0 10px', lineHeight: 1.5 }}>
							Sets the tier <i>and</i> the trial window for many accounts at once. Profile-only — no Stripe
							subscription is created, so this is the one for comps and pilots. Stripe payers and permanent
							tiers are skipped (a trial window would end them). One email per line.
						</p>
						<textarea
							className="search-input" rows={3} style={{ width: '100%', marginBottom: 10, fontFamily: 'var(--font-mono)', fontSize: 12 }}
							placeholder={'someone@example.com" + "'}
							value={trialEmails} onChange={(e) => setTrialEmails(e.target.value)}
						/>
						<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
							<div>
								<Label>Plan</Label>
								<select className="search-input" style={{ width: '100%' }} value={trialPlanKey} onChange={(e) => setTrialPlanKey(e.target.value)}>
									<option value="raise_yearly">Raise (yearly)</option>
									<option value="scout_yearly">Scout (yearly)</option>
								</select>
							</div>
							<div>
								<Label>Trial length (days)</Label>
								<input className="search-input" type="number" min={1} max={365} style={{ width: '100%' }}
									value={bulkTrialDays} onChange={(e) => setBulkTrialDays(Math.max(1, Math.min(365, Number(e.target.value) || 1)))} />
							</div>
						</div>
						<button className="btn" disabled={bulkTrialPending} onClick={() => void bulkGrantTrial()}>
							<CalendarPlus size={13} /> {bulkTrialPending ? 'Granting…' : 'Grant trials'}
						</button>
						{bulkTrialResults && (
							<div style={{ marginTop: 12, fontSize: 12, color: 'var(--fg-muted)' }}>
								{bulkTrialResults.summary.succeeded}/{bulkTrialResults.summary.total} succeeded
								{bulkTrialResults.summary.failed > 0 && ` · ${bulkTrialResults.summary.failed} failed`}
								{bulkTrialResults.results.filter((r) => !r.success).map((r) => (
									<div key={r.email} style={{ color: 'var(--neg)', marginTop: 4 }}>✗ {r.email} — {r.error ?? 'failed'}</div>
								))}
							</div>
						)}
					</div>
				</Section>

				<Section title="Bulk credit grant" meta="Non-expiring top-up unless an expiry is set">
					<Hint>
						Adds credits to each selected user&apos;s balance and appends an <Code>adjustment</Code> row to
						<Code>credit_transactions</Code>. Balances update instantly.
					</Hint>
					<div style={{ marginBottom: 12 }}>
						<Label aside={`${bulkUsers.length} selected`}>Users</Label>
						<UserMultiPicker value={bulkUsers} onChange={setBulkUsers} />
					</div>
					<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
						<div>
							<Label>Credits / user</Label>
							<input className="search-input" type="number" min={1} style={{ width: '100%' }}
								value={bulkCredits} onChange={(e) => setBulkCredits(Math.max(1, Number(e.target.value) || 1))} />
						</div>
					</div>
					<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
						<div>
							<Label>Expires in (days)</Label>
							<input className="search-input" type="number" min={0} style={{ width: '100%' }} placeholder="0 = never"
								value={bulkExpiry} onChange={(e) => setBulkExpiry(Math.max(0, Number(e.target.value) || 0))} />
						</div>
						<div>
							<Label>Reason (shows in ledger)</Label>
							<input className="search-input" style={{ width: '100%' }} placeholder="e.g. apology — sev-2 outage"
								value={bulkReason} onChange={(e) => setBulkReason(e.target.value)} />
						</div>
					</div>
					<button className="btn" disabled={bulkUsers.length === 0 || creditPending} onClick={() => void bulkCredit()}>
						<Coins size={13} /> {creditPending ? 'Granting…' : `Grant ${bulkCredits} STX credit${bulkCredits === 1 ? '' : 's'} × ${bulkUsers.length}`}
					</button>
				</Section>
			</div>

			<div style={{ marginTop: 'var(--space-4)' }}>
				<Section title="Bulk grant access" meta="Time-bounded tier promotion — no Stripe subscription created">
					<Hint>
						Sets <Code>profiles.user_type</Code> to the tier and starts a trial window on
						<Code>profile_subscriptions</Code> (<Code>is_trial</Code>, <Code>trial_ends_at = now() + N days</Code>).
						The hourly trial-expiry job downgrades back to Explore when the window passes — unless the user pays via Stripe in the meantime.
					</Hint>
					<div style={{ marginBottom: 12 }}>
						<Label aside={`${parsedEmails.length} parsed`}>Emails — one per line, or comma separated</Label>
						<textarea className="search-input" style={{ width: '100%', minHeight: 96, fontFamily: 'var(--font-mono)', fontSize: 12, resize: 'vertical' }}
							placeholder={'alice@example.com\nbob@example.com'} value={accessEmails} onChange={(e) => setAccessEmails(e.target.value)} />
					</div>
					<div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12, marginBottom: 16 }}>
						<div>
							<Label>Tier</Label>
							<div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
								{([['raise', 'Raise'], ['scout', 'Scout']] as const).map(([v, label]) => (
									<button key={v} type="button" className={`chip ${accessTier === v ? 'on' : ''}`} onClick={() => setAccessTier(v)}>{label}</button>
								))}
							</div>
						</div>
						<div>
							<Label>Days</Label>
							<input className="search-input" type="number" min={1} max={3650} style={{ width: '100%' }}
								value={accessDays} onChange={(e) => setAccessDays(Math.max(1, Math.min(3650, Number(e.target.value) || 1)))} />
						</div>
						<div>
							<Label>Reason (optional)</Label>
							<input className="search-input" style={{ width: '100%' }} placeholder="e.g. partner program · Q2"
								value={accessReason} onChange={(e) => setAccessReason(e.target.value)} />
						</div>
					</div>
					<button className="btn" disabled={parsedEmails.length === 0 || accessPending} onClick={() => void bulkGrantAccess()}>
						<KeyRound size={13} /> {accessPending ? 'Granting…' : `Grant ${accessTier} for ${accessDays}d × ${parsedEmails.length}`}
					</button>

					{accessResults && (
						<div style={{ marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
							<div style={{ fontSize: 12, color: 'var(--fg-muted)', marginBottom: 8 }}>
								{accessResults.summary.succeeded}/{accessResults.summary.total} succeeded · {accessResults.summary.failed} failed
							</div>
							<div style={{ maxHeight: 220, overflow: 'auto', fontSize: 11.5, fontFamily: 'var(--font-mono)', display: 'grid', gap: 2 }}>
								{accessResults.results.map((r, i) => (
									<div key={i} style={{ display: 'flex', gap: 8, padding: '3px 6px', borderRadius: 4, background: 'var(--bg-2)', color: r.success ? 'var(--fg-2)' : 'var(--neg)' }}>
										<span style={{ width: 14 }}>{r.success ? '✓' : '✗'}</span>
										<span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.email}</span>
										<span style={{ color: 'var(--fg-muted)' }}>{r.success ? (r.profile_id?.slice(0, 8) ?? '') : (r.error ?? 'failed')}</span>
									</div>
								))}
							</div>
						</div>
					)}
				</Section>
			</div>

			<OpsAndFunnel />
		</div>
	);
}

interface ResyncResult { email: string; result: unknown }

/** The endpoint returns whatever the sync produced, per email — show its status. */
function summarise(result: unknown): string {
	if (result && typeof result === 'object') {
		const r = result as { status?: unknown; message?: unknown };
		if (typeof r.status === 'string') return r.message ? `${r.status}: ${String(r.message)}` : r.status;
	}
	return 'done';
}

interface Funnel {
	overall: { total: number; ever_trialed: number; paid: number; free_to_trial_pct: number; trial_to_paid_pct: number
	paid_from_trial?: number;
	paid_direct?: number;
};
	by_plan: Array<{ tier: string | null; trialing: number; paid: number }>;
}

/** DB-side conversion funnel (per plan) + manually running the trial-expiry sweep. */
function OpsAndFunnel() {
	const { data, isLoading, mutate } = useSWR<Funnel>(['/api/admin/billing/conversion-funnel'], { dedupingInterval: 60_000 });
	const [running, setRunning] = useState(false);
	const [resyncEmails, setResyncEmails] = useState('');
	const [resyncing, setResyncing] = useState(false);
	const [resyncOut, setResyncOut] = useState<ResyncResult[] | null>(null);

	/**
	 * The "customer paid but their tier is wrong" fix. Pulls every Stripe
	 * subscription for each customer and runs it through the same upsert the
	 * webhook uses, deactivating rows Stripe no longer acknowledges. Takes
	 * emails because that is what an operator has in front of them.
	 */
	const resync = async () => {
		const emails = resyncEmails.split(/[\n,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);
		if (emails.length === 0) { toast.error('Add at least one email'); return; }
		setResyncing(true);
		try {
			const res = await api<ResyncResult[]>('POST', '/api/admin/billing/resync-subscriptions', { emails });
			setResyncOut(res);
			toast.success(`Resynced ${res.length} account(s)`);
		} catch (e) { toast.error((e as Error).message ?? 'Could not resync'); }
		finally { setResyncing(false); }
	};
	const runSweep = async () => {
		setRunning(true);
		try { await api('POST', '/api/admin/billing/run-trial-expiry'); toast.success('Trial-expiry sweep queued'); }
		catch (e) { toast.error((e as Error).message); } finally { setRunning(false); }
	};
	const o = data?.overall;
	return (
		<div style={{ marginTop: 'var(--space-5)' }}>
			<StatStrip cols={4}>
				<StatCard label="Users" loading={isLoading} value={(o?.total ?? 0).toLocaleString()} />
				<StatCard label="Free → trial" loading={isLoading} value={`${(o?.free_to_trial_pct ?? 0).toFixed(1)}%`} sub={`${(o?.ever_trialed ?? 0).toLocaleString()} ever trialed`} />
				<StatCard label="Trial → paid" loading={isLoading} value={`${(o?.trial_to_paid_pct ?? 0).toFixed(1)}%`} tone="green" />
				<StatCard label="Paying" loading={isLoading} value={(o?.paid ?? 0).toLocaleString()} tone="brand" />
			</StatStrip>

			<div className="grid-2" style={{ gap: 'var(--space-4)' }}>
				<Section title="Conversion by plan" meta="Trialing vs paying, per tier" action={<button className="btn ghost" onClick={() => void mutate()}>Refresh</button>}>
					<table className="data-table">
						<thead><tr><th>Plan tier</th><th style={{ textAlign: 'right' }}>Trialing</th><th style={{ textAlign: 'right' }}>Paying</th></tr></thead>
						<tbody>
							{(data?.by_plan ?? []).map((r) => (
								<tr key={r.tier ?? '—'}>
									<td style={{ textTransform: 'capitalize' }}>{r.tier ?? '—'}</td>
									<td className="num" style={{ textAlign: 'right' }}>{r.trialing.toLocaleString()}</td>
									<td className="num" style={{ textAlign: 'right' }}>{r.paid.toLocaleString()}</td>
								</tr>
							))}
							{(data?.by_plan?.length ?? 0) === 0 && <tr><td colSpan={3} style={{ color: 'var(--fg-muted)' }}>No paid or trialing users yet.</td></tr>}
						</tbody>
					</table>
				</Section>

				<Section title="Ops" meta="Safety net for missed webhooks">
					<p style={{ fontSize: 12.5, color: 'var(--fg-2)', margin: '0 0 14px', lineHeight: 1.5 }}>
						Trials expire automatically every hour. Run the sweep now to immediately downgrade anyone whose
						trial window has already passed.
					</p>
					<button className="btn" disabled={running} onClick={() => void runSweep()}>
						<RefreshCw size={13} /> {running ? 'Queuing…' : 'Run trial-expiry sweep'}
					</button>

					<div style={{ marginTop: 20, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
						<Label>Resync subscriptions from Stripe</Label>
						<p style={{ fontSize: 12.5, color: 'var(--fg-2)', margin: '6px 0 10px', lineHeight: 1.5 }}>
							For &ldquo;they paid but their tier is wrong&rdquo;. Re-reads Stripe and replays it through the
							webhook&apos;s own upsert. One email per line, up to 50.
						</p>
						<textarea
							className="search-input" rows={3} style={{ width: '100%', marginBottom: 10, fontFamily: 'var(--font-mono)', fontSize: 12 }}
							placeholder={'someone@example.com\nanother@example.com'}
							value={resyncEmails} onChange={(e) => setResyncEmails(e.target.value)}
						/>
						<button className="btn" disabled={resyncing} onClick={() => void resync()}>
							<RefreshCw size={13} /> {resyncing ? 'Resyncing…' : 'Resync from Stripe'}
						</button>
						{resyncOut && (
							<div style={{ marginTop: 12, maxHeight: 200, overflow: 'auto', fontSize: 11.5, fontFamily: 'var(--font-mono)', display: 'grid', gap: 2 }}>
								{resyncOut.map((r, i) => (
									<div key={i} style={{ display: 'flex', gap: 8, padding: '3px 6px', borderRadius: 4, background: 'var(--bg-2)' }}>
										<span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.email}</span>
										<span style={{ color: 'var(--fg-muted)' }}>{summarise(r.result)}</span>
									</div>
								))}
							</div>
						)}
					</div>
				</Section>
			</div>
		</div>
	);
}
