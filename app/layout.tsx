import './globals.css';
import type { Metadata } from 'next';
import { Inter, Space_Grotesk } from 'next/font/google';
import TopBar from '@/components/TopBar';

// Body + UI sans.
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

// Display / eyebrow / monospaced-feel headlines.
const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-space-grotesk',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Braintrust // Typing Station',
  description: 'A head-to-head typing competition broadcast from the Braintrust station.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${spaceGrotesk.variable}`}>
      <body>
        <div className="app">
          <TopBar />
          <main className="container fade-in">{children}</main>
        </div>
      </body>
    </html>
  );
}
