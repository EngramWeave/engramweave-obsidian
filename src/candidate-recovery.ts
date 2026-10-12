import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, lstat, readFile, writeFile, rename, unlink, realpath } from 'node:fs/promises';
import { vaultKey } from './connection';
import { Value } from '@sinclair/typebox/value';
import { ChangeSetApprovalSchema, type ChangeSetApproval } from '@engramweave/contracts';

export interface CandidateRecoveryRecord { changeset_id: string; item_id: string; content: string; savedContent: string; revision: string }
export class CandidateRecovery {
  private directory: string;
  private readonly logicalDirectory: string;
  private resolved = false;
  private serial = Promise.resolve();
  constructor(private readonly root: string, private readonly vault: string) {
    this.directory = path.join(root, 'EngramWeave', 'obsidian-candidates', createHash('sha256').update(vaultKey(vault)).digest('hex'));this.logicalDirectory=this.directory;
    if(!path.isAbsolute(root)||vaultKey(this.directory)===vaultKey(vault)||vaultKey(this.directory).startsWith(`${vaultKey(vault)}/`))throw new Error('Candidate recovery must stay outside the Vault');
  }
  private async file(id: string, item: string) {
    if (![id,item].every(value => /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value))) throw new Error('Invalid candidate identity');
    await mkdir(this.logicalDirectory, { recursive: true });
    const info = await lstat(this.logicalDirectory);const parent=await lstat(path.dirname(this.logicalDirectory));const grandparent=await lstat(path.dirname(path.dirname(this.logicalDirectory)));
    const physical=await realpath(this.logicalDirectory), root=await realpath(this.root);
    // Pin the OS-resolved directory once; packaged Windows processes can redirect regular application-data paths.
    if (!info.isDirectory() || info.isSymbolicLink() || !parent.isDirectory() || parent.isSymbolicLink() || !grandparent.isDirectory() || grandparent.isSymbolicLink()
      || !vaultKey(physical).startsWith(`${vaultKey(root)}/`) || vaultKey(physical).startsWith(`${vaultKey(this.vault)}/`)
      || this.resolved && vaultKey(physical)!==vaultKey(this.directory)) throw new Error('Candidate recovery directory is unsafe');
    this.directory=physical;this.resolved=true;
    return path.join(this.directory, `${id}-${item}.json`);
  }
  async load(id: string, item: string): Promise<CandidateRecoveryRecord | null> {
    const filename = await this.file(id,item); const info = await lstat(filename).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (!info) return null;
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 32 * 1024 * 1024) throw new Error('Unsafe candidate recovery record');
    const record = JSON.parse(await readFile(filename,'utf8'));
    if (record.version !== 1 || record.vault !== vaultKey(this.vault) || record.changeset_id !== id || record.item_id !== item || typeof record.content !== 'string'
      || typeof record.savedContent !== 'string' || !/^[a-f0-9]{64}$/.test(record.revision)) throw new Error('Invalid candidate recovery record');
    return record;
  }
  persist(record: CandidateRecoveryRecord, dirty: boolean) {
    const operation = this.serial.then(async () => {
      const filename = await this.file(record.changeset_id,record.item_id);
      const existing = await lstat(filename).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      if (existing && (!existing.isFile() || existing.isSymbolicLink() || existing.nlink !== 1)) throw new Error('Candidate recovery target is unsafe');
      if (!dirty) { if (existing) await unlink(filename); return; }
      const text = JSON.stringify({ version: 1, vault: vaultKey(this.vault), ...record });
      if (Buffer.byteLength(text) > 32 * 1024 * 1024) throw new Error('Candidate recovery exceeds its size bound');
      const temporary = `${filename}.${randomUUID()}.tmp`; await writeFile(temporary,text,{flag:'wx',mode:0o600,flush:true}); await rename(temporary,filename);
    });
    this.serial = operation.catch(() => {}); return operation;
  }
  async flush() { await this.serial; }
  private async approvalFile(id: string) { const file = await this.file(id, id); return path.join(path.dirname(file), `${id}-approval.json`); }
  async loadApproval(id: string): Promise<ChangeSetApproval | null> {
    const file = await this.approvalFile(id); const info = await lstat(file).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (!info) return null;
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 128000) throw new Error('Unsafe pending approval');
    const record = JSON.parse(await readFile(file, 'utf8'));
    if (record.vault !== vaultKey(this.vault) || !Value.Check(ChangeSetApprovalSchema, record.request) || record.request.changeset_id !== id) throw new Error('Invalid pending approval');
    return record.request;
  }
  persistApproval(id: string, request: ChangeSetApproval | null) {
    const operation = this.serial.then(async () => {
      const file = await this.approvalFile(id); const info = await lstat(file).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      if (info && (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1)) throw new Error('Unsafe pending approval target');
      if (!request) { if (info) await unlink(file); return; }
      if (!Value.Check(ChangeSetApprovalSchema, request) || request.changeset_id !== id) throw new Error('Invalid approval');
      const text = JSON.stringify({ vault: vaultKey(this.vault), request }); if (Buffer.byteLength(text) > 128000) throw new Error('Approval exceeds bound');
      const temporary = `${file}.${randomUUID()}.tmp`; await writeFile(temporary, text, { flag: 'wx', mode: 0o600, flush: true }); await rename(temporary, file);
    }); this.serial = operation.catch(() => {}); return operation;
  }
}
