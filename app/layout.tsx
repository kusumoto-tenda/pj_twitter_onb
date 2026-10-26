import type { Metadata } from 'next';
import '@/app/ui/global.css';
import { TweetComposerProvider } from '@/app/ui/tweets/tweet-composer';

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
      <body className="antialiased">
        {/* 投稿ダイアログはページの再取得で消えないよう、ルートのlayoutで状態を持つ。 */}
        <TweetComposerProvider>{children}</TweetComposerProvider>
      </body>
    </html>
  );
}
