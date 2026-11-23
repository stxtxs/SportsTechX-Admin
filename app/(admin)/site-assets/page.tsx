'use client';

import { useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { PageHeader, PillTabs } from '@/components/atoms';
import { Select } from '@/components/select';
import { AssetLibrary } from '@/components/site-assets/asset-library';
import { PlacementBoard } from '@/components/site-assets/placement-board';
import {
	ASSETS_KEY, PLACEMENTS_KEY,
	type Asset, type Placement, type SectionSpec, type SiteSchema,
} from '@/components/site-assets/shared';

/**
 * Site assets — the CMS behind the imagery and testimonials on the three public
 * marketing sites (Atlas, STX landing, Playmakers).
 *
 * Two tabs, matching the two things an admin does: upload images into a shared
 * library, then decide which image goes into which section of which site. The
 * same image can sit in several sections and on several sites — placements
 * reference the library, they don't own the file.
 *
 * Testimonials are not a separate tab: they are a section like any other, and
 * the schema marks them as image-optional with a multiline message field, so
 * the generic card editor covers them.
 *
 * Any section left empty is NOT an error — each site falls back to its own
 * built-in placeholders. Add one card and the site shows exactly one.
 */
type Tab = 'library' | 'placements';

const SITE_LABELS: Record<string, string> = {
	atlas: 'Atlas (atlas.sportstechx.com)',
	landing: 'STX landing',
	playmakers: 'Playmakers',
};

export default function SiteAssetsPage() {
	const [tab, setTab] = useState<Tab>('placements');
	const [site, setSite] = useState('atlas');
	const { mutate } = useSWRConfig();

	const SCHEMA_KEY = '/api/admin/site-content/schema';
	const schemaQ = useSWR<{ sites: SiteSchema }>([SCHEMA_KEY], { dedupingInterval: 300_000 });
	const assetsQ = useSWR<Asset[]>([ASSETS_KEY], { dedupingInterval: 15_000 });
	const placementsQ = useSWR<Placement[]>([PLACEMENTS_KEY, { site }], { dedupingInterval: 15_000 });

	const assets = assetsQ.data ?? [];
	const placements = placementsQ.data ?? [];

	// A card add/edit can change an asset's usage count, so both lists reload
	// together rather than leaving the tray badge stale.
	const reload = () => {
		void mutate([ASSETS_KEY]);
		void mutate([PLACEMENTS_KEY, { site }]);
	};
	// The board's Retry also refetches the schema: a schema fetch that failed would
	// otherwise keep the error screen up (its key is deduped for 5 minutes). Edits
	// never change the schema, so they use `reload` and skip it.
	const retry = () => { reload(); void mutate([SCHEMA_KEY]); };

	const sections = Object.entries(schemaQ.data?.sites?.[site] ?? {})
		.filter((e): e is [string, SectionSpec] => e[1] !== undefined);

	return (
		<>
			<PageHeader
				kicker="Content"
				title="Site assets"
				subtitle="Upload images once, then drag them into the sections of each marketing site. An empty section falls back to that site's placeholders."
				action={tab === 'placements' ? (
					<Select
						value={site}
						onChange={setSite}
						ariaLabel="Site"
						width={260}
						options={Object.keys(schemaQ.data?.sites ?? { atlas: {}, landing: {}, playmakers: {} })
							.map((s) => ({ value: s, label: SITE_LABELS[s] ?? s }))}
					/>
				) : undefined}
			/>

			<div style={{ marginBottom: 'var(--space-4)' }}>
				<PillTabs<Tab>
					tabs={[
						{ key: 'placements', label: 'Placements' },
						{ key: 'library', label: 'Library', count: assets.length },
					]}
					value={tab}
					onChange={setTab}
				/>
			</div>

			{tab === 'library' ? (
				<AssetLibrary
					assets={assets}
					loading={assetsQ.isLoading}
					error={assetsQ.error}
					reload={reload}
				/>
			) : (
				<PlacementBoard
					site={site}
					sections={sections}
					placements={placements}
					assets={assets}
					loading={schemaQ.isLoading || placementsQ.isLoading}
					error={schemaQ.error ?? placementsQ.error}
					reload={reload}
					retry={retry}
					mutatePlacements={(next) => void mutate([PLACEMENTS_KEY, { site }], next, { revalidate: false })}
				/>
			)}
		</>
	);
}
