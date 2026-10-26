'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useTweetComposer } from './tweet-composer';

/** 開いているメニューを1つにするための通知。 */
const MENU_OPENED = 'tweet-actions-menu:opened';

/**
 * 自分の投稿の三点メニュー。「編集する」「削除する」を置く（報告は実装時に追加する）。
 * 表示の有無はカードで決めるが、認可はActionとDBで改めて確認する。
 */
export function TweetActionsMenu({ tweetId, menuKey }: { tweetId: string; menuKey: string }) {
  const { openEdit, openDelete, busy } = useTweetComposer();
  const [open, setOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => setHydrated(true), []);

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onOtherOpened = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== menuId) setOpen(false);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener(MENU_OPENED, onOtherOpened);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener(MENU_OPENED, onOtherOpened);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open, menuId]);

  const items = [
    { label: '編集する', run: () => openEdit(tweetId, menuKey) },
    { label: '削除する', run: () => openDelete(tweetId, menuKey) },
  ];

  /** 上下矢印は端で反対側へ回り、Home・Endは先頭・末尾へ移る。Tabではメニューを閉じてフォーカスを先へ進める。 */
  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Tab') return setOpen(false);
    const elements = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]'));
    const current = elements.indexOf(document.activeElement as HTMLElement);
    const next =
      event.key === 'ArrowDown' ? (current + 1) % elements.length
      : event.key === 'ArrowUp' ? (current - 1 + elements.length) % elements.length
      : event.key === 'Home' ? 0
      : event.key === 'End' ? elements.length - 1
      : null;
    if (next === null) return;
    event.preventDefault();
    elements[next].focus();
  };

  const toggle = () => {
    if (open) return setOpen(false);
    window.dispatchEvent(new CustomEvent(MENU_OPENED, { detail: menuId }));
    setOpen(true);
  };

  return (
    <div
      ref={rootRef}
      className="relative ml-auto"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.stopPropagation();
          setOpen(false);
          buttonRef.current?.focus();
        }
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        data-tweet-menu-key={menuKey}
        aria-label="ツイートの操作"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        // サーバー描画直後の、まだ操作できない状態でのクリックを空振りさせない。編集中・準備中も開かない。
        disabled={!hydrated || busy}
        onClick={toggle}
        className="rounded-full px-2 py-0.5 text-lg leading-none text-gray-500 hover:bg-gray-100 disabled:opacity-40"
      >
        …
      </button>
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          onKeyDown={onMenuKeyDown}
          className="absolute right-0 z-10 mt-1 min-w-32 rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              tabIndex={-1}
              onClick={() => {
                setOpen(false);
                item.run();
              }}
              className={`block w-full px-4 py-2 text-left text-sm hover:bg-gray-100 focus:bg-gray-100 ${item.label === '削除する' ? 'text-red-600' : ''}`}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
