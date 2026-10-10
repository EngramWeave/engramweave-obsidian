import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import { readLocalFile, vaultKey } from './connection';
import { validPending, type PendingReview, type PendingStore } from './review-note';

/** Temporary delivery recovery outside the Vault; never plugin settings or an automatic retry queue. */
export class ReviewRecovery implements PendingStore {
  private directory: string;
  private filename: string;
  private readonly logicalDirectory: string;
  private resolved = false;
  private physicalFile: string | null = null;
  constructor(private readonly root: string, private readonly vault: string) {
    if(!path.isAbsolute(root))throw new Error('Desktop application data directory is unavailable');
    this.directory=path.join(root,'EngramWeave','obsidian-review');
    this.logicalDirectory=this.directory;
    if(vaultKey(this.directory).startsWith(`${vaultKey(vault)}/`) || vaultKey(this.directory)===vaultKey(vault))throw new Error('Review recovery data must stay outside the Vault');
    this.filename=path.join(this.directory,`${createHash('sha256').update(vaultKey(vault)).digest('hex')}.json`);
  }
  private async ready(create=false) {
    if(create)await mkdir(this.logicalDirectory,{recursive:true});
    const info=await lstat(this.logicalDirectory).catch(error=>{if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;});
    if(!info)return false;
    const parent=await lstat(path.dirname(this.logicalDirectory));
    const physical=await realpath(this.logicalDirectory), root=await realpath(this.root);
    // Windows packaged-process virtualization can redirect a regular application-data directory.
    // Resolve it once inside the OS data root, reject linked parents and subsequent target changes.
    if(!info.isDirectory() || info.isSymbolicLink() || !parent.isDirectory() || parent.isSymbolicLink()
      || !vaultKey(physical).startsWith(`${vaultKey(root)}/`) || vaultKey(physical).startsWith(`${vaultKey(this.vault)}/`)
      || this.resolved && vaultKey(physical)!==vaultKey(this.directory))throw new Error('Review recovery directory is unsafe');
    this.filename=path.join(physical,path.basename(this.filename));this.directory=physical;this.resolved=true;
    return true;
  }
  private async file() {
    const info=await lstat(this.filename);
    if(!info.isFile() || info.isSymbolicLink() || info.nlink!==1 || info.size>1_500_000)throw new Error('Review recovery file is unsafe');
    const physical=await realpath(this.filename),root=await realpath(this.root);
    // Packaged Windows processes can virtualize files even when their directory is not redirected.
    if(!vaultKey(physical).startsWith(`${vaultKey(root)}/`) || vaultKey(physical).startsWith(`${vaultKey(this.vault)}/`)
      || this.physicalFile && vaultKey(physical)!==vaultKey(this.physicalFile))throw new Error('Review recovery file target changed');
    this.physicalFile=physical;
    return physical;
  }
  async read():Promise<PendingReview[]> {
    if(!await this.ready())return [];
    let text:string;try{text=await readLocalFile(await this.file(),1_500_000);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return [];throw error;}
    const records=JSON.parse(text);if(!Array.isArray(records)||records.length>32||records.some(record=>!validPending(record)||vaultKey(record.vault)!==vaultKey(this.vault)))throw new Error('Review recovery content is invalid; preserved for inspection');
    return records;
  }
  async write(records:PendingReview[]) {
    if(records.length>32 || records.some(record=>!validPending(record)||vaultKey(record.vault)!==vaultKey(this.vault)))throw new Error('Invalid Review recovery input');
    if(!records.length) {if(await this.ready()) {await this.read();try{await unlink(await this.file());this.physicalFile=null;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}}return;}
    await this.ready(true);await this.read();const text=JSON.stringify(records);if(Buffer.byteLength(text)>1_500_000)throw new Error('Review recovery exceeds its bound');
    const temporary=`${this.filename}.${randomUUID()}.tmp`;await writeFile(temporary,text,{flag:'wx',flush:true,mode:0o600});await this.ready();await rename(temporary,this.filename);
  }
}
