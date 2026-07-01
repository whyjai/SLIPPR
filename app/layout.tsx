import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

const siteUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://parlayguard.com';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: 'ParlayGuard — AI Parlay Protection & Sharp Betting Tools',
    template: '%s | ParlayGuard',
  },
  description:
    'ParlayGuard uses a 10-model AI council to generate consensus parlay slips, detect predatory lines, and deliver sharp vs public insights — refreshed 8x daily.',
  keywords: [
    'parlay picks',
    'sports betting AI',
    'sharp betting',
    'predatory lines',
    'parlay builder',
    'betting tools',
  ],
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: siteUrl,
    siteName: 'ParlayGuard',
    title: 'ParlayGuard — AI Parlay Protection',
    description:
      'Consensus parlay slips from a 10-model AI council. Avoid high-juice traps. Refreshed every 3 hours.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ParlayGuard — AI Parlay Protection',
    description:
      'Consensus parlay slips from a 10-model AI council. Avoid high-juice traps.',
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
