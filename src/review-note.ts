import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { Value } from '@sinclair/typebox/value';
import { HumanReviewRequestSchema, RecompileRequestSchema, ReviewActionReceiptSchema, HumanReviewResponseSchema, RecompileResponseSchema,
  type DraftReview, type HumanReviewRequest, type HumanReviewResponse, type RecompileRequest, type RecompileResponse } from '@engramweave/contracts';
import { CoreClient, CoreResponseError, vaultKey } from './connection';

export type NoteAction = 'idea' | 'recompile' | 'complete' | 'cancel';
export interface PendingReview { vault: string; action: NoteAction; request: HumanReviewRequest | RecompileRequest }
export interface PendingStore { read(): Promise<PendingReview[]>; write(records: PendingReview[]): Promise<void> }
type Entry = { text: string; version: number };
export function validPending(value: unknown): value is PendingReview {
  if (!value || typeof value !== 'object') return false;
  const record = value as PendingReview;
  if (Object.keys(record).some(field => !['vault','action','request'].includes(field))) return false;
  return typeof record.vault === 'string' && Boolean(record.vault) && (record.action === 'recompile' ? Value.Check(RecompileRequestSchema, record.request)
    : ['idea','complete','cancel'].includes(record.action) && Value.Check(HumanReviewRequestSchema, record.request) && 'action' in record.request && record.request.action === record.action);
}

/** Unsubmitted notes live only in this plugin session. Only frozen, sent actions enter recovery storage. */
export class ReviewNotes {
  private readonly notes = new Map<string, Entry>();
  private readonly pending = new Map<string, PendingReview>();
  private readonly consumedVersions = new Map<string, number>();
  private working = false;
  constructor(private readonly client: CoreClient, private readonly vault: string, private readonly store: PendingStore) {}
  text(draft: string) { return this.notes.get(draft)?.text ?? ''; }
  edit(draft: string, text: string) { const entry = this.notes.get(draft); this.notes.set(draft, { text, version: (entry?.version ?? 0) + 1 }); }
  operation(draft: string) { return this.pending.get(draft) ?? null; }
  operations() { return [...this.pending.values()]; }
  async initialize() {
    const records = await this.store.read();
    if (records.length > 32 || records.some(record => !validPending(record) || vaultKey(record.vault) !== vaultKey(this.vault))
      || new Set(records.map(record => record.request.draft_path)).size !== records.length) throw new Error('Review recovery record is invalid or belongs to another Vault; it was preserved');
    for (const record of records) this.pending.set(record.request.draft_path, record);
  }
  private persist() { return this.store.write([...this.pending.values()]); }
  async submit(action: NoteAction, review: DraftReview) {
    if (this.pending.has(review.draft.path)) throw new Error('Check or retry the original pending action before submitting another');
    if (this.working) throw new Error('A Review Note action is being saved');
    if (this.pending.size >= 32) throw new Error('Resolve pending Review actions before adding more');
    this.working = true;
    try {
      const entry = this.notes.get(review.draft.path) ?? { text:'',version:0 };
      const identity = { request_id: randomUUID(), source_path: review.source.path, source_revision: review.source.revision, draft_path: review.draft.path, draft_revision: review.draft.revision };
      const request = action === 'recompile' ? { ...identity, feedback: entry.text } : { ...identity, action, note: action === 'cancel' ? '' : entry.text };
      if (action === 'idea' && !entry.text.trim()) throw new Error('Create Idea requires nonempty input');
      if (action !== 'cancel' && entry.text.length > 8000) throw new Error('Review Note exceeds 8000 characters; shorten it before submitting');
      const record: PendingReview = { vault:this.vault,action,request };
      this.pending.set(review.draft.path,record);
      if (action !== 'cancel') this.consumedVersions.set(request.request_id,entry.version);
      try { await this.persist(); } catch (error) { this.pending.delete(review.draft.path); this.consumedVersions.delete(request.request_id); throw error; }
      return await this.send(record);
    } finally { this.working=false; }
  }
  async retry(draft: string) {
    if (this.working) throw new Error('A Review Note action is being saved');
    const record=this.pending.get(draft); if(!record)throw new Error('No pending action');
    this.working=true; try { return await this.send(record); } finally { this.working=false; }
  }
  private async send(record: PendingReview): Promise<HumanReviewResponse | RecompileResponse> {
    try {
      const result=await this.client.request(record.action==='recompile'?'/v1/recompile':'/v1/human-review',record.request,record.vault);
      if (!Value.Check(record.action==='recompile'?RecompileResponseSchema:HumanReviewResponseSchema,result)
        || record.action==='recompile' && (result as RecompileResponse).path!==record.request.source_path
        || record.action!=='recompile' && ((result as HumanReviewResponse).request_id!==record.request.request_id || (result as HumanReviewResponse).action!==record.action)) throw new Error('Core returned an invalid action receipt; check the original request');
      await this.consume(record);return result as HumanReviewResponse | RecompileResponse;
    } catch(error) {
      // A completed HTTP rejection can be checked; an interrupted transport never releases its frozen identity.
      if(error instanceof CoreResponseError) {
        const receipt=await this.lookup(record).catch(()=>null);
        if(receipt?.status==='completed') {await this.consume(record);return receipt.result!;}
        if(receipt?.status==='not_found') {
          await this.release(record);
          if(record.action!=='cancel' && !this.notes.has(record.request.draft_path)) this.edit(record.request.draft_path,'feedback' in record.request ? record.request.feedback : record.request.note);
        }
      }
      throw error;
    }
  }
  private async lookup(record:PendingReview) {
    const receipt=await this.client.request(`/v1/review-action?id=${encodeURIComponent(record.request.request_id)}`,undefined,record.vault);
    if(!Value.Check(ReviewActionReceiptSchema,receipt) || receipt.request && !isDeepStrictEqual(receipt.request,record.request)) throw new Error('Core receipt does not match the original action; recovery input was preserved');
    if(receipt.status==='completed' && (record.action==='recompile'
      ? !Value.Check(RecompileResponseSchema,receipt.result) || receipt.result.path!==record.request.source_path
      : !Value.Check(HumanReviewResponseSchema,receipt.result) || receipt.result.request_id!==record.request.request_id || receipt.result.action!==record.action)) throw new Error('Core result does not match the original action; recovery input was preserved');
    return receipt;
  }
  async check(draft:string) {
    if(this.working)throw new Error('A Review Note action is being saved');const record=this.pending.get(draft);if(!record)throw new Error('No pending action');
    this.working=true;try{const receipt=await this.lookup(record);if(receipt.status==='completed')await this.consume(record);return receipt;}finally{this.working=false;}
  }
  private async release(record:PendingReview) {
    this.pending.delete(record.request.draft_path);
    try{await this.persist();}catch(error){this.pending.set(record.request.draft_path,record);throw error;}
    this.consumedVersions.delete(record.request.request_id);
  }
  private async consume(record:PendingReview) {
    const version=this.consumedVersions.get(record.request.request_id);
    await this.release(record);
    if(record.action!=='cancel' && version!==undefined && (this.notes.get(record.request.draft_path)?.version ?? 0)===version) this.edit(record.request.draft_path,'');
  }
}
