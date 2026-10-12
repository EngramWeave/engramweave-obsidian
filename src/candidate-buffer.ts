import { randomUUID } from 'node:crypto';
import type { CandidateDocument, CandidateSave } from '@engramweave/contracts';
import { CoreResponseError } from './connection';

export class CandidateBuffer {
  content: string; revision: string; savedContent: string;
  private pending: CandidateSave | null = null;
  private saving: Promise<void> | null = null;
  constructor(readonly document: CandidateDocument) { this.content = document.content; this.savedContent = document.content; this.revision = document.revision; }
  get dirty() { return this.content !== this.savedContent; }
  save(send: (request: CandidateSave) => Promise<{ revision: string }>) {
    if (this.saving) return this.saving;
    if (!this.dirty && !this.pending) return Promise.resolve();
    this.pending ??= { request_id: randomUUID(), changeset_id: this.document.changeset_id, item_id: this.document.item.id, revision: this.revision, content: this.content };
    const request = this.pending;
    this.saving = send(request).then(result => { this.revision = result.revision; this.savedContent = request.content; this.pending = null; }).catch(error=>{
      if(error instanceof CoreResponseError&&error.status>=400&&error.status<500)this.pending=null;
      throw error;
    }).finally(() => { this.saving = null; });
    return this.saving;
  }
  restore(record: { content: string; savedContent: string; revision: string }) { this.content = record.content; this.savedContent = record.savedContent; this.revision = record.revision; }
  snapshot() { return { changeset_id: this.document.changeset_id, item_id: this.document.item.id, content: this.content, savedContent: this.savedContent, revision: this.revision }; }
}
