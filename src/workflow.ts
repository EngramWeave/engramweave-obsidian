import { randomUUID } from 'node:crypto';
import type { AnalyzerJob, CompilerJob, Document, Draft, DraftReview, PublishDraftRequest, PublishDraftResponse } from '@engramweave/contracts';
import type { CoreClient } from './connection';

export const finished = (status: string) => !['queued', 'running'].includes(status);
export function knowledgeFilename(title: string) {
  let stem = title.normalize('NFC').replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').replace(/[. ]+$/g, '').replace(/^[.~]+/, '').trim().slice(0, 100);
  if (!stem || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(stem)) stem = `Knowledge-${stem || 'note'}`;
  return `40_Knowledge/${stem}.md`;
}
export function publicationRequest(review: DraftReview, targetPath: string): PublishDraftRequest {
  if (review.source.kind !== 'source' || !review.analysis || !finished(review.analysis.status)) throw new Error('Finish a Draft Analyzer attempt before publication');
  return { request_id: randomUUID(), draft_path: review.draft.path, draft_revision: review.draft.revision,
    source_path: review.source.path, source_revision: review.source.revision, target_path: targetPath, analysis_id: review.analysis.id,
    related_drafts: review.related_drafts.map(({ path, revision }) => ({ path, revision })) };
}
export class Workflow {
  constructor(private readonly client: CoreClient) {}
  source(relative: string) { return this.client.request<Document>(`/v1/documents?path=${encodeURIComponent(relative)}`); }
  review(relative: string) { return this.client.request<DraftReview>(`/v1/draft-review?path=${encodeURIComponent(relative)}`); }
  drafts(source: string) { return this.client.request<{ items: Draft[] }>(`/v1/drafts?source_path=${encodeURIComponent(source)}`); }
  async compile(source: Document) {
    return (await this.client.request<{ job: CompilerJob }>('/v1/compilations', { request_id: randomUUID(), path: source.path, revision: source.revision })).job;
  }
  async analyze(review: DraftReview, profileId: string) {
    return (await this.client.request<{ job: AnalyzerJob }>('/v1/analyses', { request_id: randomUUID(), source_path: review.source.path, source_revision: review.source.revision,
      draft_path: review.draft.path, draft_revision: review.draft.revision, ...(profileId ? { profile_id: profileId } : {}) })).job;
  }
  publish(request: PublishDraftRequest) { return this.client.request<PublishDraftResponse>('/v1/draft-publications', request); }
}
