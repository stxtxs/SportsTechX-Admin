'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';
import { Plus, Archive } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader, Section, AsyncState, Tag } from '@/components/atoms';
import { useConfirm } from '@/components/confirm';
import { creditPoolLabel } from '@/lib/labels';

/**
 * Admin credit-pack management. Creating a pack mints a Stripe one-time Product +
 * Price on the server, then stores the row. The public store
 * (GET /api/billing/credit-packs) + checkout consume these; the webhook grants
 * the credits as a non-expiring top-up on payment.
 *
 *   GET/POST /api/admin/credit-packs · PATCH/DELETE /api/admin/credit-packs/:id
 */
interface CreditPack {
	id: string;
	slug: string;
	name: string;
	description: string | null;
	/** Legacy packs still carry 'ai' or 'integration'; new ones are 'stx'. All
	 *  of them credit the same wallet. */
	credit_type: string;
	credit_amount: number;
	price_amount: number; // cents
	currency_code: string;
	stripe_price_id: string | null;
	is_active: boolean;
	sort_order: number;
}

/** Safe currency format — an unknown/null currency_code would otherwise throw. */
const money = (cents: number, currency: string): string => {
	try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: (currency || 'EUR').toUpperCase() }).format((cents ?? 0) / 100); }
	catch { return `${((cents ?? 0) / 100).toFixed(2)} ${currency ?? ''}`.trim(); }
};
/** Cents per credit — the number that actually makes a pack ladder comparable. */
const perCredit = (p: CreditPack): string => p.credit_amount > 0 ? `${(p.price_amount / p.credit_amount).toFixed(2)}c` : '—';

export default function CreditPacksAdminPage() {
	const { data, mutate, isLoading, error } = useSWR<{ data: CreditPack[] }>(['/api/admin/credit-packs']);
	const packs = data?.data ?? [];
	const ask = useConfirm();

	const [slug, setSlug] = useState('');
	const [name, setName] = useState('');
	const [description, setDescription] = useState('');
	const [creditAmount, setCreditAmount] = useState(1000);
	const [priceEuros, setPriceEuros] = useState(10);
	const [sortOrder, setSortOrder] = useState(0);
	const [busy, setBusy] = useState(false);
	const [pendingId, setPendingId] = useState<string | null>(null);

	const create = async () => {
		setBusy(true);
		try {
			await api('POST', '/api/admin/credit-packs', {
				slug: slug.trim(), name: name.trim(), description: description.trim() || null,
				// One wallet — a pack's credit_type is only a ledger label now.
				credit_type: 'stx', credit_amount: creditAmount,
				price_amount: Math.round(priceEuros * 100), currency_code: 'EUR', sort_order: sortOrder,
			});
			toast.success('Credit pack created (Stripe price minted)');
			setSlug(''); setName(''); setDescription('');
			await mutate();
		} catch (e) { toast.error((e as Error).message ?? 'Could not create pack'); }
		finally { setBusy(false); }
	};

	const toggleActive = async (p: CreditPack) => {
		setPendingId(p.id);
		try {
			await api('PATCH', `/api/admin/credit-packs/${p.id}`, { is_active: !p.is_active });
			toast.success(p.is_active ? `"${p.name}" hidden from the store` : `"${p.name}" is live in the store`);
			await mutate();
		} catch (e) { toast.error((e as Error).message ?? 'Update failed'); }
		finally { setPendingId(null); }
	};

	const archive = async (p: CreditPack) => {
		const ok = await ask({
			title: `Archive "${p.name}"?`,
			message: 'It is removed from the store and its Stripe price + product are archived. Existing purchases are unaffected.',
			confirmLabel: 'Archive', danger: true,
		});
		if (!ok) return;
		setPendingId(p.id);
		try { await api('DELETE', `/api/admin/credit-packs/${p.id}`); toast.success('Pack archived'); await mutate(); }
		catch (e) { toast.error((e as Error).message ?? 'Archive failed'); }
		finally { setPendingId(null); }
	};

	const liveCount = packs.filter((p) => p.is_active).length;

	return (
		<div>
			<PageHeader
				kicker="Billing · add-ons"
				title="Credit packs"
				subtitle="One-time, non-expiring top-ups users buy when their plan credits run out. Creating a pack mints the Stripe product + price automatically — price is immutable once created, so to change it archive the pack and create a new one."
			/>

			<Section title="New credit pack" meta="Provisions a Stripe one-time product + price">
				<div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12 }}>
					<Field label="Slug" hint="lowercase, dashes">
						<input className="search-input" style={{ width: '100%', fontFamily: 'var(--font-mono)' }} placeholder="ai-1k"
							value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} />
					</Field>
					<Field label="Name"><input className="search-input" style={{ width: '100%' }} placeholder="1,000 STX Credits" value={name} onChange={(e) => setName(e.target.value)} /></Field>
					<Field label="Credits"><input className="search-input" type="number" min={1} style={{ width: '100%' }} value={creditAmount} onChange={(e) => setCreditAmount(Math.max(1, Number(e.target.value) || 1))} /></Field>
					<Field label="Price (EUR)"><input className="search-input" type="number" min={0.5} step={0.5} style={{ width: '100%' }} value={priceEuros} onChange={(e) => setPriceEuros(Math.max(0.5, Number(e.target.value) || 0.5))} /></Field>
					<Field label="Sort order"><input className="search-input" type="number" style={{ width: '100%' }} value={sortOrder} onChange={(e) => setSortOrder(Number(e.target.value) || 0)} /></Field>
					<div style={{ gridColumn: '1 / -1' }}>
						<Field label="Description" hint="optional"><input className="search-input" style={{ width: '100%' }} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
					</div>
				</div>
				<div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 14, flexWrap: 'wrap' }}>
					<button className="btn" disabled={busy || !slug.trim() || !name.trim()} onClick={() => void create()}>
						<Plus size={13} /> {busy ? 'Creating…' : 'Create pack'}
					</button>
					<span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>
						{creditAmount.toLocaleString()} credits for {money(Math.round(priceEuros * 100), 'EUR')} ·{' '}
						<strong>{creditAmount > 0 ? ((priceEuros * 100) / creditAmount).toFixed(2) : '—'}c</strong> per credit
					</span>
				</div>
			</Section>

			<div style={{ marginTop: 'var(--space-4)' }}>
				<Section title="All packs" meta={`${liveCount} live in the store · ${packs.length} total`}>
					<AsyncState loading={isLoading} error={error} empty={packs.length === 0} emptyMsg="No credit packs yet — create one above." onRetry={() => void mutate()}>
						<div className="table-scroll">
							<table className="data-table">
								<thead><tr>
									<th>Pack</th><th>Type</th>
									<th style={{ textAlign: 'right' }}>Credits</th>
									<th style={{ textAlign: 'right' }}>Price</th>
									<th style={{ textAlign: 'right' }}>Per credit</th>
									<th>Stripe</th><th>Store</th><th />
								</tr></thead>
								<tbody>
									{packs.map((p) => (
										<tr key={p.id} style={{ opacity: p.is_active ? 1 : 0.55 }}>
											<td>
												<div style={{ fontWeight: 600 }}>{p.name}</div>
												<div style={{ fontSize: 11, color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>{p.slug}</div>
											</td>
											<td><Tag variant={p.credit_type === 'ai' ? 'pos' : ''}>{creditPoolLabel(p.credit_type)}</Tag></td>
											<td className="num" style={{ textAlign: 'right' }}>{p.credit_amount.toLocaleString()}</td>
											<td className="num" style={{ textAlign: 'right', fontWeight: 600 }}>{money(p.price_amount, p.currency_code)}</td>
											<td className="num" style={{ textAlign: 'right', color: 'var(--fg-muted)' }}>{perCredit(p)}</td>
											<td>{p.stripe_price_id
												? <span title={p.stripe_price_id} style={{ color: 'var(--pos)', fontSize: 12 }}>● Linked</span>
												: <span style={{ color: 'var(--warn)', fontSize: 12 }}>Not linked</span>}</td>
											<td>
												<button type="button" className={`chip ${p.is_active ? 'on' : ''}`} disabled={pendingId === p.id}
													title={p.is_active ? 'Visible in the store — click to hide' : 'Hidden — click to publish'}
													onClick={() => void toggleActive(p)}>
													{p.is_active ? 'Live' : 'Hidden'}
												</button>
											</td>
											<td style={{ textAlign: 'right' }}>
												<button className="btn ghost" style={{ color: 'var(--accent)' }} disabled={pendingId === p.id}
													onClick={() => void archive(p)} title="Archive pack"><Archive size={12} /></button>
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					</AsyncState>
				</Section>
			</div>
		</div>
	);
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
	return (
		<div>
			<div className="co-stat-label" style={{ marginBottom: 6 }}>
				{label}{hint && <span style={{ color: 'var(--fg-muted)', fontWeight: 400 }}> · {hint}</span>}
			</div>
			{children}
		</div>
	);
}
