import 'server-only';
import NextAuth from 'next-auth';
import { authenticateUser } from '@/application/users/authenticate-user';
import { getAccountDependencies } from '@/app/_composition/account';
import { createAuthConfig } from './config';

export const { handlers, auth, signIn, signOut } = NextAuth(
  createAuthConfig((credentials) => authenticateUser(getAccountDependencies(), credentials)),
);
