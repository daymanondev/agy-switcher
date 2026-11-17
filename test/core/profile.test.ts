import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  ProfileService,
  KEYCHAIN_SERVICE,
  PRIMARY_ACCOUNT,
  PROFILE_ACCOUNT_PREFIX,
} from '../../src/core/profile.ts';
import {
  type IKeychainService,
  encodeKeyringPayload,
} from '../../src/core/keychain.ts';
import {
  AgySwitcherError,
  ProfileNotFoundError,
  KeychainError,
} from '../../src/core/errors.ts';
import type { AntigravityPayload } from '../../src/core/types.ts';

class MockKeychainService implements IKeychainService {
  public store = new Map<string, string>();

  private key(service: string, account: string): string {
    return `${service}:${account}`;
  }

  async findGenericPassword(service: string, account: string): Promise<string | null> {
    return this.store.get(this.key(service, account)) ?? null;
  }

  async addGenericPassword(
    service: string,
    account: string,
    secret: string,
    updateExisting = true
  ): Promise<void> {
    const k = this.key(service, account);
    if (this.store.has(k) && !updateExisting) {
      throw new KeychainError('Item already exists', 45);
    }
    this.store.set(k, secret);
  }

  async deleteGenericPassword(service: string, account: string): Promise<boolean> {
    const k = this.key(service, account);
    if (!this.store.has(k)) {
      return false;
    }
    return this.store.delete(k);
  }

  async listAccounts(service: string, prefix = ''): Promise<string[]> {
    const accounts: string[] = [];
    for (const k of this.store.keys()) {
      const [svc, ...rest] = k.split(':');
      const acct = rest.join(':');
      if (svc === service && acct.startsWith(prefix)) {
        accounts.push(acct);
      }
    }
    return accounts;
  }
}

describe('Profile Service', () => {
  let mockKeychain: MockKeychainService;
  let tempDir: string;
  let testFallbackPath: string;
  let profileService: ProfileService;

  const payloadWork: AntigravityPayload = {
    token: {
      access_token: 'ya29.work-access',
      token_type: 'Bearer',
      refresh_token: '1//work-refresh',
      expiry: new Date(Date.now() + 3600_000).toISOString(),
      expires_in: 3600,
    },
    auth_method: 'consumer',
    id_token_email: 'work@company.com',
  };

  const payloadPersonal: AntigravityPayload = {
    token: {
      access_token: 'ya29.personal-access',
      token_type: 'Bearer',
      refresh_token: '1//personal-refresh',
      expiry: new Date(Date.now() + 1800_000).toISOString(),
      expires_in: 1800,
    },
    auth_method: 'consumer',
    id_token_email: 'personal@gmail.com',
  };

  beforeEach(async () => {
    mockKeychain = new MockKeychainService();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agy-profile-test-'));
    testFallbackPath = path.join(tempDir, 'jetski-standalone-oauth-token');
    profileService = new ProfileService({
      keychain: mockKeychain,
      fallbackPath: testFallbackPath,
    });
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  describe('getActiveProfile', () => {
    it('returns null when primary slot does not exist', async () => {
      const active = await profileService.getActiveProfile();
      assert.equal(active, null);
    });

    it('returns active profile when primary slot exists', async () => {
      await mockKeychain.addGenericPassword(
        KEYCHAIN_SERVICE,
        PRIMARY_ACCOUNT,
        encodeKeyringPayload(payloadWork)
      );

      const active = await profileService.getActiveProfile();
      assert.ok(active);
      assert.equal(active.email, 'work@company.com');
      assert.equal(active.isActive, true);
      assert.equal(active.payload.token.access_token, 'ya29.work-access');
    });
  });

  describe('saveProfile', () => {
    it('saves current active profile to specified alias', async () => {
      await mockKeychain.addGenericPassword(
        KEYCHAIN_SERVICE,
        PRIMARY_ACCOUNT,
        encodeKeyringPayload(payloadWork)
      );

      const saved = await profileService.saveProfile('work');
      assert.equal(saved.alias, 'work');
      assert.equal(saved.email, 'work@company.com');
      assert.equal(saved.isActive, true);

      const storedSecret = await mockKeychain.findGenericPassword(
        KEYCHAIN_SERVICE,
        `${PROFILE_ACCOUNT_PREFIX}work`
      );
      assert.ok(storedSecret);
    });

    it('throws error when saving with no active profile in Keychain', async () => {
      await assert.rejects(
        () => profileService.saveProfile('orphan'),
        /No active profile found in Keychain to save/
      );
    });

    it('throws error when profile already exists without force flag', async () => {
      await mockKeychain.addGenericPassword(
        KEYCHAIN_SERVICE,
        PRIMARY_ACCOUNT,
        encodeKeyringPayload(payloadWork)
      );
      await profileService.saveProfile('work');

      await assert.rejects(
        () => profileService.saveProfile('work'),
        /Profile "work" already exists. Use --force to overwrite./
      );
    });

    it('overwrites existing profile when force is true', async () => {
      await mockKeychain.addGenericPassword(
        KEYCHAIN_SERVICE,
        PRIMARY_ACCOUNT,
        encodeKeyringPayload(payloadWork)
      );
      await profileService.saveProfile('work');

      // Update primary to personal credentials
      await mockKeychain.addGenericPassword(
        KEYCHAIN_SERVICE,
        PRIMARY_ACCOUNT,
        encodeKeyringPayload(payloadPersonal)
      );

      const overwritten = await profileService.saveProfile('work', { force: true });
      assert.equal(overwritten.email, 'personal@gmail.com');
    });

    it('rejects invalid alias names', async () => {
      await assert.rejects(() => profileService.saveProfile(''), AgySwitcherError);
      await assert.rejects(() => profileService.saveProfile('bad alias!'), AgySwitcherError);
      await assert.rejects(() => profileService.saveProfile('slash/bad'), AgySwitcherError);
    });
  });

  describe('listProfiles', () => {
    it('returns empty array when no profiles are stored', async () => {
      const list = await profileService.listProfiles();
      assert.deepEqual(list, []);
    });

    it('lists all stored profiles and flags the active one', async () => {
      // Set primary to work
      await mockKeychain.addGenericPassword(
        KEYCHAIN_SERVICE,
        PRIMARY_ACCOUNT,
        encodeKeyringPayload(payloadWork)
      );

      // Save two profiles
      await profileService.saveProfileWithPayload('work', payloadWork);
      await profileService.saveProfileWithPayload('personal', payloadPersonal);

      const list = await profileService.listProfiles();
      assert.equal(list.length, 2);

      const workItem = list.find((p) => p.alias === 'work');
      const personalItem = list.find((p) => p.alias === 'personal');

      assert.ok(workItem);
      assert.ok(personalItem);

      assert.equal(workItem.isActive, true);
      assert.equal(workItem.email, 'work@company.com');
      assert.equal(workItem.isExpired, false);

      assert.equal(personalItem.isActive, false);
      assert.equal(personalItem.email, 'personal@gmail.com');
      assert.equal(personalItem.isExpired, false);

      // Verify active item sorted first
      assert.equal(list[0].alias, 'work');
    });
  });

  describe('useProfile', () => {
    it('activates profile, updates primary slot, and syncs fallback file', async () => {
      // Set primary initially to work
      await mockKeychain.addGenericPassword(
        KEYCHAIN_SERVICE,
        PRIMARY_ACCOUNT,
        encodeKeyringPayload(payloadWork)
      );

      // Store personal profile
      await profileService.saveProfileWithPayload('personal', payloadPersonal);

      // Switch to personal
      const activated = await profileService.useProfile('personal');
      assert.equal(activated.alias, 'personal');
      assert.equal(activated.email, 'personal@gmail.com');
      assert.equal(activated.isActive, true);

      // Verify primary slot was updated
      const primaryActive = await profileService.getActiveProfile();
      assert.ok(primaryActive);
      assert.equal(primaryActive.email, 'personal@gmail.com');
      assert.equal(primaryActive.payload.token.access_token, 'ya29.personal-access');

      // Verify fallback file was synchronized
      const fallbackContent = await fs.readFile(testFallbackPath, 'utf8');
      const fallbackParsed = JSON.parse(fallbackContent) as AntigravityPayload;
      assert.equal(fallbackParsed.id_token_email, 'personal@gmail.com');
      assert.equal(fallbackParsed.token.access_token, 'ya29.personal-access');

      const stat = await fs.stat(testFallbackPath);
      assert.equal(stat.mode & 0o777, 0o600);
    });

    it('throws ProfileNotFoundError when alias does not exist', async () => {
      await assert.rejects(
        () => profileService.useProfile('nonexistent'),
        (err: unknown) => {
          assert.ok(err instanceof ProfileNotFoundError);
          assert.equal((err as ProfileNotFoundError).alias, 'nonexistent');
          return true;
        }
      );
    });
  });

  describe('deleteProfile', () => {
    it('deletes stored profile and returns true', async () => {
      await profileService.saveProfileWithPayload('temp', payloadWork);

      const deleted = await profileService.deleteProfile('temp');
      assert.equal(deleted, true);

      const exists = await mockKeychain.findGenericPassword(
        KEYCHAIN_SERVICE,
        `${PROFILE_ACCOUNT_PREFIX}temp`
      );
      assert.equal(exists, null);
    });

    it('returns false when deleting nonexistent profile', async () => {
      const deleted = await profileService.deleteProfile('missing');
      assert.equal(deleted, false);
    });
  });
});
