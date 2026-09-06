import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono, Space_Grotesk } from 'next/font/google';
import type { ReactNode } from 'react';

import { THEME_COLOR_DARK, THEME_COLOR_LIGHT, THEME_STORAGE_KEY } from '@/lib/theme';

import './globals.css';

/**
 * The document. Three jobs, in this order:
 *
 * 1. FONTS, SELF HOSTED. next/font downloads Space Grotesk, Inter and JetBrains Mono at
 *    build time and serves them from this origin, so there is no render blocking request to
 *    a font CDN and no layout shift: each face is preloaded with a metric matched fallback.
 *    The three CSS variables land on <html> and tokens.css reads them as --font-display,
 *    --font-body and --font-mono. Mono is load bearing here rather than decorative - this
 *    dashboard is full of sha256 digests, ULIDs, taxonomy paths and policy YAML.
 *
 * 2. THE THEME, BEFORE FIRST PAINT. A blocking inline script reads the operator's stored
 *    choice and stamps data-theme on <html> before the body renders, so a dark mode
 *    operator never sees a white flash. With nothing stored the attribute is absent and
 *    tokens.css follows prefers-color-scheme, which is the third supported state.
 *    suppressHydrationWarning is required precisely because this script mutates <html>
 *    between the server render and hydration.
 *
 * 3. Metadata and viewport, including viewport-fit=cover so the rail respects a notch.
 */

const display = Space_Grotesk({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-face-display',
  display: 'swap',
});

const body = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-face-body',
  display: 'swap',
});

const mono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-face-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'adgate dashboard',
  description: 'Apps, creatives, audit records and verification reports for an adgate gateway.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: THEME_COLOR_LIGHT },
    { media: '(prefers-color-scheme: dark)', color: THEME_COLOR_DARK },
  ],
};

const THEME_SCRIPT = `try{var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t)}}catch(e){}`;

const RootLayout = ({ children }: { children: ReactNode }) => (
  <html
    lang="en"
    suppressHydrationWarning
    className={`${display.variable} ${body.variable} ${mono.variable}`}
  >
    <body>
      <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      {children}
    </body>
  </html>
);

export default RootLayout;
