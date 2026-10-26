import { redirect } from 'next/navigation';
import { Component, type ReactNode } from 'react';

/** 公開APIの redirect() が実際に投げる制御例外（自作のErrorで代用しない）。 */
export function redirectError(path: string): unknown {
  try {
    redirect(path);
  } catch (error) {
    return error;
  }
  throw new Error('redirect() が例外を投げませんでした');
}

/** フォームのActionから再throwされた例外を受け取る、テスト用のエラー境界。 */
export class CaptureBoundary extends Component<{ children: ReactNode; onError: (error: unknown) => void }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    this.props.onError(error);
  }

  render() {
    return this.state.failed ? <p>エラー境界で受け取りました</p> : this.props.children;
  }
}

/**
 * 呼び出し元で待たれないPromise（ダイアログを開く処理）から抜けた例外を記録する。
 * Vitest自身の検出を一時的に外し、restore() で必ず元に戻す。
 */
export function captureUnhandledRejections() {
  const errors: unknown[] = [];
  const previous = process.listeners('unhandledRejection');
  const listener = (reason: unknown) => errors.push(reason);
  process.removeAllListeners('unhandledRejection');
  process.on('unhandledRejection', listener);
  return {
    errors,
    restore() {
      process.off('unhandledRejection', listener);
      for (const original of previous) process.on('unhandledRejection', original);
    },
  };
}
