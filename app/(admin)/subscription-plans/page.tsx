'use client';

import { useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { toast } from 'sonner';
import { Save } from 'lucide-react';
import { api } from '@/lib/api';
import { Select } from '@/components/select';
import { useConfirm } from '@/components/confirm';
import { Modal } from '@/components/modal';
import { PageHeader, AsyncState, StatCard } from '@/components/atoms';
import { tidy, tierLabel } from '@/lib/labels';

interface Plan {
	id: string;
	stripe_price_id: string | null;
	stripe_product_id: string | null;
	name: string;
	slug: string;
	description: string | null;
	tagline: string | null;
	tier: string;
	tier_detail: string;
	billing_interval: string;
	price_amount: number;
	currency_code: string;
	trial_days: number;
	/** The single monthly allowance. `ai_credits_monthly` and
	 *  `integration_credits_monthly` still exist on the table but nothing reads
	 *  them any more — the pools were merged into one STX wallet. */
	stx_credits_monthly: number;
	feature_highlights: string[] | null;
	allows_overage_billing?: boolean;
	ai_overage_price_cents?: number | null;
	integration_overage_price_cents?: number | null;
	is_active: boolean;
	sort_order: number;
	last_synced_at: string | null;
}

interface PlansResponse { data: Plan[] }

/** price_amount is stored in minor units (cents). */
const money = (cents: number, currency: string): string => {
	try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: (currency || 'EUR').toUpperCase() }).format((cents ?? 0) / 100); }
	catch { return `${((cents ?? 0) / 100).toFixed(2)} ${currency}`; }
};

export default function PlansEditorialPage() {
	const { mutate } = useSWRConfig();
	const ask = useConfirm();
	const { data, error, isLoading } = useSWR<PlansResponse>(['/api/admin/subscription-plans']);
	const [editing, setEditing] = useState<Plan | null>(null);
	const [creating, setCreating] = useState(false);

	const refresh = () => mutate((key) => Array.isArray(key) && key[0] === '/api/admin/subscription-plans');
	const archive = async (p: Plan) => {
		if (!(await ask(`Archive "${p.name}"? It stays for existing subscribers but can't be newly subscribed to (Stripe price + product archived).`))) return;
		try { await api('DELETE', `/api/admin/subscription-plans/${p.id}`); toast.success('Plan archived'); void refresh(); }
		catch (e) { toast.error((e as Error).message); }
	};
	const rows = data?.data ?? [];

	return (
		<div>
			<PageHeader
				kicker="Pricing page"
				title="Subscription plans"
				subtitle="Create a plan (provisions a Stripe product + price), or edit marketing copy, credits, trial length, and overage pricing. Stripe price/currency/interval are immutable once created — to change pricing, deactivate and create a new plan."
				action={<button className="btn" onClick={() => setCreating(true)}>New plan</button>}
			/>

			{creating && <CreateModal onClose={() => setCreating(false)} onSaved={() => { setCreating(false); void refresh(); }} />}
			{editing && <EditModal plan={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void refresh(); }} />}

			<AsyncState loading={isLoading} error={error} empty={rows.length === 0} emptyMsg="No plans yet — create one to provision a Stripe product + price." onRetry={() => void refresh()}>
			<div style={{ display: 'grid', gap: 12 }}>
				{rows.map((p) => (
					<div key={p.id} className="card" style={{ padding: 'var(--space-4)', opacity: p.is_active ? 1 : 0.62, borderLeft: `3px solid ${p.is_active ? 'var(--pos)' : 'var(--border)'}` }}>
						<div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, marginBottom: 8, flexWrap: 'wrap' }}>
							<div style={{ minWidth: 0 }}>
								<div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
									<div style={{ fontWeight: 700, fontSize: 16 }}>{p.name}</div>
									<span className="chip">{tierLabel(p.tier)}</span>
									{p.billing_interval && <span className="chip">{tidy(p.billing_interval)}</span>}
									{!p.is_active && <span className="chip" style={{ color: 'var(--accent)' }}>Archived</span>}
								</div>
								{p.tagline && <div style={{ fontSize: 13, color: 'var(--fg-2)', marginTop: 4 }}>{p.tagline}</div>}
							</div>
							<div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
								<button className="btn" onClick={() => setEditing(p)}>Edit editorial</button>
								{p.is_active !== false && <button className="btn ghost" style={{ color: 'var(--accent)' }} onClick={() => void archive(p)}>Archive</button>}
							</div>
						</div>

						<div style={{ display: 'flex', alignItems: 'baseline', gap: 8, margin: '10px 0 14px' }}>
							<span style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 800, letterSpacing: '-0.02em' }}>{money(p.price_amount, p.currency_code)}</span>
							{p.billing_interval && <span style={{ fontSize: 13, color: 'var(--fg-muted)' }}>/ {p.billing_interval === 'yearly' ? 'year' : 'month'}</span>}
							{p.trial_days > 0 && <span className="tag" style={{ marginLeft: 4 }}>{p.trial_days}-day trial</span>}
						</div>

						<div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, fontSize: 12 }}>
							<StatCard label="STX credits / mo" value={p.stx_credits_monthly.toLocaleString()} />
							<StatCard label="Sort order" value={p.sort_order} />
							<StatCard
								label="Stripe"
								value={p.stripe_price_id
									? <span title={p.stripe_price_id} style={{ color: 'var(--pos)' }}>● Linked</span>
									: <span style={{ color: 'var(--fg-muted)' }}>Not linked</span>}
							/>
						</div>

						{p.allows_overage_billing && (
							<div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)', display: 'flex', gap: 18, flexWrap: 'wrap', fontSize: 12 }}>
								<span className="co-stat-label">Overage billing</span>
								<span>AI <strong>{p.ai_overage_price_cents != null ? `${(p.ai_overage_price_cents / 100).toFixed(2)} ${p.currency_code}` : '—'}</strong> / credit</span>
								<span>Integration <strong>{p.integration_overage_price_cents != null ? `${(p.integration_overage_price_cents / 100).toFixed(2)} ${p.currency_code}` : '—'}</strong> / credit</span>
							</div>
						)}

						{p.feature_highlights && p.feature_highlights.length > 0 && (
							<div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
								<div className="co-stat-label" style={{ marginBottom: 6 }}>Feature highlights</div>
								<ul style={{ paddingLeft: 18, margin: 0, fontSize: 13, display: 'grid', gap: 3 }}>
									{p.feature_highlights.map((f, i) => <li key={i}>{f}</li>)}
								</ul>
							</div>
						)}
					</div>
				))}
			</div>
			</AsyncState>
		</div>
	);
}


function EditModal({ plan, onClose, onSaved }: { plan: Plan; onClose: () => void; onSaved: () => void }) {
	const [name, setName] = useState(plan.name);
	const [tagline, setTagline] = useState(plan.tagline ?? '');
	const [description, setDescription] = useState(plan.description ?? '');
	const [highlights, setHighlights] = useState((plan.feature_highlights ?? []).join('\n'));
	const [stxCredits, setStxCredits] = useState<string>(String(plan.stx_credits_monthly));
	const [trialDays, setTrialDays] = useState<string>(String(plan.trial_days));
	const [allowsOverage, setAllowsOverage] = useState<boolean>(!!plan.allows_overage_billing);
	const [aiOverage, setAiOverage] = useState<string>(plan.ai_overage_price_cents != null ? String(plan.ai_overage_price_cents) : '');
	const [intOverage, setIntOverage] = useState<string>(plan.integration_overage_price_cents != null ? String(plan.integration_overage_price_cents) : '');
	const [isActive, setIsActive] = useState(plan.is_active);
	const [sortOrder, setSortOrder] = useState<string>(String(plan.sort_order));
	const [pending, setPending] = useState(false);

	const submit = async () => {
		setPending(true);
		try {
			await api('PATCH', `/api/admin/subscription-plans/${plan.id}`, {
				name: name.trim(),
				tagline: tagline.trim() || null,
				description: description.trim() || null,
				feature_highlights: highlights.split('\n').map((s) => s.trim()).filter(Boolean),
				trial_days: Number(trialDays) || 0,
				stx_credits_monthly: Number(stxCredits) || 0,
				allows_overage_billing: allowsOverage,
				ai_overage_price_cents: aiOverage === '' ? null : Number(aiOverage),
				integration_overage_price_cents: intOverage === '' ? null : Number(intOverage),
				is_active: isActive,
				sort_order: Number(sortOrder) || 0,
			});
			toast.success('Saved');
			onSaved();
		} catch (e) { toast.error((e as Error).message); }
		finally { setPending(false); }
	};

	return (
		<Modal
			title={`Edit ${tierLabel(plan.tier)} · ${tidy(plan.billing_interval).toLowerCase()}`}
			onClose={onClose}
			width={640}
			footer={
				<>
					<button className="btn ghost" onClick={onClose}>Cancel</button>
					<button className="btn" disabled={!name.trim() || pending} onClick={() => void submit()}>
						<Save size={12} /> {pending ? 'Saving…' : 'Save'}
					</button>
				</>
			}
		>
			<div style={{ display: 'grid', gap: 12 }}>
				<Field label="Name"><input className="search-input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
				<Field label="Tagline"><input className="search-input" value={tagline} onChange={(e) => setTagline(e.target.value)} placeholder="Short marketing one-liner" /></Field>
				<Field label="Description"><textarea className="search-input" style={{ minHeight: 80 }} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
				<Field label="Feature highlights (one per line)"><textarea className="search-input" style={{ minHeight: 120 }} value={highlights} onChange={(e) => setHighlights(e.target.value)} /></Field>
				<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 100px', gap: 12 }}>
					<Field label="STX credits / mo"><input className="search-input" type="number" value={stxCredits} onChange={(e) => setStxCredits(e.target.value)} /></Field>
					<Field label="Trial days"><input className="search-input" type="number" value={trialDays} onChange={(e) => setTrialDays(e.target.value)} /></Field>
					<Field label="Sort"><input className="search-input" type="number" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} /></Field>
				</div>
				<label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
					<input type="checkbox" checked={allowsOverage} onChange={(e) => setAllowsOverage(e.target.checked)} /> Allow overage billing
				</label>
				{allowsOverage && (
					<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
						<Field label="AI overage (cents / credit)"><input className="search-input" type="number" value={aiOverage} onChange={(e) => setAiOverage(e.target.value)} /></Field>
						<Field label="Integration overage (cents / credit)"><input className="search-input" type="number" value={intOverage} onChange={(e) => setIntOverage(e.target.value)} /></Field>
					</div>
				)}
				<label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
					<input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> Active (show on pricing page)
				</label>
			</div>
		</Modal>
	);
}

function CreateModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
	const [slug, setSlug] = useState('');
	const [name, setName] = useState('');
	const [tagline, setTagline] = useState('');
	const [description, setDescription] = useState('');
	// Raise / Scout only: Explore is the free base and has no Stripe price, so it
	// cannot be created here (the server refuses it before touching Stripe).
	const [tier, setTier] = useState<'raise' | 'scout'>('raise');
	const [priceAmount, setPriceAmount] = useState('0'); // cents
	const [currency, setCurrency] = useState('EUR');
	const [trialDays, setTrialDays] = useState('0');
	const [stxCredits, setStxCredits] = useState('0');
	const [highlights, setHighlights] = useState('');
	const [sortOrder, setSortOrder] = useState('0');
	const [pending, setPending] = useState(false);

	// tier_detail is derived from tier (matches the server enum). Atlas sells
	// yearly only, and `raise`/`scout` have no `*_monthly` enum member, so the
	// interval is fixed (shown, not offered as a choice).
	const effectiveInterval = 'yearly' as const;
	const tierDetail = `${tier}_${effectiveInterval}`;

	const submit = async () => {
		setPending(true);
		try {
			await api('POST', '/api/admin/subscription-plans', {
				slug: slug.trim(),
				name: name.trim(),
				tagline: tagline.trim() || null,
				description: description.trim() || null,
				tier,
				tier_detail: tierDetail,
				billing_interval: effectiveInterval,
				price_amount: Number(priceAmount) || 0,
				currency_code: currency.trim().toUpperCase() || 'EUR',
				trial_days: Number(trialDays) || 0,
				stx_credits_monthly: Number(stxCredits) || 0,
				feature_highlights: highlights.split('\n').map((s) => s.trim()).filter(Boolean),
				is_active: true,
				sort_order: Number(sortOrder) || 0,
			});
			toast.success('Plan created (Stripe product + price provisioned)');
			onSaved();
		} catch (e) { toast.error((e as Error).message); }
		finally { setPending(false); }
	};

	return (
		<Modal
			title="New plan"
			onClose={onClose}
			width={640}
			footer={
				<>
					<button className="btn ghost" onClick={onClose}>Cancel</button>
					<button className="btn" disabled={!slug.trim() || !name.trim() || pending} onClick={() => void submit()}>
						<Save size={12} /> {pending ? 'Creating…' : 'Create plan'}
					</button>
				</>
			}
		>
			<div style={{ display: 'grid', gap: 12 }}>
				<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
					<Field label="Slug (lowercase, dashes)"><input className="search-input" style={{ fontFamily: 'var(--font-mono)' }} value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} placeholder="growth-yearly" /></Field>
					<Field label="Name"><input className="search-input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
				</div>
				<Field label="Tagline"><input className="search-input" value={tagline} onChange={(e) => setTagline(e.target.value)} /></Field>
				<Field label="Description"><textarea className="search-input" style={{ minHeight: 60 }} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
				<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
					<Field label="Tier">
						<Select value={tier} onChange={(v) => setTier(v as 'raise' | 'scout')} width="100%" style={{ display: 'block', width: '100%' }} options={[{ value: 'raise', label: tierLabel('raise') }, { value: 'scout', label: tierLabel('scout') }]} />
					</Field>
					<Field label="Billing interval">
						<div style={{ fontSize: 13, color: 'var(--fg-2)', padding: '7px 0' }}>Yearly <span style={{ color: 'var(--fg-muted)' }}>· Atlas sells yearly plans only</span></div>
					</Field>
				</div>
				<div style={{ display: 'grid', gridTemplateColumns: '1fr 100px 100px', gap: 12 }}>
					<Field label="Price (cents)"><input className="search-input" type="number" value={priceAmount} onChange={(e) => setPriceAmount(e.target.value)} /></Field>
					<Field label="Currency"><input className="search-input" value={currency} onChange={(e) => setCurrency(e.target.value)} maxLength={3} /></Field>
					<Field label="Trial days"><input className="search-input" type="number" value={trialDays} onChange={(e) => setTrialDays(e.target.value)} /></Field>
				</div>
				<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 100px', gap: 12 }}>
					<Field label="STX credits / mo"><input className="search-input" type="number" value={stxCredits} onChange={(e) => setStxCredits(e.target.value)} /></Field>
					<Field label="Sort"><input className="search-input" type="number" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} /></Field>
				</div>
				<Field label="Feature highlights (one per line)"><textarea className="search-input" style={{ minHeight: 100 }} value={highlights} onChange={(e) => setHighlights(e.target.value)} /></Field>
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
