'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import useSWR, { useSWRConfig } from 'swr';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { Modal } from '@/components/modal';
import { PageHeader, PillTabs, AsyncState, StatCard, StatsPanel, Section } from '@/components/atoms';
import { ComboBarLine, PieDonut, PieLegend, Funnel, toSegments, type Bucket } from '@/components/charts';
import { FilterBar, FilterSelect, StatStrip } from '@/components/filters';
import { Select } from '@/components/select';
import { CreateAccountModal } from './account-access';

interface UserStats { total: number; admins: number; by_tier: Bucket[]; by_role: Bucket[]; signups_by_month: Bucket[] }
interface AuthRow { email: string | null; created_at?: string | null; last_sign_in_at?: string | null; provider?: string | null }
interface AuthActivity {
	total: number; signups_7d: number; signups_30d: number; active_7d: number; active_30d: number;
	signups_in_range?: number; active_in_range?: number;
	recent_signups: AuthRow[]; recent_logins: AuthRow[]; by_provider: Bucket[];
}
interface UserAnalytics {
	conversion: { total: number; trials: number; paid: number; paid_from_trial?: number; paid_direct?: number; free_to_trial_pct: number; trial_to_paid_pct: number };
	churn: { churned: number; active: number; churn_rate_pct: number; avg_lifetime_days: number | null };
	login_recency: Bucket[]; signup_recency: Bucket[]; login_frequency: Bucket[];
	report_downloads: { total: number; unique_users: number; last_30d: number; in_range?: number; unique_users_in_range?: number; top_reports: Bucket[]; daily_trend: Bucket[]; by_day_of_week?: Bucket[] };
}
const FREQ_BUCKETS: Record<string, 'never' | 'once' | '2-5' | '6+'> = { 'never (0)': 'never', once: 'once', '2-5': '2-5', '6+': '6+' };
const TIERS = ['explore', 'raise', 'scout'] as const;
const ROLES = ['user', 'admin'] as const;

interface User {
	id: string;
	email: string | null;
	display_name: string | null;
	user_role: string | null;
	user_type: string | null;
	company_name: string | null;
	created_at: string;
	last_seen_at: string | null;
	is_trial?: boolean;
	trial_ends_at?: string | null;
	active_subscription?: boolean;
	expires_at?: string | null;
	/** Active Stripe subscription that renews on `expires_at` (not cancelling). */
	renews?: boolean;
	login_count?: number;
}
interface UsersResponse { data: User[]; total: number; totalPages: number }

export function UsersView({ view }: { view: 'directory' | 'stats' | 'charts' }) {
	const { mutate } = useSWRConfig();
	const [search, setSearch] = useState('');
	const [role, setRole] = useState('');
	const [tier, setTier] = useState('');
	const [page, setPage] = useState(1);
	const router = useRouter();
	const [rolePending, setRolePending] = useState<string | null>(null);
	const [from, setFrom] = useState('');
	const [to, setTo] = useState('');
	const [freqBucket, setFreqBucket] = useState<'never' | 'once' | '2-5' | '6+' | null>(null);
	const [planDetail, setPlanDetail] = useState<string | null>(null);
	const [creating, setCreating] = useState(false);

	// Deep-link support: /users?q=<email>&focus=<id> (e.g. from the AI-usage page)
	// pre-fills the search; focus opens that user's details page.
	useEffect(() => {
		if (typeof window === 'undefined') return;
		const sp = new URLSearchParams(window.location.search);
		const q = sp.get('q');
		if (q) setSearch(q);
		const focus = sp.get('focus');
		if (focus) router.push(`/users/${focus}`);
	}, []);

	const debouncedSearch = useDebouncedValue(search);
	const { data, error, isLoading } = useSWR<UsersResponse>(
		['/api/admin/users', { q: debouncedSearch || undefined, role: role || undefined, tier: tier || undefined, page, limit: 30 }],
		{ dedupingInterval: 15_000 },
	);
	const stats = useSWR<UserStats>(['/api/admin/stats/users'], { dedupingInterval: 60_000 });
	const range = { from: from || undefined, to: to || undefined };
	const auth = useSWR<AuthActivity>(['/api/admin/users/auth-activity', range], { dedupingInterval: 60_000 });
	const an = useSWR<UserAnalytics>(['/api/admin/users/analytics', range], { dedupingInterval: 60_000 });
	const tierSegments = toSegments(stats.data?.by_tier ?? []);
	const providerSegments = toSegments(auth.data?.by_provider ?? []);
	const signupChart = (stats.data?.signups_by_month ?? []).map((b) => ({ label: b.label.slice(2), amt: b.value, deals: b.value }));
	const loginRecencySeg = toSegments(an.data?.login_recency ?? []);
	const signupRecencySeg = toSegments(an.data?.signup_recency ?? []);
	const freqSeg = toSegments(an.data?.login_frequency ?? []);
	const fmtDate = (s?: string | null) => (s ? new Date(s).toLocaleDateString(undefined, { year: '2-digit', month: 'short', day: 'numeric' }) : '—');

	// Export the current (filtered) user set to CSV — fetches up to 5k rows.
	const [exporting, setExporting] = useState(false);
	const exportCsv = async () => {
		setExporting(true);
		try {
			const res = await api<UsersResponse>('GET', `/api/admin/users?${new URLSearchParams({
				...(search ? { q: search } : {}), ...(role ? { role } : {}), ...(tier ? { tier } : {}), limit: '5000',
			}).toString()}`);
			const rows = res.data ?? [];
			const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
			const plan = (u: User) => u.is_trial ? `trial${u.trial_ends_at ? ` until ${u.trial_ends_at.slice(0, 10)}` : ''}` : u.active_subscription ? 'paid' : '';
			const csv = ['email,name,tier,plan,role,company,logins,joined,last_seen',
				...rows.map((u) => [u.email, u.display_name, u.user_type, plan(u), u.user_role, u.company_name, u.login_count ?? 0, u.created_at, u.last_seen_at].map(esc).join(','))].join('\n');
			const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
			const a = document.createElement('a'); a.href = url; a.download = `users-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(url);
			toast.success(`Exported ${rows.length} users`);
		} catch (e) { toast.error((e as Error).message); }
		finally { setExporting(false); }
	};

	const refresh = () => mutate((key) => Array.isArray(key) && key[0] === '/api/admin/users');

	const promote = async (id: string) => {
		setRolePending(id);
		try {
			await api('POST', `/api/admin/users/${id}/promote`);
			toast.success('User promoted');
			void refresh();
		} catch (e) { toast.error((e as Error).message); }
		finally { setRolePending(null); }
	};
	const demote = async (id: string) => {
		setRolePending(id);
		try {
			await api('POST', `/api/admin/users/${id}/demote`);
			toast.success('User demoted');
			void refresh();
		} catch (e) { toast.error((e as Error).message); }
		finally { setRolePending(null); }
	};

	const users = data?.data ?? [];
	return (
		<div>
			{view === 'stats' && (<>
			<StatsPanel>
				<StatStrip cols={4}>
					<StatCard label="Total users" loading={stats.isLoading} value={(stats.data?.total ?? 0).toLocaleString()} />
					<StatCard label="Admins" loading={stats.isLoading} value={(stats.data?.admins ?? 0).toLocaleString()} />
					{[...(stats.data?.by_tier ?? [])].sort((a, b) => b.value - a.value).slice(0, 2).map((b) => (
						<StatCard key={b.label} label={`${b.label} tier`} loading={stats.isLoading} value={b.value.toLocaleString()} />
					))}
				</StatStrip>
			</StatsPanel>

			<div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 'var(--space-4)', marginBottom: 'var(--space-5)' }}>
				<Section title="Signups by month" meta="last 12 months">
					<AsyncState loading={stats.isLoading} error={stats.error} empty={signupChart.length === 0} emptyMsg="No signups" onRetry={() => void stats.mutate()}>
						<ComboBarLine data={signupChart} height={240} valueFormatter={(v) => String(Math.round(v))} barLabel="Signups" lineLabel="signups" />
					</AsyncState>
				</Section>
				<Section title="By tier" meta="users" center>
					<AsyncState loading={stats.isLoading} error={stats.error} empty={tierSegments.length === 0} emptyMsg="No data" onRetry={() => void stats.mutate()}>
						<div style={{ display: 'grid', placeItems: 'center', gap: 12 }}>
							<PieDonut segments={tierSegments} size={170} mode="donut" />
							<PieLegend segments={tierSegments} />
						</div>
					</AsyncState>
				</Section>
			</div>

			{/* Analytics date-range — windows provider mix, in-range counts, and report-download trends */}
			<div className="card" style={{ padding: 12, marginBottom: 'var(--space-4)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
				<span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>Analytics window</span>
				<input className="search-input" type="date" style={{ height: 30 }} value={from} onChange={(e) => setFrom(e.target.value)} title="From" />
				<span style={{ color: 'var(--fg-muted)' }}>→</span>
				<input className="search-input" type="date" style={{ height: 30 }} value={to} onChange={(e) => setTo(e.target.value)} title="To" />
				{(from || to) && <button className="btn ghost" onClick={() => { setFrom(''); setTo(''); }}>Clear (last 30d)</button>}
				{(from || to) && <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>· {(auth.data?.signups_in_range ?? 0).toLocaleString()} signups · {(auth.data?.active_in_range ?? 0).toLocaleString()} active · {(an.data?.report_downloads.in_range ?? 0).toLocaleString()} downloads in range</span>}
			</div>

			</>)}

			{view === 'charts' && (<>
			{/* Sign-in / sign-up activity — straight from Supabase auth */}
			<div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0 0 10px' }}>
				Sign-in / sign-up activity · Supabase auth
			</div>
			<StatStrip cols={4}>
				<StatCard label="Auth users" loading={auth.isLoading} value={(auth.data?.total ?? 0).toLocaleString()} />
				<StatCard label="Signups · 7d" loading={auth.isLoading} value={(auth.data?.signups_7d ?? 0).toLocaleString()} />
				<StatCard label="Active · 7d" loading={auth.isLoading} value={(auth.data?.active_7d ?? 0).toLocaleString()} />
				<StatCard label="Active · 30d" loading={auth.isLoading} value={(auth.data?.active_30d ?? 0).toLocaleString()} />
			</StatStrip>
			<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--space-4)', marginBottom: 'var(--space-5)' }}>
				<Section title="Recent signups" meta="newest first" padded={false}>
					<AsyncState loading={auth.isLoading} error={auth.error} empty={(auth.data?.recent_signups?.length ?? 0) === 0} emptyMsg="No signups" onRetry={() => void auth.mutate()}>
						<table className="data-table">
							<thead><tr><th>Email</th><th>Joined</th><th>Via</th></tr></thead>
							<tbody>
								{(auth.data?.recent_signups ?? []).map((r, i) => (
									<tr key={`${r.email}-${i}`}><td>{r.email ?? '—'}</td><td className="num">{fmtDate(r.created_at)}</td><td>{r.provider ?? 'email'}</td></tr>
								))}
							</tbody>
						</table>
					</AsyncState>
				</Section>
				<Section title="Recent logins" meta="last sign-in" padded={false}>
					<AsyncState loading={auth.isLoading} error={auth.error} empty={(auth.data?.recent_logins?.length ?? 0) === 0} emptyMsg="No logins" onRetry={() => void auth.mutate()}>
						<table className="data-table">
							<thead><tr><th>Email</th><th>Last sign-in</th><th>Via</th></tr></thead>
							<tbody>
								{(auth.data?.recent_logins ?? []).map((r, i) => (
									<tr key={`${r.email}-${i}`}><td>{r.email ?? '—'}</td><td className="num">{fmtDate(r.last_sign_in_at)}</td><td>{r.provider ?? 'email'}</td></tr>
								))}
							</tbody>
						</table>
					</AsyncState>
				</Section>
				<Section title="Login method" meta="all auth users" center>
					<AsyncState loading={auth.isLoading} error={auth.error} empty={providerSegments.length === 0} emptyMsg="No data" onRetry={() => void auth.mutate()}>
						<div style={{ display: 'grid', placeItems: 'center', gap: 12 }}>
							<PieDonut segments={providerSegments} size={150} mode="donut" />
							<PieLegend segments={providerSegments} />
						</div>
					</AsyncState>
				</Section>
			</div>

			{/* Growth analytics — conversions, churn, recency/frequency, report downloads */}
			<div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0 0 10px' }}>
				Growth analytics
			</div>
			<StatStrip cols={4}>
				<StatCard label="Free → trial" loading={an.isLoading} value={`${(an.data?.conversion.free_to_trial_pct ?? 0).toFixed(1)}%`} />
				<StatCard label="Trial → paid" loading={an.isLoading} value={`${(an.data?.conversion.trial_to_paid_pct ?? 0).toFixed(1)}%`}
					sub={`${(an.data?.conversion.paid_direct ?? 0).toLocaleString()} more bought without trialing`} />
				<StatCard label="Churn rate" loading={an.isLoading} value={`${(an.data?.churn.churn_rate_pct ?? 0).toFixed(1)}%`} urgent={(an.data?.churn.churn_rate_pct ?? 0) > 0} />
				<StatCard label="Avg lifetime" loading={an.isLoading} value={an.data?.churn.avg_lifetime_days != null ? `${Math.round(an.data.churn.avg_lifetime_days)}d` : '—'} />
			</StatStrip>
			<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)', marginBottom: 'var(--space-5)' }}>
				<Section title="Conversion funnel" meta="free → trial → paid">
					<Funnel stages={[
						{ label: 'Total users', value: an.data?.conversion.total ?? 0 },
						{ label: 'Started a trial', value: an.data?.conversion.trials ?? 0 },
						{ label: 'Paying', value: an.data?.conversion.paid ?? 0, color: 'var(--pos)' },
						{ label: 'Churned', value: an.data?.churn.churned ?? 0, color: 'var(--neg)' },
					]} />
				</Section>
				{/* Counts come from the auth.users trigger (record_login_event) added 21 Jul
					2026. Pre-existing accounts were seeded with the single login provable from
					last_sign_in_at, so historical totals are a floor — hence the dated meta. */}
				<Section title="Login frequency" meta="per user · counted since 21 Jul 2026 · click to drill in">
					<AsyncState loading={an.isLoading} error={an.error} empty={freqSeg.length === 0} emptyMsg="No data" onRetry={() => void an.mutate()}>
						<PieDonut segments={freqSeg} mode="bar" />
						<div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
							{(an.data?.login_frequency ?? []).map((b) => {
								const bucket = FREQ_BUCKETS[b.label];
								return bucket ? <button key={b.label} className="chip" onClick={() => setFreqBucket(bucket)}>{b.label}: {b.value.toLocaleString()}</button> : null;
							})}
						</div>
					</AsyncState>
				</Section>
			</div>
			{/* Report-download charts live on the dedicated Reports tab — not duplicated here. */}
			<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)', marginBottom: 'var(--space-5)' }}>
				<Section title="Signup recency" meta="account age" center>
					<AsyncState loading={an.isLoading} error={an.error} empty={signupRecencySeg.length === 0} emptyMsg="No data" onRetry={() => void an.mutate()}>
						<div style={{ display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
							<PieDonut segments={signupRecencySeg} size={160} mode="donut" />
							<div style={{ flex: 1, minWidth: 150 }}><PieLegend segments={signupRecencySeg} /></div>
						</div>
					</AsyncState>
				</Section>
				<Section title="Login recency" meta="last seen" center>
					<AsyncState loading={an.isLoading} error={an.error} empty={loginRecencySeg.length === 0} emptyMsg="No data" onRetry={() => void an.mutate()}>
						<div style={{ display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
							<PieDonut segments={loginRecencySeg} size={160} mode="donut" />
							<div style={{ flex: 1, minWidth: 150 }}><PieLegend segments={loginRecencySeg} /></div>
						</div>
					</AsyncState>
				</Section>
			</div>

			<SubscriptionMix onPlan={setPlanDetail} />

			</>)}

			{view === 'directory' && (<>
			<FilterBar>
				<input
					className="search-input"
					style={{ flex: '0 0 280px', height: 32 }}
					placeholder="Search email or name…"
					value={search}
					onChange={(e) => { setSearch(e.target.value); setPage(1); }}
				/>
				<FilterSelect ariaLabel="Tier" value={tier} onChange={(v) => { setTier(v); setPage(1); }} options={[...TIERS]} allLabel="All tiers" />
				<FilterSelect ariaLabel="Role" value={role} onChange={(v) => { setRole(v); setPage(1); }} options={[...ROLES]} allLabel="All roles" />
				<div style={{ flex: 1 }} />
				<button className="btn ghost" disabled={exporting} onClick={() => void exportCsv()}>{exporting ? 'Exporting…' : 'Export CSV'}</button>
				<button className="btn" onClick={() => setCreating(true)}>Create account</button>
			</FilterBar>

			<div className="card">
				<AsyncState loading={isLoading} error={error} empty={users.length === 0} emptyMsg={search ? 'No users match.' : 'No users yet.'} onRetry={() => void refresh()}>
				<div className="table-scroll">
				<table className="data-table">
					<thead>
						<tr>
							<th>Email</th>
							<th>Name</th>
							<th>Company</th>
							<th>Tier</th>
							<th>Role</th>
							<th>Logins</th>
							<th>Last seen</th>
							<th>Joined</th>
							<th>Access expires</th>
							<th style={{ textAlign: 'right' }}>Actions</th>
						</tr>
					</thead>
					<tbody>
						{users.map((u) => (
								<tr key={u.id}>
									<td>{u.email}</td>
									<td>{u.display_name ?? '—'}</td>
									<td style={{ fontSize: 12, color: 'var(--fg-muted)' }}>{u.company_name ?? '—'}</td>
									<td>
										<span className="tag">{u.user_type ?? 'explore'}</span>
										{u.is_trial
											? <span className="tag warn" title={u.trial_ends_at ? `Trial ends ${fmtDate(u.trial_ends_at)}` : 'On trial'} style={{ marginLeft: 4 }}>trial{u.trial_ends_at ? ` · ends ${fmtDate(u.trial_ends_at)}` : ''}</span>
											: u.active_subscription ? <span className="tag pos" style={{ marginLeft: 4 }}>paid</span> : null}
									</td>
									<td>{u.user_role === 'admin' ? <span className="tag pos">admin</span> : 'user'}</td>
									<td className="num">{(u.login_count ?? 0).toLocaleString()}</td>
									<td className="num">{u.last_seen_at ? fmtDate(u.last_seen_at) : '—'}</td>
									<td className="num">{new Date(u.created_at).toLocaleDateString()}</td>
									<td className="num">
										{u.is_trial && u.trial_ends_at
											? <span className={new Date(u.trial_ends_at) < new Date() ? 'tag' : 'tag warn'} title={`Trial ends ${fmtDate(u.trial_ends_at)}`}>{fmtDate(u.trial_ends_at)}</span>
											: u.expires_at && u.renews
												? <span className="tag" title={`Stripe subscription renews ${fmtDate(u.expires_at)}`}>renews {fmtDate(u.expires_at)}</span>
											: u.expires_at
												? <span className={new Date(u.expires_at) < new Date() ? 'tag' : 'tag warn'} title={`Access expires ${fmtDate(u.expires_at)}`}>ends {fmtDate(u.expires_at)}</span>
												: (u.user_type && u.user_type !== 'explore')
													? <span style={{ color: 'var(--fg-muted)', fontSize: 12 }} title="Paid tier with no subscription end — admin-granted / comped">Permanent</span>
													: <span style={{ color: 'var(--fg-muted)' }}>—</span>}
									</td>
									<td style={{ textAlign: 'right' }}>
										<div style={{ display: 'inline-flex', gap: 6 }}>
											{u.user_role === 'admin' ? (
												<button className="btn ghost" disabled={rolePending === u.id} onClick={() => void demote(u.id)}>Demote</button>
											) : (
												<button className="btn ghost" disabled={rolePending === u.id} onClick={() => void promote(u.id)}>Promote</button>
											)}
											<Link href={`/users/${u.id}`} className="btn">Manage →</Link>
										</div>
									</td>
								</tr>
						))}
					</tbody>
				</table>
				</div>
				</AsyncState>
			</div>

			{data && data.totalPages > 1 && (
				<div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
					<span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-muted)', alignSelf: 'center', marginRight: 8 }}>
						Page {page} of {data.totalPages}
					</span>
					<button className="btn ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Prev</button>
					<button className="btn ghost" disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)}>Next</button>
				</div>
			)}

			</>)}

			{freqBucket && <LoginUsersModal bucket={freqBucket} onClose={() => setFreqBucket(null)} />}
			{planDetail && <PlanUsersModal detail={planDetail} onClose={() => setPlanDetail(null)} />}
			{creating && <CreateAccountModal onClose={() => setCreating(false)} />}
		</div>
	);
}

// ─── Drill-down: users in a login-frequency bucket ───────────────────────────
interface LoginUser { id: string; email: string | null; display_name: string | null; login_count: number; last_seen_at: string | null; created_at: string }
function LoginUsersModal({ bucket, onClose }: { bucket: string; onClose: () => void }) {
	const [q, setQ] = useState('');
	const dq = useDebouncedValue(q);
	const { data, isLoading } = useSWR<{ users: LoginUser[] }>([`/api/admin/users/analytics/login-users`, { bucket, q: dq || undefined }], { dedupingInterval: 10_000 });
	const users = data?.users ?? [];
	const exportCsv = () => {
		const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
		const csv = ['email,name,login_count,last_seen,joined', ...users.map((u) => [u.email, u.display_name, u.login_count, u.last_seen_at, u.created_at].map(esc).join(','))].join('\n');
		const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
		const a = document.createElement('a'); a.href = url; a.download = `login-${bucket}.csv`; a.click(); URL.revokeObjectURL(url);
	};
	return (
		<Modal title={`Users · login frequency “${bucket}”`} onClose={onClose} width={620} footer={<><button className="btn ghost" onClick={onClose}>Close</button><button className="btn" disabled={!users.length} onClick={exportCsv}>Export CSV</button></>}>
			<input className="search-input" style={{ marginBottom: 10 }} placeholder="Search email or name…" value={q} onChange={(e) => setQ(e.target.value)} />
			<AsyncState loading={isLoading} empty={users.length === 0} emptyMsg="No users in this bucket.">
				<table className="data-table">
					<thead><tr><th>Email</th><th>Name</th><th>Logins</th><th>Last seen</th></tr></thead>
					<tbody>
						{users.map((u) => (
							<tr key={u.id}><td>{u.email ?? '—'}</td><td>{u.display_name ?? '—'}</td><td className="num">{u.login_count}</td><td className="num">{u.last_seen_at ? new Date(u.last_seen_at).toLocaleDateString() : '—'}</td></tr>
						))}
					</tbody>
				</table>
			</AsyncState>
		</Modal>
	);
}

// ─── Subscription mix matrix + monthly churn ─────────────────────────────────
interface SubsData { matrix: Array<{ detail: string; count: number }>; monthly_churn: Array<{ label: string; value: number }> }
const prettyDetail = (d: string) => d.replace(/_/g, ' ').replace('trial', '(trial)');
function SubscriptionMix({ onPlan }: { onPlan: (detail: string) => void }) {
	const { data, isLoading, error, mutate } = useSWR<SubsData>(['/api/admin/users/analytics/subscriptions'], { dedupingInterval: 60_000 });
	const matrix = data?.matrix ?? [];
	const churnChart = (data?.monthly_churn ?? []).map((m) => ({ label: m.label.slice(2), amt: m.value, deals: m.value }));
	return (
		<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)', marginBottom: 'var(--space-5)' }}>
			<Section title="Subscription mix" meta="by plan · click to drill in">
				<AsyncState loading={isLoading} error={error} empty={matrix.length === 0} emptyMsg="No paid/trial plans yet." onRetry={() => void mutate()}>
					<table className="data-table">
						<thead><tr><th>Plan</th><th>Users</th><th /></tr></thead>
						<tbody>
							{matrix.map((m) => (
								<tr key={m.detail} style={{ cursor: 'pointer' }} onClick={() => onPlan(m.detail)}>
									<td>{prettyDetail(m.detail)}{m.detail.includes('trial') && <span className="tag warn" style={{ marginLeft: 6 }}>trial</span>}</td>
									<td className="num">{m.count.toLocaleString()}</td>
									<td style={{ textAlign: 'right', color: 'var(--fg-muted)' }}>view →</td>
								</tr>
							))}
						</tbody>
					</table>
				</AsyncState>
			</Section>
			<Section title="Monthly churn" meta="subscriptions ended, last 12 mo">
				<AsyncState loading={isLoading} error={error} empty={churnChart.length === 0} emptyMsg="No churn recorded." onRetry={() => void mutate()}>
					<ComboBarLine data={churnChart} height={200} valueFormatter={(v) => String(Math.round(v))} barLabel="Churned" lineLabel="churned" />
				</AsyncState>
			</Section>
		</div>
	);
}

interface PlanUser { id: string; email: string | null; display_name: string | null; company_name: string | null; login_count: number; last_seen_at: string | null }
function PlanUsersModal({ detail, onClose }: { detail: string; onClose: () => void }) {
	const [q, setQ] = useState('');
	const dq = useDebouncedValue(q);
	const { data, isLoading } = useSWR<{ users: PlanUser[] }>(['/api/admin/users/analytics/plan-users', { detail, q: dq || undefined }], { dedupingInterval: 10_000 });
	const users = data?.users ?? [];
	const exportCsv = () => {
		const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
		const csv = ['email,name,company,logins,last_seen', ...users.map((u) => [u.email, u.display_name, u.company_name, u.login_count, u.last_seen_at].map(esc).join(','))].join('\n');
		const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
		const a = document.createElement('a'); a.href = url; a.download = `plan-${detail}.csv`; a.click(); URL.revokeObjectURL(url);
	};
	return (
		<Modal title={`Users · ${prettyDetail(detail)}`} onClose={onClose} width={640} footer={<><button className="btn ghost" onClick={onClose}>Close</button><button className="btn" disabled={!users.length} onClick={exportCsv}>Export CSV</button></>}>
			<input className="search-input" style={{ marginBottom: 10 }} placeholder="Search email or name…" value={q} onChange={(e) => setQ(e.target.value)} />
			<AsyncState loading={isLoading} empty={users.length === 0} emptyMsg="No users on this plan.">
				<table className="data-table">
					<thead><tr><th>Email</th><th>Name</th><th>Company</th><th>Logins</th><th>Last seen</th></tr></thead>
					<tbody>
						{users.map((u) => (
							<tr key={u.id}><td>{u.email ?? '—'}</td><td>{u.display_name ?? '—'}</td><td>{u.company_name ?? '—'}</td><td className="num">{u.login_count}</td><td className="num">{u.last_seen_at ? new Date(u.last_seen_at).toLocaleDateString() : '—'}</td></tr>
						))}
					</tbody>
				</table>
			</AsyncState>
		</Modal>
	);
}

// ─── Drill-down: per-user report downloads ───────────────────────────────────
interface ReportUser { id: string; email: string | null; display_name: string | null; downloads: number; last_download: string | null }
function ReportUsersModal({ onClose }: { onClose: () => void }) {
	const [q, setQ] = useState('');
	const [page, setPage] = useState(1);
	const dq = useDebouncedValue(q);
	const { data, isLoading } = useSWR<{ data: ReportUser[]; total: number; totalPages: number }>(
		[`/api/admin/users/analytics/report-users`, { q: dq || undefined, page, limit: 25 }], { dedupingInterval: 10_000 },
	);
	const rows = data?.data ?? [];
	return (
		<Modal title={`Per-user report downloads · ${(data?.total ?? 0).toLocaleString()} users`} onClose={onClose} width={620} footer={<button className="btn ghost" onClick={onClose}>Close</button>}>
			<input className="search-input" style={{ marginBottom: 10 }} placeholder="Search email or name…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
			<AsyncState loading={isLoading} empty={rows.length === 0} emptyMsg="No downloads yet.">
				<table className="data-table">
					<thead><tr><th>Email</th><th>Name</th><th>Downloads</th><th>Last</th></tr></thead>
					<tbody>
						{rows.map((u) => (
							<tr key={u.id}><td>{u.email ?? '—'}</td><td>{u.display_name ?? '—'}</td><td className="num">{u.downloads}</td><td className="num">{u.last_download ? new Date(u.last_download).toLocaleDateString() : '—'}</td></tr>
						))}
					</tbody>
				</table>
			</AsyncState>
			{data && data.totalPages > 1 && (
				<div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
					<button className="btn ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Prev</button>
					<button className="btn ghost" disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)}>Next</button>
				</div>
			)}
		</Modal>
	);
}


// ─── Sign-up behaviour ───────────────────────────────────────────────────────
// Range-scoped signup series (granularity follows the range), day-of-week mix,
// week/month deltas and run-rate averages — the legacy "Sign-Up Behaviour" block.
interface SignupAnalytics {
	range: string; unit: 'day' | 'week' | 'month';
	series: Bucket[]; by_day_of_week: Bucket[];
	this_week: number; last_week: number; this_month: number; last_month: number;
	total: number; first_signup: string | null;
	avg_per_week: number; avg_per_month: number;
	new_by_plan: Array<{ label: string; plan: string; value: number }>;
	paying: { trialed_ever: number; trialing_now: number; paid_now: number; paid_ever: number; paid_from_trial: number };
}
const SIGNUP_RANGES = [
	{ key: '7d', label: 'Last 7 days' }, { key: '30d', label: 'Last 30 days' },
	{ key: '90d', label: 'Last 90 days' }, { key: 'all', label: 'All time' },
] as const;
/** Percentage change vs the previous equivalent period (null when there's no base). */
const pctDelta = (now: number, prev: number): number | null => (prev > 0 ? ((now - prev) / prev) * 100 : null);

function SignupBehaviour() {
	const [range, setRange] = useState<'7d' | '30d' | '90d' | 'all'>('30d');
	const { data, isLoading, error, mutate } = useSWR<SignupAnalytics>(
		['/api/admin/users/analytics/signups', { range }], { dedupingInterval: 60_000 },
	);
	const d = data;
	// Month labels are YYYY-MM, weeks/days are already short — trim the century.
	const series = (d?.series ?? []).map((b) => ({ label: b.label.replace(/^20/, ''), amt: b.value, deals: b.value }));
	const dowSeg = toSegments(d?.by_day_of_week ?? []);
	// New paid subscriptions per month. ComboBarLine has no stacking, so the chart
	// shows monthly totals and the plan split is surfaced in the table beside it
	// (legacy "New Subscribers by Plan" used a stacked bar).
	const byPlanRows = d?.new_by_plan ?? [];
	const planMonths = Array.from(new Set(byPlanRows.map((r) => r.label))).sort();
	const planTotals = planMonths.map((m) => {
		const amt = byPlanRows.filter((r) => r.label === m).reduce((s, r) => s + r.value, 0);
		return { label: m.slice(2), amt, deals: amt };
	});
	// Plan totals across the whole 6-month window, biggest first.
	const planSplit = Object.entries(
		byPlanRows.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.plan]: (acc[r.plan] ?? 0) + r.value }), {}),
	).sort((a, b) => b[1] - a[1]);

	return (
		<>
			<div className="card" style={{ padding: 12, marginBottom: 'var(--space-4)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
				<span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>Sign-up window</span>
				{SIGNUP_RANGES.map((r) => (
					<button key={r.key} type="button" className={`chip ${range === r.key ? 'on' : ''}`} onClick={() => setRange(r.key)}>{r.label}</button>
				))}
				{d?.first_signup && (
					<span style={{ fontSize: 12, color: 'var(--fg-muted)', marginLeft: 'auto' }}>
						Averages measured since first signup · {new Date(d.first_signup).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}
					</span>
				)}
			</div>

			<StatStrip cols={4}>
				<StatCard label="This week" loading={isLoading} value={(d?.this_week ?? 0).toLocaleString()}
					delta={pctDelta(d?.this_week ?? 0, d?.last_week ?? 0)} sub={`vs last week (${(d?.last_week ?? 0).toLocaleString()})`} />
				<StatCard label="This month" loading={isLoading} value={(d?.this_month ?? 0).toLocaleString()}
					delta={pctDelta(d?.this_month ?? 0, d?.last_month ?? 0)} sub={`vs last month (${(d?.last_month ?? 0).toLocaleString()})`} />
				<StatCard label="Avg / week" loading={isLoading} value={(d?.avg_per_week ?? 0).toFixed(1)} sub="run rate since launch" />
				<StatCard label="Avg / month" loading={isLoading} value={(d?.avg_per_month ?? 0).toFixed(1)} sub="run rate since launch" />
			</StatStrip>

			<div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 'var(--space-4)', marginBottom: 'var(--space-5)' }}>
				<Section title="Signups over time" meta={`per ${d?.unit ?? 'day'} · ${SIGNUP_RANGES.find((r) => r.key === range)?.label.toLowerCase()}`}>
					<AsyncState loading={isLoading} error={error} empty={series.length === 0} emptyMsg="No signups in this window" onRetry={() => void mutate()}>
						<ComboBarLine data={series} height={240} valueFormatter={(v) => String(Math.round(v))} barLabel="Signups" lineLabel="signups" />
					</AsyncState>
				</Section>
				<Section title="By day of week" meta="when people sign up">
					<AsyncState loading={isLoading} error={error} empty={dowSeg.length === 0} emptyMsg="No data" onRetry={() => void mutate()}>
						<PieDonut segments={dowSeg} mode="bar" />
					</AsyncState>
				</Section>
			</div>

			<div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0 0 10px' }}>
				Paying customers
			</div>
			<StatStrip cols={4}>
				<StatCard label="On trial now" loading={isLoading} value={(d?.paying.trialing_now ?? 0).toLocaleString()}
					sub={`${(d?.paying.trialed_ever ?? 0).toLocaleString()} have ever trialed`} />
				<StatCard label="Paying now" loading={isLoading} value={(d?.paying.paid_now ?? 0).toLocaleString()} tone="pos"
					sub={`${(d?.paying.paid_ever ?? 0).toLocaleString()} paid ever (incl. churned)`} />
				{/* Numerator must be payers who actually trialed. Dividing ALL payers by
				    trialers read 165% here while the Engagement tab, using the fixed
				    server value, showed 51.9% — the same page contradicting itself. */}
				<StatCard label="Trial → paid" loading={isLoading}
					value={`${d?.paying.trialed_ever ? (((d.paying.paid_from_trial ?? 0) / d.paying.trialed_ever) * 100).toFixed(1) : '0.0'}%`}
					sub={`${((d?.paying.paid_now ?? 0) - (d?.paying.paid_from_trial ?? 0)).toLocaleString()} more bought without trialing`} />
				<StatCard label="Signup → trial" loading={isLoading}
					value={`${d?.total ? (((d.paying.trialed_ever) / d.total) * 100).toFixed(1) : '0.0'}%`}
					sub={`of ${(d?.total ?? 0).toLocaleString()} accounts`} />
			</StatStrip>

			<div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 'var(--space-4)', marginBottom: 'var(--space-5)' }}>
				<Section title="New paid subscriptions by month" meta="last 6 months · excludes trials">
					<AsyncState loading={isLoading} error={error} empty={planTotals.length === 0} emptyMsg="No new paid subscriptions in this period" onRetry={() => void mutate()}>
						<ComboBarLine data={planTotals} height={200} valueFormatter={(v) => String(Math.round(v))} barLabel="New subs" lineLabel="new subs" />
					</AsyncState>
				</Section>
				<Section title="By plan" meta="same 6 months" padded={false}>
					<AsyncState loading={isLoading} error={error} empty={planSplit.length === 0} emptyMsg="No new paid subscriptions" onRetry={() => void mutate()}>
						<table className="data-table">
							<thead><tr><th>Plan</th><th style={{ textAlign: 'right' }}>New subs</th></tr></thead>
							<tbody>
								{planSplit.map(([plan, n]) => (
									<tr key={plan}>
										<td>{prettyDetail(plan)}</td>
										<td className="num" style={{ textAlign: 'right', fontWeight: 600 }}>{n.toLocaleString()}</td>
									</tr>
								))}
							</tbody>
						</table>
					</AsyncState>
				</Section>
			</div>
		</>
	);
}

// ─── Report analytics (dedicated tab) ────────────────────────────────────────
interface ReportStat { report_id: string; title: string; downloads: number; unique_users: number; last_download: string | null }
const REPORT_SORTS = [
	{ key: 'downloads', label: 'Total downloads' },
	{ key: 'unique_users', label: 'Unique users' },
	{ key: 'title', label: 'Report title' },
] as const;

/** ISO date N days ago — used for the Reports tab's default window. */
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
/** Explicit floor for "all time" (a blank `from` means "last 30 days" to the API). */
const ALL_TIME_FROM = '2000-01-01';

function ReportsAnalytics() {
	// Downloads are overwhelmingly historical (only a handful in the last 30 days),
	// so a 30-day default would render an empty tab. Open on the last 12 months.
	const [from, setFrom] = useState(() => daysAgo(365));
	const [to, setTo] = useState('');
	const [q, setQ] = useState('');
	const [sort, setSort] = useState<'downloads' | 'unique_users' | 'title'>('downloads');
	const [usersOpen, setUsersOpen] = useState(false);
	// Pixels per day on the daily chart; 0 = fit the whole window into the card.
	const [dailyBand, setDailyBand] = useState(0);
	const dq = useDebouncedValue(q);
	const range = { from: from || undefined, to: to || undefined };

	const an = useSWR<UserAnalytics>(['/api/admin/users/analytics', range], { dedupingInterval: 60_000 });
	const rs = useSWR<{ reports: ReportStat[]; monthly_trend: Bucket[]; total_reports: number }>(
		['/api/admin/users/analytics/report-stats', { ...range, q: dq || undefined, sort }], { dedupingInterval: 30_000 },
	);
	const dl = an.data?.report_downloads;
	const reports = rs.data?.reports ?? [];
	// Every headline number must respect the window, otherwise a narrow range shows
	// "3 downloads" beside an all-time "1,058 unique users".
	const windowed = dl?.in_range ?? 0;
	const uniqueWindowed = dl?.unique_users_in_range ?? 0;
	const avgPerUser = uniqueWindowed ? windowed / uniqueWindowed : 0;
	const topSeg = toSegments(dl?.top_reports ?? []);
	const dowSeg = toSegments(dl?.by_day_of_week ?? []);
	const monthly = (rs.data?.monthly_trend ?? []).map((b) => ({ label: b.label.slice(2), amt: b.value, deals: b.value }));
	const daily = (dl?.daily_trend ?? []).map((b) => ({
		label: new Date(b.label).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
		amt: b.value, deals: b.value,
	}));

	return (
		<>
			<div className="card" style={{ padding: 12, marginBottom: 'var(--space-4)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
				<span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>Download window</span>
				<input className="search-input" type="date" style={{ height: 30 }} value={from} onChange={(e) => setFrom(e.target.value)} title="From" />
				<span style={{ color: 'var(--fg-muted)' }}>→</span>
				<input className="search-input" type="date" style={{ height: 30 }} value={to} onChange={(e) => setTo(e.target.value)} title="To" />
				{/* An empty `from` makes the API fall back to a rolling 30 days, so
				    "all time" has to be an explicit floor date rather than a blank. */}
				<button className="btn ghost" onClick={() => { setFrom(daysAgo(365)); setTo(''); }}>Last 12 months</button>
				<button className="btn ghost" onClick={() => { setFrom(ALL_TIME_FROM); setTo(''); }}>All time</button>
				<div style={{ flex: 1 }} />
				<button className="btn ghost" onClick={() => setUsersOpen(true)}>Per-user downloads →</button>
			</div>

			<StatStrip cols={4}>
				<StatCard label="Downloads in window" loading={an.isLoading} value={windowed.toLocaleString()}
					sub={`${(dl?.total ?? 0).toLocaleString()} all time`} />
				<StatCard label="Unique users" loading={an.isLoading} value={uniqueWindowed.toLocaleString()}
					sub={`${(dl?.unique_users ?? 0).toLocaleString()} all time`} />
				<StatCard label="Reports downloaded" loading={rs.isLoading} value={(rs.data?.total_reports ?? 0).toLocaleString()} sub="distinct reports in window" />
				<StatCard label="Avg / user" loading={an.isLoading} value={avgPerUser.toFixed(1)} sub="downloads per downloading user, in window" />
			</StatStrip>

			<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)', marginBottom: 'var(--space-5)' }}>
				<Section title="Top reports" meta="most downloaded in window">
					<AsyncState loading={an.isLoading} error={an.error} empty={topSeg.length === 0} emptyMsg="No downloads in this window" onRetry={() => void an.mutate()}>
						<PieDonut segments={topSeg} mode="bar" />
					</AsyncState>
				</Section>
				<Section title="Monthly downloads" meta="last 12 months">
					<AsyncState loading={rs.isLoading} error={rs.error} empty={monthly.length === 0} emptyMsg="No downloads yet" onRetry={() => void rs.mutate()}>
						<ComboBarLine data={monthly} height={200} valueFormatter={(v) => String(Math.round(v))} barLabel="Downloads" lineLabel="downloads" />
					</AsyncState>
				</Section>
			</div>

			{/* Daily downloads gets its own full-width row: as a grid item its huge
			    intrinsic width stretched the track and pushed the card off-screen. */}
			<div style={{ minWidth: 0, marginBottom: 'var(--space-5)' }}>
				<Section title="Daily downloads" meta={`in the selected window · ${daily.length} days`}>
					<AsyncState loading={an.isLoading} error={an.error} empty={daily.length === 0} emptyMsg="No downloads in this window" onRetry={() => void an.mutate()}>
						{/* Zoom sets pixels-per-day: at "Fit" the whole window is squeezed into
						    the card, and widening it spreads the x-axis out and scrolls instead. */}
						<div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
							<span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>Zoom</span>
							<button className="btn ghost" aria-label="Zoom out" disabled={dailyBand === 0}
								onClick={() => setDailyBand((b) => (b <= 8 ? 0 : b - 8))}>−</button>
							<button className="btn ghost" aria-label="Zoom in" disabled={dailyBand >= 64}
								onClick={() => setDailyBand((b) => Math.min(64, (b || 8) + 8))}>+</button>
							<button className={`chip ${dailyBand === 0 ? 'on' : ''}`} onClick={() => setDailyBand(0)}>Fit</button>
							<span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
								{dailyBand === 0 ? 'whole window in view' : `${dailyBand}px per day · scroll sideways`}
							</span>
						</div>
						<ComboBarLine data={daily} height={220} minBand={dailyBand} valueFormatter={(v) => String(Math.round(v))} barLabel="Downloads" lineLabel="downloads" />
					</AsyncState>
				</Section>
			</div>

			<div style={{ marginBottom: 'var(--space-5)' }}>
				<Section title="By day of week" meta="in the selected window">
					<AsyncState loading={an.isLoading} error={an.error} empty={dowSeg.length === 0} emptyMsg="No data" onRetry={() => void an.mutate()}>
						<PieDonut segments={dowSeg} mode="bar" />
					</AsyncState>
				</Section>
			</div>

			<Section title="Report statistics" meta={`${reports.length} reports in window`}>
				<div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
					<input className="search-input" style={{ flex: '0 0 260px', height: 32 }} placeholder="Search reports…" value={q} onChange={(e) => setQ(e.target.value)} />
					{/* Plain Select, not FilterSelect — the latter prepends an "all" option,
					    which would duplicate "Total downloads" and means nothing for a sort. */}
					<Select ariaLabel="Sort by" value={sort} onChange={(v) => setSort(v as typeof sort)}
						options={REPORT_SORTS.map((s) => ({ value: s.key, label: s.label }))} />
				</div>
				<AsyncState loading={rs.isLoading} error={rs.error} empty={reports.length === 0} emptyMsg={q ? 'No reports match.' : 'No downloads in this window.'} onRetry={() => void rs.mutate()}>
					<div className="table-scroll">
						<table className="data-table">
							<thead><tr>
								<th>Report</th>
								<th style={{ textAlign: 'right' }}>Downloads</th>
								<th style={{ textAlign: 'right' }}>Unique users</th>
								<th style={{ textAlign: 'right' }}>Per user</th>
								<th>Last download</th>
							</tr></thead>
							<tbody>
								{reports.map((r) => (
									<tr key={r.report_id}>
										<td>{r.title}</td>
										<td className="num" style={{ textAlign: 'right', fontWeight: 600 }}>{r.downloads.toLocaleString()}</td>
										<td className="num" style={{ textAlign: 'right' }}>{r.unique_users.toLocaleString()}</td>
										<td className="num" style={{ textAlign: 'right', color: 'var(--fg-muted)' }}>{r.unique_users ? (r.downloads / r.unique_users).toFixed(1) : '—'}</td>
										<td className="num">{r.last_download ? new Date(r.last_download).toLocaleDateString() : '—'}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</AsyncState>
			</Section>

			{usersOpen && <ReportUsersModal onClose={() => setUsersOpen(false)} />}
		</>
	);
}

// ─── Mixpanel embed ──────────────────────────────────────────────────────────
// NOTE: the embed URL carries a passcode, so it ships in the client bundle.
// Move it to NEXT_PUBLIC_MIXPANEL_EMBED (or proxy it) if that's a concern.
const MIXPANEL_EMBED = process.env.NEXT_PUBLIC_MIXPANEL_EMBED
	?? 'https://eu.mixpanel.com/p/7MkWY37CUE2uzv89QtV1YT?embed=true&passcode=Sportstechx%4012345';

function MixpanelEmbed() {
	return (
		<div className="card" style={{ padding: 0, overflow: 'hidden' }}>
			<iframe src={MIXPANEL_EMBED} title="Mixpanel Dashboard" style={{ width: '100%', height: '78vh', border: 0, display: 'block' }} />
		</div>
	);
}

// ─── Tabbed shell ────────────────────────────────────────────────────────────
const TABS = [
	{ key: 'directory', label: 'Directory' },
	{ key: 'signups', label: 'Signups & subscription' },
	{ key: 'engagement', label: 'Engagement' },
	{ key: 'reports', label: 'Reports' },
	{ key: 'mixpanel', label: 'Mixpanel' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

const SUBTITLES: Record<TabKey, string> = {
	directory: 'Search, filter and manage every account — roles, tiers, trials and access.',
	signups: 'Signup volume and cadence, tier mix, trial-to-paid conversion and new subscriptions.',
	engagement: 'Auth activity, conversion, churn and login recency.',
	reports: 'Report download volume, top reports, trends and per-report statistics.',
	mixpanel: 'Live product analytics from Mixpanel.',
};

export default function UsersAdminPage() {
	const [tab, setTab] = useState<TabKey>('directory');
	const stats = useSWR<UserStats>(['/api/admin/stats/users'], { dedupingInterval: 60_000 });

	useEffect(() => {
		const t = new URLSearchParams(window.location.search).get('tab');
		if (t && TABS.some((x) => x.key === t)) setTab(t as TabKey);
	}, []);
	const onTab = (t: TabKey) => {
		setTab(t);
		const url = new URL(window.location.href);
		url.searchParams.set('tab', t);
		window.history.replaceState(null, '', url.toString());
	};

	return (
		<div>
			<PageHeader
				kicker={`Identity · ${(stats.data?.total ?? 0).toLocaleString()} users`}
				title="User analytics"
				subtitle={SUBTITLES[tab]}
			/>
			<PillTabs tabs={TABS.map((t) => ({ key: t.key, label: t.label }))} value={tab} onChange={onTab} />
			<div style={{ marginTop: 'var(--space-4)' }}>
				{tab === 'directory' && <UsersView view="directory" />}
				{tab === 'signups' && <><UsersView view="stats" /><SignupBehaviour /></>}
				{tab === 'engagement' && <UsersView view="charts" />}
				{tab === 'reports' && <ReportsAnalytics />}
				{tab === 'mixpanel' && <MixpanelEmbed />}
			</div>
		</div>
	);
}
