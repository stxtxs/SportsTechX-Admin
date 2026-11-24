'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';
import { Plus, Save, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useConfirm } from '@/components/confirm';
import { FilterBar, FilterSelect } from '@/components/filters';
import { Modal } from '@/components/modal';
import { PageHeader, AsyncState, Section, Tag } from '@/components/atoms';
import { tidy, tierLabel } from '@/lib/labels';

interface FeatureRow {
	id: string;
	slug: string;
	name: string;
	description: string | null;
	category: string | null;
	sort_order: number;
	explore: boolean;
	raise: boolean;
	scout: boolean;
	is_active: boolean;
}

type Tier = 'explore' | 'raise' | 'scout';

const TIERS: Tier[] = ['explore', 'raise', 'scout'];

interface FeaturesResponse { data: FeatureRow[] }

export default function FeaturesAdminPage() {
	const ask = useConfirm();
	const [includeInactive, setIncludeInactive] = useState(false);
	const [q, setQ] = useState('');
	const [cat, setCat] = useState('');
	const { data, mutate, isLoading, error } = useSWR<FeaturesResponse>(['/api/admin/features', { include_inactive: includeInactive || undefined }]);
	const [creating, setCreating] = useState(false);
	const [editing, setEditing] = useState<FeatureRow | null>(null);

	const reactivate = async (row: FeatureRow) => {
		try {
			await api('PATCH', `/api/admin/features/${row.id}`, { is_active: true });
			toast.success(`Reactivated ${row.name}`);
			void mutate();
		} catch (e) {
			toast.error((e as Error).message ?? 'Could not reactivate');
		}
	};

	const toggleTier = async (row: FeatureRow, tier: Tier) => {
		const next = { explore: row.explore, raise: row.raise, scout: row.scout, [tier]: !row[tier] };
		const optimistic: FeaturesResponse = {
			data: (data?.data ?? []).map((r) => (r.id === row.id ? { ...r, ...next } : r)),
		};
		try {
			await mutate(
				async () => {
					await api('PATCH', `/api/admin/features/${row.id}`, { tiers: next });
					return optimistic;
				},
				{ optimisticData: optimistic, rollbackOnError: true, revalidate: true },
			);
		} catch (e) {
			toast.error((e as Error).message ?? 'Could not update');
		}
	};

	const deactivate = async (row: FeatureRow) => {
		if (!(await ask(`Deactivate "${row.name}"? It stays in the DB but is hidden from the catalog.`))) return;
		try {
			await api('DELETE', `/api/admin/features/${row.id}`);
			toast.success(`Deactivated ${row.name}`);
			void mutate();
		} catch (e) {
			toast.error((e as Error).message ?? 'Could not deactivate');
		}
	};

	const all = data?.data ?? [];
	const categories = Array.from(new Set(all.map((r) => r.category).filter(Boolean))) as string[];
	const rows = all.filter((r) =>
		(!cat || r.category === cat) &&
		(!q || r.name.toLowerCase().includes(q.toLowerCase()) || r.slug.toLowerCase().includes(q.toLowerCase())),
	);

	return (
		<div>
			<PageHeader
				kicker="Feature flags · tier gating"
				title="Feature flags"
				subtitle="Edits go live on the public /api/features response on the next request (5-min cache, invalidated on write). Per-user overrides live separately in profile_feature_grants."
			/>

			<FilterBar>
				<input className="search-input" style={{ flex: '0 0 240px', height: 32 }} placeholder="Search name or slug…"
					value={q} onChange={(e) => setQ(e.target.value)} />
				<FilterSelect ariaLabel="Category" value={cat} onChange={setCat} options={categories.map((c) => ({ value: c, label: tidy(c) }))} allLabel="All categories" />
				<div style={{ flex: 1 }} />
				<label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, color: 'var(--fg-2)' }}>
					<input type="checkbox" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} /> Show inactive
				</label>
				<button className="btn" onClick={() => setCreating(true)}>
					<Plus size={12} /> Add feature
				</button>
			</FilterBar>

			{(creating || editing) && (
				<FeatureModal
					initial={editing}
					onClose={() => { setCreating(false); setEditing(null); }}
					onSaved={() => { setCreating(false); setEditing(null); void mutate(); }}
				/>
			)}

			<Section padded={false} title="All features" meta={`${rows.length} of ${all.length}`}>
				<AsyncState loading={isLoading} error={error} empty={rows.length === 0} emptyMsg={q || cat ? 'No features match.' : 'No features yet — add one.'} onRetry={() => void mutate()}>
				<table className="data-table">
					<thead>
						<tr>
							<th>Name</th>
							<th>Slug</th>
							<th>Category</th>
							<th style={{ textAlign: 'center' }}>Explore</th>
							<th style={{ textAlign: 'center' }}>Raise</th>
							<th style={{ textAlign: 'center' }}>Scout</th>
							<th />
						</tr>
					</thead>
					<tbody>
						{rows.map((row) => (
							<tr key={row.id} style={{ opacity: row.is_active ? 1 : 0.5 }}>
								<td>
									<div style={{ fontWeight: 600 }}>{row.name}{!row.is_active && <Tag>Inactive</Tag>}</div>
									{row.description && <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 2 }}>{row.description}</div>}
								</td>
								<td style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{row.slug}</td>
								<td style={{ color: 'var(--fg-2)' }}>{tidy(row.category)}</td>
								{TIERS.map((t) => (
									<td key={t} style={{ textAlign: 'center' }}>
										<button
											className={`chip ${row[t] ? 'on' : ''}`}
											style={{ minWidth: 32 }}
											onClick={() => void toggleTier(row, t)}
											aria-label={`Toggle ${tierLabel(t)} for ${row.name}`}
										>
											{row[t] ? '✓' : '·'}
										</button>
									</td>
								))}
								<td style={{ textAlign: 'right' }}>
									<div style={{ display: 'inline-flex', gap: 6, justifyContent: 'flex-end' }}>
										<button className="btn ghost" onClick={() => setEditing(row)}>Edit</button>
										{row.is_active ? (
											<button className="btn ghost" style={{ color: 'var(--accent)' }} onClick={() => void deactivate(row)} title="Deactivate">
												<Trash2 size={12} />
											</button>
										) : (
											<button className="btn ghost" onClick={() => void reactivate(row)} title="Reactivate">Reactivate</button>
										)}
									</div>
								</td>
							</tr>
						))}
					</tbody>
				</table>
				</AsyncState>
			</Section>
		</div>
	);
}


function FeatureModal({ initial, onClose, onSaved }: { initial: FeatureRow | null; onClose: () => void; onSaved: () => void }) {
	const isEdit = !!initial;
	const [slug, setSlug] = useState(initial?.slug ?? '');
	const [name, setName] = useState(initial?.name ?? '');
	const [description, setDescription] = useState(initial?.description ?? '');
	const [category, setCategory] = useState(initial?.category ?? '');
	const [sortOrder, setSortOrder] = useState(initial?.sort_order ?? 999);
	const [tiers, setTiers] = useState({ explore: initial?.explore ?? false, raise: initial?.raise ?? true, scout: initial?.scout ?? true });
	const [pending, setPending] = useState(false);

	const submit = async () => {
		setPending(true);
		try {
			if (isEdit) {
				await api('PATCH', `/api/admin/features/${initial!.id}`, {
					name: name.trim(),
					description: description.trim() || null,
					category: category.trim() || null,
					sort_order: sortOrder,
					tiers,
				});
				toast.success(`Saved ${name.trim() || slug}`);
			} else {
				await api('POST', '/api/admin/features', {
					slug: slug.trim(),
					name: name.trim(),
					description: description.trim() || null,
					category: category.trim() || null,
					sort_order: sortOrder,
					tiers,
				});
				toast.success(`Created ${name.trim() || slug}`);
			}
			onSaved();
		} catch (e) {
			toast.error((e as Error).message ?? 'Could not save');
		} finally {
			setPending(false);
		}
	};

	return (
		<Modal
			title={isEdit ? 'Edit feature' : 'New feature'}
			onClose={onClose}
			width={520}
			footer={
				<>
					<button className="btn ghost" onClick={onClose}>Cancel</button>
					<button className="btn" disabled={!slug.trim() || !name.trim() || pending} onClick={() => void submit()}>
						<Save size={12} /> {pending ? 'Saving…' : 'Save'}
					</button>
				</>
			}
		>
			<div style={{ display: 'grid', gap: 12 }}>
				<Field label={isEdit ? 'Slug (immutable)' : 'Slug (lowercase, _ allowed)'}>
					<input className="search-input" style={{ width: '100%', fontFamily: 'var(--font-mono)' }} placeholder="csv_export" value={slug} disabled={isEdit} onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))} />
				</Field>
				<Field label="Display name">
					<input className="search-input" style={{ width: '100%' }} placeholder="CSV export" value={name} onChange={(e) => setName(e.target.value)} />
				</Field>
				<Field label="Description (optional)">
					<textarea className="search-input" style={{ width: '100%', minHeight: 60, resize: 'vertical' }} value={description} onChange={(e) => setDescription(e.target.value)} />
				</Field>
				<div style={{ display: 'grid', gridTemplateColumns: '1fr 120px', gap: 12 }}>
					<Field label="Category">
						<input className="search-input" style={{ width: '100%' }} placeholder="export, analytics, ai…" value={category} onChange={(e) => setCategory(e.target.value)} />
					</Field>
					<Field label="Sort">
						<input className="search-input" type="number" style={{ width: '100%' }} value={sortOrder} onChange={(e) => setSortOrder(Number(e.target.value) || 999)} />
					</Field>
				</div>
				<Field label="Tier access">
					<div style={{ display: 'flex', gap: 6 }}>
						{TIERS.map((t) => (
							<button
								key={t}
								type="button"
								className={`chip ${tiers[t] ? 'on' : ''}`}
								onClick={() => setTiers({ ...tiers, [t]: !tiers[t] })}
							>
								{tierLabel(t)}
							</button>
						))}
					</div>
				</Field>
			</div>
		</Modal>
	);
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<div>
			<div className="co-stat-label" style={{ marginBottom: 6 }}>{label}</div>
			{children}
		</div>
	);
}
