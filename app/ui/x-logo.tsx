/** 画面案の右側にあるXロゴ。画像を使わずテキストで表現する。 */
export function XLogo({ className = '' }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      data-testid="x-logo"
      className={`select-none font-black leading-none ${className}`}
    >
      𝕏
    </span>
  );
}
