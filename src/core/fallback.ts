import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import type { AntigravityPayload } from './types.ts';

export function getDefaultFallbackFilePath(): string {
  return path.join(os.homedir(), '.gemini', 'jetski-standalone-oauth-token');
}

export const DEFAULT_FALLBACK_FILE_PATH = getDefaultFallbackFilePath();

/**
 * Atomically writes unprefixed plain JSON to the fallback token file with 0o600 permissions.
 */
export async function syncFallbackFile(
  payload: AntigravityPayload,
  targetPath = getDefaultFallbackFilePath()
): Promise<void> {
  const dir = path.dirname(targetPath);
  await fs.mkdir(dir, { recursive: true });

  const timestamp = Date.now();
  const randomSuffix = crypto.randomBytes(6).toString('hex');
  const tempFileName = `.${path.basename(targetPath)}.tmp.${timestamp}.${randomSuffix}`;
  const tempPath = path.join(dir, tempFileName);

  const jsonContent = JSON.stringify(payload, null, 2);

  try {
    // Write file with mode 0o600 (-rw-------)
    await fs.writeFile(tempPath, jsonContent, { mode: 0o600, encoding: 'utf8' });
    // Explicitly chmod in case process umask masked out permissions
    await fs.chmod(tempPath, 0o600);
    // Atomically move temp file to target path
    await fs.rename(tempPath, targetPath);
  } catch (error) {
    try {
      await fs.unlink(tempPath);
    } catch {
      // Ignore temp file cleanup error
    }
    throw error;
  }
}

/**
 * Safely removes fallback token file if it exists.
 */
export async function removeFallbackFile(
  targetPath = getDefaultFallbackFilePath()
): Promise<void> {
  try {
    await fs.unlink(targetPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
}
