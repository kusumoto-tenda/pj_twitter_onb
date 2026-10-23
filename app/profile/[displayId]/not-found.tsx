import Link from 'next/link';
import { PageShell } from '@/app/ui/layout/page-shell';

/** 未登録・形式違反のユーザーIDの表示。取得障害とは区別する。 */
export default function ProfileNotFound() {
  return (
    <PageShell activePage={null} profileHref={null}>
      <div className="px-4 py-16 text-center">
        <p className="text-lg font-bold">このユーザーは見つかりませんでした</p>
        <Link href="/" className="mt-4 inline-block font-bold text-sky-600 underline">
          ホームに戻る
        </Link>
      </div>
    </PageShell>
  );
}
