'use client';

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import useSWRInfinite from 'swr/infinite';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Select } from '@/components/select';
import { Section, PillTabs } from '@/components/atoms';
import { SignInLinkSection } from './account-access';
import { AdminActivityTable } from '@/components/admin-activity';

/** Minimal user shape the manage panel needs. */
export interface ManageUser { id: string; user_type: string | null; email?: string | null }

interface GrantRow {
	id: string;
	feature_slug: string;
	expires_at: string | null;
	revoked_at: string | null;
	reason: string | null;
	created_at: string;
}
interface FeatureCatalogRow { id: string; slug: string; name: string }

const MANAGE_TABS = ['Access', 'Billing & credits', 'Personalization', 'History'] as const;
type ManageTab = (typeof MANAGE_TABS)[number];

/**
 * Per-user management panel — used both inline-expanded in the list and on the
 * standalone /users/[id] details page. Grouped into focused tabs.
 */
export function ManagePanel({ user }: { user: ManageUser }) {
	const [tab, setTab] = useState<ManageTab>('Access');
	return (
		<div style={{ display: 'grid', gap: 'var(--space-4)' }}>
			<PillTabs tabs={MANAGE_TABS} value={tab} onChange={setTab} />

			{tab === 'Access' && (
				<div style={{ display: 'grid', gap: 'var(--space-4)' }}>
					<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--space-4)' }}>
						<TierChangeSection user={user} />
						<GrantAccessSection profileId={user.id} />
						<FeatureGrantsSection profileId={user.id} />
					</div>
					<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 2fr', gap: 'var(--space-4)' }}>
						<SignInLinkSection profileId={user.id} email={user.email ?? null} />
						<PlaymakersSection profileId={user.id} />
						<AccessControlSection profileId={user.id} />
					</div>
					<AdminNoteSection profileId={user.id} />
				</div>
			)}

			{tab === 'Billing & credits' && (
				<div style={{ display: 'grid', gap: 'var(--space-4)' }}>
					<CreditBalancesSection profileId={user.id} />
					<CreditLedgerSection profileId={user.id} />
					<BillingSection profileId={user.id} />
					<CreditGrantSection profileId={user.id} />
				</div>
			)}

			{tab === 'Personalization' && <PersonalizationSection profileId={user.id} />}

			{tab === 'History' && (
				<Section title="Admin actions on this user" meta="since 18 Nov 2026">
					<AdminActivityTable filter={{ target: user.id }} />
				</Section>
			)}
		</div>
	);
}

interface AdminCreditPool { monthly_balance: number; topup_balance: number; total_available: number; monthly_grant: number }
interface AdminCredits { ai: AdminCreditPool; integration: AdminCreditPool }

/** Live credit balances for both pools — so admins can SEE what a user has. */
function CreditBalancesSection({ profileId }: { profileId: string }) {
	const { data, isLoading } = useSWR<AdminCredits>([`/api/admin/users/${profileId}/credits`], { dedupingInterval: 15_000 });
	const pool = (label: string, p?: AdminCreditPool) => (
		<div className="card" style={{ padding: 'var(--space-4)' }}>
			<div className="co-stat-label">{label}</div>
			<div style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 800, lineHeight: 1.1, marginTop: 4 }}>
				{isLoading ? '…' : (p?.total_available ?? 0).toLocaleString()}
			</div>
			<div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 6 }}>
				{(p?.monthly_balance ?? 0).toLocaleString()} / {(p?.monthly_grant ?? 0).toLocaleString()} monthly
				{(p?.topup_balance ?? 0) > 0 ? ` · +${(p!.topup_balance).toLocaleString()} top-up` : ''}
			</div>
		</div>
	);
	return (
		<Section title="Credit balances" meta="live · AI + export (integration) pools">
			<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
				{pool('AI credits', data?.ai)}
				{pool('Export credits', data?.integration)}
			</div>
		</Section>
	);
}

interface AdminLedgerRow {
	id: string; credit_type: string; transaction_type: string; amount: number; balance_after: number;
	description: string | null; operation_key: string | null; display_name: string | null; occurred_at: string;
}
interface AdminLedgerPage { data: AdminLedgerRow[]; nextCursor: string | null }

const LEDGER_TXN_LABEL: Record<string, string> = {
	monthly_grant: 'Monthly grant', topup_purchase: 'Top-up', refund: 'Refund',
	expiry: 'Expired', adjustment: 'Adjustment', spend: 'Usage',
};
function ledgerLabel(r: AdminLedgerRow): string {
	const d = r.description?.trim();
	if (d && /\s/.test(d)) return d;
	if (r.display_name) return r.display_name;
	if (d) return d.replace(/^ai\./, '').replace(/[._]/g, ' ');
	return LEDGER_TXN_LABEL[r.transaction_type] ?? r.transaction_type;
}
function fmtLedgerWhen(iso: string): string {
	const dt = new Date(iso);
	return Number.isNaN(dt.getTime()) ? '' : dt.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
// Spend CATEGORY, not a pool. One balance funds everything; the ledger still
// records what each spend was for, so filtering the history stays useful.
const LEDGER_FILTERS: Array<{ k: 'all' | 'ai' | 'integration' | 'stx'; label: string }> = [
	{ k: 'all', label: 'All' }, { k: 'ai', label: 'AI' }, { k: 'integration', label: 'Export' }, { k: 'stx', label: 'Other' },
];

/** Itemized credit-spend history for this user (every spend, grant & refund). */
function CreditLedgerSection({ profileId }: { profileId: string }) {
	const [type, setType] = useState<'all' | 'ai' | 'integration' | 'stx'>('all');
	const getKey = (index: number, prev: AdminLedgerPage | null) => {
		if (prev && !prev.nextCursor) return null;
		const cursor = index === 0 ? undefined : (prev?.nextCursor ?? undefined);
		return [`/api/admin/users/${profileId}/ledger`, { type, cursor, limit: 25 }];
	};
	const { data, size, setSize, isLoading, isValidating } = useSWRInfinite<AdminLedgerPage>(getKey, { revalidateFirstPage: false });
	useEffect(() => { setSize(1); }, [type, setSize]);
	const rows = data ? data.flatMap((p) => p.data) : [];
	const hasMore = Boolean(data?.[data.length - 1]?.nextCursor);
	const loadingMore = isValidating && size > (data?.length ?? 0);

	return (
		<Section
			title="Credit activity"
			meta="every spend, grant & refund"
			action={
				<div style={{ display: 'flex', gap: 4 }}>
					{LEDGER_FILTERS.map((f) => (
						<button
							key={f.k}
							className="btn ghost"
							style={{ height: 26, padding: '0 10px', fontSize: 12, borderBottom: type === f.k ? '2px solid var(--accent)' : '2px solid transparent', color: type === f.k ? 'var(--fg)' : 'var(--fg-muted)' }}
							onClick={() => setType(f.k)}
						>
							{f.label}
						</button>
					))}
				</div>
			}
		>
			{isLoading && rows.length === 0 ? (
				<div style={{ padding: 16, color: 'var(--fg-muted)', fontSize: 13 }}>Loading…</div>
			) : rows.length === 0 ? (
				<div style={{ padding: 16, color: 'var(--fg-muted)', fontSize: 13 }}>No credit activity.</div>
			) : (
				<div className="table-scroll">
					<table className="data-table">
						<thead>
							<tr>
								<th>When</th><th>Pool</th><th>Activity</th>
								<th style={{ textAlign: 'right' }}>Amount</th><th style={{ textAlign: 'right' }}>Balance</th>
							</tr>
						</thead>
						<tbody>
							{rows.map((r) => {
								const spend = r.amount < 0;
								return (
									<tr key={r.id}>
										<td style={{ whiteSpace: 'nowrap', color: 'var(--fg-muted)', fontSize: 12 }}>{fmtLedgerWhen(r.occurred_at)}</td>
										<td>{r.credit_type === 'ai' ? 'AI' : 'Export'}</td>
										<td>{ledgerLabel(r)}{r.transaction_type !== 'spend' ? ` (${LEDGER_TXN_LABEL[r.transaction_type] ?? r.transaction_type})` : ''}</td>
										<td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 700, color: spend ? 'var(--neg)' : 'var(--pos)' }}>{spend ? '' : '+'}{r.amount.toLocaleString()}</td>
										<td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--fg-muted)' }}>{r.balance_after.toLocaleString()}</td>
									</tr>
								);
							})}
						</tbody>
					</table>
					{hasMore && (
						<div style={{ display: 'flex', justifyContent: 'center', padding: 12 }}>
							<button className="btn ghost" disabled={loadingMore} onClick={() => setSize(size + 1)}>{loadingMore ? 'Loading…' : 'Load more'}</button>
						</div>
					)}
				</div>
			)}
		</Section>
	);
}

/**
 * Grant extra non-expiring STX credits to this user.
 *
 * There is one wallet — AI features and exports draw on the same balance — so
 * the old AI/Export picker chose a ledger label, not a destination: whichever
 * you picked, the credits landed in the same pool, and the panel above then
 * displayed them under the other name.
 */
function CreditGrantSection({ profileId }: { profileId: string }) {
	const [amount, setAmount] = useState('');
	const [pending, setPending] = useState(false);
	const { mutate } = useSWRConfig();
	const grant = async () => {
		const n = Number(amount);
		if (!Number.isFinite(n) || n < 1) { toast.error('Enter a positive amount'); return; }
		setPending(true);
		try {
			await api('POST', '/api/admin/billing/bulk-credit-grant', { profile_ids: [profileId], credits: Math.floor(n), credit_type: 'stx' });
			toast.success(`Granted ${Math.floor(n).toLocaleString()} STX credits`);
			setAmount('');
			void mutate([`/api/admin/users/${profileId}/credits`]);
		} catch (e) { toast.error((e as Error).message); }
		finally { setPending(false); }
	};
	return (
		<Section title="Grant credits" meta="non-expiring top-up · used after monthly plan credits">
			<div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
				<input className="search-input" type="number" min="1" step="1" style={{ height: 32, width: 140 }} placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
				<button className="btn" disabled={pending} onClick={() => void grant()}>Grant</button>
			</div>
		</Section>
	);
}

interface PersonalizationProfile {
	interests: { sectors: string[]; sports: string[]; regions: string[]; topics: string[]; tech_tags: string[]; intents: string[]; entity_interests: string[] };
	summary: string | null;
	metrics: { engagement_level: string; chat_signals: number; search_signals: number; total_signals: number; top_terms: Array<{ term: string; count: number }>; last_signal_at: string | null };
	last_analyzed_at: string | null;
}

function PersonalizationSection({ profileId }: { profileId: string }) {
	const { data, isLoading } = useSWR<{ profile: PersonalizationProfile | null }>(
		[`/api/admin/users/${profileId}/personalization`], { dedupingInterval: 30_000 },
	);
	const p = data?.profile;
	const chips = (label: string, items: string[]) => items.length > 0 && (
		<div style={{ marginBottom: 6 }}>
			<span style={{ fontSize: 11, color: 'var(--fg-muted)', marginRight: 6 }}>{label}</span>
			{items.map((t) => <span key={t} className="chip" style={{ marginRight: 4 }}>{t}</span>)}
		</div>
	);
	return (
		<Section title="Personalization" meta="AI-derived interests + metrics · read-only">
			{isLoading ? <div style={{ color: 'var(--fg-muted)', fontSize: 13 }}>Loading…</div>
				: !p ? <div style={{ color: 'var(--fg-muted)', fontSize: 13 }}>No personalization yet — builds as the user uses chat + search.</div>
				: (
					<div>
						{p.summary && <p style={{ fontSize: 13, color: 'var(--fg-2)', margin: '0 0 10px' }}>{p.summary}</p>}
						{chips('Sectors', p.interests.sectors)}
						{chips('Sports', p.interests.sports)}
						{chips('Topics', p.interests.topics)}
						{chips('Tech', p.interests.tech_tags)}
						{chips('Regions', p.interests.regions)}
						{chips('Intents', p.interests.intents)}
						{chips('Entities', p.interests.entity_interests)}
						<div style={{ display: 'flex', gap: 16, marginTop: 10, fontSize: 12, color: 'var(--fg-muted)' }}>
							<span>Engagement: <b style={{ color: 'var(--fg-2)' }}>{p.metrics.engagement_level}</b></span>
							<span>Signals: {p.metrics.total_signals} ({p.metrics.chat_signals} chat / {p.metrics.search_signals} search)</span>
							{p.metrics.last_signal_at && <span>Last: {new Date(p.metrics.last_signal_at).toLocaleDateString()}</span>}
						</div>
						{p.metrics.top_terms.length > 0 && (
							<div style={{ marginTop: 8 }}>
								<span style={{ fontSize: 11, color: 'var(--fg-muted)', marginRight: 6 }}>Top terms</span>
								{p.metrics.top_terms.map((t) => <span key={t.term} className="chip" style={{ marginRight: 4 }}>{t.term} · {t.count}</span>)}
							</div>
						)}
					</div>
				)}
		</Section>
	);
}

interface BillingDetail {
	local: {
		stripe_customer_id: string | null; stripe_subscription_id: string | null;
		active_subscription: boolean; is_trial: boolean; trial_ends_at: string | null;
		expires_at: string | null; subscription_started_at: string | null;
	} | null;
	stripe: {
		status?: string; cancel_at_period_end?: boolean; current_period_end?: string | null;
		has_scheduled_change?: boolean; price_nickname?: string | null; amount?: number | null;
		currency?: string | null; interval?: string | null; error?: string;
	} | null;
}

function BillingSection({ profileId }: { profileId: string }) {
	const { data, isLoading } = useSWR<BillingDetail>([`/api/admin/users/${profileId}/billing`], { dedupingInterval: 30_000 });
	const l = data?.local; const s = data?.stripe;
	const fmt = (d?: string | null) => (d ? new Date(d).toLocaleDateString() : '—');
	const cell = (label: string, value: ReactNode) => (
		<div><div className="co-stat-label">{label}</div><div style={{ fontSize: 13 }}>{value}</div></div>
	);
	const pending = s?.cancel_at_period_end ? 'Cancels at period end' : s?.has_scheduled_change ? 'Plan change scheduled' : '—';
	return (
		<div className="card" style={{ padding: 'var(--space-4)' }}>
			<div className="co-stat-label" style={{ marginBottom: 10 }}>Billing</div>
			{isLoading ? (
				<div style={{ fontSize: 13, color: 'var(--fg-muted)' }}>Loading…</div>
			) : !l ? (
				<div style={{ fontSize: 13, color: 'var(--fg-muted)' }}>No subscription record.</div>
			) : (
				<div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
					{cell('Plan status', l.active_subscription ? (l.is_trial ? 'Trial' : 'Active') : 'Inactive')}
					{cell('Renews / expires', fmt(s?.current_period_end ?? l.expires_at))}
					{cell('Trial ends', fmt(l.trial_ends_at))}
					{cell('Pending change', <span style={{ color: pending === '—' ? 'var(--fg)' : 'var(--accent)', fontWeight: pending === '—' ? 400 : 600 }}>{pending}</span>)}
					{cell('Stripe plan', s?.price_nickname ?? (s?.amount != null ? `${s.amount} ${(s.currency ?? '').toUpperCase()}/${s.interval ?? ''}` : '—'))}
					{cell('Stripe status', s?.status ?? '—')}
					{cell('Customer ID', <code style={{ fontSize: 11 }}>{l.stripe_customer_id ?? '—'}</code>)}
					{cell('Subscription ID', <code style={{ fontSize: 11 }}>{l.stripe_subscription_id ?? '—'}</code>)}
				</div>
			)}
			{s?.error && <div style={{ fontSize: 11, color: 'var(--accent)', marginTop: 8 }}>Stripe lookup: {s.error}</div>}
		</div>
	);
}

/** Playmakers membership label (profiles.playmakers). Tier, access and billing are untouched. */
/** Internal note admins keep on this user — never shown to the user. Saving is recorded in Admin activity. */
function AdminNoteSection({ profileId }: { profileId: string }) {
	const { data: u, mutate: refetch } = useSWR<{ admin_note?: string | null }>([`/api/admin/users/${profileId}`], { dedupingInterval: 15_000, revalidateOnFocus: false });
	const [note, setNote] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const saved = u?.admin_note ?? '';
	const value = note ?? saved;
	const save = async () => {
		setSaving(true);
		try {
			await api('PATCH', `/api/admin/users/${profileId}`, { admin_note: value.trim() || null });
			toast.success(value.trim() ? 'Note saved' : 'Note cleared');
			setNote(null);
			void refetch();
		} catch (e) { toast.error((e as Error).message); }
		finally { setSaving(false); }
	};
	return (
		<div className="card" style={{ padding: 'var(--space-4)' }}>
			<div className="co-stat-label" style={{ marginBottom: 10 }}>Admin note</div>
			<textarea className="search-input" style={{ width: '100%', minHeight: 80, resize: 'vertical', fontSize: 13 }} maxLength={4000}
				placeholder="Internal note about this user (e.g. why their tier was changed). Only admins see it."
				value={value} disabled={!u} onChange={(e) => setNote(e.target.value)} />
			<div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
				<button className="btn" disabled={saving || !u || value === saved} onClick={() => void save()}>{saving ? 'Saving…' : 'Save note'}</button>
				<span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>Admins only — never shown to the user.</span>
			</div>
		</div>
	);
}

function PlaymakersSection({ profileId }: { profileId: string }) {
	const { mutate } = useSWRConfig();
	const { data: u, mutate: refetch } = useSWR<{ playmakers?: boolean }>([`/api/admin/users/${profileId}`], { dedupingInterval: 15_000 });
	const [pending, setPending] = useState(false);
	const on = !!u?.playmakers;
	const toggle = async () => {
		setPending(true);
		try {
			await api('PATCH', `/api/admin/users/${profileId}`, { playmakers: !on });
			toast.success(on ? 'Removed from Playmakers' : 'Marked as Playmakers member');
			void refetch();
			void mutate((key) => Array.isArray(key) && key[0] === '/api/admin/users');
		} catch (e) { toast.error((e as Error).message); }
		finally { setPending(false); }
	};
	return (
		<div className="card" style={{ padding: 'var(--space-4)' }}>
			<div className="co-stat-label" style={{ marginBottom: 10 }}>Playmakers</div>
			<label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
				<input type="checkbox" checked={on} disabled={pending || !u} onChange={() => void toggle()} />
				Playmakers member
			</label>
			<div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 8 }}>
				Label only — does not change the tier, access or any subscription.
			</div>
		</div>
	);
}

function AccessControlSection({ profileId }: { profileId: string }) {
	const { mutate } = useSWRConfig();
	const { data: u, mutate: refetch } = useSWR<{ blocked_at?: string | null; blocked_reason?: string | null }>(
		[`/api/admin/users/${profileId}`], { dedupingInterval: 15_000 });
	const [busy, setBusy] = useState<'revoke' | 'block' | 'unblock' | null>(null);
	const blocked = !!u?.blocked_at;
	const refreshLists = () => mutate((key) => Array.isArray(key) && key[0] === '/api/admin/users');

	const revoke = async () => {
		if (!window.confirm('Revoke this user’s access now? Any Stripe subscription is cancelled immediately (no refund — refund separately in Stripe) and the account drops to Explore. Admin-granted access is cleared too.')) return;
		setBusy('revoke');
		try { await api('POST', `/api/admin/users/${profileId}/revoke-access`); toast.success('Access revoked'); void refetch(); refreshLists(); }
		catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
	};
	const block = async () => {
		const reason = window.prompt('Block (suspend) this account? All access is rejected until unblocked. Optional reason:') ?? undefined;
		if (reason === undefined) return; // cancelled
		setBusy('block');
		try { await api('POST', `/api/admin/users/${profileId}/block`, { reason: reason.trim() || undefined }); toast.success('Account blocked'); void refetch(); refreshLists(); }
		catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
	};
	const unblock = async () => {
		setBusy('unblock');
		try { await api('POST', `/api/admin/users/${profileId}/unblock`); toast.success('Account unblocked'); void refetch(); refreshLists(); }
		catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
	};

	return (
		<div className="card" style={{ padding: 'var(--space-4)', borderColor: 'color-mix(in oklch, var(--neg), transparent 55%)' }}>
			<div className="co-stat-label" style={{ marginBottom: 10, color: 'var(--neg)' }}>Access control</div>
			{blocked && (
				<div style={{ fontSize: 12, color: 'var(--neg)', marginBottom: 10 }}>
					⛔ Blocked{u?.blocked_reason ? ` — ${u.blocked_reason}` : ''}. All access is rejected until unblocked.
				</div>
			)}
			<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
				<button className="btn ghost" disabled={busy !== null} onClick={() => void revoke()}>
					{busy === 'revoke' ? 'Revoking…' : 'Revoke access (cancel subscription)'}
				</button>
				{blocked ? (
					<button className="btn" disabled={busy !== null} onClick={() => void unblock()}>{busy === 'unblock' ? 'Unblocking…' : 'Unblock account'}</button>
				) : (
					<button className="btn ghost" style={{ color: 'var(--neg)' }} disabled={busy !== null} onClick={() => void block()}>{busy === 'block' ? 'Blocking…' : 'Block account'}</button>
				)}
			</div>
			<div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 8 }}>
				<strong>Revoke</strong> = immediate downgrade to Explore (works for Stripe-paid and admin-granted; no refund — refund in Stripe separately).
				<strong> Block</strong> = suspend all access regardless of tier (even Explore).
			</div>
		</div>
	);
}

function TierChangeSection({ user }: { user: ManageUser }) {
	const { mutate } = useSWRConfig();
	const [tier, setTier] = useState(user.user_type ?? 'explore');
	const [pending, setPending] = useState(false);
	const update = async () => {
		setPending(true);
		try {
			await api('PATCH', `/api/admin/users/${user.id}`, { user_type: tier });
			toast.success('Tier updated');
			void mutate((key) => Array.isArray(key) && key[0] === '/api/admin/users');
		} catch (e) { toast.error((e as Error).message); }
		finally { setPending(false); }
	};
	return (
		<div>
			<div className="co-stat-label" style={{ marginBottom: 8 }}>Permanent tier</div>
			<Select value={tier} onChange={setTier} width="100%" style={{ display: 'block', width: '100%', marginBottom: 8 }} options={['explore', 'raise', 'scout'].map((t) => ({ value: t, label: t }))} />
			<button className="btn" disabled={pending || tier === user.user_type} onClick={() => void update()}>
				{pending ? 'Saving…' : 'Save tier'}
			</button>
		</div>
	);
}

function GrantAccessSection({ profileId }: { profileId: string }) {
	const { mutate } = useSWRConfig();
	const [tier, setTier] = useState<'general' | 'raise' | 'scout' | 'growth' | 'pro'>('raise');
	const [days, setDays] = useState(30);
	const [reason, setReason] = useState('');
	const [pending, setPending] = useState(false);
	const grant = async () => {
		setPending(true);
		try {
			await api('POST', '/api/admin/billing/grant-access', { profile_id: profileId, tier, days, reason: reason.trim() || undefined });
			toast.success(`Granted ${tier} for ${days} day${days === 1 ? '' : 's'}`);
			setReason('');
			void mutate((key) => Array.isArray(key) && key[0] === '/api/admin/users');
		} catch (e) { toast.error((e as Error).message); }
		finally { setPending(false); }
	};
	return (
		<div>
			<div className="co-stat-label" style={{ marginBottom: 8 }}>Grant time-bounded access</div>
			<div style={{ display: 'grid', gridTemplateColumns: '1fr 100px', gap: 6, marginBottom: 6 }}>
				<Select value={tier} onChange={(v) => setTier(v as 'general' | 'raise' | 'scout' | 'growth' | 'pro')} width="100%" style={{ display: 'block', width: '100%' }} options={[{ value: 'general', label: 'General' }, { value: 'raise', label: 'Raise' }, { value: 'scout', label: 'Scout' }, { value: 'growth', label: 'Growth (legacy)' }, { value: 'pro', label: 'Pro (legacy)' }]} />
				<input className="search-input" type="number" min={1} max={3650} value={days} onChange={(e) => setDays(Math.max(1, Number(e.target.value) || 1))} />
			</div>
			<input className="search-input" placeholder="Reason (optional)" style={{ width: '100%', marginBottom: 8 }} value={reason} onChange={(e) => setReason(e.target.value)} />
			<button className="btn" disabled={pending} onClick={() => void grant()}>
				{pending ? 'Granting…' : `Grant ${tier} · ${days}d`}
			</button>
		</div>
	);
}

function FeatureGrantsSection({ profileId }: { profileId: string }) {
	const { mutate } = useSWRConfig();
	const [slug, setSlug] = useState('');
	const [days, setDays] = useState<number | ''>(30);
	const [reason, setReason] = useState('');
	const [addPending, setAddPending] = useState(false);
	const [revokePending, setRevokePending] = useState(false);

	const { data: catalog } = useSWR<{ data: FeatureCatalogRow[] }>(['/api/admin/features'], { dedupingInterval: 5 * 60_000 });
	const featureOptions = catalog?.data ?? [];

	const { data } = useSWR<{ data: GrantRow[] }>([`/api/admin/users/${profileId}/feature-grants`], { dedupingInterval: 30_000 });
	const grants = data?.data ?? [];
	const activeGrants = grants.filter((g) => !g.revoked_at && (!g.expires_at || new Date(g.expires_at) > new Date()));
	const refreshGrants = () => mutate([`/api/admin/users/${profileId}/feature-grants`]);

	const add = async () => {
		setAddPending(true);
		try {
			await api('POST', `/api/admin/users/${profileId}/feature-grants`, {
				feature_slug: slug,
				days: days === '' ? undefined : Number(days),
				expires_at: days === '' ? null : undefined,
				reason: reason.trim() || undefined,
			});
			toast.success(`Granted ${slug}`);
			setReason('');
			void refreshGrants();
		} catch (e) { toast.error((e as Error).message); }
		finally { setAddPending(false); }
	};
	const revoke = async (s: string) => {
		setRevokePending(true);
		try {
			await api('DELETE', `/api/admin/users/${profileId}/feature-grants/${s}`);
			toast.success('Revoked');
			void refreshGrants();
		} catch (e) { toast.error((e as Error).message); }
		finally { setRevokePending(false); }
	};

	return (
		<div>
			<div className="co-stat-label" style={{ marginBottom: 8 }}>Per-feature grants</div>
			{activeGrants.length === 0 ? (
				<div style={{ fontSize: 12, color: 'var(--fg-muted)', marginBottom: 10 }}>None active.</div>
			) : (
				<div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
					{activeGrants.map((g) => (
						<div key={g.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, background: 'var(--bg-1)', padding: '4px 8px', border: '1px solid var(--border)' }}>
							<span style={{ fontFamily: 'var(--font-mono)', flex: 1 }}>{g.feature_slug}</span>
							<span style={{ color: 'var(--fg-muted)' }}>{g.expires_at ? `expires ${new Date(g.expires_at).toLocaleDateString()}` : 'permanent'}</span>
							<button className="btn ghost" style={{ padding: '2px 8px', fontSize: 11 }} disabled={revokePending} onClick={() => void revoke(g.feature_slug)}>Revoke</button>
						</div>
					))}
				</div>
			)}
			<div style={{ display: 'grid', gridTemplateColumns: '1fr 100px', gap: 6, marginBottom: 6 }}>
				<Select value={slug} onChange={setSlug} searchable width="100%" style={{ display: 'block', width: '100%' }} placeholder="Select feature…" options={[{ value: '', label: 'Select feature…' }, ...featureOptions.map((f) => ({ value: f.slug, label: f.name }))]} />
				<input className="search-input" type="number" min={0} placeholder="days" value={days} onChange={(e) => {
					const v = e.target.value;
					if (v === '') { setDays(''); return; }
					const n = Number(v); setDays(Number.isFinite(n) && n > 0 ? n : '');
				}} />
			</div>
			<input className="search-input" placeholder="Reason (optional)" style={{ width: '100%', marginBottom: 8 }} value={reason} onChange={(e) => setReason(e.target.value)} />
			<button className="btn" disabled={addPending || !slug} onClick={() => void add()}>
				{addPending ? 'Granting…' : slug ? `Grant ${slug}${days === '' ? ' (permanent)' : ` · ${days}d`}` : 'Grant feature'}
			</button>
		</div>
	);
}
