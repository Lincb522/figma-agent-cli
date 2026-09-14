import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { AgentError } from '../protocol.js';

const digest = (token: string) => createHash('sha256').update(token).digest('hex');

export class Authorizations {
  private grants = new Set<string>();
  private pending: Promise<unknown> = Promise.resolve();
  private constructor(private path?: string) {}
  static async open(path?: string) {
    const store = new Authorizations(path);
    if (path) {
      try {
        const data = JSON.parse(await readFile(path, 'utf8'));
        if (data.version !== 1 || !Array.isArray(data.grants) || !data.grants.every((v: unknown) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v))) throw new Error();
        store.grants = new Set(data.grants);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new AgentError('AUTH_STORE_UNREADABLE', 'Saved plugin authorizations could not be loaded.', 'Restore the authorization file or move it aside and pair again.');
      }
    }
    return store;
  }
  identify(token: unknown) {
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return undefined;
    const id = digest(token);
    return this.grants.has(id) ? id : undefined;
  }
  private change(update: (next: Set<string>) => void) {
    const operation = this.pending.then(async () => {
      const next = new Set(this.grants); update(next);
      if (this.path) {
        const temp = `${this.path}.${randomUUID()}.tmp`;
        try {
          await writeFile(temp, JSON.stringify({ version: 1, grants: [...next] }), { flag: 'wx', mode: 0o600 });
          await rename(temp, this.path);
        } catch { throw new AgentError('AUTH_STORE_WRITE_FAILED', 'Plugin authorization could not be saved.', 'Check that the bridge state directory is writable, then try again.'); }
        finally { await unlink(temp).catch(() => {}); }
      }
      this.grants = next;
    });
    this.pending = operation.catch(() => {});
    return operation;
  }
  async issue() {
    const token = randomBytes(32).toString('hex');
    await this.change(next => { next.add(digest(token)); });
    return token;
  }
  async revoke(id: string) { await this.change(next => { next.delete(id); }); }
}
