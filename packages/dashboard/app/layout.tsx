import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import './globals.css';

export const metadata: Metadata = {
  title: 'adgate dashboard',
  description: 'Apps, creatives, audit records and verification reports for an adgate gateway.',
};

const RootLayout = ({ children }: { children: ReactNode }) => (
  <html lang="en">
    <body className="min-h-screen bg-stone-50 text-stone-900 antialiased">{children}</body>
  </html>
);

export default RootLayout;
