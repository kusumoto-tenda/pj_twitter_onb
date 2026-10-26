import { unstable_rethrow } from 'next/navigation';

/** ok:false は通信切断・応答の読取失敗など、処理結果を確認できなかったことを表す（理由は含めない）。 */
export type DialogActionOutcome<T> = { ok: true; value: T } | { ok: false };

/**
 * ダイアログからのAction呼び出しだけを包み、一般的なrejectを失敗結果へ変換する。
 * redirect・notFound等のNext.jsの制御例外は同じ値のまま再throwし、遷移を妨げない。
 * unstable APIへの依存はこのファイルだけに閉じ込める。
 */
export async function invokeDialogAction<T>(run: () => Promise<T>): Promise<DialogActionOutcome<T>> {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false };
  }
}
