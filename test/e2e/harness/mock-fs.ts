import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export class MockFs {
  private readonly homeDir: string;
  private readonly geminiDir: string;
  private readonly fallbackTokenPath: string;

  constructor(customHome?: string) {
    if (customHome) {
      this.homeDir = customHome;
    } else {
      this.homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-mock-home-'));
    }
    this.geminiDir = path.join(this.homeDir, '.gemini');
    this.fallbackTokenPath = path.join(this.geminiDir, 'jetski-standalone-oauth-token');
  }

  public getHomeDir(): string {
    return this.homeDir;
  }

  public getGeminiDir(): string {
    return this.geminiDir;
  }

  public getFallbackTokenPath(): string {
    return this.fallbackTokenPath;
  }

  public existsFallback(): boolean {
    return fs.existsSync(this.fallbackTokenPath);
  }

  public readFallbackRaw(): string | null {
    if (!this.existsFallback()) {
      return null;
    }
    return fs.readFileSync(this.fallbackTokenPath, 'utf8');
  }

  public readFallback(): any | null {
    const raw = this.readFallbackRaw();
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  public writeFallback(content: any | string, mode: number = 0o600): void {
    if (!fs.existsSync(this.geminiDir)) {
      fs.mkdirSync(this.geminiDir, { recursive: true });
    }
    const str = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
    fs.writeFileSync(this.fallbackTokenPath, str, { mode, encoding: 'utf8' });
    try {
      fs.chmodSync(this.fallbackTokenPath, mode);
    } catch {
      // ignore
    }
  }

  public getFallbackFileMode(): number | null {
    if (!this.existsFallback()) {
      return null;
    }
    const stats = fs.statSync(this.fallbackTokenPath);
    return stats.mode & 0o777;
  }

  public removeFallback(): void {
    if (this.existsFallback()) {
      fs.unlinkSync(this.fallbackTokenPath);
    }
  }

  public cleanup(): void {
    try {
      fs.rmSync(this.homeDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
}
