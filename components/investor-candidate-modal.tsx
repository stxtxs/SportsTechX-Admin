'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import { Select } from '@/components/select';
import { Modal } from '@/components/modal';

/** "Add candidate" form for the Investors to add queue — used by that page and by the deal form's investor box. */

interface AdminUser { id: string; full_name?: string | null; display_name?: string | null; email: string; user_role: string }
export function AddCandidateModal({ initialName = '', onClose, onSaved }: { initialName?: string; onClose: () => void; onSaved: (name: string) => void }) {
	const { data: usersResp } = useSWR<{ data: AdminUser[] }>(['/api/admin/users', { role: 'admin', limit: 100 }], { dedupingInterval: 300_000 });
	const admins = (usersResp?.data ?? []).filter((u) => u.user_role === 'admin');
	const [f, setF] = useState({ name: initialName, website: '', category: '', country: '', city: '', year_launched: '', description: '', linkedin_url: '', twitter_url: '', instagram_url: '', facebook_url: '', poc_name: '', poc_position: '', poc_email: '', poc_linkedin: '', assigned_to: '' });
	const [pending, setPending] = useState(false);
	const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));

	const submit = async () => {
		setPending(true);
		try {
			const body: Record<string, unknown> = { name: f.name.trim() };
			for (const k of ['website', 'category', 'country', 'city', 'description', 'linkedin_url', 'twitter_url', 'instagram_url', 'facebook_url', 'poc_name', 'poc_position', 'poc_email', 'poc_linkedin'] as const) if (f[k].trim()) body[k] = f[k].trim();
			if (f.year_launched.trim()) body.year_launched = Number(f.year_launched);
			if (f.assigned_to) body.assigned_to = f.assigned_to;
			await api('POST', '/api/admin/investor-review', body);
			toast.success('Added to Investors to add'); onSaved(body.name as string);
		} catch (e) {
			// Already pending in the queue: nothing to add, and the caller can carry on (the deal keeps the name).
			if (e instanceof ApiError && e.status === 409) { toast.info(e.message); onSaved(f.name.trim()); }
			else toast.error((e as Error).message);
		} finally { setPending(false); }
	};

	return (
		<Modal title="Add candidate" onClose={onClose} width={580} footer={
			<>
				<button className="btn ghost" onClick={onClose}>Cancel</button>
				<button className="btn" disabled={!f.name.trim() || !f.website.trim() || pending} title={f.website.trim() ? undefined : 'A website is required'} onClick={() => void submit()}>{pending ? 'Saving…' : 'Add'}</button>
			</>
		}>
			<div style={{ display: 'grid', gap: 12 }}>
				<div style={{ fontSize: 12, color: 'var(--fg-muted)' }}>The website identifies the investor: it’s how duplicates are caught and what enrichment looks up.</div>
				<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
					<L label="Name"><input className="search-input" value={f.name} onChange={(e) => set('name', e.target.value)} /></L>
					<L label="Website (required)"><input className="search-input" required aria-required value={f.website} onChange={(e) => set('website', e.target.value)} placeholder="acme.com" /></L>
				</div>
				<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
					<L label="Category"><input className="search-input" value={f.category} onChange={(e) => set('category', e.target.value)} placeholder="VC, PE…" /></L>
					<L label="Country"><input className="search-input" value={f.country} onChange={(e) => set('country', e.target.value)} /></L>
					<L label="City"><input className="search-input" value={f.city} onChange={(e) => set('city', e.target.value)} /></L>
				</div>
				<div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 12 }}>
					<L label="Year launched"><input className="search-input" type="number" value={f.year_launched} onChange={(e) => set('year_launched', e.target.value)} placeholder="2015" /></L>
					<L label="Assign to"><Select value={f.assigned_to} onChange={(v) => set('assigned_to', v)} searchable width="100%" style={{ display: 'block', width: '100%' }} placeholder="— unassigned —" options={[{ value: '', label: '— unassigned —' }, ...admins.map((a) => ({ value: a.id, label: a.full_name || a.display_name || a.email }))]} /></L>
				</div>
				<L label="Description"><textarea className="search-input" style={{ minHeight: 56, resize: 'vertical' }} value={f.description} onChange={(e) => set('description', e.target.value)} /></L>
				<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
					<L label="LinkedIn"><input className="search-input" value={f.linkedin_url} onChange={(e) => set('linkedin_url', e.target.value)} placeholder="https://linkedin.com/company/…" /></L>
					<L label="X / Twitter"><input className="search-input" value={f.twitter_url} onChange={(e) => set('twitter_url', e.target.value)} placeholder="https://x.com/…" /></L>
				</div>
				<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
					<L label="Instagram"><input className="search-input" value={f.instagram_url} onChange={(e) => set('instagram_url', e.target.value)} /></L>
					<L label="Facebook"><input className="search-input" value={f.facebook_url} onChange={(e) => set('facebook_url', e.target.value)} /></L>
				</div>
				<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
					<L label="POC name"><input className="search-input" value={f.poc_name} onChange={(e) => set('poc_name', e.target.value)} /></L>
					<L label="POC position"><input className="search-input" value={f.poc_position} onChange={(e) => set('poc_position', e.target.value)} /></L>
				</div>
				<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
					<L label="POC email"><input className="search-input" type="email" value={f.poc_email} onChange={(e) => set('poc_email', e.target.value)} placeholder="name@fund.com" /></L>
					<L label="POC LinkedIn"><input className="search-input" value={f.poc_linkedin} onChange={(e) => set('poc_linkedin', e.target.value)} placeholder="https://linkedin.com/in/…" /></L>
				</div>
			</div>
		</Modal>
	);
}

export function L({ label, children }: { label: string; children: React.ReactNode }) {
	return <div><div className="co-stat-label" style={{ marginBottom: 6 }}>{label}</div>{children}</div>;
}
