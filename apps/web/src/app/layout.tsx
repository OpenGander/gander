import type { Metadata } from 'next';
import { Inter, DM_Serif_Display } from 'next/font/google';
import './globals.css';
import { TrackingScript } from './tracking-script';
import { ThemeProvider } from '@/components/providers/ThemeProvider';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });
const dmSerif = DM_Serif_Display({ weight: '400', subsets: ['latin'], variable: '--font-serif' });

export const metadata: Metadata = {
  title: 'OpenGander - Privacy-First Analytics',
  description: 'Privacy-first observability and analytics platform',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} ${dmSerif.variable} font-sans`}>
        <ThemeProvider>{children}</ThemeProvider>
        <TrackingScript />
      </body>
    </html>
  );
}
