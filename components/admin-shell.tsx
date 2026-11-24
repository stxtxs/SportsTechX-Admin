'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { useRestoreListQuery } from '@/hooks/use-url-state';
import useSWR from 'swr';
import { ChevronDown, LogOut, Menu, Sun, Moon } from 'lucide-react';
import { NAV_GROUPS, activeNavItem, type NavGroup, type NavItem } from '@/lib/admin-nav';
import { CommandPalette } from '@/components/command-palette';
import { useTheme } from 'next-themes';
import { useAuthSession } from '@/hooks/use-auth-session';
import { useIsAdmin, useUserProfile } from '@/hooks/use-user-profile';
import { useAdminRealtime } from '@/hooks/use-admin-realtime';
import { Tooltip } from '@/components/tooltip';
import { AdminNotifications } from '@/components/admin-notifications';

/** Light/dark toggle — the old admin ships both themes; default is dark. */
function ThemeToggle() {
	const { theme, setTheme } = useTheme();
	const [mounted, setMounted] = useState(false);
	useEffect(() => setMounted(true), []);
	const dark = theme === 'dark';
	return (
		<Tooltip label={dark ? 'Switch to light mode' : 'Switch to dark mode'} side="bottom">
			<button className="btn ghost" onClick={() => setTheme(dark ? 'light' : 'dark')} aria-label="Toggle theme">
				{mounted && !dark ? <Moon size={14} /> : <Sun size={14} />}
			</button>
		</Tooltip>
	);
}

type NavCounts = Partial<Record<NonNullable<NavItem['count']>[number], number>>;
const countOf = (item: NavItem, counts?: NavCounts) => (item.count ?? []).reduce((n, k) => n + (counts?.[k] ?? 0), 0);

/** Groups the admin closed, remembered in this browser (a layout preference, nothing more). */
const COLLAPSE_KEY = 'admin.nav.collapsed';
function useCollapsedGroups(): [Set<string>, (id: string) => void] {
	const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(NAV_GROUPS.filter((g) => g.collapsedByDefault).map((g) => g.id)));
	useEffect(() => {
		try { const v = localStorage.getItem(COLLAPSE_KEY); if (v) setCollapsed(new Set(JSON.parse(v) as string[])); } catch { /* defaults */ }
	}, []);
	const toggle = (id: string) => setCollapsed((cur) => {
		const next = new Set(cur);
		if (next.has(id)) next.delete(id); else next.add(id);
		try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...next])); } catch { /* not remembered */ }
		return next;
	});
	return [collapsed, toggle];
}

/** One sidebar group: a header that folds it, its links, and how many things wait in it. */
function NavSection({ group, activeHref, collapsed, onToggle, counts, onNavigate }: {
	group: NavGroup; activeHref: string | null; collapsed: boolean; onToggle: () => void; counts?: NavCounts; onNavigate: () => void;
}) {
	// The group holding the current page is always open.
	const open = !collapsed || group.items.some((i) => i.href === activeHref);
	const waiting = group.items.reduce((n, i) => n + countOf(i, counts), 0);
	return (
		<div className="nav-group">
			<button type="button" className="nav-group-label nav-group-toggle" onClick={onToggle} aria-expanded={open}>
				<span style={{ flex: 1 }}>{group.label}</span>
				{!open && waiting > 0 && <span className="nav-count">{waiting}</span>}
				<ChevronDown size={12} style={{ transform: open ? 'none' : 'rotate(-90deg)', transition: 'transform .15s', opacity: 0.7 }} />
			</button>
			{open && group.items.map((item) => {
				const n = countOf(item, counts);
				return (
					<Link key={item.href} href={item.href} className={`nav-link ${item.href === activeHref ? 'active' : ''}`} onClick={onNavigate}>
						<item.Icon size={15} /> <span style={{ flex: 1 }}>{item.label}</span>
						{n > 0 && <span className="nav-count" title={`${n} waiting`}>{n > 999 ? '999+' : n}</span>}
					</Link>
				);
			})}
		</div>
	);
}

/**
 * Admin shell — auth-gated, admin-role-gated wrapper for every admin page.
 *
 *  - Redirects unauthenticated users to /login
 *  - Redirects non-admin users to /forbidden
 *  - Renders the rail + topbar + content layout
 */
/** Brings back a list page's last filters/page when you return to it (see use-url-state). */
function RestoreListQuery() { useRestoreListQuery(); return null; }

export function AdminShell({ children }: { children: React.ReactNode }) {
	const { session, loading: authLoading, signOut } = useAuthSession();
	const { isAdmin, isLoading: adminLoading } = useIsAdmin();
	const { data: profile } = useUserProfile();
	const router = useRouter();
	const pathname = usePathname();
	const [navOpen, setNavOpen] = useState(false);
	const [collapsed, toggleGroup] = useCollapsedGroups();
	useAdminRealtime(); // live SSE → SWR invalidation (e.g. Attio pipeline sync)

	useEffect(() => {
		if (authLoading) return;
		if (!session) {
			router.replace('/login');
			return;
		}
		if (!adminLoading && !isAdmin) {
			router.replace('/forbidden');
		}
	}, [authLoading, session, adminLoading, isAdmin, router]);

	// The browser tab names the page ("Reports | SportsTechX Admin"), as the topbar does.
	const pageLabel = activeNavItem(pathname)?.label;
	// Re-applied once the shell is ready: set while loading, Next's own <title> writes over it.
	const shellReady = !authLoading && !adminLoading && !!session && isAdmin;
	useEffect(() => { document.title = pageLabel ? `${pageLabel} | SportsTechX Admin` : 'SportsTechX Admin'; }, [pageLabel, shellReady]);

	// What waits in each review queue (sidebar counts); refreshed every minute and after writes.
	const { data: counts } = useSWR<NavCounts>(shellReady ? ['/api/admin/stats/nav'] : null, { refreshInterval: 60_000, dedupingInterval: 30_000 });

	if (authLoading || adminLoading || !session || !isAdmin) {
		return (
			<div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}>
				<div style={{ fontFamily: 'var(--font-mono)', color: 'var(--fg-muted)', fontSize: 12 }}>
					Loading admin…
				</div>
			</div>
		);
	}

	const initials = (profile?.display_name || profile?.email || 'A')
		.split(/\s+/)
		.map((w) => w[0])
		.slice(0, 2)
		.join('')
		.toUpperCase();

	const current = activeNavItem(pathname);
	const activeHref = current?.href ?? null;

	return (
		<div style={{ minHeight: '100vh' }}>
			<div className={`admin-scrim ${navOpen ? 'open' : ''}`} onClick={() => setNavOpen(false)} />

			<aside className={`admin-rail ${navOpen ? 'open' : ''}`}>
				<div className="admin-rail-brandrow">
					<div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
						{/* The brand mark on its own, not the lockup: the wordmark is
						    already spelled out beside it, and at this size it would
						    be illegible anyway. Pink reads on both themes, so it
						    needs no dark/light variant. */}
						{/* eslint-disable-next-line @next/next/no-img-element */}
						<img
							src="/stx-mark.png"
							alt="SportsTechX"
							width={28}
							height={28}
							style={{ width: 28, height: 28, objectFit: 'contain', flex: 'none' }}
						/>
						<div>
							<div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--sidebar-muted)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 4 }}>
								SportsTechX
							</div>
							<div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 800, letterSpacing: '-0.02em' }}>
								Admin
							</div>
						</div>
					</div>
				</div>
				<nav>
					{NAV_GROUPS.map((group) => (
						<NavSection key={group.id} group={group} activeHref={activeHref} counts={counts}
							collapsed={collapsed.has(group.id)} onToggle={() => toggleGroup(group.id)} onNavigate={() => setNavOpen(false)} />
					))}
				</nav>
			</aside>

			<Suspense fallback={null}><RestoreListQuery /></Suspense>
			<main className="admin-main">
				<header className="admin-topbar">
					<button className="btn ghost admin-rail-toggle" onClick={() => setNavOpen((v) => !v)} aria-label="Toggle navigation">
						<Menu size={16} />
					</button>
					<div className="admin-topbar-title">{current?.label ?? 'Admin'}</div>
					<div style={{ flex: 1 }} />
					<CommandPalette />
					<AdminNotifications />
					<ThemeToggle />
					<div className="admin-avatar" title={profile?.email ?? undefined}>{initials}</div>
					<button onClick={() => signOut().then(() => router.replace('/login'))} className="btn ghost" title="Sign out">
						<LogOut size={12} /> Sign out
					</button>
				</header>
				<div style={{ flex: 1, padding: 'var(--space-5) var(--space-4)' }}>
					<div className="admin-content">{children}</div>
				</div>
			</main>
		</div>
	);
}
