import 'server-only';
import NextAuth from 'next-auth';
import { authenticateUser } from '@/application/usecases/users/authenticate-user';
import { getAccountDependencies } from '@/main/container/account';
import { createAuthConfig } from './config';

export const { handlers, auth, signIn, signOut } = NextAuth(
  createAuthConfig((credentials) => authenticateUser(getAccountDependencies(), credentials)),
);
