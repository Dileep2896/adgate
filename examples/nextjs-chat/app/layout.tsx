import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import './globals.css';

export const metadata: Metadata = {
  title: 'adgate example: Next.js chat',
  description: 'A chat app whose sponsored block is decided by the adgate gateway, not the model.',
};

const RootLayout = ({ children }: { children: ReactNode }) => (
  <html lang="en">
    <body className="min-h-screen bg-stone-50 text-stone-900 antialiased">{children}</body>
  </html>
);

export default RootLayout;
