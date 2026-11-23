'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabaseBrowser } from '@/lib/supabase';

export default function LoginPage() {
	const router = useRouter();
	const [email, setEmail] = useState('');
	const [password, setPassword] = useState('');
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	const submit = async (e: React.FormEvent) => {
		e.preventDefault();
		setBusy(true);
		setError(null);
		const supabase = getSupabaseBrowser();
		const { error: err } = await supabase.auth.signInWithPassword({ email, password });
		setBusy(false);
		if (err) {
			setError(err.message);
			return;
		}
		// Back to where the session expired (set by lib/api.ts). Resolve it as a URL and keep it
		// only if it stays on this origin: string checks miss "/\evil.com" and "/%09/evil.com".
		let dest = '/dashboard';
		try {
			const u = new URL(new URLSearchParams(window.location.search).get('redirectTo') ?? '', window.location.origin);
			if (u.origin === window.location.origin && !u.pathname.startsWith('/login')) dest = u.pathname + u.search + u.hash;
		} catch { /* malformed → dashboard */ }
		router.replace(dest);
	};

	return (
		<div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}>
			<form
				onSubmit={submit}
				style={{
					width: 360,
					padding: 'var(--space-5)',
					background: 'var(--surface)',
					border: '1px solid var(--border)',
				}}
			>
				<div
					style={{
						fontFamily: 'var(--font-mono)',
						fontSize: 10,
						color: 'var(--fg-muted)',
						textTransform: 'uppercase',
						letterSpacing: '0.12em',
						marginBottom: 4,
					}}
				>
					SportsTechX
				</div>
				<h1
					style={{
						fontFamily: 'var(--font-display)',
						fontSize: 28,
						fontWeight: 800,
						letterSpacing: '-0.02em',
						margin: '0 0 var(--space-4)',
					}}
				>
					Admin sign-in
				</h1>
				<div style={{ marginBottom: 12 }}>
					<div className="co-stat-label" style={{ marginBottom: 6 }}>Email</div>
					<input
						className="search-input"
						type="email"
						required
						style={{ width: '100%' }}
						value={email}
						onChange={(e) => setEmail(e.target.value)}
					/>
				</div>
				<div style={{ marginBottom: 12 }}>
					<div className="co-stat-label" style={{ marginBottom: 6 }}>Password</div>
					<input
						className="search-input"
						type="password"
						required
						style={{ width: '100%' }}
						value={password}
						onChange={(e) => setPassword(e.target.value)}
					/>
				</div>
				{error && (
					<div style={{ fontSize: 12, color: 'var(--neg)', marginBottom: 12 }}>{error}</div>
				)}
				<button className="btn" style={{ width: '100%', justifyContent: 'center' }} disabled={busy}>
					{busy ? 'Signing in…' : 'Sign in'}
				</button>
			</form>
		</div>
	);
}
