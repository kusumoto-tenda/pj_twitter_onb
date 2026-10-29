import type {
  CreateUserOutcome,
  DeleteUserOutcome,
  UpdateProfileOutcome,
  UserRepository,
} from '@/domain/repository_ifs/user-repository';
import { normalizeDisplayId } from '@/domain/value_objects/users/account-validation';
import type { ValidEditProfileInput } from '@/domain/value_objects/users/profile-edit-validation';
import { toAccountProfile, type StoredAccount } from '@/domain/entities/users/user';

export class InMemoryUserRepository implements UserRepository {
  readonly accounts: StoredAccount[] = [];

  async findByDisplayId(displayId: string): Promise<StoredAccount | null> {
    const key = normalizeDisplayId(displayId);
    return this.accounts.find((a) => normalizeDisplayId(a.displayId) === key) ?? null;
  }

  async findById(id: string): Promise<StoredAccount | null> {
    return this.accounts.find((a) => a.id === id) ?? null;
  }

  async create(account: StoredAccount): Promise<CreateUserOutcome> {
    if (await this.findByDisplayId(account.displayId)) return 'display-id-taken';
    this.accounts.push({ ...account });
    return 'created';
  }

  async updateProfile(id: string, input: ValidEditProfileInput): Promise<UpdateProfileOutcome> {
    const index = this.accounts.findIndex((a) => a.id === id);
    if (index === -1) return { status: 'not-found' };
    const key = normalizeDisplayId(input.displayId);
    const taken = this.accounts.some((a) => a.id !== id && normalizeDisplayId(a.displayId) === key);
    if (taken) return { status: 'display-id-taken' };
    this.accounts[index] = { ...this.accounts[index], ...input };
    return { status: 'updated', profile: toAccountProfile(this.accounts[index]) };
  }

  async deleteById(id: string): Promise<DeleteUserOutcome> {
    const index = this.accounts.findIndex((a) => a.id === id);
    if (index === -1) return 'not-found';
    this.accounts.splice(index, 1);
    return 'deleted';
  }
}
