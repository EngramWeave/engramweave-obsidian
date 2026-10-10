import { randomUUID } from 'node:crypto';
import type { AnalyzerJob, AnalyzeRequest, Document, Draft, DraftReview, PublishDraftRequest, PublishDraftResponse, ProcessingRound, ProcessingRequest, RecompileRequest, RecompileResponse, HumanReviewRequest, HumanReviewResponse, ReviewActionReceipt } from '@engramweave/contracts';
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
  private roundRequest: ProcessingRequest | null = null;
  private analysisRequest: AnalyzeRequest | null = null;
  constructor(private readonly client: CoreClient) {}
  source(relative: string) { return this.client.request<Document>(`/v1/documents?path=${encodeURIComponent(relative)}`); }
  review(relative: string) { return this.client.request<DraftReview>(`/v1/draft-review?path=${encodeURIComponent(relative)}`); }
  drafts(source: string) { return this.client.request<{ items: Draft[] }>(`/v1/drafts?source_path=${encodeURIComponent(source)}`); }
  async compile(source: Document, profileId = '') {
    const prior = this.roundRequest?.items?.[0];
    if (prior && (prior.source_path !== source.path || (prior.profile_id ?? '') !== profileId)) this.roundRequest = null;
    this.roundRequest ??= {request_id:randomUUID(),mode:'selected',items:[{source_path:source.path,source_revision:source.revision,...(profileId ? {profile_id:profileId} : {})}]};
    const result = await this.client.request<{round:ProcessingRound}>('/v1/processing-rounds',this.roundRequest); this.roundRequest = null; return result.round;
  }
  async analyze(review: DraftReview, profileId: string, task?: 'review' | 'relation') {
    if (this.analysisRequest && (this.analysisRequest.source_path !== review.source.path || this.analysisRequest.draft_path !== review.draft.path || this.analysisRequest.task !== task || (this.analysisRequest.profile_id ?? '') !== profileId)) this.analysisRequest = null;
    this.analysisRequest ??= { request_id: randomUUID(), source_path: review.source.path, source_revision: review.source.revision,
      draft_path: review.draft.path, draft_revision: review.draft.revision, ...(profileId ? { profile_id: profileId } : {}), ...(task ? {task} : {}) };
    const result = await this.client.request<{job:AnalyzerJob}>('/v1/analyses',this.analysisRequest);this.analysisRequest = null;return result.job;
  }
  round(id: string) {return this.client.request<ProcessingRound>(`/v1/processing-round?id=${encodeURIComponent(id)}`);}
  recompile(request: RecompileRequest) {return this.client.request<RecompileResponse>('/v1/recompile',request);}
  humanReview(request: HumanReviewRequest, vault: string) { return this.client.request<HumanReviewResponse>('/v1/human-review', request, vault); }
  reviewAction(id: string, vault: string) { return this.client.request<ReviewActionReceipt>(`/v1/review-action?id=${encodeURIComponent(id)}`, undefined, vault); }
  publish(request: PublishDraftRequest) { return this.client.request<PublishDraftResponse>('/v1/draft-publications', request); }
}
