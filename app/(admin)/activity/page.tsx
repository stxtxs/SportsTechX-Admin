'use client';

import { useState } from 'react';
import { PageHeader, Section } from '@/components/atoms';
import { AdminActivityTable } from '@/components/admin-activity';

/**
 * Admin activity — every change made through the admin panel: who, when, what, on which record, and whether it
 * worked (tier and access changes, admin roles, credit grants, deletions, edits…). Recorded since 18 Nov 2026.
 * Row-level before/after values live in the database audit log.
 */
export default function AdminActivityPage() {
	const [text, setText] = useState('');
	const [q, setQ] = useState('');
	return (
		<>
			<PageHeader kicker="Performance" title="Admin activity" subtitle="Every change made through the admin panel: who made it, when, on which record, and the result. Recorded since 18 Nov 2026; kept indefinitely." />
			<Section title="Actions">
				<form style={{ display: 'flex', gap: 8, marginBottom: 12 }} onSubmit={(e) => { e.preventDefault(); setQ(text.trim()); }}>
					<input className="search-input" style={{ minWidth: 320 }} placeholder="Search: users, credits, reports, an email…" value={text} onChange={(e) => setText(e.target.value)} />
					<button className="btn" type="submit">Search</button>
					{q && <button className="btn ghost" type="button" onClick={() => { setText(''); setQ(''); }}>Clear</button>}
				</form>
				<AdminActivityTable key={q} filter={{ q: q || undefined }} />
			</Section>
		</>
	);
}
