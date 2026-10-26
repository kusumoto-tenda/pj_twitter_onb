import 'server-only';
import { isSuccessfulSignOut } from '@/app/lib/form-data';
import { signOut } from './auth';

/**
 * Cookieの終了はAuth.jsへ任せる。遷移は呼び出し元のActionが行い、戻り値のエラーURLも失敗として扱う。
 * Auth.jsの例外はapplicationへ渡す。利用者DBの実在確認やDB接続は行わない。
 */
export async function endSession(): Promise<boolean> {
  return isSuccessfulSignOut(await signOut({ redirect: false, redirectTo: '/login' }));
}
