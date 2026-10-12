import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { expect, it } from 'vitest';
import type { CandidateDocument, ChangeSetInspection, ChangeSetApproval } from '@engramweave/contracts';
import { CandidateBuffer } from '../src/candidate-buffer';
import { CandidateRecovery } from '../src/candidate-recovery';
import { CoreClient } from '../src/connection';
import { approvalRequest, saveWorkspace, checkedJob } from '../src/changeset-approval';

const document = (id: string, item: string) => ({ changeset_id: id, item: { id: item }, content: 'Original', revision: 'a'.repeat(64) }) as CandidateDocument;
it('saves all workspace buffers and refuses approval when later typing remains dirty', async () => {
  const id = randomUUID(), first = new CandidateBuffer(document(id,randomUUID())), second = new CandidateBuffer(document(id,randomUUID()));
  first.content = 'First edit'; second.content = 'Unvisited edit';
  const buffers = new Map([[`${id}/${first.document.item.id}`,first],[`${id}/${second.document.item.id}`,second]]);
  const requests: unknown[] = []; const persisted: boolean[] = [];
  const recovery = { async persist(_record:unknown,dirty:boolean){persisted.push(dirty);} } as CandidateRecovery;
  const client = { async request(_route:string,request:unknown){requests.push(request); if(requests.length===1)first.content='Typed during save'; return{revision:'b'.repeat(64)};} } as CoreClient;
  await expect(saveWorkspace(id,buffers,recovery,client)).rejects.toThrow('新编辑');
  expect(requests).toHaveLength(2); expect(second.dirty).toBe(false); expect(first.content).toBe('Typed during save'); expect(first.dirty).toBe(true); expect(persisted).toEqual([true,false]);
});
it('uses displayed Current conditions and saved candidate revisions without silently refreshing the target',()=>{
  const id=randomUUID(),item=randomUUID(),buffer=new CandidateBuffer(document(id,item));buffer.revision='b'.repeat(64);
  const inspection={manifest_revision:'c'.repeat(64),source_revision:'d'.repeat(64),selected_draft:'30_Drafts/selected.md',related_drafts:[{path:'30_Drafts/selected.md',revision:'e'.repeat(64)}],
    review:{revision:'f'.repeat(64),decisions:[{item_id:item,decision:'include',domain_approved:false}]},targets:[{item_id:item,current_revision:'1'.repeat(64),candidate_revision:'a'.repeat(64)}]} as ChangeSetInspection;
  const request=approvalRequest(id,'30_Drafts/selected.md',inspection,new Map([[`${id}/${item}`,buffer]]));
  expect(request.items[0]).toEqual({item_id:item,current_revision:'1'.repeat(64),candidate_revision:'b'.repeat(64)});
  buffer.content='Later typing';expect(()=>approvalRequest(id,'30_Drafts/selected.md',inspection,new Map([[`${id}/${item}`,buffer]]))).toThrow('未保存');
  expect(()=>checkedJob({status:'succeeded'})).toThrow('不符合合同');
});
it('persists the same pending approval identity outside the Vault across reopen and removes only confirmed-unaccepted input',async()=>{
  await mkdir('.local',{recursive:true});const root=await mkdtemp(path.resolve('.local/approval-'));const vault=path.join(root,'vault');await mkdir(vault);
  try{
    const id=randomUUID();const request:ChangeSetApproval={request_id:randomUUID(),changeset_id:id,manifest_revision:'a'.repeat(64),review_revision:'b'.repeat(64),source_revision:'c'.repeat(64),draft_path:'30_Drafts/selected.md',related_drafts:[{path:'30_Drafts/selected.md',revision:'d'.repeat(64)}],items:[{item_id:randomUUID(),candidate_revision:'e'.repeat(64),current_revision:null}]};
    const recovery=new CandidateRecovery(root,vault);await recovery.persistApproval(id,request);
    const reopened=new CandidateRecovery(root,vault);expect(await reopened.loadApproval(id)).toEqual(request);expect(await readdir(vault)).toEqual([]);
    await reopened.persistApproval(id,null);expect(await reopened.loadApproval(id)).toBeNull();
  }finally{const relative=path.relative(path.resolve('.local'),root);if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw new Error('Unsafe cleanup');await rm(root,{recursive:true,force:true});}
});
