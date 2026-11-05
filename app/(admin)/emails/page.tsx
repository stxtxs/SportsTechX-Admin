'use client';

import { useMemo, useState } from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';
import { Eye, RefreshCw, Save, Send, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader, AsyncState, PillTabs, StatCard, Pager, Tag } from '@/components/atoms';
import { Select } from '@/components/select';
import { useConfirm } from '@/components/confirm';

interface Field { key: string; label: string; multiline?: boolean }
interface BuiltIn { id: string; label: string; subject: string; fields: Field[] }
interface Saved { id: string; name: string; subject: string; heading: string; body: string; cta_label: string | null; cta_url: string | null }
interface TemplatesResp { builtIn: BuiltIn[]; saved: Saved[]; savedAvailable: boolean }

interface LogRow {
	id: string; to_email: string; subject: string; template: string; status: string; provider: string | null;
	delivery_status: string | null; delivery_detail: string | null; last_error: string | null; attempt: number;
	source: string | null; batch_id: string | null; enqueued_at: string; sent_at: string | null;
}
interface LogResp {
	rows: LogRow[]; total: number;
	stats: { total_24h: number; ses_24h: number; resend_24h: number; failed_24h: number; queued: number; bounced_30d: number; complained_30d: number; suppressed: number };
	providers: { ses: boolean; resend: boolean; sesMaxPerDay: number | null };
}

const CUSTOM_FIELDS: Field[] = [
	{ key: 'heading', label: 'Heading' },
	{ key: 'body', label: 'Body — a blank line starts a new paragraph; links are clickable', multiline: true },
	{ key: 'ctaLabel', label: 'Button label (optional)' },
	{ key: 'ctaUrl', label: 'Button URL (optional, https://…)' },
];

const Label = ({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) => (
	<div className="co-stat-label" style={{ marginBottom: 6, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
		<span>{children}</span>{aside && <span style={{ color: 'var(--fg-muted)' }}>{aside}</span>}
	</div>
);

const parseRecipients = (s: string) => [...new Set(s.split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean))];

export default function EmailsPage() {
	const [tab, setTab] = useState<'send' | 'log'>('send');
	const [batch, setBatch] = useState<string | undefined>();
	return (
		<div>
			<PageHeader
				kicker="Communication"
				title="Emails"
				subtitle="Send single or bulk emails and follow every email's delivery. Mail goes out through Amazon SES, with Resend as the fallback."
			/>
			<PillTabs tabs={[{ key: 'send', label: 'Send' }, { key: 'log', label: 'Log' }] as const} value={tab} onChange={setTab} />
			{tab === 'send'
				? <Compose onSent={(id) => { setBatch(id); setTab('log'); }} />
				: <Log batch={batch} clearBatch={() => setBatch(undefined)} />}
		</div>
	);
}

// ─── Send ──────────────────────────────────────────────────────────────────

function Compose({ onSent }: { onSent: (batchId: string) => void }) {
	const confirm = useConfirm();
	const { data, mutate } = useSWR<TemplatesResp>('/api/admin/emails/templates');
	// '' = blank custom email, 'saved:<id>' = a saved custom template, else a built-in template id.
	const [choice, setChoice] = useState('');
	const [subject, setSubject] = useState('');
	const [fields, setFields] = useState<Record<string, string>>({});
	const [recipients, setRecipients] = useState('');
	const [preview, setPreview] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	// One id per composed email, so a double-click or retry can't queue it twice.
	const [batchId, setBatchId] = useState(() => crypto.randomUUID());

	const builtIn = data?.builtIn.find((t) => t.id === choice);
	const saved = choice.startsWith('saved:') ? data?.saved.find((t) => `saved:${t.id}` === choice) : undefined;
	const template = builtIn ? builtIn.id : 'custom';
	const fieldList = builtIn ? builtIn.fields : CUSTOM_FIELDS;
	const to = useMemo(() => parseRecipients(recipients), [recipients]);

	const options = [
		{ value: '', label: 'Blank email (write your own)' },
		...(data?.saved ?? []).map((t) => ({ value: `saved:${t.id}`, label: `Saved: ${t.name}` })),
		...(data?.builtIn ?? []).map((t) => ({ value: t.id, label: `Built-in: ${t.label}` })),
	];

	const pick = (v: string) => {
		setChoice(v);
		setPreview(null);
		const b = data?.builtIn.find((t) => t.id === v);
		const s = data?.saved.find((t) => `saved:${t.id}` === v);
		if (b) { setSubject(b.subject); setFields({}); }
		else if (s) { setSubject(s.subject); setFields({ heading: s.heading, body: s.body, ctaLabel: s.cta_label ?? '', ctaUrl: s.cta_url ?? '' }); }
		else { setSubject(''); setFields({}); }
	};

	const payload = () => ({ template, subject: subject.trim(), data: Object.fromEntries(Object.entries(fields).filter(([, v]) => v.trim() !== '')) });

	const doPreview = async () => {
		if (!subject.trim()) { toast.error('Add a subject first.'); return; }
		try { setPreview((await api<{ html: string }>('POST', '/api/admin/emails/preview', payload())).html); }
		catch (e) { toast.error((e as Error).message); }
	};

	const doSend = async () => {
		if (!subject.trim()) { toast.error('Add a subject.'); return; }
		if (to.length === 0) { toast.error('Add at least one recipient.'); return; }
		if (template === 'custom' && !fields['heading']?.trim() && !fields['body']?.trim()) { toast.error('Write a heading or body.'); return; }
		const ok = await confirm({
			title: to.length > 1 ? `Send to ${to.length} people?` : 'Send this email?',
			message: to.length > 1
				? `"${subject.trim()}" will be sent to ${to.length} addresses. People who turned email notifications off, and addresses that bounced before, are skipped.`
				: `"${subject.trim()}" will be sent to ${to[0]}.`,
			confirmLabel: 'Send',
		});
		if (!ok) return;
		setBusy(true);
		try {
			const r = await api<{ queued: number; skipped: number; invalid: string[]; failed: string[] }>('POST', '/api/admin/emails/send', { ...payload(), batchId, recipients: to });
			toast.success(`Queued ${r.queued}${r.skipped ? `, skipped ${r.skipped} (notifications off)` : ''}${r.invalid.length ? `, ${r.invalid.length} invalid` : ''}${r.failed.length ? `, ${r.failed.length} failed` : ''}.`);
			if (r.invalid.length) toast.message(`Invalid addresses: ${r.invalid.slice(0, 10).join(', ')}${r.invalid.length > 10 ? '…' : ''}`);
			if (r.failed.length) {
				// Same batch id: a resend re-queues only these; everyone already queued is skipped.
				setRecipients(r.failed.join('\n'));
				toast.error(`${r.failed.length} could not be queued. They are left in the box: press Send again to retry just those.`);
				return;
			}
			const sentBatch = batchId;
			setBatchId(crypto.randomUUID());
			setRecipients('');
			onSent(sentBatch);
		} catch (e) { toast.error((e as Error).message); }
		finally { setBusy(false); }
	};

	const saveTemplate = async (asNew: boolean) => {
		const name = asNew ? window.prompt('Template name', subject.trim() || 'Untitled')?.trim() : saved?.name;
		if (!name) return;
		const body = { name, subject: subject.trim() || name, heading: fields['heading'] ?? '', body: fields['body'] ?? '', cta_label: fields['ctaLabel'] || null, cta_url: fields['ctaUrl'] || null };
		try {
			const row = asNew || !saved
				? await api<Saved>('POST', '/api/admin/emails/templates', body)
				: await api<Saved>('PATCH', `/api/admin/emails/templates/${saved.id}`, body);
			await mutate();
			setChoice(`saved:${row.id}`);
			toast.success(asNew ? 'Template saved.' : 'Template updated.');
		} catch (e) { toast.error((e as Error).message); }
	};

	const deleteTemplate = async () => {
		if (!saved || !(await confirm({ message: `Delete the template "${saved.name}"?`, danger: true, confirmLabel: 'Delete' }))) return;
		try {
			await api('DELETE', `/api/admin/emails/templates/${saved.id}`);
			await mutate();
			pick('');
			toast.success('Template deleted.');
		} catch (e) { toast.error((e as Error).message); }
	};

	return (
		<div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 'var(--space-4)', alignItems: 'start' }}>
			<div className="card" style={{ padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 14 }}>
				<div>
					<Label>Template</Label>
					<Select value={choice} onChange={pick} options={options} width="100%" />
				</div>
				<div>
					<Label>Subject</Label>
					<input className="search-input" style={{ width: '100%' }} value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} />
				</div>
				{fieldList.map((f) => (
					<div key={f.key}>
						<Label>{f.label}</Label>
						{f.multiline
							? <textarea className="search-input" rows={8} style={{ width: '100%', resize: 'vertical', lineHeight: 1.5 }} value={fields[f.key] ?? ''} onChange={(e) => setFields((p) => ({ ...p, [f.key]: e.target.value }))} />
							: <input className="search-input" style={{ width: '100%' }} value={fields[f.key] ?? ''} onChange={(e) => setFields((p) => ({ ...p, [f.key]: e.target.value }))} />}
					</div>
				))}
				{template === 'custom' && data?.savedAvailable && (
					<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
						{saved && <button className="btn ghost" onClick={() => void saveTemplate(false)}><Save size={12} /> Update template</button>}
						<button className="btn ghost" onClick={() => void saveTemplate(true)}><Save size={12} /> Save as new template</button>
						{saved && <button className="btn ghost" onClick={() => void deleteTemplate()}><Trash2 size={12} /> Delete</button>}
					</div>
				)}
				<div style={{ borderTop: '1px solid var(--border)', paddingTop: 14 }}>
					<Label aside={`${to.length} recipient${to.length === 1 ? '' : 's'}`}>Recipients</Label>
					<textarea
						className="search-input" rows={4} style={{ width: '100%', resize: 'vertical', fontFamily: 'var(--font-mono)', fontSize: 12 }}
						placeholder={'one@example.com\ntwo@example.com'}
						value={recipients} onChange={(e) => setRecipients(e.target.value)}
					/>
					<p style={{ fontSize: 12, color: 'var(--fg-muted)', margin: '6px 0 0', lineHeight: 1.5 }}>
						Separate with commas or new lines (up to 5,000). Each person gets their own email.
					</p>
				</div>
				<div style={{ display: 'flex', gap: 8 }}>
					<button className="btn ghost" onClick={() => void doPreview()}><Eye size={12} /> Preview</button>
					<button className="btn" disabled={busy} onClick={() => void doSend()}><Send size={12} /> {busy ? 'Sending…' : to.length > 1 ? `Send to ${to.length}` : 'Send'}</button>
				</div>
			</div>
			<div className="card" style={{ padding: 0, overflow: 'hidden', minHeight: 420 }}>
				{preview
					? <iframe title="Email preview" srcDoc={preview} sandbox="" style={{ width: '100%', height: 720, border: 0, background: '#fff' }} />
					: <p style={{ padding: 'var(--space-4)', color: 'var(--fg-muted)', fontSize: 13 }}>Click Preview to see the email exactly as recipients will.</p>}
			</div>
		</div>
	);
}

// ─── Log ───────────────────────────────────────────────────────────────────

const PAGE = 50;

function Log({ batch, clearBatch }: { batch: string | undefined; clearBatch: () => void }) {
	const [status, setStatus] = useState('');
	const [provider, setProvider] = useState('');
	const [delivery, setDelivery] = useState('');
	const [q, setQ] = useState('');
	const [page, setPage] = useState(1);
	const { data, error, isLoading, mutate } = useSWR<LogResp>(
		['/api/admin/emails/log', { status, provider, delivery, q: q.trim(), batch, limit: PAGE, offset: (page - 1) * PAGE }],
		{ refreshInterval: 15_000 },
	);
	const s = data?.stats;
	const p = data?.providers;
	const reset = <T,>(fn: (v: T) => void) => (v: T) => { fn(v); setPage(1); };

	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
			<div className="grid-4">
				<StatCard label="Via SES (24h)" value={s ? s.ses_24h.toLocaleString() : '—'} loading={isLoading}
					sub={p ? (p.ses ? `limit ${p.sesMaxPerDay?.toLocaleString()} / day` : 'SES not configured') : undefined} />
				<StatCard label="Via Resend (24h)" value={s ? s.resend_24h.toLocaleString() : '—'} loading={isLoading} sub={p && !p.resend ? 'Resend not configured' : 'fallback'} />
				<StatCard label="Failed (24h)" value={s ? s.failed_24h.toLocaleString() : '—'} loading={isLoading} urgent={!!s?.failed_24h} sub={s ? `${s.queued} waiting in queue` : undefined} />
				<StatCard label="Bounced / complaints (30d)" value={s ? `${s.bounced_30d} / ${s.complained_30d}` : '—'} loading={isLoading} sub={s ? `${s.suppressed} addresses blocked` : undefined} />
			</div>

			<div className="card" style={{ padding: 'var(--space-4)' }}>
				<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12, alignItems: 'center' }}>
					<input className="search-input" placeholder="Search recipient or subject" style={{ width: 240 }} value={q} onChange={(e) => reset(setQ)(e.target.value)} />
					<Select value={status} onChange={reset(setStatus)} width={140} options={[{ value: '', label: 'Any status' }, ...['pending', 'sending', 'sent', 'failed'].map((v) => ({ value: v, label: v }))]} />
					<Select value={provider} onChange={reset(setProvider)} width={140} options={[{ value: '', label: 'Any provider' }, { value: 'ses', label: 'SES' }, { value: 'resend', label: 'Resend' }]} />
					<Select value={delivery} onChange={reset(setDelivery)} width={160} options={[{ value: '', label: 'Any delivery' }, ...['delivered', 'bounced', 'complained', 'delayed', 'rejected'].map((v) => ({ value: v, label: v })), { value: 'none', label: 'no report yet' }]} />
					{batch && <button className="chip on" onClick={clearBatch} title="Show all emails">This send only ✕</button>}
					<button className="btn ghost" style={{ marginLeft: 'auto' }} onClick={() => void mutate()}><RefreshCw size={12} /> Refresh</button>
				</div>
				<AsyncState loading={isLoading} error={error} empty={(data?.rows.length ?? 0) === 0} emptyMsg="No emails match." onRetry={() => void mutate()}>
					<table className="data-table">
						<thead>
							<tr><th>Queued</th><th>To</th><th>Subject</th><th>Status</th><th>Via</th><th>Delivery</th><th>Detail</th></tr>
						</thead>
						<tbody>
							{data?.rows.map((r) => (
								<tr key={r.id}>
									<td style={{ whiteSpace: 'nowrap', fontSize: 12, color: 'var(--fg-muted)' }}>{new Date(r.enqueued_at).toLocaleString()}</td>
									<td style={{ fontSize: 12 }}>{r.to_email}</td>
									<td style={{ fontSize: 12.5 }}>{r.subject}<div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{r.template}{r.source === 'admin_email' ? ' · sent by admin' : r.source === 'admin_bulk' ? ' · bulk send by admin' : ''}</div></td>
									<td><Tag variant={r.status === 'sent' ? 'pos' : r.status === 'failed' ? 'neg' : 'warn'}>{r.status}</Tag></td>
									<td style={{ fontSize: 12 }}>{r.provider ?? '—'}</td>
									<td>{r.delivery_status ? <Tag variant={r.delivery_status === 'delivered' ? 'pos' : r.delivery_status === 'delayed' ? 'warn' : 'neg'}>{r.delivery_status}</Tag> : <span style={{ color: 'var(--fg-muted)', fontSize: 12 }}>—</span>}</td>
									<td style={{ fontSize: 11.5, color: 'var(--fg-muted)', maxWidth: 320 }}>{r.delivery_detail ?? r.last_error ?? ''}</td>
								</tr>
							))}
						</tbody>
					</table>
					<Pager page={page} totalPages={data ? Math.ceil(data.total / PAGE) : undefined} onPage={setPage} />
				</AsyncState>
			</div>
		</div>
	);
}
