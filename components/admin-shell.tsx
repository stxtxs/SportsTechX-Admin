'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
	LayoutDashboard, Briefcase, Users, FilePlus, FileText, Layers,
	Activity, ShoppingCart, LogOut, CreditCard, ToggleLeft,
	Banknote, Sparkles, Tag, BookOpen, Menu, BarChart3, Gauge,
	Receipt, Package, Handshake, Download, Coins, ChevronDown, Sun, Moon, Newspaper, Undo2,
	Images, Rocket, CalendarClock, SlidersHorizontal, ShieldCheck, DatabaseZap, Mail,
} from 'lucide-react';
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

type IconType = typeof LayoutDashboard;
interface NavLeaf { href: string; label: string }
// A nav item is either a direct link (href) or a parent that expands into child
// pages (children). This mirrors the STX-WebApp admin, where each top tab that
// had its own sub-tabs becomes an expandable group whose sub-tabs are pages.
interface NavItem { href?: string; label: string; Icon: IconType; children?: NavLeaf[] }
interface NavGroup { label: string; items: NavItem[] }

// ── Sidebar grouped like the old admin: Data / Sales / Performance ───────────
// The old admin bucketed its 12 tabs into three top groups. We keep the sidebar
// + routed pages but mirror that grouping; nested tabs stay as expandable child
// pages, and the new-build features slot into the closest group.
const DATA_NAV: NavItem[] = [
	{ label: 'Dashboard', href: '/dashboard', Icon: LayoutDashboard },
	{ label: 'Claims & data changes', href: '/claims', Icon: ShieldCheck },
	{ label: 'Companies & Deals', href: '/companies', Icon: Briefcase },
	{ label: 'Ecosystem', href: '/ecosystem', Icon: Layers },
	{ label: 'Startups to add', href: '/startups-pipeline', Icon: FilePlus },
	{ label: 'Investors to add', href: '/investor-review', Icon: Banknote },
	{ label: 'Reports', href: '/reports', Icon: FileText },
	{ label: 'Featured lists', href: '/featured-lists', Icon: Sparkles },
	{ label: 'Reference data', href: '/reference', Icon: BookOpen },
	{ label: 'Polls', href: '/polls', Icon: Sparkles },
	{ label: 'Market roundup', href: '/market-roundup', Icon: Newspaper },
	{ label: 'Site assets', href: '/site-assets', Icon: Images },
	{ label: 'Intro requests', href: '/intro-requests', Icon: Handshake },
	{ label: 'Strategy sessions', href: '/strategy-sessions', Icon: CalendarClock },
	{ label: 'Fundraising Guide', href: '/raise-resources', Icon: BookOpen },
	{ label: 'Deal Flow', href: '/scout-deals', Icon: Rocket },
];

const SALES_NAV: NavItem[] = [
	// One Sales entry with in-page sub-tabs (Sales Tracker / Sales Entry /
	// Touchpoints / Stripe) — mirrors the legacy STX-WebApp Sales tab.
	{ label: 'Sales', href: '/sales', Icon: ShoppingCart },
	{ label: 'Billing', href: '/billing', Icon: CreditCard },
	{ label: 'Plans', href: '/subscription-plans', Icon: Tag },
	{ label: 'Credit packs', href: '/credit-packs', Icon: Package },
	// Pro-rata refunds owed after an in-app downgrade — a money-out queue, so
	// it sits with the other billing surfaces rather than in the review group.
	{ label: 'Refunds', href: '/refunds', Icon: Undo2 },
];

const PERFORMANCE_NAV: NavItem[] = [
	// One entry with in-page sub-tabs (Directory / Signups / Engagement / Mixpanel).
	{ label: 'User analytics', href: '/users', Icon: BarChart3 },
	{ label: 'Performance', href: '/performance', Icon: Gauge },
	{ label: 'Activity analytics', href: '/analytics', Icon: Activity },
	{ label: 'AI usage & cost', href: '/ai-usage', Icon: Receipt },
	{ label: 'Credit usage', href: '/credit-usage', Icon: Coins },
	{ label: 'Feature flags', href: '/features', Icon: ToggleLeft },
	{ label: 'Jobs & integrations', href: '/jobs', Icon: Activity },
	{ label: 'Export columns', href: '/exports', Icon: Download },
	{ label: 'Emails', href: '/emails', Icon: Mail },
	{ label: 'System settings', href: '/system', Icon: SlidersHorizontal },
	{ label: 'Data migration', href: '/data-migration', Icon: DatabaseZap },
];

const NAV_GROUPS: NavGroup[] = [
	{ label: 'Data', items: DATA_NAV },
	{ label: 'Sales', items: SALES_NAV },
	{ label: 'Performance', items: PERFORMANCE_NAV },
];

// Flat list of every reachable page (parents + children) for the topbar title.
const ALL_LEAVES: NavLeaf[] = NAV_GROUPS.flatMap((g) =>
	g.items.flatMap((it) => (it.children ? it.children : it.href ? [{ href: it.href, label: it.label }] : [])),
);

const leafActive = (pathname: string | null, href: string): boolean =>
	pathname === href || (!!pathname && pathname.startsWith(`${href}/`));

// The active leaf is the longest href that prefixes the current path, so a child
// page (/companies/claims) wins over its section root (/companies).
function activeLeafHref(pathname: string | null): string | null {
	const matches = ALL_LEAVES.filter((l) => leafActive(pathname, l.href));
	if (!matches.length) return null;
	return matches.sort((a, b) => b.href.length - a.href.length)[0].href;
}

/** One sidebar row — a direct link, or an expandable parent with child pages. */
function NavRow({ item, activeHref, onNavigate }: { item: NavItem; activeHref: string | null; onNavigate: () => void }) {
	const branchActive = !!item.children?.some((c) => c.href === activeHref);
	const [open, setOpen] = useState(branchActive);
	useEffect(() => { if (branchActive) setOpen(true); }, [branchActive]);

	if (!item.children) {
		return (
			<Link href={item.href!} className={`nav-link ${item.href === activeHref ? 'active' : ''}`} onClick={onNavigate}>
				<item.Icon size={15} /> {item.label}
			</Link>
		);
	}
	return (
		<div>
			<button
				type="button"
				className={`nav-link nav-parent ${branchActive ? 'branch' : ''}`}
				style={{ width: '100%', background: 'none', border: 0, font: 'inherit', cursor: 'pointer', textAlign: 'left' }}
				onClick={() => setOpen((o) => !o)}
				aria-expanded={open}
			>
				<item.Icon size={15} />
				<span style={{ flex: 1 }}>{item.label}</span>
				<ChevronDown size={13} style={{ transform: open ? 'none' : 'rotate(-90deg)', transition: 'transform .15s', opacity: 0.7 }} />
			</button>
			{open && (
				<div style={{ margin: '2px 0 4px' }}>
					{item.children.map((c) => (
						<Link
							key={c.href}
							href={c.href}
							className={`nav-link nav-child ${c.href === activeHref ? 'active' : ''}`}
							style={{ paddingLeft: 34 }}
							onClick={onNavigate}
						>
							{c.label}
						</Link>
					))}
				</div>
			)}
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
export function AdminShell({ children }: { children: React.ReactNode }) {
	const { session, loading: authLoading, signOut } = useAuthSession();
	const { isAdmin, isLoading: adminLoading } = useIsAdmin();
	const { data: profile } = useUserProfile();
	const router = useRouter();
	const pathname = usePathname();
	const [navOpen, setNavOpen] = useState(false);
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
	const pageLabel = ALL_LEAVES.find((n) => n.href === activeLeafHref(pathname))?.label;
	// Re-applied once the shell is ready: set while loading, Next's own <title> writes over it.
	const shellReady = !authLoading && !adminLoading && !!session && isAdmin;
	useEffect(() => { document.title = pageLabel ? `${pageLabel} | SportsTechX Admin` : 'SportsTechX Admin'; }, [pageLabel, shellReady]);

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

	// Longest-prefix match so a child page (e.g. /companies/claims) wins over its
	// parent section (/companies) in the topbar title.
	const activeHref = activeLeafHref(pathname);
	const current = ALL_LEAVES.find((n) => n.href === activeHref);

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
						<div className="nav-group" key={group.label}>
							<div className="nav-group-label">{group.label}</div>
							{group.items.map((item) => (
								<NavRow key={item.label} item={item} activeHref={activeHref} onNavigate={() => setNavOpen(false)} />
							))}
						</div>
					))}
				</nav>
			</aside>

			<main className="admin-main">
				<header className="admin-topbar">
					<button className="btn ghost admin-rail-toggle" onClick={() => setNavOpen((v) => !v)} aria-label="Toggle navigation">
						<Menu size={16} />
					</button>
					<div className="admin-topbar-title">{current?.label ?? 'Admin'}</div>
					<div style={{ flex: 1 }} />
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
