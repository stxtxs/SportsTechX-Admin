import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import { Providers } from './providers';
import './globals.css';

// Admin font stack — IBM Plex Sans (display + body) to match the STX-WebApp
// admin's clean SaaS look; JetBrains Mono kept for numeric/tabular cells.
// Self-hosted (latin, variable weight): next/font/google fetches from gstatic AT BUILD
// TIME and that fetch flakes on cold Vercel builds, failing the whole deploy (25 Nov 2026).
// Re-download: Google Fonts CSS2 API, latin subset.
const sans = localFont({
	src: './fonts/ibm-plex-sans.woff2',
	variable: '--font-ibm-plex-sans',
	display: 'swap',
	weight: '100 700',
});

const mono = localFont({
	src: './fonts/jetbrains-mono.woff2',
	variable: '--font-jetbrains-mono',
	display: 'swap',
	weight: '100 800',
});

export const metadata: Metadata = {
	title: { default: 'SportsTechX Admin', template: '%s | SportsTechX Admin' },
	description: 'Internal administration tools for the SportsTechX platform',
	applicationName: 'SportsTechX Admin',
	// An internal tool: never indexed, never followed, never cached in search results.
	// (No sitemap on purpose — it would only advertise the admin's URLs.)
	robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
	referrer: 'strict-origin-when-cross-origin',
	formatDetection: { telephone: false, email: false, address: false },
};

export const viewport: Viewport = {
	themeColor: [
		{ media: '(prefers-color-scheme: light)', color: '#ffffff' },
		{ media: '(prefers-color-scheme: dark)', color: '#0c0f1a' },
	],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
	return (
		<html
			lang="en"
			data-density="comfortable"
			suppressHydrationWarning
			className={`${sans.variable} ${mono.variable} h-full antialiased`}
		>
			<body className="min-h-full flex flex-col">
				<Providers>{children}</Providers>
			</body>
		</html>
	);
}
