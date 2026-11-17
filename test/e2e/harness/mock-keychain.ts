import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export interface KeychainEntry {
  service: string;
  account: string;
  secret: string;
}

export class MockKeychain {
  private readonly dir: string;
  private readonly dbPath: string;
  private readonly scriptPath: string;
  private readonly ownedDir: boolean;

  constructor(customDir?: string) {
    if (customDir) {
      this.dir = customDir;
      this.ownedDir = false;
    } else {
      this.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-mock-keychain-'));
      this.ownedDir = true;
    }

    this.dbPath = path.join(this.dir, 'keychain-db.json');
    this.scriptPath = path.join(this.dir, 'mock-security.mjs');

    this.initDb();
    this.initScript();
  }

  private initDb(): void {
    if (!fs.existsSync(this.dbPath)) {
      fs.writeFileSync(this.dbPath, JSON.stringify({}, null, 2), 'utf8');
    }
  }

  private initScript(): void {
    const scriptContent = `#!/usr/bin/env node
import fs from 'node:fs';

const dbPath = process.env.AGY_MOCK_KEYCHAIN_DB || ${JSON.stringify(this.dbPath)};

function loadDb() {
  try {
    return JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  } catch {
    return {};
  }
}

function saveDb(db) {
  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), 'utf8');
}

const args = process.argv.slice(2);
const command = args[0];

function parseParam(flag) {
  const idx = args.indexOf(flag);
  if (idx !== -1 && idx + 1 < args.length) {
    return args[idx + 1];
  }
  return undefined;
}

if (command === 'find-generic-password') {
  const service = parseParam('-s');
  const account = parseParam('-a');
  if (!service || !account) {
    process.stderr.write('Missing service or account\\n');
    process.exit(1);
  }
  const db = loadDb();
  const key = \`\${service}:\${account}\`;
  if (key in db) {
    process.stdout.write(db[key] + '\\n');
    process.exit(0);
  } else {
    process.stderr.write('security: SecKeychainSearchCopyNext: The specified item could not be found.\\n');
    process.exit(44);
  }
} else if (command === 'add-generic-password') {
  const service = parseParam('-s');
  const account = parseParam('-a');
  const secret = parseParam('-w');
  if (!service || !account || secret === undefined) {
    process.stderr.write('Missing parameters for add-generic-password\\n');
    process.exit(1);
  }
  const db = loadDb();
  const key = \`\${service}:\${account}\`;
  db[key] = secret;
  saveDb(db);
  process.exit(0);
} else if (command === 'delete-generic-password') {
  const service = parseParam('-s');
  const account = parseParam('-a');
  if (!service || !account) {
    process.stderr.write('Missing service or account\\n');
    process.exit(1);
  }
  const db = loadDb();
  const key = \`\${service}:\${account}\`;
  if (key in db) {
    delete db[key];
    saveDb(db);
    process.exit(0);
  } else {
    process.stderr.write('security: SecKeychainSearchCopyNext: The specified item could not be found.\\n');
    process.exit(44);
  }
} else if (command === 'dump-keychain') {
  const db = loadDb();
  let output = '';
  for (const [key, secret] of Object.entries(db)) {
    const [svce, ...rest] = key.split(':');
    const acct = rest.join(':');
    output += \`class: "genp"\\nattributes:\\n    "svce"<blob>="\${svce}"\\n    "acct"<blob>="\${acct}"\\n--\\n\`;
  }
  process.stdout.write(output);
  process.exit(0);
} else {
  process.stderr.write(\`Unknown security command: \${command}\\n\`);
  process.exit(1);
}
`;

    fs.writeFileSync(this.scriptPath, scriptContent, { mode: 0o755 });
    // Also create a symlink or file named 'security' in the directory so PATH lookup works
    const securityLink = path.join(this.dir, 'security');
    try {
      if (fs.existsSync(securityLink)) {
        fs.unlinkSync(securityLink);
      }
      fs.symlinkSync(this.scriptPath, securityLink);
    } catch {
      fs.writeFileSync(securityLink, scriptContent, { mode: 0o755 });
    }
  }

  private readDb(): Record<string, string> {
    try {
      return JSON.parse(fs.readFileSync(this.dbPath, 'utf8'));
    } catch {
      return {};
    }
  }

  private writeDb(db: Record<string, string>): void {
    fs.writeFileSync(this.dbPath, JSON.stringify(db, null, 2), 'utf8');
  }

  setItem(service: string, account: string, secret: string): void {
    const db = this.readDb();
    db[`${service}:${account}`] = secret;
    this.writeDb(db);
  }

  getItem(service: string, account: string): string | null {
    const db = this.readDb();
    const key = `${service}:${account}`;
    return key in db ? db[key] : null;
  }

  deleteItem(service: string, account: string): boolean {
    const db = this.readDb();
    const key = `${service}:${account}`;
    if (key in db) {
      delete db[key];
      this.writeDb(db);
      return true;
    }
    return false;
  }

  listAccounts(service: string, prefix = ''): string[] {
    const db = this.readDb();
    const accounts: string[] = [];
    const servicePrefix = `${service}:`;
    for (const key of Object.keys(db)) {
      if (key.startsWith(servicePrefix)) {
        const acct = key.slice(servicePrefix.length);
        if (acct.startsWith(prefix)) {
          accounts.push(acct);
        }
      }
    }
    return accounts;
  }

  clear(): void {
    this.writeDb({});
  }

  getSecurityBinPath(): string {
    return this.scriptPath;
  }

  getBinDir(): string {
    return this.dir;
  }

  getDbPath(): string {
    return this.dbPath;
  }

  getDumpOutput(): string {
    const db = this.readDb();
    let output = '';
    for (const key of Object.keys(db)) {
      const [svce, ...rest] = key.split(':');
      const acct = rest.join(':');
      output += `class: "genp"\nattributes:\n    "svce"<blob>="${svce}"\n    "acct"<blob>="${acct}"\n--\n`;
    }
    return output;
  }

  /**
   * Direct in-memory execFileFn adapter matching (file, args) => Promise<{stdout, stderr}>
   */
  get execFileFn(): (file: string, args: readonly string[]) => Promise<{ stdout: string; stderr: string }> {
    return async (file: string, args: readonly string[]) => {
      const command = args[0];
      const parseArg = (flag: string) => {
        const idx = args.indexOf(flag);
        if (idx !== -1 && idx + 1 < args.length) {
          return args[idx + 1];
        }
        return undefined;
      };

      if (command === 'find-generic-password') {
        const s = parseArg('-s');
        const a = parseArg('-a');
        if (!s || !a) {
          const err = new Error('Missing -s or -a') as any;
          err.code = 1;
          throw err;
        }
        const val = this.getItem(s, a);
        if (val !== null) {
          return { stdout: `${val}\n`, stderr: '' };
        } else {
          const err = new Error('The specified item could not be found') as any;
          err.code = 44;
          err.stderr = 'security: SecKeychainSearchCopyNext: The specified item could not be found.';
          throw err;
        }
      }

      if (command === 'add-generic-password') {
        const s = parseArg('-s');
        const a = parseArg('-a');
        const w = parseArg('-w');
        if (!s || !a || w === undefined) {
          const err = new Error('Missing args for add-generic-password') as any;
          err.code = 1;
          throw err;
        }
        this.setItem(s, a, w);
        return { stdout: '', stderr: '' };
      }

      if (command === 'delete-generic-password') {
        const s = parseArg('-s');
        const a = parseArg('-a');
        if (!s || !a) {
          const err = new Error('Missing -s or -a') as any;
          err.code = 1;
          throw err;
        }
        const deleted = this.deleteItem(s, a);
        if (deleted) {
          return { stdout: 'deleted\n', stderr: '' };
        } else {
          const err = new Error('The specified item could not be found') as any;
          err.code = 44;
          err.stderr = 'security: SecKeychainSearchCopyNext: The specified item could not be found.';
          throw err;
        }
      }

      if (command === 'dump-keychain') {
        return { stdout: this.getDumpOutput(), stderr: '' };
      }

      const err = new Error(`Unknown security command: ${command}`) as any;
      err.code = 1;
      throw err;
    };
  }

  cleanup(): void {
    if (this.ownedDir) {
      try {
        fs.rmSync(this.dir, { recursive: true, force: true });
      } catch {
        // ignore cleanup errors
      }
    }
  }
}
