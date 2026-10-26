import type { Metadata } from 'next';
import '@/app/ui/global.css';
import { ActionFeedbackProvider } from '@/app/ui/notifications/action-feedback-provider';
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
        {/* 投稿ダイアログ・操作の通知はページの再取得で消えないよう、ルートのlayoutで状態を持つ。 */}
        <ActionFeedbackProvider>
          <TweetComposerProvider>{children}</TweetComposerProvider>
        </ActionFeedbackProvider>
      </body>
    </html>
  );
}
