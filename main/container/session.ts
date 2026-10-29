import 'server-only';
import type { SessionTerminator } from '@/domain/external_service_ifs/auth/session-terminator';
import { endSession } from '@/app/_auth/end-session';

const dependencies: { sessions: SessionTerminator } = { sessions: { end: endSession } };

/** セッション終了の具体実装。組み立て時には認証処理・DB接続を行わない。 */
export function getSessionDependencies(): { sessions: SessionTerminator } {
  return dependencies;
}
