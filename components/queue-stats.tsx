'use client';

import React from 'react';
import { Section } from '@/components/atoms';

/** Decimal duration like the old admin: "12.96h" / "2.97 min" / "45s". */
export const fmtDur = (s: number): string => (s >= 3600 ? `${(s / 3600).toFixed(2)}h` : s >= 60 ? `${(s / 60).toFixed(2)} min` : `${Math.round(s)}s`);

export interface QueueTimeStats {
	perAdmin: Array<{ admin_id: string; full_name: string | null; total_seconds: number; items: number; avg_seconds_per_item: number }>;
	totals: { total_seconds: number; items: number };
}

/**
 * Per-admin completion — the old admin's "Completion by Admin": "N done · N skipped · N pending"
 * with a green (done) + grey (skipped) bar. Rate = done / all items for that admin.
 */
export function CompletionByAdmin({ rows, skippedLabel = 'skipped' }: {
	rows: Array<{ key: string; name: string; done: number; skipped?: number; pending?: number; total: number; rate: number }>;
	skippedLabel?: string;
}) {
	if (!rows.length) return null;
	const pct = (n: number, t: number) => (t ? Math.min(Math.max((n / t) * 100, 0), 100) : 0);
	return (
		<div style={{ marginBottom: 'var(--space-5)' }}>
			<Section title="Completion by admin" meta={`done · ${skippedLabel} · pending`}>
				<div style={{ display: 'grid', gap: 14 }}>
					{rows.map((r) => (
						<div key={r.key}>
							<div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6, gap: 12 }}>
								<span style={{ fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
								<span style={{ color: 'var(--fg-muted)', flexShrink: 0 }}>
									{r.done.toLocaleString()} done · {(r.skipped ?? 0).toLocaleString()} {skippedLabel} · {(r.pending ?? 0).toLocaleString()} pending <strong style={{ color: 'var(--fg)' }}>{r.rate}%</strong>
								</span>
							</div>
							<div style={{ height: 8, borderRadius: 999, background: 'var(--bg-3)', overflow: 'hidden', display: 'flex' }}>
								<div style={{ width: `${pct(r.done, r.total)}%`, height: '100%', background: 'var(--pos)', transition: 'width .3s ease' }} />
								<div style={{ width: `${pct(r.skipped ?? 0, r.total)}%`, height: '100%', background: 'var(--fg-muted)', opacity: 0.45, transition: 'width .3s ease' }} />
							</div>
						</div>
					))}
				</div>
			</Section>
		</div>
	);
}

/** Per-admin work-time table (Total / Avg-per-item / Completed) + overall-average footer. */
export function TimeAnalytics({ timeStats, adminName }: { timeStats?: QueueTimeStats; adminName: (id: string | null) => string }) {
	const rows = timeStats?.perAdmin ?? [];
	const t = timeStats?.totals;
	const overall = t && t.items > 0 ? Math.round(t.total_seconds / t.items) : 0;
	return (
		<Section title="Time analytics" meta="work time per admin">
			{rows.length === 0 ? <div style={{ color: 'var(--fg-muted)', fontSize: 13 }}>No time data yet</div> : (
				<table className="data-table">
					<thead><tr><th>Admin</th><th style={{ textAlign: 'right' }}>Total Time</th><th style={{ textAlign: 'right' }}>Avg/Item</th><th style={{ textAlign: 'right' }}>Completed</th></tr></thead>
					<tbody>
						{rows.map((r) => (
							<tr key={r.admin_id}>
								<td>{r.full_name ?? adminName(r.admin_id)}</td>
								<td className="num">{fmtDur(r.total_seconds)}</td>
								<td className="num">{r.items > 0 ? fmtDur(r.avg_seconds_per_item) : '—'}</td>
								<td className="num">{r.items}</td>
							</tr>
						))}
					</tbody>
					<tfoot><tr><td colSpan={3} style={{ color: 'var(--fg-muted)' }}>Overall Average</td><td className="num" style={{ fontWeight: 700 }}>{overall ? `${fmtDur(overall)}/item` : '—'}</td></tr></tfoot>
				</table>
			)}
		</Section>
	);
}

export interface WeeklyMetric { label: string; cur: number; prev: number; fmt: (n: number) => string; goodDown?: boolean }

/** This-week vs last-week throughput with colored deltas — "Weekly Metrics". */
export function WeeklyMetrics({ metrics }: { metrics: WeeklyMetric[] | null }) {
	return (
		<Section title="Weekly metrics" meta="this week vs last">
			{!metrics ? <div style={{ color: 'var(--fg-muted)', fontSize: 13 }}>No weekly data</div> : (
				<div>
					{metrics.map((m, i) => {
						const change = m.prev > 0 ? Math.round(((m.cur - m.prev) / m.prev) * 100) : (m.cur > 0 ? 100 : 0);
						const positive = m.goodDown ? change <= 0 : change >= 0;
						return (
							<div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '11px 0', borderBottom: '1px solid var(--border)' }}>
								<div>
									<div style={{ fontSize: 12, color: 'var(--fg-muted)' }}>{m.label}</div>
									<div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 800, letterSpacing: '-0.01em' }}>{m.fmt(m.cur)}</div>
								</div>
								<div style={{ textAlign: 'right' }}>
									<span className={`tag ${positive ? 'pos' : 'neg'}`}>{change >= 0 ? '▲' : '▼'} {change >= 0 ? '+' : ''}{change}%</span>
									<div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 4 }}>vs {m.fmt(m.prev)}</div>
								</div>
							</div>
						);
					})}
				</div>
			)}
		</Section>
	);
}
