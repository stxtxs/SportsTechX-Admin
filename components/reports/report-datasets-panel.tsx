'use client';

import { useRef, useState } from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';
import { Download, Upload } from 'lucide-react';
import { api } from '@/lib/api';
import { useConfirm } from '@/components/confirm';

interface Dataset { key: string; block: string | null; bytes: number; type: string; updated_at: string }

const size = (b: number) => (b >= 1024 * 1024 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

/**
 * A custom report's frozen chart / map data (report_datasets): the numbers its charts and maps
 * show, exactly as published. Not edited field by field — download the JSON, change it, and
 * replace it (same top-level shape). Hidden when the report has none.
 */
export function ReportDatasetsPanel({ reportId, labelOf }: { reportId: string; labelOf: (block: string) => string }) {
	const ask = useConfirm();
	const { data, mutate } = useSWR<Dataset[]>([`/api/admin/reports/${reportId}/datasets`], { revalidateOnFocus: false });
	const [busy, setBusy] = useState<string | null>(null);
	const file = useRef<HTMLInputElement>(null);
	const target = useRef<string | null>(null);
	if (!data?.length) return null;

	const download = async (key: string) => {
		setBusy(key);
		try {
			const json = await api('GET', `/api/admin/reports/${reportId}/datasets/${encodeURIComponent(key)}`);
			const url = URL.createObjectURL(new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' }));
			const a = document.createElement('a');
			a.href = url; a.download = `${key.replace(/[^\w.-]+/g, '_')}.json`;
			document.body.appendChild(a); a.click(); a.remove();
			setTimeout(() => URL.revokeObjectURL(url), 1000);
		} catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
	};
	const replace = async (f: File) => {
		const key = target.current;
		if (!key) return;
		let json: unknown;
		try { json = JSON.parse(await f.text()); } catch { toast.error('That file is not valid JSON.'); return; }
		if (!(await ask({ title: `Replace “${key}”?`, message: 'The report’s charts show the new data as soon as it’s saved. Download the current file first if you may need it back.', confirmLabel: 'Replace', danger: true }))) return;
		setBusy(key);
		try {
			await api('PATCH', `/api/admin/reports/${reportId}/datasets/${encodeURIComponent(key)}`, { data: json });
			toast.success('Data replaced — live on the report');
			void mutate();
		} catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
	};

	return (
		<div style={{ marginTop: 18 }}>
			<div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Data (frozen as published)</div>
			<div style={{ fontSize: 11, color: 'var(--fg-muted)', marginBottom: 8, lineHeight: 1.45 }}>
				The numbers behind the charts and maps. Download a file, change it, and replace it with the same structure.
			</div>
			<input ref={file} type="file" accept="application/json,.json" style={{ display: 'none' }}
				onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void replace(f); }} />
			<div style={{ display: 'grid', gap: 4, maxHeight: 320, overflowY: 'auto' }}>
				{data.map((d) => (
					<div key={d.key} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', background: 'var(--bg-1)', border: '1px solid var(--border)', fontSize: 11 }}>
						<div style={{ flex: 1, minWidth: 0 }}>
							<div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={d.key}>{d.key}</div>
							<div style={{ color: 'var(--fg-muted)' }}>{d.block ? labelOf(d.block) : 'Whole page'} · {size(d.bytes)}</div>
						</div>
						<button type="button" className="btn ghost" disabled={busy === d.key} onClick={() => void download(d.key)} title="Download JSON"><Download size={12} /></button>
						<button type="button" className="btn ghost" disabled={busy === d.key} onClick={() => { target.current = d.key; file.current?.click(); }} title="Replace with a JSON file"><Upload size={12} /></button>
					</div>
				))}
			</div>
		</div>
	);
}
