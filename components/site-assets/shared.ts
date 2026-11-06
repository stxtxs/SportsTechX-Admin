import { toast } from 'sonner';
import { getSupabaseBrowser } from '@/lib/supabase';

/* Wire types — mirror server/src/modules/site-content/. */

export type CopyField = 'title' | 'subtitle' | 'body';

export interface SectionSpec {
	label: string;
	hint: string;
	fields: { name: CopyField; label: string; multiline?: boolean }[];
	overlay?: boolean;
	imageOptional?: boolean;
	placeholderCount: number;
	/** Fixed, positional slots (dashboards, solutions). Absent = unlimited. */
	max?: number;
}

/** site -> section -> spec. Served by GET /schema so it can't drift from the
 *  definition the public read uses. */
export type SiteSchema = Record<string, Partial<Record<string, SectionSpec>>>;

export interface Asset {
	id: string;
	url: string;
	storage_path: string | null;
	filename: string | null;
	mime_type: string | null;
	bytes: number | null;
	alt_text: string;
	created_at: string;
	usage_count: number;
}

export interface Placement {
	id: string;
	site: string;
	section: string;
	position: number;
	asset_id: string | null;
	overlay_asset_id: string | null;
	title: string | null;
	subtitle: string | null;
	body: string | null;
	is_active: boolean;
	asset_url: string | null;
	asset_alt: string | null;
	overlay_url: string | null;
	overlay_alt: string | null;
}

export const ASSETS_KEY = '/api/admin/site-content/assets';
export const PLACEMENTS_KEY = '/api/admin/site-content/placements';

/* ---- upload ------------------------------------------------------------- */

/* These two limits are the `public-images` bucket's, set in migration
   20260522120000. SVG is excluded there on purpose (XSS on a public bucket), so
   company logos have to be PNG or WebP. */
export const BUCKET = 'public-images';
export const PATH_PREFIX = 'site-assets';
export const MAX_BYTES = 5 * 1024 * 1024;
export const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
export const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif';

export function uploadsDisabled(): boolean {
	const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
	return !url || url.includes('localhost') || url.includes('127.0.0.1');
}

export interface UploadedFile {
	url: string;
	storage_path: string;
	filename: string;
	mime_type: string;
	bytes: number;
}

/**
 * Browser → Supabase Storage directly, exactly as components/image-input.tsx
 * does it. Bytes never touch the API process; the server only records the
 * resulting public URL.
 *
 * The one-year cacheControl is what keeps these off Supabase's rate limiter:
 * public-bucket objects are CDN-fronted, and a year-long max-age means the edge
 * answers repeat traffic on the public sites.
 */
/** Undo an upload whose DB row could not be written. Without it the object
 *  stays in the bucket forever with nothing referencing it - invisible to the
 *  library and impossible to delete from any UI. */
export async function discardUpload(storagePath: string): Promise<void> {
	try {
		await getSupabaseBrowser().storage.from(BUCKET).remove([storagePath]);
	} catch {
		/* best effort - the toast for the real failure has already fired */
	}
}

export async function uploadOne(file: File): Promise<UploadedFile | null> {
	if (!ALLOWED_MIME.has(file.type)) {
		toast.error(`${file.name}: unsupported type ${file.type || '(unknown)'}. PNG, JPEG, WebP or GIF.`);
		return null;
	}
	if (file.size > MAX_BYTES) {
		toast.error(`${file.name}: too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max 5 MB.`);
		return null;
	}
	// The whole body is guarded, not just the returned { error }:
	// getSupabaseBrowser() itself throws when the Supabase env vars are absent,
	// and that rejection used to escape the caller as an unhandled promise.
	try {
		const supabase = getSupabaseBrowser();
		const ext = (file.name.match(/\.([a-zA-Z0-9]+)$/)?.[1] ?? mimeExt(file.type)).toLowerCase();
		const key = `${PATH_PREFIX}/${crypto.randomUUID()}.${ext}`;
		const { error } = await supabase.storage.from(BUCKET).upload(key, file, {
			cacheControl: '31536000',
			upsert: false,
			contentType: file.type,
		});
		if (error) throw error;
		const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(key);
		return {
			url: pub.publicUrl,
			storage_path: key,
			filename: file.name,
			mime_type: file.type,
			bytes: file.size,
		};
	} catch (e) {
		toast.error(`${file.name}: ${(e as Error).message || 'upload failed'}`);
		return null;
	}
}

function mimeExt(mime: string): string {
	if (mime === 'image/jpeg') return 'jpg';
	if (mime === 'image/png') return 'png';
	if (mime === 'image/webp') return 'webp';
	if (mime === 'image/gif') return 'gif';
	return 'bin';
}

export function prettyBytes(n: number | null): string {
	if (!n) return '';
	return n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
}
