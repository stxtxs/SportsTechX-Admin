import { Suspense } from 'react';
import { AdminShell } from '@/components/admin-shell';
import { ConfirmProvider } from '@/components/confirm';

// No `force-dynamic`: every admin page is a client component (auth runs in AdminShell), so
// pages can be prerendered and prefetched, and a sidebar click no longer waits on a server
// render. Suspense covers pages that read the URL (useSearchParams) during prerender.
export default function AdminLayout({ children }: { children: React.ReactNode }) {
	return <AdminShell><ConfirmProvider><Suspense fallback={null}>{children}</Suspense></ConfirmProvider></AdminShell>;
}
