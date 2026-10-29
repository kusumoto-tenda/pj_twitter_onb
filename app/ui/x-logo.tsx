import Image from 'next/image';

/** 呼び出し元の文字サイズに合わせて表示する共通ロゴ。 */
export function XLogo({ className = '' }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      data-testid="x-logo"
      className={`select-none font-black leading-none ${className}`}
    >
      <Image
        src="/evil-rabbit.png"
        alt=""
        width={56}
        height={56}
        className="h-[1em] w-[1em] object-contain"
      />
    </span>
  );
}
