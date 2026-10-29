import 'server-only';
import postgres from 'postgres';

let client: postgres.Sql | undefined;

/** サーバー専用のDB接続。ビルド時に接続しないよう、初回利用時に生成する。 */
export function getSql(): postgres.Sql {
  if (!client) {
    const url = process.env.POSTGRES_URL;
    if (!url) throw new Error('POSTGRES_URL が未設定です。');
    // SSLの要否は接続URLの sslmode で指定する。
    client = postgres(url, { onnotice: () => {} });
  }
  return client;
}
