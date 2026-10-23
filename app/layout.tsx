import type { Metadata } from 'next';
import '@/app/ui/global.css';

export const metadata: Metadata = {
  title: { default: 'X', template: '%s / X' },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body className="antialiased">{children}</body>
    </html>
  );
}
