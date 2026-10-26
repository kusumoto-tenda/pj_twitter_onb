import type React from 'react';

const FOCUSABLE =
  'button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), a[href], [tabindex]:not([tabindex="-1"])';

/** ネイティブの<dialog>は最後の要素から外へフォーカスが出るため、Tab・Shift+Tabをダイアログ内で循環させる。 */
export function trapFocus(event: React.KeyboardEvent<HTMLDialogElement>) {
  if (event.key !== 'Tab') return;
  const focusables = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE));
  if (focusables.length === 0) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  const active = document.activeElement;
  if (event.shiftKey && (active === first || !event.currentTarget.contains(active))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || !event.currentTarget.contains(active))) {
    event.preventDefault();
    first.focus();
  }
}

/**
 * ダイアログを閉じた後、フォーカス先（find が返す要素）が操作できる状態で表示されたらフォーカスを移す。
 * Server Action後の再取得で一覧が読み込み表示に置き換わっていても、再表示（作り直し・有効化）を
 * DOMの変化で待つ。戻した後に要素が作り直されたら新しい要素へ移し直す。
 * 利用者が別の場所へフォーカスを移す・クリック・キー操作をしたら、奪わずに見守りをやめる。返り値で中止できる。
 */
export function restoreFocusWhenReady(find: () => HTMLElement | null): () => void {
  let target: HTMLElement | null = null;
  let stopped = false;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    observer.disconnect();
    window.removeEventListener('pointerdown', stop, true);
    window.removeEventListener('keydown', stop, true);
    document.removeEventListener('focusin', onFocusIn, true);
  };

  const tryFocus = () => {
    if (stopped) return;
    const active = document.activeElement;
    if (target?.isConnected && active === target) return;
    const element = find();
    if (!element || element.matches(':disabled')) return;
    target = element;
    element.focus({ preventScroll: true });
  };

  // 自分が移したフォーカス以外（利用者の操作など）でフォーカスが動いたら、見守りをやめる。
  const onFocusIn = (event: FocusEvent) => {
    if (event.target !== target && event.target !== document.body) stop();
  };

  const observer = new MutationObserver(tryFocus);
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });
  window.addEventListener('pointerdown', stop, true);
  window.addEventListener('keydown', stop, true);
  document.addEventListener('focusin', onFocusIn, true);
  tryFocus();
  return stop;
}
