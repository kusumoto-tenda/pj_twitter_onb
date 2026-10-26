import 'server-only';
import { resolveViewer } from '@/app/_auth/viewer';

/** JSONでエラー・結果を返す。秘密やSQL・ストレージの生のエラーは含めない。 */
export function jsonResponse(status: number, body: unknown): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

/**
 * Route HandlerにはServer ActionのCSRF保護が自動では適用されないため、
 * Originヘッダーが自分自身と一致する要求だけを受け付ける。
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  return origin !== null && origin === new URL(request.url).origin;
}

async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  if (!request.headers.get('content-type')?.startsWith('application/json')) return null;
  try {
    const body: unknown = await request.json();
    return typeof body === 'object' && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * 変更系のRoute Handlerの共通の入口。同一Origin・ログイン中の利用者の実在・JSON本文を確認する。
 * 利用者はリクエストごとにセッションとDBで確認し、本文の値は権限判断に使わない。
 */
export async function guardMutation(
  request: Request,
): Promise<{ ok: true; actorId: string; body: Record<string, unknown> } | { ok: false; response: Response }> {
  if (!isSameOrigin(request)) {
    return { ok: false, response: jsonResponse(403, { code: 'FORBIDDEN', message: '許可されていない要求です' }) };
  }
  const viewer = await resolveViewer();
  if (viewer.status === 'unavailable') {
    return { ok: false, response: jsonResponse(503, { code: 'UNAVAILABLE', message: '時間をおいて再度お試しください' }) };
  }
  if (viewer.status === 'anonymous') {
    return { ok: false, response: jsonResponse(401, { code: 'UNAUTHENTICATED', message: 'ログインしてください' }) };
  }
  const body = await readJsonObject(request);
  if (!body) return { ok: false, response: jsonResponse(400, { code: 'INVALID_REQUEST', message: '入力内容を確認してください' }) };
  return { ok: true, actorId: viewer.profile.id, body };
}

export const ERROR_RESPONSES = {
  INVALID_REQUEST: [400, '入力内容を確認してください'],
  UNAUTHENTICATED: [401, 'ログインしてください'],
  FORBIDDEN: [403, 'この操作はできません'],
  NOT_FOUND: [404, '画像が見つかりません'],
  NOT_UPLOADED: [409, '画像のアップロードが完了していません'],
  DRAFT_EXPIRED: [409, '投稿の準備が切れました。ダイアログを開き直してください'],
  LIMIT_REACHED: [409, '画像は4枚まで添付できます'],
  ATTACHED: [409, '投稿済みの画像は解除できません'],
  PUBLISHED: [409, '投稿済みです'],
  UNAVAILABLE: [503, '時間をおいて再度お試しください'],
} as const satisfies Record<string, readonly [number, string]>;

export function errorResponse(code: keyof typeof ERROR_RESPONSES): Response {
  const [status, message] = ERROR_RESPONSES[code];
  return jsonResponse(status, { code, message });
}
