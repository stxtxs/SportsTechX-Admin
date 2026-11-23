'use client';

import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Image as ImageIcon, Loader2, Trash2, Upload } from 'lucide-react';
import { api } from '@/lib/api';
import { useConfirm } from '@/components/confirm';
import { AsyncState, Section, Tag } from '@/components/atoms';
import {
	ACCEPT, ASSETS_KEY, discardUpload, prettyBytes, uploadOne, uploadsDisabled,
	type Asset,
} from './shared';

/* eslint-disable @next/next/no-img-element */

/**
 * The library tab: drop files in, they land in Supabase Storage and get
 * recorded. Nothing here is site-specific — an asset is placed on a site (and
 * on as many sites and sections as you like) over on the Placements tab.
 */
export function AssetLibrary({
	assets, loading, error, reload,
}: {
	assets: Asset[];
	loading: boolean;
	error: unknown;
	reload: () => void;
}) {
	const [busy, setBusy] = useState(false);
	const [dragOver, setDragOver] = useState(false);
	const fileRef = useRef<HTMLInputElement>(null);
	const ask = useConfirm();
	const disabled = uploadsDisabled();

	const ingest = async (files: FileList | null) => {
		if (!files || files.length === 0 || busy) return;
		setBusy(true);
		let ok = 0;
		try {
			// Sequential on purpose: a bulk drop of 20 files in parallel gets
			// throttled by Storage, and the failures are then indistinguishable
			// from real errors.
			for (const file of Array.from(files)) {
				const uploaded = await uploadOne(file);
				if (!uploaded) continue;
				try {
					await api('POST', ASSETS_KEY, { ...uploaded, alt_text: '' });
					ok += 1;
				} catch (e) {
					toast.error(`${file.name}: ${(e as Error).message}`);
					// The bytes are already in the bucket. Without this the object is
					// orphaned: no row, so it never shows in the library and no UI can
					// remove it. This is the only place that still knows its key.
					await discardUpload(uploaded.storage_path);
				}
			}
			if (ok > 0) toast.success(`Uploaded ${ok} image${ok === 1 ? '' : 's'}`);
		} finally {
			setBusy(false);
			reload();
		}
	};

	const saveAlt = async (a: Asset, alt: string) => {
		if (alt === a.alt_text) return;
		try {
			await api('PATCH', `${ASSETS_KEY}/${a.id}`, { alt_text: alt });
			reload();
		} catch (e) {
			toast.error((e as Error).message);
		}
	};

	const remove = async (a: Asset) => {
		if (a.usage_count > 0) {
			toast.error(`Used in ${a.usage_count} place${a.usage_count === 1 ? '' : 's'} — remove it from those sections first.`);
			return;
		}
		if (!(await ask({ message: `Delete ${a.filename || 'this image'}? This cannot be undone.`, danger: true }))) return;
		try {
			await api('DELETE', `${ASSETS_KEY}/${a.id}`);
			toast.success('Deleted');
			reload();
		} catch (e) {
			toast.error((e as Error).message);
		}
	};

	return (
		<div style={{ display: 'grid', gap: 'var(--space-4)' }}>
			<style>{`@keyframes site-assets-spin { to { transform: rotate(360deg); } }`}</style>

			<Section title="Upload" meta="PNG · JPEG · WebP · GIF · max 5 MB each">
				<input ref={fileRef} type="file" accept={ACCEPT} multiple style={{ display: 'none' }}
					onChange={(e) => { void ingest(e.target.files); e.target.value = ''; }} />
				<div
					onClick={() => !disabled && !busy && fileRef.current?.click()}
					onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
					onDragLeave={() => setDragOver(false)}
					onDrop={(e) => { e.preventDefault(); setDragOver(false); if (!disabled) void ingest(e.dataTransfer.files); }}
					style={{
						border: `1px dashed ${dragOver ? 'var(--accent)' : 'var(--border)'}`,
						background: dragOver ? 'var(--bg-3)' : 'var(--bg-2)',
						padding: '28px 14px', display: 'flex', flexDirection: 'column',
						alignItems: 'center', gap: 6, color: 'var(--fg-2)', fontSize: 12,
						cursor: disabled || busy ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1,
					}}
				>
					{busy ? (
						<>
							<Loader2 size={20} style={{ animation: 'site-assets-spin 0.9s linear infinite' }} />
							<div>Uploading…</div>
						</>
					) : (
						<>
							{disabled ? <Upload size={20} /> : <ImageIcon size={20} />}
							<div>{disabled ? 'Uploads disabled — Storage is remote-only in local dev.' : 'Drop images here, or click to pick several'}</div>
							{/* SVG is excluded by the bucket's own mime whitelist, which is
							    deliberate; admins hit it most often with company logos. */}
							<div style={{ fontSize: 10, color: 'var(--fg-muted)' }}>
								No SVG — convert company logos to PNG or WebP
							</div>
						</>
					)}
				</div>
			</Section>

			<Section title="Library" meta={`${assets.length} image${assets.length === 1 ? '' : 's'}`}>
				<AsyncState loading={loading} error={error} empty={assets.length === 0}
					emptyMsg="No images yet — drop some above." onRetry={reload}>
					<div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
						{assets.map((a) => (
							<div key={a.id} style={{ border: '1px solid var(--border)', background: 'var(--bg-1)', display: 'grid' }}>
								<img src={a.url} alt="" loading="lazy" decoding="async" style={{ width: '100%', aspectRatio: '4 / 3', objectFit: 'cover', background: 'var(--bg-3)' }}
									onError={(e) => { e.currentTarget.style.opacity = '0.25'; }} />
								<div style={{ padding: 8, display: 'grid', gap: 6 }}>
									<input className="search-input" defaultValue={a.alt_text} placeholder="Alt text"
										onBlur={(e) => void saveAlt(a, e.target.value)}
										onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
										style={{ fontSize: 11, height: 26 }} />
									<div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: 'var(--fg-muted)' }}>
										<Tag variant={a.usage_count > 0 ? 'pos' : ''}>{a.usage_count} use{a.usage_count === 1 ? '' : 's'}</Tag>
										<span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
											{prettyBytes(a.bytes)}
										</span>
										<button type="button" className="btn ghost" onClick={() => void remove(a)}
											title={a.usage_count > 0 ? 'Still in use' : 'Delete'}>
											<Trash2 size={12} />
										</button>
									</div>
								</div>
							</div>
						))}
					</div>
				</AsyncState>
			</Section>
		</div>
	);
}
