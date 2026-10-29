import type { NextAuthConfig, Session, User } from 'next-auth';
import type { JWT } from 'next-auth/jwt';
import Credentials from 'next-auth/providers/credentials';
import type { Credentials as AccountCredentials } from '@/application/usecases/users/authenticate-user';
import type { AccountProfile } from '@/domain/entities/users/user';

export const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

export type Authenticate = (credentials: AccountCredentials) => Promise<AccountProfile | null>;

/** Credentialsのauthorize。不一致はnull、DB障害などはthrowして区別する。 */
export function createAuthorize(authenticate: Authenticate) {
  return async (credentials: Partial<Record<string, unknown>>): Promise<User | null> => {
    const { displayId, password } = credentials;
    if (typeof displayId !== 'string' || typeof password !== 'string') return null;

    const profile = await authenticate({ displayId, password });
    if (!profile) return null;
    return { id: profile.id, name: profile.name };
  };
}

/** JWTには内部UUID（sub）だけを入れ、名前などは毎回DBから取得する。 */
export async function jwtCallback({ token, user }: { token: JWT; user?: User }): Promise<JWT> {
  if (user?.id) return { sub: user.id };
  return token;
}

export async function sessionCallback({
  session,
  token,
}: {
  session: Session | (Omit<Session, 'user'> & { user: Partial<Session['user']> });
  token: JWT;
}): Promise<Session> {
  return { expires: session.expires, user: { id: token.sub ?? '' } } as Session;
}

export function createAuthConfig(authenticate: Authenticate) {
  return {
    providers: [
      Credentials({
        credentials: { displayId: {}, password: {} },
        authorize: createAuthorize(authenticate),
      }),
    ],
    session: { strategy: 'jwt', maxAge: SESSION_MAX_AGE_SECONDS },
    pages: { signIn: '/login' },
    logger: {
      // 資格情報の不一致は想定内の結果なのでログに残さない。それ以外は既定どおり出力する。
      error(error) {
        if (error.name === 'CredentialsSignin') return;
        console.error(error);
      },
    },
    callbacks: {
      jwt: jwtCallback,
      session: sessionCallback as NonNullable<NextAuthConfig['callbacks']>['session'],
    },
  } satisfies NextAuthConfig;
}
