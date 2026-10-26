import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { resolveViewer } from '@/app/_auth/viewer';
import { profileHref } from '@/app/lib/profile-query';
import { PageShell } from '@/app/ui/layout/page-shell';
import { AccountDeleteForm } from '@/app/ui/profile/account-delete-form';
import { ProfileRetry } from '@/app/ui/profile/profile-retry';
import { normalizeDisplayId } from '@/domain/users/account-validation';
import { deleteAccountAction } from './actions';

export const metadata: Metadata = { title: 'アカウント削除' };

/** 削除の確認画面。表示（GET）では削除せず、削除はActionだけで行う。 */
export default async function DeleteAccountPage({ params }: { params: Promise<{ displayId: string }> }) {
  const { displayId } = await params;
  const viewer = await resolveViewer();

  // redirect・notFoundは例外で遷移するため、try/catchの外で呼ぶ。
  if (viewer.status === 'anonymous') redirect('/login');
  if (viewer.status === 'unavailable') {
    return (
      <PageShell activePage={null} profileHref={null}>
        <ProfileRetry scope="profile" />
      </PageShell>
    );
  }

  const { profile } = viewer;
  // 自分の現在のIDだけを受け付ける（大小文字は区別しない）。他人・古いID・形式違反は見つからない表示。
  if (normalizeDisplayId(displayId) !== normalizeDisplayId(profile.displayId)) notFound();

  const ownHref = profileHref({ displayId: profile.displayId, tab: 'tweets' });
  return (
    <PageShell activePage="profile" profileHref={ownHref}>
      <AccountDeleteForm
        // 削除対象は表示時のUUIDで固定する。削除時にもActionで本人か確認する。
        action={deleteAccountAction.bind(null, profile.id)}
        account={{ name: profile.name, displayId: profile.displayId }}
        cancelHref={ownHref}
      />
    </PageShell>
  );
}
