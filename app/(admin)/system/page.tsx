'use client';

import { useEffect, useState } from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { PageHeader, AsyncState, Section } from '@/components/atoms';

/**
 * System settings — global, runtime switches the admin panel owns (`app_settings`). No redeploy needed.
 *
 *  - Email: the pre-launch kill switch. While on, the app sends ONLY transactional auth mail and
 *    support requests; the outbox caches it ~30s.
 *  - VC Benchmark: shows the benchmark surfaces in Atlas (report card, "Your benchmark", the survey
 *    call to action). Atlas reads it within about a minute. These replace the old
 *    NEXT_PUBLIC_VC_BENCHMARK* env vars.
 */
interface AppSettings {
	pause_nonessential_emails: boolean;
	vc_benchmark_enabled: boolean;
	vc_benchmark_survey_url: string | null;
	vc_benchmark_release: string;
	updated_at: string;
}

export default function SystemSettingsPage() {
	const { data, mutate, isLoading, error } = useSWR<AppSettings>('/api/admin/app-settings');
	const [saving, setSaving] = useState(false);
	const [survey, setSurvey] = useState('');
	const [release, setRelease] = useState('');
	useEffect(() => {
		if (!data) return;
		setSurvey(data.vc_benchmark_survey_url ?? '');
		setRelease(data.vc_benchmark_release ?? '');
	}, [data]);

	const save = async (patch: Partial<AppSettings>, done: string) => {
		setSaving(true);
		try {
			const updated = await api<AppSettings>('PATCH', '/api/admin/app-settings', patch);
			await mutate(updated, false);
			toast.success(done);
		} catch (e) {
			toast.error((e as Error).message);
		} finally {
			setSaving(false);
		}
	};
	const paused = data?.pause_nonessential_emails ?? true;
	const benchmarkOn = data?.vc_benchmark_enabled ?? false;
	const surveyChanged = data && survey.trim() !== (data.vc_benchmark_survey_url ?? '');
	const releaseChanged = data && release !== data.vc_benchmark_release;

	return (
		<>
			<PageHeader kicker="System" title="System settings" subtitle="Global switches that take effect across the whole app, with no redeploy." />
			<AsyncState loading={isLoading} error={error} onRetry={() => void mutate()}>
				<Section title="Email" meta="Pre-launch">
					<Row
						title="Pause non-essential emails"
						on={paused} saving={saving}
						onToggle={() => void save({ pause_nonessential_emails: !paused }, paused ? 'Non-essential emails resumed' : 'Non-essential emails paused')}
						status={data && `${paused ? 'PAUSED' : 'ACTIVE'} · updated ${new Date(data.updated_at).toLocaleString()}`}
					>
						While this is on, the app sends <strong>only</strong> sign-up confirmation, password
						reset, magic-link login, email-change confirmation and support requests. All
						notifications, saved-search digests and trial / report alerts are held — use this
						before launch so test users stop receiving mail. Turn it off to resume everything.
					</Row>
				</Section>

				<div style={{ marginTop: 'var(--space-4)' }}>
					<Section title="VC Deal Sourcing Benchmark" meta="Reports">
						<Row
							title="Show the VC Benchmark in Atlas"
							on={benchmarkOn} saving={saving}
							onToggle={() => void save({ vc_benchmark_enabled: !benchmarkOn }, benchmarkOn ? 'VC Benchmark hidden' : 'VC Benchmark shown')}
							status={`${benchmarkOn ? 'ON' : 'OFF'} · Atlas picks it up within a minute`}
						>
							The benchmark&rsquo;s report card and Home pin, &ldquo;Your benchmark&rdquo; for contributors and the
							investor call to action. The report itself is still served only to signed-in users, and its
							gated sections only to Raise, Scout and contributors. Contributors are managed under
							Reports › Benchmark contributors.
						</Row>
						<div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14, marginTop: 16 }}>
							<label style={{ display: 'grid', gap: 6, fontSize: 12.5 }}>
								<span style={{ fontWeight: 600 }}>Survey link <span style={{ color: 'var(--fg-muted)', fontWeight: 400 }}>· https, empty hides &ldquo;Take the survey&rdquo;</span></span>
								<div style={{ display: 'flex', gap: 8 }}>
									<input className="search-input" style={{ flex: 1 }} placeholder="https://…" value={survey} onChange={(e) => setSurvey(e.target.value)} />
									<button className="btn" disabled={saving || !surveyChanged} onClick={() => void save({ vc_benchmark_survey_url: survey.trim() || null }, 'Survey link saved')}>Save</button>
								</div>
							</label>
							<label style={{ display: 'grid', gap: 6, fontSize: 12.5 }}>
								<span style={{ fontWeight: 600 }}>Release date <span style={{ color: 'var(--fg-muted)', fontWeight: 400 }}>· sets how long it&rsquo;s featured on Home</span></span>
								<div style={{ display: 'flex', gap: 8 }}>
									<input className="search-input" type="date" style={{ flex: 1 }} value={release} onChange={(e) => setRelease(e.target.value)} />
									<button className="btn" disabled={saving || !releaseChanged || !release} onClick={() => void save({ vc_benchmark_release: release }, 'Release date saved')}>Save</button>
								</div>
							</label>
						</div>
					</Section>
				</div>
			</AsyncState>
		</>
	);
}

function Row({ title, on, saving, onToggle, status, children }: { title: string; on: boolean; saving: boolean; onToggle: () => void; status?: string | false; children: React.ReactNode }) {
	return (
		<div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
			<div style={{ flex: 1, minWidth: 280 }}>
				<div style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg)' }}>{title}</div>
				<p style={{ fontSize: 12.5, color: 'var(--fg-2)', lineHeight: 1.55, margin: '6px 0 0', maxWidth: 560 }}>{children}</p>
				{status && <div style={{ fontSize: 11, color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)', marginTop: 10 }}>{status}</div>}
			</div>
			<button
				type="button" role="switch" aria-checked={on} aria-label={title} disabled={saving} onClick={onToggle}
				style={{
					position: 'relative', width: 54, height: 30, flex: 'none', borderRadius: 999,
					border: '1px solid var(--border)', cursor: saving ? 'wait' : 'pointer',
					background: on ? 'var(--accent, #e11d8f)' : 'var(--bg-2)', transition: 'background .15s', opacity: saving ? 0.6 : 1,
				}}
			>
				<span style={{ position: 'absolute', top: 3, left: on ? 27 : 3, width: 22, height: 22, borderRadius: '50%', background: '#fff', transition: 'left .15s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }} />
			</button>
		</div>
	);
}
