import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  MacKeychainService,
  encodeKeyringPayload,
  parseKeyringPayload,
  parseDumpKeychainAccounts,
  KEYRING_PREFIX,
} from '../../src/core/keychain.ts';
import { KeychainError, TokenParseError } from '../../src/core/errors.ts';
import type { AntigravityPayload } from '../../src/core/types.ts';

describe('Keychain Wrapper & Serializer', () => {
  const samplePayload: AntigravityPayload = {
    token: {
      access_token: 'ya29.sample-access-token',
      token_type: 'Bearer',
      refresh_token: '1//sample-refresh-token',
      expiry: '2026-11-16T18:00:00.000Z',
      expires_in: 3600,
    },
    auth_method: 'consumer',
    id_token_email: 'test@example.com',
  };

  describe('Payload Encoding and Parsing', () => {
    it('encodes payload with go-keyring-base64 prefix', () => {
      const encoded = encodeKeyringPayload(samplePayload);
      assert.ok(encoded.startsWith(KEYRING_PREFIX));

      const base64Data = encoded.slice(KEYRING_PREFIX.length);
      const decodedJson = JSON.parse(Buffer.from(base64Data, 'base64').toString('utf8'));
      assert.deepEqual(decodedJson, samplePayload);
    });

    it('round-trips encode and parse accurately', () => {
      const encoded = encodeKeyringPayload(samplePayload);
      const parsed = parseKeyringPayload(encoded);
      assert.deepEqual(parsed, samplePayload);
    });

    it('parses raw unprefixed JSON payload', () => {
      const rawJson = JSON.stringify(samplePayload);
      const parsed = parseKeyringPayload(rawJson);
      assert.deepEqual(parsed, samplePayload);
    });

    it('throws TokenParseError on empty or invalid input', () => {
      assert.throws(() => parseKeyringPayload(''), TokenParseError);
      assert.throws(() => parseKeyringPayload('   '), TokenParseError);
    });

    it('throws TokenParseError on corrupt base64 or JSON', () => {
      assert.throws(() => parseKeyringPayload(`${KEYRING_PREFIX}%%%not-base64%%%`), TokenParseError);
      assert.throws(() => parseKeyringPayload(`${KEYRING_PREFIX}${Buffer.from('not-json').toString('base64')}`), TokenParseError);
    });

    it('throws TokenParseError when token or required fields are missing', () => {
      assert.throws(() => parseKeyringPayload(JSON.stringify({ auth_method: 'consumer' })), TokenParseError);
      assert.throws(
        () => parseKeyringPayload(JSON.stringify({ token: { access_token: 'abc' } })),
        TokenParseError
      );
    });
  });

  describe('parseDumpKeychainAccounts', () => {
    const sampleDump = `
keychain: "/Users/user/Library/Keychains/login.keychain-db"
version: 512
class: "genp"
attributes:
    0x00000007 <blob>="gemini"
    0x00000008 <blob>=<NULL>
    "acct"<blob>="antigravity"
    "cdat"<timedate>=0x32303236313031353133353832365A00
--
class: "genp"
attributes:
    "svce"<blob>="gemini"
    "acct"<blob>="antigravity-profile:work"
--
class: "genp"
attributes:
    0x00000007 <blob>=0x67656d696e69
    "acct"<blob>=0x616e7469677261766974792d70726f66696c653a706572736f6e616c
--
class: "genp"
attributes:
    0x00000007 <blob>="other-service"
    "acct"<blob>="antigravity-profile:other"
`;

    it('extracts matching service accounts including hex encoded attributes', () => {
      const accounts = parseDumpKeychainAccounts(sampleDump, 'gemini');
      assert.deepEqual(accounts.sort(), [
        'antigravity',
        'antigravity-profile:personal',
        'antigravity-profile:work',
      ]);
    });

    it('filters by prefix when provided', () => {
      const accounts = parseDumpKeychainAccounts(sampleDump, 'gemini', 'antigravity-profile:');
      assert.deepEqual(accounts.sort(), [
        'antigravity-profile:personal',
        'antigravity-profile:work',
      ]);
    });

    it('returns empty array when service does not match', () => {
      const accounts = parseDumpKeychainAccounts(sampleDump, 'nonexistent');
      assert.deepEqual(accounts, []);
    });
  });

  describe('MacKeychainService', () => {
    it('findGenericPassword returns trimmed secret on success', async () => {
      const mockExec = async (file: string, args: readonly string[]) => {
        assert.equal(file, '/usr/bin/security');
        assert.deepEqual(args, ['find-generic-password', '-s', 'gemini', '-a', 'antigravity', '-w']);
        return { stdout: '  secret-value\n', stderr: '' };
      };

      const keychain = new MacKeychainService({ execFileFn: mockExec });
      const result = await keychain.findGenericPassword('gemini', 'antigravity');
      assert.equal(result, 'secret-value');
    });

    it('findGenericPassword returns null on exit code 44 (errSecItemNotFound)', async () => {
      const mockExec = async () => {
        const error = new Error('The specified item could not be found');
        (error as unknown as { code: number }).code = 44;
        (error as unknown as { stderr: string }).stderr = 'errSecItemNotFound';
        throw error;
      };

      const keychain = new MacKeychainService({ execFileFn: mockExec });
      const result = await keychain.findGenericPassword('gemini', 'missing');
      assert.equal(result, null);
    });

    it('findGenericPassword throws KeychainError on other exit codes', async () => {
      const mockExec = async () => {
        const error = new Error('General security error');
        (error as unknown as { code: number }).code = 1;
        (error as unknown as { stderr: string }).stderr = 'Permission denied';
        throw error;
      };

      const keychain = new MacKeychainService({ execFileFn: mockExec });
      await assert.rejects(
        () => keychain.findGenericPassword('gemini', 'locked'),
        (err: unknown) => {
          assert.ok(err instanceof KeychainError);
          assert.equal((err as KeychainError).exitCode, 1);
          assert.match((err as KeychainError).message, /Permission denied/);
          return true;
        }
      );
    });

    it('addGenericPassword executes upsert with -U by default', async () => {
      let executedArgs: readonly string[] = [];
      const mockExec = async (file: string, args: readonly string[]) => {
        executedArgs = args;
        return { stdout: '', stderr: '' };
      };

      const keychain = new MacKeychainService({ execFileFn: mockExec });
      await keychain.addGenericPassword('gemini', 'antigravity', 'new-secret');

      assert.deepEqual(executedArgs, [
        'add-generic-password',
        '-U',
        '-s',
        'gemini',
        '-a',
        'antigravity',
        '-w',
        'new-secret',
      ]);
    });

    it('addGenericPassword omits -U when updateExisting is false', async () => {
      let executedArgs: readonly string[] = [];
      const mockExec = async (file: string, args: readonly string[]) => {
        executedArgs = args;
        return { stdout: '', stderr: '' };
      };

      const keychain = new MacKeychainService({ execFileFn: mockExec });
      await keychain.addGenericPassword('gemini', 'antigravity', 'new-secret', false);

      assert.deepEqual(executedArgs, [
        'add-generic-password',
        '-s',
        'gemini',
        '-a',
        'antigravity',
        '-w',
        'new-secret',
      ]);
    });

    it('deleteGenericPassword returns true on exit code 0', async () => {
      const mockExec = async (file: string, args: readonly string[]) => {
        assert.deepEqual(args, ['delete-generic-password', '-s', 'gemini', '-a', 'antigravity']);
        return { stdout: 'deleted', stderr: '' };
      };

      const keychain = new MacKeychainService({ execFileFn: mockExec });
      const result = await keychain.deleteGenericPassword('gemini', 'antigravity');
      assert.equal(result, true);
    });

    it('deleteGenericPassword returns false on exit code 44', async () => {
      const mockExec = async () => {
        const error = new Error('Item not found');
        (error as unknown as { code: number }).code = 44;
        throw error;
      };

      const keychain = new MacKeychainService({ execFileFn: mockExec });
      const result = await keychain.deleteGenericPassword('gemini', 'nonexistent');
      assert.equal(result, false);
    });

    it('listAccounts calls dump-keychain and filters output', async () => {
      const mockExec = async (file: string, args: readonly string[]) => {
        assert.deepEqual(args, ['dump-keychain']);
        return {
          stdout: `
class: "genp"
attributes:
    "svce"<blob>="gemini"
    "acct"<blob>="antigravity-profile:alpha"
class: "genp"
attributes:
    "svce"<blob>="gemini"
    "acct"<blob>="antigravity-profile:beta"
`,
          stderr: '',
        };
      };

      const keychain = new MacKeychainService({ execFileFn: mockExec });
      const accounts = await keychain.listAccounts('gemini', 'antigravity-profile:');
      assert.deepEqual(accounts, [
        'antigravity-profile:alpha',
        'antigravity-profile:beta',
      ]);
    });
  });
});
