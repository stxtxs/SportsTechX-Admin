'use client';

import { useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { toast } from 'sonner';
import { Plus, Trash2, X, Save, Pencil, ArrowUp, ArrowDown } from 'lucide-react';
import { api } from '@/lib/api';
import { Select } from '@/components/select';
import { useConfirm } from '@/components/confirm';
import { Modal } from '@/components/modal';
import { PageHeader, AsyncState } from '@/components/atoms';

interface PollOption { id: string; poll_id: string; label: string; sort_order: number; votes?: number }
interface Poll {
	id: string;
	report_id: string;
	question: string;
	is_open: boolean;
	sort_order: number;
	options: PollOption[];
}
interface PollsResponse { data: Poll[] }
interface Report { id: string; title: string }
interface ReportsResponse { data: Report[] }

export default function PollsAdminPage() {
	const { mutate } = useSWRConfig();
	const ask = useConfirm();
	const [reportFilter, setReportFilter] = useState<string>('');
	const [creating, setCreating] = useState(false);

	const { data: polls, error: pollsError, isLoading: pollsLoading } = useSWR<PollsResponse>(
		['/api/admin/polls', { report_id: reportFilter || undefined }],
		{ dedupingInterval: 30_000 },
	);
	// The endpoint's default page is 50; the library is past that, so older reports were unpickable.
	const { data: reports } = useSWR<ReportsResponse>(['/api/reports', { limit: 200 }], { dedupingInterval: 5 * 60_000 });
	const reportTitle = (id: string) => reports?.data.find((r) => r.id === id)?.title ?? id.slice(0, 8);

	const refresh = () => mutate((key) => Array.isArray(key) && key[0] === '/api/admin/polls');

	const togglePoll = async (poll: Poll) => {
		try {
			await api('PATCH', `/api/admin/polls/${poll.id}`, { is_open: !poll.is_open });
			toast.success(poll.is_open ? 'Closed' : 'Opened');
			void refresh();
		} catch (e) { toast.error((e as Error).message); }
	};

	const saveQuestion = async (id: string, question: string) => {
		try { await api('PATCH', `/api/admin/polls/${id}`, { question: question.trim() }); toast.success('Question updated'); void refresh(); }
		catch (e) { toast.error((e as Error).message); }
	};

	const removePoll = async (id: string) => {
		if (!(await ask('Delete poll? Votes will be removed too.'))) return;
		try { await api('DELETE', `/api/admin/polls/${id}`); toast.success('Deleted'); void refresh(); }
		catch (e) { toast.error((e as Error).message); }
	};

	const removeOption = async (o: PollOption) => {
		const votes = o.votes ?? 0;
		if (!(await ask(votes ? `Delete "${o.label}"? Its ${votes} vote${votes === 1 ? '' : 's'} will be deleted too.` : `Delete "${o.label}"?`))) return;
		const optionId = o.id;
		try { await api('DELETE', `/api/admin/polls/options/${optionId}`); void refresh(); }
		catch (e) { toast.error((e as Error).message); }
	};

	const renameOption = async (optionId: string, label: string) => {
		try { await api('PATCH', `/api/admin/polls/options/${optionId}`, { label: label.trim() }); void refresh(); }
		catch (e) { toast.error((e as Error).message); }
	};

	const addOption = async (poll: Poll, label: string) => {
		if (!label.trim()) return;
		const nextOrder = poll.options.reduce((m, o) => Math.max(m, o.sort_order), -1) + 1;
		try { await api('POST', `/api/admin/polls/${poll.id}/options`, { label: label.trim(), sort_order: nextOrder }); void refresh(); }
		catch (e) { toast.error((e as Error).message); }
	};

	// Swap sort_order of two options to move one up/down.
	const swapOptions = async (a: PollOption, b: PollOption) => {
		try {
			await Promise.all([
				api('PATCH', `/api/admin/polls/options/${a.id}`, { sort_order: b.sort_order }),
				api('PATCH', `/api/admin/polls/options/${b.id}`, { sort_order: a.sort_order }),
			]);
			void refresh();
		} catch (e) { toast.error((e as Error).message); }
	};

	return (
		<div>
			<PageHeader
				kicker="Reader engagement"
				title="Polls"
				subtitle="Authored once here, then attached to report sections via the section editor's poll picker."
			/>

			<div className="filter-bar" style={{ marginBottom: 12 }}>
				<Select value={reportFilter} onChange={setReportFilter} searchable width={280} placeholder="All reports" options={[{ value: '', label: 'All reports' }, ...(reports?.data ?? []).map((r) => ({ value: r.id, label: r.title }))]} />
				<div style={{ flex: 1 }} />
				<button className="btn" onClick={() => setCreating(true)} disabled={(reports?.data ?? []).length === 0}>
					<Plus size={12} /> New poll
				</button>
			</div>

			{creating && (
				<NewPollModal reports={reports?.data ?? []} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); void refresh(); }} />
			)}

			<AsyncState loading={pollsLoading} error={pollsError} empty={(polls?.data ?? []).length === 0} emptyMsg="No polls yet." onRetry={() => void refresh()}>
			<div style={{ display: 'grid', gap: 12 }}>
				{(polls?.data ?? []).map((p) => (
					<div key={p.id} className="card" style={{ padding: 'var(--space-4)' }}>
						<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
							<EditableQuestion poll={p} reportTitle={reportTitle(p.report_id)} onSave={(q) => void saveQuestion(p.id, q)} />
							<div style={{ display: 'flex', gap: 6 }}>
								<button className="btn ghost" onClick={() => void togglePoll(p)}>
									{p.is_open ? 'Close' : 'Reopen'}
								</button>
								<button className="btn ghost" style={{ color: 'var(--accent)' }} onClick={() => void removePoll(p.id)}>
									<Trash2 size={12} />
								</button>
							</div>
						</div>
						<div style={{ display: 'grid', gap: 6 }}>
							{p.options.map((o, idx) => (
								<OptionRow
									key={o.id}
									option={o}
									canUp={idx > 0}
									canDown={idx < p.options.length - 1}
									onUp={() => void swapOptions(o, p.options[idx - 1])}
									onDown={() => void swapOptions(o, p.options[idx + 1])}
									onRename={(label) => void renameOption(o.id, label)}
									onRemove={() => void removeOption(o)}
								/>
							))}
							<AddOptionInline onAdd={(label) => void addOption(p, label)} />
						</div>
					</div>
				))}
			</div>
			</AsyncState>
		</div>
	);
}

function EditableQuestion({ poll, reportTitle, onSave }: { poll: Poll; reportTitle: string; onSave: (q: string) => void }) {
	const [editing, setEditing] = useState(false);
	const [value, setValue] = useState(poll.question);
	if (editing) {
		return (
			<div style={{ display: 'flex', gap: 6, alignItems: 'center', flex: 1 }}>
				<input className="search-input" style={{ flex: 1 }} value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
				<button className="btn" disabled={!value.trim()} onClick={() => { onSave(value); setEditing(false); }}><Save size={12} /></button>
				<button className="btn ghost" onClick={() => { setValue(poll.question); setEditing(false); }}><X size={12} /></button>
			</div>
		);
	}
	return (
		<div>
			<div style={{ fontWeight: 700, fontSize: 15, display: 'flex', alignItems: 'center', gap: 8 }}>
				{poll.question}
				<button className="btn ghost" style={{ padding: '2px 6px' }} onClick={() => setEditing(true)}><Pencil size={11} /></button>
			</div>
			<div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-muted)', marginTop: 4 }}>
				report: {reportTitle} · {poll.is_open ? 'open' : 'closed'} · {poll.options.reduce((n, o) => n + (o.votes ?? 0), 0)} votes
			</div>
		</div>
	);
}

function OptionRow({ option, canUp, canDown, onUp, onDown, onRename, onRemove }: {
	option: PollOption; canUp: boolean; canDown: boolean; onUp: () => void; onDown: () => void; onRename: (label: string) => void; onRemove: () => void;
}) {
	const [editing, setEditing] = useState(false);
	const [value, setValue] = useState(option.label);
	return (
		<div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
			<div style={{ display: 'flex', flexDirection: 'column' }}>
				<button className="btn ghost" style={{ padding: 0, height: 14, opacity: canUp ? 1 : 0.3 }} disabled={!canUp} onClick={onUp}><ArrowUp size={11} /></button>
				<button className="btn ghost" style={{ padding: 0, height: 14, opacity: canDown ? 1 : 0.3 }} disabled={!canDown} onClick={onDown}><ArrowDown size={11} /></button>
			</div>
			{editing ? (
				<>
					<input className="search-input" style={{ flex: 1 }} value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
					<button className="btn ghost" disabled={!value.trim()} onClick={() => { onRename(value); setEditing(false); }}><Save size={11} /></button>
					<button className="btn ghost" onClick={() => { setValue(option.label); setEditing(false); }}><X size={11} /></button>
				</>
			) : (
				<>
					<span style={{ flex: 1 }}>{option.label}</span>
					<span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-muted)' }}>{option.votes ?? 0} votes</span>
					<button className="btn ghost" style={{ padding: '2px 6px' }} onClick={() => setEditing(true)}><Pencil size={11} /></button>
					<button className="btn ghost" style={{ padding: '2px 6px' }} onClick={onRemove}><X size={11} /></button>
				</>
			)}
		</div>
	);
}

function AddOptionInline({ onAdd }: { onAdd: (label: string) => void }) {
	const [label, setLabel] = useState('');
	return (
		<div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
			<input className="search-input" style={{ flex: 1 }} placeholder="Add option…" value={label} onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && label.trim()) { onAdd(label); setLabel(''); } }} />
			<button className="btn ghost" disabled={!label.trim()} onClick={() => { onAdd(label); setLabel(''); }}><Plus size={12} /></button>
		</div>
	);
}

function NewPollModal({ reports, onClose, onSaved }: { reports: Report[]; onClose: () => void; onSaved: () => void }) {
	const [reportId, setReportId] = useState(reports[0]?.id ?? '');
	const [question, setQuestion] = useState('');
	const [optionsText, setOptionsText] = useState('');
	const [isOpen, setIsOpen] = useState(true);
	const [pending, setPending] = useState(false);

	const submit = async () => {
		setPending(true);
		try {
			const options = optionsText.split('\n').map((s) => s.trim()).filter(Boolean);
			if (options.length < 2) { toast.error('Need at least 2 options'); setPending(false); return; }
			if (options.length > 8) { toast.error('Maximum 8 options'); setPending(false); return; }
			await api('POST', '/api/admin/polls', { report_id: reportId, question: question.trim(), options, is_open: isOpen });
			toast.success('Poll created');
			onSaved();
		} catch (e) { toast.error((e as Error).message); }
		finally { setPending(false); }
	};

	return (
		<Modal
			title="New poll"
			onClose={onClose}
			width={520}
			footer={
				<>
					<button className="btn ghost" onClick={onClose}>Cancel</button>
					<button className="btn" disabled={!reportId || !question.trim() || pending} onClick={() => void submit()}>
						<Save size={12} /> {pending ? 'Creating…' : 'Create'}
					</button>
				</>
			}
		>
			<div style={{ display: 'grid', gap: 12 }}>
				<div>
					<div className="co-stat-label" style={{ marginBottom: 6 }}>Report</div>
					<Select value={reportId} onChange={setReportId} searchable width="100%" style={{ display: 'block', width: '100%' }} options={reports.map((r) => ({ value: r.id, label: r.title }))} />
				</div>
				<div>
					<div className="co-stat-label" style={{ marginBottom: 6 }}>Question</div>
					<input className="search-input" style={{ width: '100%' }} value={question} onChange={(e) => setQuestion(e.target.value)} />
				</div>
				<div>
					<div className="co-stat-label" style={{ marginBottom: 6 }}>Options (one per line, 2–8)</div>
					<textarea
						className="search-input"
						style={{ width: '100%', minHeight: 100 }}
						value={optionsText}
						onChange={(e) => setOptionsText(e.target.value)}
						placeholder={'Yes\nNo\nMaybe'}
					/>
				</div>
				<label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
					<input type="checkbox" checked={isOpen} onChange={(e) => setIsOpen(e.target.checked)} /> Open for voting immediately
				</label>
			</div>
		</Modal>
	);
}
