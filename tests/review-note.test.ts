import { expect, it, vi } from 'vitest';
import type { DraftReview, HumanReviewRequest } from '@engramweave/contracts';
import { CoreResponseError, type CoreClient } from '../src/connection';
import { ReviewNotes, type PendingReview } from '../src/review-note';

const vault='D:\\ReviewVault';
const review=(draft='30_Drafts/one.md')=>({source:{path:'20_Sources/one.md',revision:'a'.repeat(64)},draft:{path:draft,revision:'b'.repeat(64)}} as DraftReview);
function fixture() {
  let records:PendingReview[]=[];
  const request=vi.fn(async(_route:string,body?:HumanReviewRequest)=>({request_id:body?.request_id,action:body?.action,status:'completed',idea_path:body?.action==='idea'?'10_Ideas/one.md':null,reused:false}));
  const store={read:async()=>structuredClone(records),write:async(value:PendingReview[])=>{records=structuredClone(value);}};
  const create=()=>new ReviewNotes({request} as unknown as CoreClient,vault,store);
  return {notes:create(),request,store,create,records:()=>records};
}
it('routes the shared note once, consumes only confirmed text and keeps another Draft and Cancel input',async()=>{
  const f=fixture();const one=review();f.notes.edit(one.draft.path,'Intent');f.notes.edit('30_Drafts/two.md','Another note');
  await f.notes.submit('complete',one);expect(f.request.mock.calls[0]).toEqual(['/v1/human-review',expect.objectContaining({action:'complete',note:'Intent'}),vault]);
  expect(f.notes.text(one.draft.path)).toBe('');expect(f.notes.text('30_Drafts/two.md')).toBe('Another note');expect(f.records()).toEqual([]);
  f.notes.edit(one.draft.path,'Keep unsubmitted');await f.notes.submit('cancel',one);expect(f.notes.text(one.draft.path)).toBe('Keep unsubmitted');
  expect(f.request.mock.calls[1]![1]).toMatchObject({action:'cancel',note:''});
});
it('retains an uncertain frozen request through reload, never sends on initialize and explicitly retries the same ID',async()=>{
  const f=fixture();f.request.mockRejectedValueOnce(new Error('Lost response'));f.notes.edit(review().draft.path,'Original feedback');
  await expect(f.notes.submit('recompile',review())).rejects.toThrow('Lost response');const original=f.records()[0]!;
  await expect(f.notes.submit('idea',review())).rejects.toThrow('pending action');expect(f.request).toHaveBeenCalledTimes(1);
  const restarted=f.create();await restarted.initialize();expect(restarted.text(review().draft.path)).toBe('');expect(f.request).toHaveBeenCalledTimes(1);
  restarted.edit(review().draft.path,'New session text');f.request.mockResolvedValueOnce({path:original.request.source_path,revision:'c'.repeat(64),recompile_count:1,reused:true} as never);
  await restarted.retry(review().draft.path);expect(f.request.mock.calls[1]![1]).toEqual(original.request);expect(restarted.text(review().draft.path)).toBe('New session text');expect(f.records()).toEqual([]);
});
it('an old asynchronous response cannot clear text edited after submission, even if the text matches again',async()=>{
 const f=fixture();let finish!:(value:unknown)=>void;f.request.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}) as never);
 const draft=review().draft.path;f.notes.edit(draft,'Original');const action=f.notes.submit('complete',review());await vi.waitFor(()=>expect(f.request).toHaveBeenCalledTimes(1));
 f.notes.edit(draft,'New');f.notes.edit(draft,'Original');const request=f.records()[0]!.request as HumanReviewRequest;
 finish({request_id:request.request_id,action:'complete',status:'completed',idea_path:null,reused:false});await action;expect(f.notes.text(draft)).toBe('Original');
});
it('restores submitted input after reload when explicit retry is definitively rejected without acceptance',async()=>{
 const f=fixture();f.notes.edit(review().draft.path,'Original retained input');f.request.mockRejectedValueOnce(new Error('Disconnected before acceptance'));
 await expect(f.notes.submit('complete',review())).rejects.toThrow();const restarted=f.create();await restarted.initialize();
 f.request.mockRejectedValueOnce(new CoreResponseError(409,'SOURCE_CHANGED','Inspect current files')).mockResolvedValueOnce({status:'not_found',request:null,result:null} as never);
 await expect(restarted.retry(review().draft.path)).rejects.toThrow('SOURCE_CHANGED');expect(restarted.text(review().draft.path)).toBe('Original retained input');expect(f.records()).toEqual([]);
});
it('preserves input on rejection and preserves a partially accepted action until its matching receipt completes',async()=>{
 const f=fixture();f.notes.edit(review().draft.path,'My note');f.request.mockRejectedValueOnce(new CoreResponseError(409,'SOURCE_CHANGED','Read again'));
 f.request.mockResolvedValueOnce({status:'not_found',request:null,result:null} as never);await expect(f.notes.submit('complete',review())).rejects.toThrow('SOURCE_CHANGED');expect(f.notes.text(review().draft.path)).toBe('My note');expect(f.records()).toEqual([]);
 f.request.mockRejectedValueOnce(new Error('Interrupted'));await expect(f.notes.submit('complete',review())).rejects.toThrow('Interrupted');const record=f.records()[0]!;
 f.request.mockResolvedValueOnce({status:'unfinished',request:record.request,result:null} as never);expect((await f.notes.check(review().draft.path)).status).toBe('unfinished');expect(f.records()).toHaveLength(1);
 f.request.mockResolvedValueOnce({status:'completed',request:record.request,result:{request_id:record.request.request_id,action:'complete',status:'completed',idea_path:null,reused:true}} as never);
 await f.notes.check(review().draft.path);expect(f.notes.text(review().draft.path)).toBe('');expect(f.records()).toEqual([]);
});
it('refuses wrong Vault recovery, empty Idea, oversized notes and mismatching receipts without truncation or sending',async()=>{
 const f=fixture();await expect(f.notes.submit('idea',review())).rejects.toThrow('nonempty');f.notes.edit(review().draft.path,'a'.repeat(8001));await expect(f.notes.submit('complete',review())).rejects.toThrow('8000');expect(f.request).not.toHaveBeenCalled();
 f.notes.edit(review().draft.path,'Keep');f.request.mockRejectedValueOnce(new Error('Lost'));await expect(f.notes.submit('idea',review())).rejects.toThrow();const record=f.records()[0]!;
 f.request.mockResolvedValueOnce({status:'unfinished',request:{...record.request,note:'Other'},result:null} as never);await expect(f.notes.check(review().draft.path)).rejects.toThrow('does not match');expect(f.records()).toHaveLength(1);
 const other=new ReviewNotes({request:f.request} as unknown as CoreClient,'D:\\Other',f.store);await expect(other.initialize()).rejects.toThrow('another Vault');expect(f.records()[0]!.request).toEqual(record.request);
});
