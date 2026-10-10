import path from 'node:path';
import { mkdir, mkdtemp, readdir, rm, writeFile, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { ReviewRecovery } from '../src/review-recovery';
import type { PendingReview } from '../src/review-note';

it('persists only pending input outside the Vault, bounds recovery, protects unsafe existing records and removes confirmed input',async()=>{
 await mkdir('.local',{recursive:true});const root=await mkdtemp(path.resolve('.local/recovery-'));const vault=path.join(root,'vault');await mkdir(vault);
 try{
  expect(()=>new ReviewRecovery(vault,vault)).toThrow('outside');const store=new ReviewRecovery(path.join(root,'appdata'),vault);
  expect(await store.read()).toEqual([]);const record:PendingReview={vault,action:'complete',request:{request_id:randomUUID(),action:'complete',source_path:'20_Sources/one.md',source_revision:'a'.repeat(64),draft_path:'30_Drafts/one.md',draft_revision:'b'.repeat(64),note:'Only sent text'}};
  await store.write([record]);expect(await new ReviewRecovery(path.join(root,'appdata'),vault).read()).toEqual([record]);expect(await readdir(vault)).toEqual([]);
  const directory=path.join(root,'appdata/EngramWeave/obsidian-review');const filename=path.join(directory,(await readdir(directory))[0]!);
  expect(await readFile(filename,'utf8')).not.toContain('token');await store.write([]);expect(await readdir(directory)).toEqual([]);
  await writeFile(filename,'Invalid preserved record');await expect(store.write([record])).rejects.toThrow();expect(await readFile(filename,'utf8')).toBe('Invalid preserved record');
 }finally{const relative=path.relative(path.resolve('.local'),root);if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw new Error('Unsafe cleanup');await rm(root,{recursive:true,force:true});}
});
