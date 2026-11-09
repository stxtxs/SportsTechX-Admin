'use client';

import Link from 'next/link';
import { useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { toast } from 'sonner';
import { Trash2, FileText, Eye, EyeOff, Pencil, Languages, RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';
import { Select } from '@/components/select';
import { useConfirm } from '@/components/confirm';
import { Modal } from '@/components/modal';
import { PageHeader, AsyncState, Loading } from '@/components/atoms';
import { YearSelect } from '@/components/year-select';
import { ImageInput } from '@/components/image-input';
import { ReportPdfInput } from '@/components/report-pdf-input';
import { ReportEditionsModal } from '@/components/report-editions-modal';

interface Report {
	id: string;
	title: string;
	slug?: string;
	report_month?: number | null;
	report_year?: number | null;
	show_on_dashboard?: boolean;
	has_sections?: boolean;
	is_published?: boolean;
}
interface Response { data: Report[]; total: number }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const emptyDraft = {
	title: '', short_title: '', slug: '', description: '', summary_points: '', drive_link: '', pdf_url: '',
	report_month: '', report_year: String(new Date().getFullYear()), show_on_dashboard: false, has_sections: true,
	tags: '',
};

/** Topic tags are a `text[]` on `reports`, edited here as a comma-separated
 *  field — they drive the Topic facet on the public Reports library, which
 *  stays empty until reports are tagged. Free text, not a fixed vocabulary. */
const parseTags = (s: string): string[] => [...new Set(s.split(',').map((t) => t.trim()).filter(Boolean))];

/** Slugify a title/code into a URL-safe report slug. */
const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

export default function ReportsAdminPage() {
	const { mutate } = useSWRConfig();
	const ask = useConfirm();
	const [draft, setDraft] = useState({ ...emptyDraft });
	const [createPending, setCreatePending] = useState(false);
	const [removePending, setRemovePending] = useState(false);
	const [editingId, setEditingId] = useState<string | null>(null);
	const [editionsId, setEditionsId] = useState<string | null>(null);
	const [search, setSearch] = useState('');
	const [analyticsOpen, setAnalyticsOpen] = useState(false);
	const { data, error, isLoading } = useSWR<Response>(['/api/reports', { limit: 200 }], { dedupingInterval: 30_000 });

	const refresh = () => mutate((key) => Array.isArray(key) && key[0] === '/api/reports');

	const create = async () => {
		setCreatePending(true);
		try {
			// has_sections is a NEW column on reports — the legacy CRUD endpoint
			// doesn't know about it, so we POST to create + PATCH /flags to set it.
			const { has_sections, report_month, report_year, ...rest } = draft;
			const created = await api<{ id: string }>('POST', '/api/admin/reports', {
				title: rest.title,
				short_title: rest.short_title || undefined,
				slug: (rest.slug || rest.short_title || rest.title) ? slugify(rest.slug || rest.short_title || rest.title) : undefined,
				description: rest.description || undefined,
				summary_points: rest.summary_points || undefined,
				drive_link: rest.drive_link || undefined,
				pdf_url: rest.pdf_url || undefined,
				report_month: report_month ? Number(report_month) : undefined,
				report_year: report_year ? Number(report_year) : undefined,
				show_on_dashboard: rest.show_on_dashboard,
				tags: parseTags(rest.tags),
			});
			if (has_sections) {
				await api('PATCH', `/api/admin/reports/${created.id}/flags`, { has_sections: true });
			}
			toast.success('Report created');
			setDraft({ ...emptyDraft });
			void refresh();
		} catch (e) {
			toast.error((e as Error).message);
		} finally {
			setCreatePending(false);
		}
	};
	const remove = async (id: string) => {
		setRemovePending(true);
		try {
			await api('DELETE', `/api/admin/reports/${id}`);
			toast.success('Deleted');
			void refresh();
		} catch (e) {
			toast.error((e as Error).message);
		} finally {
			setRemovePending(false);
		}
	};
	/**
	 * Re-embed one report. The panel already calls the all-reports backfill from
	 * the Jobs page, so an editor who fixed a single report had to either
	 * re-embed every report or reach for curl.
	 */
	const [reindexing, setReindexing] = useState<string | null>(null);
	const reindex = async (id: string, title: string) => {
		setReindexing(id);
		try {
			await api('POST', `/api/admin/embeddings/reports/${id}/reindex`);
			toast.success(`Re-embedding "${title}" — semantic search and chat will pick it up shortly`);
		} catch (e) { toast.error((e as Error).message ?? 'Could not reindex'); }
		finally { setReindexing(null); }
	};

	const togglePublished = async (id: string, next: boolean) => {
		try {
			await api('PATCH', `/api/admin/reports/${id}/flags`, { is_published: next });
			toast.success(next ? 'Published' : 'Moved to draft');
			void refresh();
		} catch (e) {
			toast.error((e as Error).message);
		}
	};

	const allReports = data?.data ?? [];
	const reports = search.trim()
		? allReports.filter((r) => r.title.toLowerCase().includes(search.trim().toLowerCase()))
		: allReports;
	return (
		<div>
			<PageHeader kicker={`Library · ${(data?.total ?? 0).toLocaleString()} reports`} title="Reports" />

			{editingId && <EditReportModal id={editingId} onClose={() => setEditingId(null)} onSaved={() => { setEditingId(null); void refresh(); }} />}
			{editionsId && <ReportEditionsModal id={editionsId} onClose={() => setEditionsId(null)} />}

			<div className="card" style={{ padding: 'var(--space-4)', marginBottom: 'var(--space-4)' }}>
				<div style={{ fontWeight: 700, marginBottom: 12 }}>Publish a new report</div>
				<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
					<input className="search-input" placeholder="Title" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
					<input className="search-input" placeholder="Short title" value={draft.short_title} onChange={(e) => setDraft({ ...draft, short_title: e.target.value })} />
				</div>
				<input className="search-input" placeholder="URL slug (auto from short title / title)" value={draft.slug} onChange={(e) => setDraft({ ...draft, slug: e.target.value })} onBlur={(e) => setDraft({ ...draft, slug: slugify(e.target.value) })} style={{ marginTop: 8, fontFamily: 'var(--font-mono)', fontSize: 12 }} />
				<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginTop: 8 }}>
					<Select value={draft.report_month} onChange={(v) => setDraft({ ...draft, report_month: v })} width="100%" style={{ display: 'block', width: '100%' }} placeholder="Month —" options={[{ value: '', label: 'Month —' }, ...MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))]} />
					<YearSelect value={draft.report_year} onChange={(v) => setDraft({ ...draft, report_year: v })} placeholder="Year —" />
					<label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
						<input type="checkbox" checked={draft.show_on_dashboard} onChange={(e) => setDraft({ ...draft, show_on_dashboard: e.target.checked })} />
						Feature on dashboard
					</label>
				</div>
				<input className="search-input" placeholder="Drive link" value={draft.drive_link} onChange={(e) => setDraft({ ...draft, drive_link: e.target.value })} style={{ marginTop: 8 }} />
				<input className="search-input" placeholder="Topic tags, comma separated (e.g. Europe, Funding, Venues)" value={draft.tags} onChange={(e) => setDraft({ ...draft, tags: e.target.value })} style={{ marginTop: 8 }} />
				<div style={{ marginTop: 8 }}>
					<div className="co-stat-label" style={{ marginBottom: 4 }}>PDF</div>
					<ReportPdfInput value={draft.pdf_url} onChange={(u) => setDraft({ ...draft, pdf_url: u })} downloadName={draft.slug || draft.title} />
				</div>
				<textarea
					className="search-input"
					placeholder="Description"
					value={draft.description}
					onChange={(e) => setDraft({ ...draft, description: e.target.value })}
					style={{ width: '100%', marginTop: 8, minHeight: 70, resize: 'vertical' }}
				/>
				<textarea
					className="search-input"
					placeholder="Summary points (one per line)"
					value={draft.summary_points}
					onChange={(e) => setDraft({ ...draft, summary_points: e.target.value })}
					style={{ width: '100%', marginTop: 8, minHeight: 60, resize: 'vertical' }}
				/>
				<label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, fontSize: 13 }}>
					<input
						type="checkbox"
						checked={draft.has_sections}
						onChange={(e) => setDraft({ ...draft, has_sections: e.target.checked })}
					/>
					Sections-based report (in-app composable content). Uncheck for legacy PDF-link reports.
				</label>
				<button className="btn" style={{ marginTop: 10 }} disabled={!draft.title || createPending} onClick={() => void create()}>Create</button>
			</div>

			<div className="card" style={{ marginBottom: 'var(--space-4)' }}>
				<button className="btn ghost" style={{ width: '100%', justifyContent: 'space-between', display: 'flex' }} onClick={() => setAnalyticsOpen((o) => !o)}>
					<span>Download analytics — per-report stats</span><span>{analyticsOpen ? '▲' : '▼'}</span>
				</button>
				{analyticsOpen && <ReportAnalytics />}
			</div>

			<div className="card">
				<div style={{ padding: '12px var(--space-4)', borderBottom: '1px solid var(--border)' }}>
					<input className="search-input" style={{ width: 320, height: 30 }} placeholder="Search reports by title…" value={search} onChange={(e) => setSearch(e.target.value)} />
				</div>
				<AsyncState loading={isLoading} error={error} empty={reports.length === 0} emptyMsg={search ? 'No reports match.' : 'No reports yet.'} onRetry={() => void refresh()}>
				<table className="data-table">
					<thead><tr><th>Title</th><th>Model</th><th>Period</th><th>Status</th><th style={{ textAlign: 'right' }}></th></tr></thead>
					<tbody>
						{reports.map((r) => (
							<tr key={r.id}>
								<td>{r.title}{r.show_on_dashboard && <span className="tag" style={{ marginLeft: 6 }}>featured</span>}</td>
								<td>{r.has_sections ? <span className="tag pos">sections</span> : <span className="tag">pdf</span>}</td>
								<td className="num">{r.report_year ? `${r.report_month ? MONTHS[r.report_month - 1] + ' ' : ''}${r.report_year}` : '—'}</td>
								<td>{r.is_published === false ? <span className="tag">draft</span> : <span className="tag pos">published</span>}</td>
								<td style={{ textAlign: 'right', display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
									{r.has_sections && (
										<Link href={`/reports/${r.id}`} className="btn ghost" title="Edit sections">
											<FileText size={12} /> Sections
										</Link>
									)}
									<button className="btn ghost" onClick={() => setEditingId(r.id)} title="Edit metadata"><Pencil size={12} /> Edit</button>
										<button className="btn ghost" onClick={() => setEditionsId(r.id)} title="Language editions"><Languages size={12} /> Editions</button>
									<button
										className="btn ghost"
										onClick={() => void togglePublished(r.id, r.is_published === false)}
										title={r.is_published === false ? 'Publish' : 'Move to draft'}
									>
										{r.is_published === false ? <><Eye size={12} /> Publish</> : <><EyeOff size={12} /> Unpublish</>}
									</button>
									<button
										className="btn ghost"
										disabled={reindexing === r.id}
										onClick={() => void reindex(r.id, r.title)}
										title="Re-embed this report for semantic search and chat"
									>
										<RefreshCw size={12} /> {reindexing === r.id ? 'Reindexing…' : 'Reindex'}
									</button>
									<button className="btn ghost" disabled={removePending} onClick={async () => { if (await ask(`Delete ${r.title}?`)) void remove(r.id); }}>
										<Trash2 size={12} />
									</button>
								</td>
							</tr>
						))}
					</tbody>
				</table>
				</AsyncState>
			</div>
		</div>
	);
}

interface ReportStat { id: string; title: string; report_year?: number | null; report_month?: number | null; downloads: number; unique_users: number; last_download: string | null }

function ReportAnalytics() {
	const { data, isLoading, error, mutate } = useSWR<{ reports: ReportStat[] }>(['/api/admin/reports/analytics'], { dedupingInterval: 60_000 });
	const rows = (data?.reports ?? []).filter((r) => r.downloads > 0);
	const totalDl = rows.reduce((s, r) => s + r.downloads, 0);
	return (
		<div style={{ padding: 'var(--space-4)', borderTop: '1px solid var(--border)' }}>
			<AsyncState loading={isLoading} error={error} empty={rows.length === 0} emptyMsg="No downloads recorded yet." onRetry={() => void mutate()}>
				<div style={{ fontSize: 12, color: 'var(--fg-muted)', marginBottom: 8 }}>{totalDl.toLocaleString()} downloads across {rows.length} reports</div>
				<table className="data-table">
					<thead><tr><th>Report</th><th>Period</th><th>Downloads</th><th>Unique users</th><th>Last download</th></tr></thead>
					<tbody>
						{rows.map((r) => (
							<tr key={r.id}>
								<td>{r.title}</td>
								<td className="num">{r.report_year ? `${r.report_month ? MONTHS[r.report_month - 1] + ' ' : ''}${r.report_year}` : '—'}</td>
								<td className="num">{r.downloads.toLocaleString()}</td>
								<td className="num">{r.unique_users.toLocaleString()}</td>
								<td className="num">{r.last_download ? new Date(r.last_download).toLocaleDateString() : '—'}</td>
							</tr>
						))}
					</tbody>
				</table>
			</AsyncState>
		</div>
	);
}

interface ReportEdit {
	id: string; title: string; short_title?: string | null; slug?: string | null; report_month?: number | null; report_year?: number | null;
	show_on_dashboard?: boolean; description?: string | null; summary_points?: string | null; drive_link?: string | null; pdf_url?: string | null; cover_url?: string | null;
	tags?: string[] | null;
}

function EditReportModal({ id, onClose, onSaved }: { id: string; onClose: () => void; onSaved: () => void }) {
	const { data } = useSWR<ReportEdit>([`/api/admin/reports/${id}/edit`], { revalidateOnFocus: false });
	if (!data) return <Modal title="Edit report" onClose={onClose}><Loading msg="Loading report…" /></Modal>;
	return <EditReportForm initial={data} id={id} onClose={onClose} onSaved={onSaved} />;
}

function EditReportForm({ id, initial, onClose, onSaved }: { id: string; initial: ReportEdit; onClose: () => void; onSaved: () => void }) {
	const [f, setF] = useState({
		title: initial.title ?? '', short_title: initial.short_title ?? '', slug: initial.slug ?? '',
		report_month: initial.report_month ? String(initial.report_month) : '',
		report_year: initial.report_year ? String(initial.report_year) : '',
		show_on_dashboard: !!initial.show_on_dashboard,
		drive_link: initial.drive_link ?? '', pdf_url: initial.pdf_url ?? '', cover_url: initial.cover_url ?? '',
		description: initial.description ?? '', summary_points: initial.summary_points ?? '',
		tags: (initial.tags ?? []).join(', '),
	});
	const [pending, setPending] = useState(false);
	const set = (k: keyof typeof f, v: string | boolean) => setF((p) => ({ ...p, [k]: v }));
	const submit = async () => {
		setPending(true);
		try {
			await api('PATCH', `/api/admin/reports/${id}`, {
				title: f.title.trim(),
				short_title: f.short_title.trim() || undefined,
				slug: f.slug.trim() ? slugify(f.slug) : undefined,
				report_month: f.report_month ? Number(f.report_month) : null,
				report_year: f.report_year ? Number(f.report_year) : null,
				show_on_dashboard: f.show_on_dashboard,
				drive_link: f.drive_link.trim() || undefined,
				pdf_url: f.pdf_url.trim() || undefined,
				cover_url: f.cover_url.trim() || undefined,
				description: f.description.trim() || undefined,
				summary_points: f.summary_points.trim() || undefined,
				// Always sent, so clearing the field clears the tags.
				tags: parseTags(f.tags),
			});
			toast.success('Report updated');
			onSaved();
		} catch (e) { toast.error((e as Error).message); } finally { setPending(false); }
	};
	return (
		<Modal title="Edit report" onClose={onClose} width={620} footer={
			<>
				<button className="btn ghost" onClick={onClose}>Cancel</button>
				<button className="btn" disabled={!f.title.trim() || pending} onClick={() => void submit()}>{pending ? 'Saving…' : 'Save'}</button>
			</>
		}>
			<div style={{ display: 'grid', gap: 8 }}>
				<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
					<input className="search-input" placeholder="Title" value={f.title} onChange={(e) => set('title', e.target.value)} />
					<input className="search-input" placeholder="Short title" value={f.short_title} onChange={(e) => set('short_title', e.target.value)} />
				</div>
				<input className="search-input" placeholder="URL slug" value={f.slug} onChange={(e) => set('slug', e.target.value)} onBlur={(e) => set('slug', slugify(e.target.value))} style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }} />
				<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
					<Select value={f.report_month} onChange={(v) => set('report_month', v)} width="100%" style={{ display: 'block', width: '100%' }} placeholder="Month —" options={[{ value: '', label: 'Month —' }, ...MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))]} />
					<YearSelect value={f.report_year} onChange={(v) => set('report_year', v)} placeholder="Year —" />
					<label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
						<input type="checkbox" checked={f.show_on_dashboard} onChange={(e) => set('show_on_dashboard', e.target.checked)} /> Featured
					</label>
				</div>
				<input className="search-input" placeholder="Drive link" value={f.drive_link} onChange={(e) => set('drive_link', e.target.value)} />
				<input className="search-input" placeholder="Topic tags, comma separated (e.g. Europe, Funding, Venues)" value={f.tags} onChange={(e) => set('tags', e.target.value)} />
				<div><div className="co-stat-label" style={{ marginBottom: 4 }}>PDF</div><ReportPdfInput value={f.pdf_url} onChange={(u) => set('pdf_url', u)} downloadName={f.slug || f.title} /></div>
				<div><div className="co-stat-label" style={{ marginBottom: 4 }}>Cover image</div><ImageInput value={f.cover_url} onChange={(u) => set('cover_url', u)} pathPrefix="reports/covers" /></div>
				<textarea className="search-input" placeholder="Description" value={f.description} onChange={(e) => set('description', e.target.value)} style={{ minHeight: 70, resize: 'vertical' }} />
				<textarea className="search-input" placeholder="Summary points (one per line)" value={f.summary_points} onChange={(e) => set('summary_points', e.target.value)} style={{ minHeight: 60, resize: 'vertical' }} />
			</div>
		</Modal>
	);
}
