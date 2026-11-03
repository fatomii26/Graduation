import type { Metadata, Viewport } from 'next';
import './globals.css';
import { getAppSettings } from '@/lib/settings';

export const metadata: Metadata = {
  title: 'Graduation Tickets · Middlesex University Dubai',
  description: 'Graduate and guest tickets, zones, e-tickets and merchandise for the Middlesex University Dubai graduation ceremonies.',
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#7A1128' };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const testMode = await getAppSettings().then((s) => s.test_mode).catch(() => false);
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
      </head>
      <body>
        <a className="skip" href="#main">Skip to content</a>
        {testMode ? <div className="test-strip" role="note">TEST MODE · payments are simulated or use the CCAvenue test account · fictional data only</div> : null}
        {children}
      </body>
    </html>
  );
}
