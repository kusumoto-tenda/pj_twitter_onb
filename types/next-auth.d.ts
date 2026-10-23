import type { DefaultSession } from 'next-auth';

declare module 'next-auth' {
  interface Session {
    /** idは内部UUID。パスワードやハッシュは含めない。 */
    user: { id: string } & DefaultSession['user'];
  }
}
