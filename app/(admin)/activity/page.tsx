'use client';

import useSWR from 'swr';
import { PageHeader, Section } from '@/components/atoms';
import { AdminActivityTable } from '@/components/admin-activity';
import { FilterBar, FilterSelect } from '@/components/filters';
import { useUrlState } from '@/hooks/use-url-state';
import { useDebouncedValue } from '@/hooks/use-debounced-value';

interface Actor { id: string; email: string | null; name: string | null; actions: number }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Admin activity — every change made through the admin panel: who, when, what, on which record, and whether it
 * worked (tier and access changes, admin roles, credit grants, deletions, edits…). Recorded since 18 Nov 2026.
 * Row-level before/after values live in the database audit log.
 */
export default function AdminActivityPage() {
	const [q, setQ] = useUrlState('act', 'q');
	const [actor, setActor] = useUrlState('act', 'actor');
	const [target, setTarget] = useUrlState('act', 'target');
	const [from, setFrom] = useUrlState('act', 'from');
	const [to, setTo] = useUrlState('act', 'to');
	const [sort, setSort] = useUrlState('act', 'sort', '-when');
	const dq = useDebouncedValue(q.trim());
	const dTarget = useDebouncedValue(target.trim());
	// The server takes a profile id or an email; anything half-typed is left out until it is one.
	const targetOk = UUID.test(dTarget) || EMAIL.test(dTarget);
	const { data: actors } = useSWR<Actor[]>(['/api/admin/activity/actors'], { dedupingInterval: 60_000 });
	const active = [q, actor, target, from, to].filter(Boolean).length;
	const clear = () => { for (const set of [setQ, setActor, setTarget, setFrom, setTo]) set(''); };
	const dateInput = (label: string, value: string, set: (v: string) => void) => (
		<input className="search-input" type="date" style={{ height: 32, width: 140 }} value={value} onChange={(e) => set(e.target.value)} aria-label={label} title={label} />
	);
	return (
		<>
			<PageHeader kicker="Performance" title="Admin activity" subtitle="Every change made through the admin panel: who made it, when, on which record, and the result. Recorded since 18 Nov 2026; kept indefinitely." />
			<Section title="Actions">
				<FilterBar>
					<input className="search-input" style={{ height: 32, width: 280 }} placeholder="Search: users, credits, reports, an email…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search admin actions" />
					<FilterSelect ariaLabel="Admin" value={actor} onChange={setActor} allLabel="All admins"
						options={(actors ?? []).map((a) => ({ value: a.id, label: `${a.name || a.email || a.id.slice(0, 8)} (${a.actions})` }))} />
					<input className="search-input" style={{ height: 32, width: 240 }} placeholder="On user: email or id" value={target} onChange={(e) => setTarget(e.target.value)}
						aria-label="Target user email or id" title={target && !targetOk ? 'Enter a full email or user id' : undefined} />
					<span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>Date</span>
					{dateInput('From', from, setFrom)}<span style={{ color: 'var(--fg-muted)' }}>–</span>{dateInput('To', to, setTo)}
					{active > 0 && <button className="btn ghost" onClick={clear}>Clear {active} filter{active === 1 ? '' : 's'}</button>}
				</FilterBar>
				<AdminActivityTable
					filter={{ q: dq || undefined, actor: actor || undefined, target: targetOk ? dTarget : undefined, from: from || undefined, to: to || undefined, sort: sort === '-when' ? undefined : sort }}
					onSort={setSort}
					emptyMsg={active ? 'No admin actions match these filters.' : undefined}
				/>
			</Section>
		</>
	);
}
