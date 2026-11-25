import {
	LayoutDashboard, Briefcase, Users, FilePlus, FileText, Layers, Activity, ShoppingCart, CreditCard, ToggleLeft,
	Banknote, Sparkles, Tag, BookOpen, Gauge, Receipt, Package, Handshake, Download, Coins, Newspaper, Undo2,
	Images, Rocket, CalendarClock, SlidersHorizontal, ShieldCheck, DatabaseZap, Mail, Pin, Award, History,
	Vote, Workflow, GraduationCap, MessageSquareWarning,
} from 'lucide-react';

export type IconType = typeof LayoutDashboard;
/** `count`: the key in /api/admin/stats/nav whose number shows beside the item (things waiting). */
export interface NavItem { href: string; label: string; Icon: IconType; count?: Array<'claims' | 'data_changes' | 'startups' | 'investors' | 'deal_flow' | 'intros' | 'sessions' | 'refunds' | 'feedback'>; keywords?: string }
export interface NavGroup { id: string; label: string; items: NavItem[]; collapsedByDefault?: boolean }

/**
 * The admin sidebar, by what an admin is doing: reviewing what came in, keeping the catalog,
 * publishing content, looking after users and money, reading numbers, running the system.
 * Each page appears once. The global search (⌘K) matches these labels and keywords too.
 */
export const NAV_GROUPS: NavGroup[] = [
	{ id: 'overview', label: 'Overview', items: [
		{ label: 'Dashboard', href: '/dashboard', Icon: LayoutDashboard, keywords: 'home overview kpi' },
	] },
	{ id: 'review', label: 'Review', items: [
		{ label: 'Claims & data changes', href: '/claims', Icon: ShieldCheck, count: ['claims', 'data_changes'], keywords: 'verify ownership requests edits' },
		{ label: 'Startups to add', href: '/startups-pipeline', Icon: FilePlus, count: ['startups'], keywords: 'pipeline new companies' },
		{ label: 'Investors to add', href: '/investor-review', Icon: Banknote, count: ['investors'], keywords: 'candidates review' },
		{ label: 'Deal Flow', href: '/scout-deals', Icon: Rocket, count: ['deal_flow'], keywords: 'scout raises submissions' },
		{ label: 'Intro requests', href: '/intro-requests', Icon: Handshake, count: ['intros'], keywords: 'introductions founders investors' },
		{ label: 'Strategy sessions', href: '/strategy-sessions', Icon: CalendarClock, count: ['sessions'], keywords: 'calls bookings meetings' },
		{ label: 'Refunds', href: '/refunds', Icon: Undo2, count: ['refunds'], keywords: 'money back downgrade' },
		{ label: 'Feedback', href: '/feedback', Icon: MessageSquareWarning, count: ['feedback'], keywords: 'bugs reports feature requests users' },
	] },
	{ id: 'catalog', label: 'Catalog', items: [
		{ label: 'Companies & Deals', href: '/companies', Icon: Briefcase, keywords: 'startups funding rounds m&a acquisitions' },
		{ label: 'Ecosystem', href: '/ecosystem', Icon: Layers, keywords: 'investors programs events initiatives organizations' },
		{ label: 'Reference data', href: '/reference', Icon: BookOpen, keywords: 'sectors sports tags rounds taxonomy' },
	] },
	{ id: 'content', label: 'Content', items: [
		{ label: 'Reports', href: '/reports', Icon: FileText, keywords: 'pdf gster ftabr benchmark editor' },
		{ label: 'Benchmark contributors', href: '/benchmark-contributors', Icon: Award, keywords: 'vc survey funds' },
		{ label: 'Market roundup', href: '/market-roundup', Icon: Newspaper, keywords: 'monthly newsletter' },
		{ label: 'Fundraising Guide', href: '/raise-resources', Icon: GraduationCap, keywords: 'raise resources checklist' },
		{ label: 'Polls', href: '/polls', Icon: Vote, keywords: 'votes questions' },
		{ label: 'Featured lists', href: '/featured-lists', Icon: Sparkles, keywords: 'curated' },
		{ label: 'Home pins', href: '/home-pins', Icon: Pin, keywords: 'pinned home' },
		{ label: 'Site assets', href: '/site-assets', Icon: Images, keywords: 'images logos cms testimonials team gallery' },
	] },
	{ id: 'users', label: 'Users & revenue', items: [
		{ label: 'Users', href: '/users', Icon: Users, keywords: 'accounts members logins signups directory' },
		{ label: 'Sales', href: '/sales', Icon: ShoppingCart, keywords: 'revenue tracker stripe touchpoints' },
		{ label: 'Billing tools', href: '/billing', Icon: CreditCard, keywords: 'trial comp credits grant access' },
		{ label: 'Plans', href: '/subscription-plans', Icon: Tag, keywords: 'subscriptions pricing tiers' },
		{ label: 'Credit packs', href: '/credit-packs', Icon: Package, keywords: 'top up' },
	] },
	{ id: 'insights', label: 'Insights', items: [
		{ label: 'Activity analytics', href: '/analytics', Icon: Activity, keywords: 'active users events' },
		{ label: 'Performance', href: '/performance', Icon: Gauge, keywords: 'latency speed endpoints' },
		{ label: 'AI usage & cost', href: '/ai-usage', Icon: Receipt, keywords: 'tokens anthropic openai spend' },
		{ label: 'Credit usage', href: '/credit-usage', Icon: Coins, keywords: 'spend' },
		{ label: 'Admin activity', href: '/activity', Icon: History, keywords: 'audit log history who changed' },
	] },
	{ id: 'system', label: 'System', collapsedByDefault: true, items: [
		{ label: 'Feature flags', href: '/features', Icon: ToggleLeft, keywords: 'toggles' },
		{ label: 'Jobs & integrations', href: '/jobs', Icon: Workflow, keywords: 'queues cron sync attio apollo' },
		{ label: 'Emails', href: '/emails', Icon: Mail, keywords: 'send log outbox ses' },
		{ label: 'Export columns', href: '/exports', Icon: Download, keywords: 'csv costs' },
		{ label: 'System settings', href: '/system', Icon: SlidersHorizontal, keywords: 'switches pause emails' },
		{ label: 'Data migration', href: '/data-migration', Icon: DatabaseZap, keywords: 'legacy hub sync' },
	] },
];

export const ALL_NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

const leafActive = (pathname: string | null, href: string): boolean => pathname === href || (!!pathname && pathname.startsWith(`${href}/`));
/** The nav item for the current path (longest matching href). */
export function activeNavItem(pathname: string | null): NavItem | undefined {
	return ALL_NAV_ITEMS.filter((l) => leafActive(pathname, l.href)).sort((a, b) => b.href.length - a.href.length)[0];
}
