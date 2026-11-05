'use client';

import { useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { toast } from 'sonner';
import { Plus, Trash2, Save, Pencil, Eye, EyeOff } from 'lucide-react';
import { api } from '@/lib/api';
import { Select } from '@/components/select';
import { useConfirm } from '@/components/confirm';
import { Modal } from '@/components/modal';
import { PageHeader, AsyncState, Loading } from '@/components/atoms';
import { RoundupPreview, Pills, type RoundupMode, type Perspective } from '@/components/market-roundup-preview';

interface Edition { id: string; year: number; month: number; title: string | null; summary: string | null; is_published: boolean }
interface NewsItem {
	id: string; year: number; month: number; section: string; category: string | null;
	headline: string; body: string | null; org: string | null; geo: string | null;
	source_url: string | null; sort_order: number; is_active: boolean;
}

const MONTHS = [
	[1, 'January'], [2, 'February'], [3, 'March'], [4, 'April'], [5, 'May'], [6, 'June'],
	[7, 'July'], [8, 'August'], [9, 'September'], [10, 'October'], [11, 'November'], [12, 'December'],
] as const;
const NOW = new Date();
// IH: current year + 10 previous.
const YEARS = Array.from({ length: 11 }, (_, i) => NOW.getUTCFullYear() - i);
const prevCalendarMonth = () => (NOW.getUTCMonth() === 0 ? { year: NOW.getUTCFullYear() - 1, month: 12 } : { year: NOW.getUTCFullYear(), month: NOW.getUTCMonth() });

export default function MarketRoundupAdminPage() {
	// `null` until the admin picks a month: open on the latest month that HAS
	// deals (the server resolves it when year/month are omitted), not blindly the
	// previous calendar month — ingest lags, so that one is often empty.
	const [sel, setSel] = useState<{ year: number; month: number } | null>(null);
	const latest = useSWR<{ year: number; month: number }>(sel ? null : ['/api/market/roundup', { mode: 'funding' }]);
	const cur = sel ?? (latest.data ? { year: latest.data.year, month: latest.data.month } : latest.error ? prevCalendarMonth() : null);
	if (!cur) return <div><Header /><Loading /></div>;
	return <MarketRoundupMonth year={cur.year} month={cur.month} onChange={setSel} />;
}

function Header() {
	return (
		<PageHeader
			kicker="Client Market page"
			title="Market roundup"
			subtitle="Monthly Funding & M&A analytics (computed live from deal data, as the old Intelligence Hub roundup), plus the editorial header and curated news for the client /roundup page."
		/>
	);
}

function MarketRoundupMonth({ year, month, onChange }: { year: number; month: number; onChange: (v: { year: number; month: number }) => void }) {
	const { mutate } = useSWRConfig();
	const ask = useConfirm();
	const [mode, setMode] = useState<RoundupMode>('funding');
	const [perspective, setPerspective] = useState<Perspective>('acquiree');
	const [editItem, setEditItem] = useState<NewsItem | null>(null);
	const [creating, setCreating] = useState(false);

	const edition = useSWR<{ edition: Edition | null }>(['/api/admin/market/roundup/edition', { year, month }], { dedupingInterval: 10_000 });
	const news = useSWR<{ data: NewsItem[] }>(['/api/admin/market/roundup/news', { year, month }], { dedupingInterval: 10_000 });

	const refresh = () => mutate((key) => Array.isArray(key) && typeof key[0] === 'string' && key[0].startsWith('/api/admin/market/roundup'));

	const toggleActive = async (n: NewsItem) => {
		try { await api('PATCH', `/api/admin/market/roundup/news/${n.id}`, { is_active: !n.is_active }); void refresh(); }
		catch (e) { toast.error((e as Error).message); }
	};
	const remove = async (n: NewsItem) => {
		if (!(await ask('Delete this news item?'))) return;
		try { await api('DELETE', `/api/admin/market/roundup/news/${n.id}`); toast.success('Deleted'); void refresh(); }
		catch (e) { toast.error((e as Error).message); }
	};

	return (
		<div>
			<Header />

			{/* IH filter row: Funding / M&A tabs, month + year, M&A perspective. */}
			<div className="card" style={{ padding: '12px 16px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
				<div role="tablist" style={{ display: 'flex' }}>
					{([['funding', 'Funding'], ['ma', 'M&A']] as const).map(([k, l]) => (
						<button key={k} type="button" role="tab" aria-selected={mode === k} onClick={() => setMode(k)}
							style={{
								padding: '8px 18px 9px', background: 'none', border: 0, cursor: 'pointer', fontSize: 14,
								fontWeight: mode === k ? 700 : 500, color: mode === k ? 'var(--accent)' : 'var(--fg-muted)',
								borderBottom: `3px solid ${mode === k ? 'var(--accent)' : 'transparent'}`,
							}}>
							{l}
						</button>
					))}
				</div>
				<Select ariaLabel="Month" value={String(month)} onChange={(v) => onChange({ year, month: Number(v) })} width={150} options={MONTHS.map(([v, l]) => ({ value: String(v), label: l }))} />
				<Select ariaLabel="Year" value={String(year)} onChange={(v) => onChange({ year: Number(v), month })} width={110} options={YEARS.map((y) => ({ value: String(y), label: String(y) }))} />
				{mode === 'ma' && <Pills value={perspective} onChange={setPerspective} options={[['acquiree', 'Acquiree'], ['acquirer', 'Acquirer']]} />}
			</div>

			<RoundupPreview year={year} month={month} mode={mode} perspective={perspective} />

			<div style={{ height: 16 }} />
			<EditionEditor key={`${year}-${month}`} year={year} month={month} edition={edition.data?.edition ?? null} onSaved={refresh} />

			<div className="filter-bar" style={{ margin: '20px 0 12px' }}>
				<div style={{ fontWeight: 700, fontSize: 15 }}>News items</div>
				<div style={{ flex: 1 }} />
				<button className="btn" onClick={() => setCreating(true)}><Plus size={12} /> New item</button>
			</div>

			<AsyncState loading={news.isLoading} error={news.error} empty={(news.data?.data ?? []).length === 0} emptyMsg="No news items for this month yet." onRetry={() => void refresh()}>
				<div style={{ display: 'grid', gap: 10 }}>
					{(news.data?.data ?? []).map((n) => (
						<div key={n.id} className="card" style={{ padding: 'var(--space-4)', opacity: n.is_active ? 1 : 0.55 }}>
							<div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
								<div style={{ minWidth: 0 }}>
									<div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-muted)', marginBottom: 4 }}>
										{n.section}{n.category ? ` · ${n.category}` : ''}{n.org ? ` · ${n.org}` : ''}{n.geo ? ` · ${n.geo}` : ''}
									</div>
									<div style={{ fontWeight: 700, fontSize: 15 }}>{n.headline}</div>
									{n.body && <div style={{ fontSize: 13, color: 'var(--fg-muted)', marginTop: 4 }}>{n.body}</div>}
								</div>
								<div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
									<button className="btn ghost" onClick={() => void toggleActive(n)} title={n.is_active ? 'Hide' : 'Show'}>{n.is_active ? <Eye size={12} /> : <EyeOff size={12} />}</button>
									<button className="btn ghost" onClick={() => setEditItem(n)}><Pencil size={12} /></button>
									<button className="btn ghost" style={{ color: 'var(--accent)' }} onClick={() => void remove(n)}><Trash2 size={12} /></button>
								</div>
							</div>
						</div>
					))}
				</div>
			</AsyncState>

			{(creating || editItem) && (
				<NewsModal
					year={year} month={month} item={editItem}
					onClose={() => { setCreating(false); setEditItem(null); }}
					onSaved={() => { setCreating(false); setEditItem(null); void refresh(); }}
				/>
			)}
		</div>
	);
}

function EditionEditor({ year, month, edition, onSaved }: { year: number; month: number; edition: Edition | null; onSaved: () => void }) {
	const [title, setTitle] = useState(edition?.title ?? '');
	const [summary, setSummary] = useState(edition?.summary ?? '');
	const [published, setPublished] = useState(edition?.is_published ?? false);
	const [pending, setPending] = useState(false);

	const save = async () => {
		setPending(true);
		try {
			await api('PUT', '/api/admin/market/roundup/edition', {
				year, month,
				title: title.trim() || null,
				summary: summary.trim() || null,
				is_published: published,
			});
			toast.success('Edition saved');
			onSaved();
		} catch (e) { toast.error((e as Error).message); }
		finally { setPending(false); }
	};

	return (
		<div className="card" style={{ padding: 'var(--space-4)' }}>
			<div style={{ fontWeight: 700, fontSize: 15, marginBottom: 12 }}>Editorial header</div>
			<div style={{ display: 'grid', gap: 12 }}>
				<div>
					<div className="co-stat-label" style={{ marginBottom: 6 }}>Title</div>
					<input className="search-input" style={{ width: '100%' }} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. August 2026 roundup" />
				</div>
				<div>
					<div className="co-stat-label" style={{ marginBottom: 6 }}>Summary (falls back to an auto-generated line if empty)</div>
					<textarea className="search-input" style={{ width: '100%', minHeight: 90 }} value={summary} onChange={(e) => setSummary(e.target.value)} />
				</div>
				<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
					<label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
						<input type="checkbox" checked={published} onChange={(e) => setPublished(e.target.checked)} /> Published (visible on the client)
					</label>
					<button className="btn" disabled={pending} onClick={() => void save()}><Save size={12} /> {pending ? 'Saving…' : 'Save header'}</button>
				</div>
			</div>
		</div>
	);
}

function NewsModal({ year, month, item, onClose, onSaved }: { year: number; month: number; item: NewsItem | null; onClose: () => void; onSaved: () => void }) {
	const [section, setSection] = useState(item?.section ?? 'Highlights');
	const [category, setCategory] = useState(item?.category ?? '');
	const [headline, setHeadline] = useState(item?.headline ?? '');
	const [body, setBody] = useState(item?.body ?? '');
	const [org, setOrg] = useState(item?.org ?? '');
	const [geo, setGeo] = useState(item?.geo ?? '');
	const [sourceUrl, setSourceUrl] = useState(item?.source_url ?? '');
	const [sortOrder, setSortOrder] = useState(String(item?.sort_order ?? 0));
	const [pending, setPending] = useState(false);

	const submit = async () => {
		if (!headline.trim()) { toast.error('Headline is required'); return; }
		setPending(true);
		const payload = {
			section: section.trim() || 'Highlights',
			category: category.trim() || null,
			headline: headline.trim(),
			body: body.trim() || null,
			org: org.trim() || null,
			geo: geo.trim() || null,
			source_url: sourceUrl.trim() || null,
			sort_order: Number(sortOrder) || 0,
		};
		try {
			if (item) await api('PATCH', `/api/admin/market/roundup/news/${item.id}`, payload);
			else await api('POST', '/api/admin/market/roundup/news', { year, month, ...payload });
			toast.success(item ? 'Updated' : 'Created');
			onSaved();
		} catch (e) { toast.error((e as Error).message); }
		finally { setPending(false); }
	};

	return (
		<Modal
			title={item ? 'Edit news item' : 'New news item'}
			onClose={onClose}
			width={560}
			footer={
				<>
					<button className="btn ghost" onClick={onClose}>Cancel</button>
					<button className="btn" disabled={!headline.trim() || pending} onClick={() => void submit()}><Save size={12} /> {pending ? 'Saving…' : 'Save'}</button>
				</>
			}
		>
			<div style={{ display: 'grid', gap: 12 }}>
				<Row label="Section"><input className="search-input" style={{ width: '100%' }} value={section} onChange={(e) => setSection(e.target.value)} placeholder="e.g. Deals & funding" /></Row>
				<Row label="Category (badge)"><input className="search-input" style={{ width: '100%' }} value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Funding" /></Row>
				<Row label="Headline"><input className="search-input" style={{ width: '100%' }} value={headline} onChange={(e) => setHeadline(e.target.value)} /></Row>
				<Row label="Body"><textarea className="search-input" style={{ width: '100%', minHeight: 90 }} value={body} onChange={(e) => setBody(e.target.value)} /></Row>
				<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
					<Row label="Org tag"><input className="search-input" style={{ width: '100%' }} value={org} onChange={(e) => setOrg(e.target.value)} /></Row>
					<Row label="Geo tag"><input className="search-input" style={{ width: '100%' }} value={geo} onChange={(e) => setGeo(e.target.value)} /></Row>
				</div>
				<Row label="Source URL"><input className="search-input" style={{ width: '100%' }} value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="https://…" /></Row>
				<Row label="Sort order"><input className="search-input" style={{ width: 120 }} type="number" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} /></Row>
			</div>
		</Modal>
	);
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
	return <div><div className="co-stat-label" style={{ marginBottom: 6 }}>{label}</div>{children}</div>;
}
