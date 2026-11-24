'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import useSWR, { useSWRConfig } from 'swr';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { PageHeader, AsyncState, PillTabs, Section } from '@/components/atoms';
import { useUrlState } from '@/hooks/use-url-state';
import { accessSourceLabel, claimStatusLabel, claimTypeLabel, tidy, tierLabel } from '@/lib/labels';
import { AccessPanel, BillingPanel, PersonalizationSection, AdminActionsSection } from '../manage-panel';

interface UserDetail {
	id: string;
	email: string | null;
	display_name: string | null;
	user_role: string | null;
	user_type: string | null;
	company_name: string | null;
	created_at: string;
	last_seen_at: string | null;
	login_count?: number;
	is_trial?: boolean;
	trial_ends_at?: string | null;
	active_subscription?: boolean;
	expires_at?: string | null;
	renews?: boolean;
	playmakers?: boolean;
	blocked_at?: string | null;
	blocked_reason?: string | null;
	access_source?: string | null;
	access_reason?: string | null;
	access_changed_at?: string | null;
	access_granted_by_name?: string | null;
	access_granted_by_email?: string | null;
	is_legacy_user?: boolean;
	migrated_at?: string | null;
	is_test_account?: boolean;
	email_confirmed_at?: string | null;
	claims_count?: number;
}
interface Logins { data: { occurred_at: string; provider: string | null }[]; total: number }
interface Related {
	claims: { id: string; claim_type: string; name: string | null; is_verified: boolean; picked_up_at: string | null; rejected_at: string | null; created_at: string }[];
	intros: { id: string; status: string; created_at: string; investor_id: string; investor_name: string; company_name: string | null }[];
	downloads: { report_id: string; title: string; downloaded_at: string }[];
}

const TABS = [
	{ key: 'overview', label: 'Overview' },
	{ key: 'access', label: 'Access' },
	{ key: 'billing', label: 'Billing & credits' },
	{ key: 'activity', label: 'Activity' },
	{ key: 'personalization', label: 'Personalization' },
] as const;
type Tab = (typeof TABS)[number]['key'];

const fmt = (s?: string | null) => (s ? new Date(s).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—');
const fmtTime = (s: string) => new Date(s).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const muted = (t: string) => <span style={{ color: 'var(--fg-muted)' }}>{t}</span>;
const claimStatus = (c: Related['claims'][number]) => (c.is_verified ? 'verified' : c.rejected_at ? 'rejected' : c.picked_up_at ? 'picked_up' : 'pending');

/** One sentence on what plan they're on, why, and until when. */
function planSentence(u: UserDetail): string {
	const tier = u.user_type ?? 'explore';
	const by = u.access_granted_by_name || u.access_granted_by_email;
	if (tier === 'explore') {
		return u.access_source === 'revoked'
			? `Explore (free) — paid access revoked${by ? ` by ${by}` : ''}${u.access_changed_at ? ` on ${fmt(u.access_changed_at)}` : ''}`
			: 'Explore (free plan)';
	}
	const why = u.access_source ? accessSourceLabel(u.access_source) : 'reason not recorded';
	const until = u.is_trial && u.trial_ends_at ? `trial ends ${fmt(u.trial_ends_at)}`
		: u.expires_at && u.renews ? `renews ${fmt(u.expires_at)}`
		: u.expires_at ? `ends ${fmt(u.expires_at)}`
		: 'no end date';
	return `${tierLabel(tier)} · ${why}${by ? ` by ${by}` : ''} · ${until}`;
}

export default function UserDetailsPage() {
	const id = String(useParams().id);
	const { mutate } = useSWRConfig();
	const [tab, setTab] = useUrlState('profile', 'tab', 'overview');
	const { data: user, error, isLoading, mutate: reload } = useSWR<UserDetail>([`/api/admin/users/${id}`], { dedupingInterval: 15_000 });
	const credits = useSWR<{ stx: { total_available: number } }>([`/api/admin/users/${id}/credits`], { dedupingInterval: 15_000 });
	const [rolePending, setRolePending] = useState(false);

	const setRole = async (to: 'promote' | 'demote') => {
		if (!window.confirm(to === 'promote' ? 'Make this user an admin? They get full access to this admin panel.' : 'Remove admin rights from this user?')) return;
		setRolePending(true);
		try {
			await api('POST', `/api/admin/users/${id}/${to}`);
			toast.success(to === 'promote' ? 'Now an admin' : 'Admin rights removed');
			void reload();
			void mutate((key) => Array.isArray(key) && key[0] === '/api/admin/users');
		} catch (e) { toast.error((e as Error).message); }
		finally { setRolePending(false); }
	};

	const fact = (label: string, value: React.ReactNode) => (
		<div><div className="co-stat-label">{label}</div><div style={{ fontSize: 13 }}>{value}</div></div>
	);
	const isAdmin = user?.user_role === 'admin';
	const active = (TABS.some((t) => t.key === tab) ? tab : 'overview') as Tab;

	return (
		<div>
			<Link href="/users" className="btn ghost" style={{ marginBottom: 14 }}>← All users</Link>
			<PageHeader kicker="User" title={user?.display_name || user?.email || 'User'} subtitle={user?.display_name ? user.email ?? undefined : undefined} />

			<AsyncState loading={isLoading} error={error} empty={!isLoading && !user} emptyMsg="User not found." onRetry={() => void reload()}>
				{user && (
					<>
						<div className="card" style={{ padding: 'var(--space-4)', marginBottom: 'var(--space-4)' }}>
							<div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
								<span className="tag">{tierLabel(user.user_type ?? 'explore')}</span>
								{isAdmin && <span className="tag pos">Admin</span>}
								{user.blocked_at && <span className="tag neg">Blocked</span>}
								{user.playmakers && <span className="tag">Playmakers</span>}
								{user.is_test_account && <span className="tag">Test account</span>}
								{user.is_legacy_user && <span className="tag">From the old Hub</span>}
								<div style={{ flex: 1 }} />
								<button className="btn ghost" disabled={rolePending} onClick={() => void setRole(isAdmin ? 'demote' : 'promote')}>
									{isAdmin ? 'Remove admin rights' : 'Make admin'}
								</button>
							</div>
							<div style={{ fontSize: 15, fontWeight: 600, margin: '8px 0 4px' }}>{planSentence(user)}</div>
							{user.access_reason && <div style={{ fontSize: 13, color: 'var(--fg-2)' }}>Reason: “{user.access_reason}”</div>}
							{user.blocked_at && (
								<div style={{ fontSize: 13, color: 'var(--neg)', marginTop: 4 }}>
									Blocked since {fmt(user.blocked_at)}{user.blocked_reason ? ` — ${user.blocked_reason}` : ''}. They can’t use Atlas until unblocked (Access tab).
								</div>
							)}
							<div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12, marginTop: 'var(--space-4)' }}>
								{fact('Joined', fmt(user.created_at))}
								{fact('Last login', user.last_seen_at ? fmt(user.last_seen_at) : (user.login_count ? '—' : 'Never'))}
								{fact('Logins', (user.login_count ?? 0).toLocaleString())}
								{fact('Company', user.company_name ?? '—')}
								{fact('Claims', (user.claims_count ?? 0).toLocaleString())}
								{fact('Credits left', credits.data ? credits.data.stx.total_available.toLocaleString() : '…')}
							</div>
						</div>

						<PillTabs tabs={TABS.map((t) => ({ key: t.key, label: t.label }))} value={active} onChange={(t) => setTab(t)} />
						<div style={{ marginTop: 'var(--space-4)' }}>
							{active === 'overview' && <Overview user={user} />}
							{active === 'access' && <AccessPanel user={user} />}
							{active === 'billing' && <BillingPanel profileId={user.id} />}
							{active === 'activity' && <Activity profileId={user.id} />}
							{active === 'personalization' && <PersonalizationSection profileId={user.id} />}
						</div>
					</>
				)}
			</AsyncState>
		</div>
	);
}

function Overview({ user }: { user: UserDetail }) {
	const related = useSWR<Related>([`/api/admin/users/${user.id}/related`], { dedupingInterval: 30_000 });
	const logins = useSWR<Logins>([`/api/admin/users/${user.id}/logins`], { dedupingInterval: 30_000 });
	const r = related.data;
	const row = (label: string, value: React.ReactNode) => (
		<tr><td style={{ color: 'var(--fg-muted)', width: 180 }}>{label}</td><td>{value}</td></tr>
	);
	const by = user.access_granted_by_name || user.access_granted_by_email;
	return (
		<div style={{ display: 'grid', gap: 'var(--space-4)' }}>
			<div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 380px), 1fr))', gap: 'var(--space-4)' }}>
				<Section title="Their plan" meta="what they have and why" padded={false}>
					<table className="data-table"><tbody>
						{row('Plan', tierLabel(user.user_type ?? 'explore'))}
						{row('Why', user.access_source ? accessSourceLabel(user.access_source) : (user.user_type ?? 'explore') === 'explore' ? 'Free plan' : muted('Not recorded'))}
						{user.access_reason && row('Reason given', user.access_reason)}
						{by && row('Given by', by)}
						{user.access_changed_at && row('Changed on', fmt(user.access_changed_at))}
						{row('Access ends', user.is_trial && user.trial_ends_at ? `${fmt(user.trial_ends_at)} (trial)` : user.expires_at ? `${fmt(user.expires_at)}${user.renews ? ' (renews automatically)' : ''}` : (user.user_type ?? 'explore') === 'explore' ? '—' : 'No end date')}
						{user.is_legacy_user && row('Old Hub account', user.migrated_at ? `First signed in to Atlas ${fmt(user.migrated_at)}` : 'Hasn’t signed in to Atlas yet')}
						{row('Email confirmed', user.email_confirmed_at ? fmt(user.email_confirmed_at) : muted('Not confirmed'))}
					</tbody></table>
				</Section>
				<Section title="Recent sign-ins" meta={logins.data ? `${logins.data.total.toLocaleString()} recorded` : undefined} padded={false}>
					<AsyncState loading={logins.isLoading} error={logins.error} empty={(logins.data?.data.length ?? 0) === 0} emptyMsg="No sign-ins recorded.">
						<table className="data-table"><tbody>
							{(logins.data?.data ?? []).slice(0, 8).map((l, i) => (
								<tr key={i}><td>{fmtTime(l.occurred_at)}</td><td style={{ color: 'var(--fg-muted)' }}>{tidy(l.provider ?? 'email')}</td></tr>
							))}
						</tbody></table>
					</AsyncState>
				</Section>
			</div>

			<Section title="Claims" meta="companies, investors and ecosystem entries they asked to manage" padded={false}>
				<AsyncState loading={related.isLoading} error={related.error} empty={(r?.claims.length ?? 0) === 0} emptyMsg="No claims.">
					<table className="data-table">
						<thead><tr><th>Claimed</th><th>Type</th><th>Status</th><th>Sent</th><th /></tr></thead>
						<tbody>
							{(r?.claims ?? []).map((c) => (
								<tr key={c.id}>
									<td>{c.name ?? '—'}</td>
									<td>{claimTypeLabel(c.claim_type)}</td>
									<td>{claimStatusLabel(claimStatus(c))}</td>
									<td className="num">{fmt(c.created_at)}</td>
									<td style={{ textAlign: 'right' }}><Link className="btn ghost" href={`/claims?q=${encodeURIComponent(c.name ?? '')}&open=${c.id}`}>Open →</Link></td>
								</tr>
							))}
						</tbody>
					</table>
				</AsyncState>
			</Section>

			<div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 380px), 1fr))', gap: 'var(--space-4)' }}>
				<Section title="Intro requests" meta="investors they asked to be introduced to" padded={false}>
					<AsyncState loading={related.isLoading} error={related.error} empty={(r?.intros.length ?? 0) === 0} emptyMsg="No intro requests.">
						<table className="data-table">
							<thead><tr><th>Investor</th><th>For</th><th>Status</th><th>Sent</th></tr></thead>
							<tbody>
								{(r?.intros ?? []).map((x) => (
									<tr key={x.id}><td>{x.investor_name}</td><td>{x.company_name ?? '—'}</td><td>{tidy(x.status)}</td><td className="num">{fmt(x.created_at)}</td></tr>
								))}
							</tbody>
						</table>
					</AsyncState>
				</Section>
				<Section title="Report downloads" meta="latest 50" padded={false}>
					<AsyncState loading={related.isLoading} error={related.error} empty={(r?.downloads.length ?? 0) === 0} emptyMsg="No downloads.">
						<table className="data-table">
							<thead><tr><th>Report</th><th>Downloaded</th></tr></thead>
							<tbody>
								{(r?.downloads ?? []).map((d, i) => (
									<tr key={i}><td><Link href={`/reports/${d.report_id}`}>{d.title}</Link></td><td className="num">{fmt(d.downloaded_at)}</td></tr>
								))}
							</tbody>
						</table>
					</AsyncState>
				</Section>
			</div>
		</div>
	);
}

function Activity({ profileId }: { profileId: string }) {
	const logins = useSWR<Logins>([`/api/admin/users/${profileId}/logins`], { dedupingInterval: 30_000 });
	return (
		<div style={{ display: 'grid', gap: 'var(--space-4)' }}>
			<Section title="Sign-ins" meta={logins.data ? `latest ${Math.min(100, logins.data.total)} of ${logins.data.total.toLocaleString()} · includes history copied from the old Hub` : undefined} padded={false}>
				<AsyncState loading={logins.isLoading} error={logins.error} empty={(logins.data?.data.length ?? 0) === 0} emptyMsg="No sign-ins recorded.">
					<div style={{ maxHeight: 360, overflow: 'auto' }}>
						<table className="data-table">
							<thead><tr><th>When</th><th>How</th></tr></thead>
							<tbody>
								{(logins.data?.data ?? []).map((l, i) => (
									<tr key={i}><td>{fmtTime(l.occurred_at)}</td><td style={{ color: 'var(--fg-muted)' }}>{tidy(l.provider ?? 'email')}</td></tr>
								))}
							</tbody>
						</table>
					</div>
				</AsyncState>
			</Section>
			<AdminActionsSection profileId={profileId} />
		</div>
	);
}
