import { describe, expect, it } from 'vitest';
import { CandidateBuffer } from '../src/candidate-buffer';
import type { CandidateDocument, CandidateSave } from '@engramweave/contracts';
const doc = { changeset_id:'a',item:{id:'b'},content:'Original',revision:'1'.repeat(64) } as CandidateDocument;
describe('Candidate editing preservation',()=>{
  it('does not mark later typing saved when an earlier request finishes',async()=>{
    const buffer=new CandidateBuffer(doc);buffer.content='First';let finish!:(result:{revision:string})=>void;
    const saving=buffer.save(()=>new Promise(resolve=>{finish=resolve;}));buffer.content='Later';finish({revision:'2'.repeat(64)});await saving;
    expect(buffer.content).toBe('Later');expect(buffer.savedContent).toBe('First');expect(buffer.dirty).toBe(true);
  });
  it('retains the original request identity after uncertain delivery and restores dirty edits',async()=>{
    const buffer=new CandidateBuffer(doc);buffer.content='Pending';const requests:CandidateSave[]=[];
    await expect(buffer.save(async request=>{requests.push(request);throw new Error('Disconnected');})).rejects.toThrow('Disconnected');
    await buffer.save(async request=>{requests.push(request);return{revision:'2'.repeat(64)};});
    expect(requests[1]).toEqual(requests[0]);expect(buffer.dirty).toBe(false);
    buffer.content='Unsaved';const restored=new CandidateBuffer(doc);restored.restore(buffer.snapshot());expect(restored.content).toBe('Unsaved');expect(restored.dirty).toBe(true);
  });
});
