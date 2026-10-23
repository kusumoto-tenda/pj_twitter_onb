import { execFileSync } from 'node:child_process';

/**
 * テストDBにマイグレーションを適用する。
 * webServerにはPOSTGRES_URLをテストDBへ差し替えた環境を渡すため、そこでは実行せず、
 * 元の環境変数のまま実行してアプリ用DBとの分離チェックを効かせる。
 */
export default function globalSetup() {
  execFileSync('pnpm', ['db:migrate', '--test'], { stdio: 'inherit' });
}
