'use client';

import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Upload, Link2, Trash2, Loader2, Image as ImageIcon, Check } from 'lucide-react';
import { getSupabaseBrowser } from '@/lib/supabase';

/**
 * Image picker with two modes:
 *   • URL — paste an absolute https URL.
 *   • Upload — pick or drag-drop a file. Lands in Supabase Storage's
 *     `public-images` bucket at `${pathPrefix}/${uuid}.${ext}`. The resulting
 *     public URL is then written into `value` via `onChange`.
 *
 * `onChange` fires only at meaningful commit boundaries — NOT on every URL
 * keystroke. The URL tab buffers locally and commits on blur / Enter.
 * Switching tabs never fires onChange on its own. This keeps auto-save
 * parents (Report cover, profile avatar) from writing the partial URL of
 * "h", "ht", "htt", … to the DB while the admin is mid-typing.
 *
 * The Remove button only clears the field (the stored file is kept, so a
 * record is never left pointing at a deleted file before it is saved).
 *
 * RLS on `storage.objects` for `public-images` is the security boundary
 * (see migration 20260522120000). Admin paths require `public.is_admin()`;
 * `avatars/{auth.uid()}/...` is user-self-writable.
 */

const BUCKET_DEFAULT = 'public-images';
const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

interface ImageInputProps {
	value: string;
	onChange: (url: string) => void;
	pathPrefix: string;
	bucket?: string;
	placeholder?: string;
	disabled?: boolean;
}

export function ImageInput({
	value, onChange, pathPrefix, bucket = BUCKET_DEFAULT,
	placeholder = 'https://…', disabled = false,
}: ImageInputProps) {
	// Default tab follows the kind of value we already have — uploaded files
	// open the Upload tab so the admin sees their dropzone state; pasted URLs
	// open the URL tab.
	const initialMode: 'url' | 'upload' =
		value && value.includes(`/storage/v1/object/public/${bucket}/`) ? 'upload' : 'url';
	const [mode, setMode] = useState<'url' | 'upload'>(initialMode);

	const [draftUrl, setDraftUrl] = useState(value);
	const [uploading, setUploading] = useState(false);
	const [resetting, setResetting] = useState(false);
	const [dragOver, setDragOver] = useState(false);
	const fileInputRef = useRef<HTMLInputElement>(null);

	// Resync local draft when `value` changes from outside (upload completed,
	// parent reloaded, etc) using React's adjust-state-during-render pattern —
	// keeps the URL input from showing a stale URL after the Upload tab succeeds,
	// without a cascading-render effect.
	const [prevValue, setPrevValue] = useState(value);
	if (value !== prevValue) {
		setPrevValue(value);
		setDraftUrl(value);
	}

	const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
	const uploadsDisabled =
		!supabaseUrl ||
		supabaseUrl.includes('localhost') ||
		supabaseUrl.includes('127.0.0.1');

	const commitUrl = () => {
		if (disabled) return;
		if (draftUrl === value) return;          // nothing to commit
		onChange(draftUrl);
	};

	const doUpload = async (file: File) => {
		if (disabled || uploading) return;
		if (!ALLOWED_MIME.has(file.type)) {
			toast.error(`Unsupported type ${file.type || '(unknown)'}. Allowed: PNG, JPEG, WebP, GIF.`);
			return;
		}
		if (file.size > MAX_BYTES) {
			toast.error(`File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max 5 MB.`);
			return;
		}
		setUploading(true);
		try {
			const supabase = getSupabaseBrowser();
			const ext = (file.name.match(/\.([a-zA-Z0-9]+)$/)?.[1] ?? mimeExt(file.type)).toLowerCase();
			const key = `${pathPrefix.replace(/\/$/, '')}/${crypto.randomUUID()}.${ext}`;
			const { error } = await supabase.storage.from(bucket).upload(key, file, {
				cacheControl: '31536000',
				upsert: false,
				contentType: file.type,
			});
			if (error) throw error;
			const { data: pub } = supabase.storage.from(bucket).getPublicUrl(key);
			onChange(pub.publicUrl);
			toast.success('Uploaded');
		} catch (e) {
			toast.error((e as Error).message || 'Upload failed');
		} finally {
			setUploading(false);
		}
	};

	const onFilePicked = (e: React.ChangeEvent<HTMLInputElement>) => {
		const f = e.target.files?.[0];
		if (f) void doUpload(f);
		e.target.value = '';
	};

	const onDrop = (e: React.DragEvent) => {
		e.preventDefault();
		setDragOver(false);
		const f = e.dataTransfer.files?.[0];
		if (f) void doUpload(f);
	};

	// Remove only clears the field; the stored file is kept. Deleting it here happened before the
	// form was saved (and on Cancel too), so the live record kept pointing at a deleted file and a
	// broken image went live. An unused file in storage costs nothing that matters.
	const doReset = async () => {
		if (disabled || resetting || !value) return;
		if (!confirm('Remove this image? It is removed from the record when you save.')) return;
		setResetting(true);
		try {
			onChange('');
			toast.success('Image removed');
		} finally {
			setResetting(false);
		}
	};

	const dirty = draftUrl !== value;

	return (
		<div style={{ display: 'grid', gap: 8 }}>
			{/* Inline keyframes — admin doesn't ship an .animate-spin class. */}
			<style>{`@keyframes image-input-spin { to { transform: rotate(360deg); } }`}</style>

			{/* Tab switcher */}
			<div style={{ display: 'flex', gap: 4, padding: 3, background: 'var(--bg-2)', border: '1px solid var(--border)', width: 'fit-content' }}>
				<button type="button" onClick={() => setMode('url')} style={tabBtn(mode === 'url')}>
					<Link2 size={12} /> URL
				</button>
				<button
					type="button"
					onClick={() => setMode('upload')}
					disabled={uploadsDisabled}
					title={uploadsDisabled ? 'Uploads disabled — Supabase Storage is remote-only in local dev.' : undefined}
					style={tabBtn(mode === 'upload', uploadsDisabled)}
				>
					<Upload size={12} /> Upload
				</button>
			</div>

			{/* URL mode */}
			{mode === 'url' && (
				<div style={{ display: 'flex', gap: 6 }}>
					<input
						className="search-input"
						type="url"
						placeholder={placeholder}
						value={draftUrl}
						onChange={(e) => setDraftUrl(e.target.value)}
						onBlur={commitUrl}
						onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitUrl(); } }}
						disabled={disabled}
						style={{ flex: 1 }}
					/>
					<button
						type="button"
						className="btn"
						onClick={commitUrl}
						disabled={disabled || !dirty}
						title={dirty ? 'Save URL' : 'No changes'}
					>
						<Check size={12} /> Save URL
					</button>
				</div>
			)}

			{/* Upload mode */}
			{mode === 'upload' && (
				<>
					<input
						ref={fileInputRef}
						type="file"
						accept="image/png,image/jpeg,image/webp,image/gif"
						onChange={onFilePicked}
						style={{ display: 'none' }}
					/>
					<div
						onClick={() => !disabled && !uploading && fileInputRef.current?.click()}
						onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
						onDragLeave={() => setDragOver(false)}
						onDrop={onDrop}
						style={{
							border: `1px dashed ${dragOver ? 'var(--accent)' : 'var(--border)'}`,
							background: dragOver ? 'var(--bg-3)' : 'var(--bg-2)',
							padding: '18px 14px',
							display: 'flex',
							flexDirection: 'column',
							alignItems: 'center',
							gap: 6,
							cursor: disabled || uploading ? 'default' : 'pointer',
							color: 'var(--fg-2)',
							fontSize: 12,
						}}
					>
						{uploading ? (
							<>
								<Loader2 size={18} style={{ animation: 'image-input-spin 0.9s linear infinite' }} />
								<div>Uploading…</div>
							</>
						) : (
							<>
								<ImageIcon size={18} />
								<div>Click to pick a file, or drag and drop</div>
								<div style={{ fontSize: 10, color: 'var(--fg-muted)' }}>
									PNG · JPEG · WebP · GIF · max 5 MB
								</div>
							</>
						)}
					</div>
				</>
			)}

			{/* Preview + reset */}
			{value && (
				<div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 6, background: 'var(--bg-2)', border: '1px solid var(--border)' }}>
					{/* eslint-disable-next-line @next/next/no-img-element */}
					<img
						src={value}
						alt=""
						style={{ width: 48, height: 48, objectFit: 'cover', background: 'var(--bg-3)' }}
						onError={(e) => { (e.currentTarget.style.opacity = '0.3'); }}
					/>
					<div style={{ flex: 1, minWidth: 0, fontSize: 11, color: 'var(--fg-muted)', wordBreak: 'break-all', fontFamily: 'var(--font-mono)' }}>
						{value}
					</div>
					<button
						type="button"
						onClick={() => void doReset()}
						className="btn ghost"
						title="Remove image"
						disabled={disabled || resetting}
					>
						{resetting
							? <Loader2 size={12} style={{ animation: 'image-input-spin 0.9s linear infinite' }} />
							: <Trash2 size={12} />}
					</button>
				</div>
			)}
		</div>
	);
}

function tabBtn(active: boolean, disabled = false): React.CSSProperties {
	return {
		display: 'inline-flex',
		alignItems: 'center',
		gap: 4,
		padding: '4px 10px',
		fontSize: 12,
		fontWeight: 600,
		background: active ? 'var(--accent)' : 'transparent',
		color: active ? 'var(--accent-fg)' : disabled ? 'var(--fg-muted)' : 'var(--fg)',
		border: 'none',
		cursor: disabled ? 'default' : 'pointer',
		opacity: disabled ? 0.5 : 1,
	};
}

function mimeExt(mime: string): string {
	if (mime === 'image/jpeg') return 'jpg';
	if (mime === 'image/png') return 'png';
	if (mime === 'image/webp') return 'webp';
	if (mime === 'image/gif') return 'gif';
	return 'bin';
}


