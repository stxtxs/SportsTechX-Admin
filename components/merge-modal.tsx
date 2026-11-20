'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Modal } from '@/components/modal';
import { CompanySelectOne, InvestorSelectOne } from '@/components/entity-pickers';
import { useDebouncedValue } from '@/hooks/use-debounced-value';

type Kind = 'company' | 'investor' | 'ecosystem';
interface ImpactItem { label: string; count: number }
interface Impact { deletes: ImpactItem[]; unlinks: ImpactItem[] }

/** Merge a duplicate into the record to keep (server: POST /admin/merge/:kind/:id/into/:target). */
export function MergeModal({ kind, id, name, onClose, onMerged }: { kind: Kind; id: string; name: string; onClose: () => void; onMerged: () => void }) {
	const [target, setTarget] = useState('');
	const [pending, setPending] = useState(false);
	// Everything pointing at the duplicate moves — the same list a delete would affect.
	const { data: impact } = useSWR<Impact>([`/api/admin/delete-impact/${kind}/${id}`], { revalidateOnFocus: false });
	const moves = [...(impact?.deletes ?? []), ...(impact?.unlinks ?? [])].map((x) => `${x.count} ${x.label}`).join(', ');

	const submit = async () => {
		setPending(true);
		try {
			const r = await api<{ kept: string; removed: string }>('POST', `/api/admin/merge/${kind}/${id}/into/${target}`);
			toast.success(`Merged “${r.removed}” into “${r.kept}”`);
			onMerged();
		} catch (e) { toast.error((e as Error).message); } finally { setPending(false); }
	};

	return (
		<Modal title={`Merge “${name}” into…`} onClose={onClose} width={540} footer={
			<>
				<button className="btn ghost" onClick={onClose}>Cancel</button>
				<button className="btn" disabled={!target || target === id || pending} onClick={() => void submit()}>{pending ? 'Merging…' : 'Merge'}</button>
			</>
		}>
			<div style={{ display: 'grid', gap: 12, fontSize: 13, lineHeight: 1.55 }}>
				<div>Pick the record to <b>keep</b>. Everything attached to “{name}” moves to it{impact ? `: ${moves || 'nothing is attached'}` : '…'}.
					Rows the kept record already has are not duplicated. Its empty fields are filled from “{name}”, then “{name}” is deleted. This can’t be undone.</div>
				{kind === 'company' && <CompanySelectOne value={target} onChange={setTarget} placeholder="Company to keep…" />}
				{kind === 'investor' && <InvestorSelectOne value={target} onChange={setTarget} placeholder="Investor to keep…" />}
				{kind === 'ecosystem' && <EcosystemSelectOne value={target} onChange={setTarget} excludeId={id} />}
				{target === id && <div style={{ color: 'var(--neg)', fontSize: 12 }}>That’s the same record — pick the other one.</div>}
			</div>
		</Modal>
	);
}

function EcosystemSelectOne({ value, onChange, excludeId }: { value: string; onChange: (id: string) => void; excludeId: string }) {
	const [q, setQ] = useState('');
	const dq = useDebouncedValue(q);
	const [picked, setPicked] = useState<string | null>(null);
	const { data } = useSWR<{ data: { id: string; name: string; entity_type?: string }[] }>(dq.trim().length >= 2 ? ['/api/ecosystem-entities', { q: dq.trim(), limit: 10 }] : null);
	if (value && picked) {
		return (
			<div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
				<div className="search-input" style={{ flex: 1, fontWeight: 500 }}>{picked}</div>
				<button className="btn ghost" onClick={() => { onChange(''); setPicked(null); }}>Change</button>
			</div>
		);
	}
	return (
		<div>
			<input className="search-input" style={{ width: '100%' }} placeholder="Organisation / program / event to keep…" value={q} onChange={(e) => setQ(e.target.value)} />
			{(data?.data ?? []).filter((e) => e.id !== excludeId).map((e) => (
				<button key={e.id} type="button" className="btn ghost" style={{ display: 'block', width: '100%', textAlign: 'left', marginTop: 4 }}
					onClick={() => { onChange(e.id); setPicked(e.name); }}>
					{e.name}{e.entity_type ? <span style={{ color: 'var(--fg-muted)' }}> · {e.entity_type}</span> : null}
				</button>
			))}
		</div>
	);
}
