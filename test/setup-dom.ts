import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});

// jsdomには<dialog>のshowModal/closeがないため、開閉と cancel/close イベントだけを再現する。
// 実際のモーダルの挙動（背景の操作不可・フォーカスの閉じ込め）はE2Eで確認する。
if (typeof HTMLDialogElement !== 'undefined' && !HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    if (!this.hasAttribute('open')) return;
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
}

// jsdomにはobject URLがないため、生成・解放を観測できる代替を用意する。
if (!URL.createObjectURL) {
  let seq = 0;
  URL.createObjectURL = () => `blob:test/${++seq}`;
  URL.revokeObjectURL = () => {};
}
