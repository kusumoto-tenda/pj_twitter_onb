import { notFound, redirect } from 'next/navigation';
import { describe, expect, it } from 'vitest';
import { invokeDialogAction } from '@/app/ui/tweets/invoke-dialog-action';

/** 公開APIが実際に投げる制御例外を捕まえて使う（自作のErrorで代用しない）。 */
function thrownBy(run: () => never): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error('制御例外が投げられませんでした');
}

describe('invokeDialogAction', () => {
  it('成功値・通常のエラー値・互換用のundefinedはそのまま返す', async () => {
    const value = { status: 'success', attempt: 1 };
    const error = { status: 'error', code: 'CONFLICT', message: '競合', fieldErrors: {}, attempt: 2 };

    expect(await invokeDialogAction(async () => value)).toEqual({ ok: true, value });
    expect(await invokeDialogAction(async () => error)).toEqual({ ok: true, value: error });
    expect(await invokeDialogAction(async () => undefined)).toEqual({ ok: true, value: undefined });
  });

  it('通信失敗などの一般的なrejectは、内容を含めない失敗結果にする', async () => {
    expect(await invokeDialogAction(() => Promise.reject(new TypeError('Failed to fetch')))).toEqual({ ok: false });
    expect(await invokeDialogAction(() => Promise.reject(new Error('password=secret')))).toEqual({ ok: false });
    expect(await invokeDialogAction(() => Promise.reject('aborted'))).toEqual({ ok: false });
  });

  it.each([
    ['redirect(/login)', () => redirect('/login')],
    ['redirect(/)', () => redirect('/')],
    ['notFound()', () => notFound()],
  ])('Next.jsの制御例外（%s）は同じ値のまま再throwする', async (_name, run) => {
    const control = thrownBy(run);

    await expect(invokeDialogAction(() => Promise.reject(control))).rejects.toBe(control);
  });

  it('causeに制御例外を持つ例外も変換せずにNext.jsへ渡す', async () => {
    const control = thrownBy(() => redirect('/login'));
    const wrapped = new Error('wrapped', { cause: control });

    await expect(invokeDialogAction(() => Promise.reject(wrapped))).rejects.toBe(control);
  });
});
