'use client';

import { Suspense } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import useSWR from 'swr';
import { PageHeader, PillTabs } from '@/components/atoms';
import { ClaimsView } from '@/components/admin-views/claims';
import { DataRequestsView } from '@/components/admin-views/data-requests';

/**
 * One queue for every ownership claim and data-change request — companies,
 * investors and ecosystem entities together. The per-section tabs (Companies →
 * Claims, Ecosystem → Investor claims, …) stay as scoped views; this page is the
 * place to work the whole queue without guessing which section a request is in.
 */
type Tab = 'claims' | 'changes';

interface QueueStats {
	claims: { pending: number; picked_up: number };
	data_requests: Array<{ label: string; value: number }>;
}

function ClaimsAndChanges() {
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const tab: Tab = searchParams.get('tab') === 'changes' ? 'changes' : 'claims';
	// Keep each tab's own list filters (co.*, deal.* …) when switching tabs.
	const setTab = (t: Tab) => { const q = new URLSearchParams(window.location.search); q.set('tab', t); q.delete('q'); window.history.replaceState(null, '', `${pathname}?${q}`); };

	const stats = useSWR<QueueStats>(['/api/admin/stats/queues'], { dedupingInterval: 60_000 });
	// Open = not yet picked up + picked up but not decided — the same set as the list's "Pending".
	const pendingClaims = (stats.data?.claims.pending ?? 0) + (stats.data?.claims.picked_up ?? 0);
	const openChanges = stats.data?.data_requests.find((b) => b.label === 'open')?.value ?? 0;
	const count = (n: number) => (n > 0 ? ` (${n.toLocaleString()})` : '');

	return (
		<div>
			<PageHeader kicker="Queues" title="Claims & data changes" subtitle="Every ownership claim and data-change request — companies, investors and ecosystem — in one place." />
			<div style={{ marginBottom: 'var(--space-4)' }}>
				<PillTabs
					tabs={[
						{ key: 'claims', label: `Claims${count(pendingClaims)}` },
						{ key: 'changes', label: `Data changes${count(openChanges)}` },
					]}
					value={tab}
					onChange={setTab}
				/>
			</div>
			{tab === 'claims' ? <ClaimsView embedded /> : <DataRequestsView embedded />}
		</div>
	);
}

export default function ClaimsPage() {
	// useSearchParams needs a Suspense boundary under the App Router.
	return <Suspense><ClaimsAndChanges /></Suspense>;
}
