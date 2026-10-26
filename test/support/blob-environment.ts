/** SDKと同じく、読み書きトークン（vercel_blob_rw_<storeId>_<secret>）からストアIDを取り出す。 */
export function storeIdFromToken(token: string | undefined): string | null {
  if (!token?.startsWith('vercel_blob_rw_')) return null;
  return token.split('_')[3] || null;
}

const normalizeStoreId = (id: string | undefined) => (id ? id.replace(/^store_/, '') : null);

/**
 * 結合テスト・E2E用のBlob資格情報を返す。実体の作成・削除の前に、
 * テスト用トークンが宣言したテスト用ストアを指し、アプリ用ストアとは別であることを確認する。
 * 資格情報がなければ、成功扱いでskipせずセットアップ不足として失敗させる。
 */
export function requireTestBlobEnvironment(env: Record<string, string | undefined>) {
  const token = env.TEST_BLOB_READ_WRITE_TOKEN;
  const storeId = normalizeStoreId(env.TEST_BLOB_STORE_ID);
  if (!token || !storeId) {
    throw new Error('TEST_BLOB_READ_WRITE_TOKEN と TEST_BLOB_STORE_ID が必要です（テスト専用の非公開Blobストア）。');
  }
  if (storeIdFromToken(token) !== storeId) {
    throw new Error('TEST_BLOB_READ_WRITE_TOKEN が TEST_BLOB_STORE_ID のストアを指していません。');
  }
  const appStores = [normalizeStoreId(env.BLOB_STORE_ID), storeIdFromToken(env.BLOB_READ_WRITE_TOKEN)];
  if (appStores.includes(storeId)) {
    throw new Error('テスト用のBlobストアがアプリ用のストアと同じです。別のストアを指定してください。');
  }
  return { token, storeId: `store_${storeId}` };
}
