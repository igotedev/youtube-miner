import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import './globals.css';

export const metadata: Metadata = {
  title: 'YouTube Niche Miner',
  description: 'Analise de dados publicos de canais do YouTube.',
};

/**
 * O tipo e escrito explicitamente em vez de usar o global `LayoutProps<"/">`
 * gerado pelo Next: `tsc --noEmit` precisa passar em um checkout limpo, antes
 * de qualquer `next build` ter populado `.next/types`.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" className="h-full antialiased">
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
