import { randomUUID } from 'node:crypto';
import { Value } from '@sinclair/typebox/value';
import { IntegrationJobSchema, type ChangeSetApproval, type ChangeSetInspection, type IntegrationJob } from '@engramweave/contracts';
import type { CoreClient } from './connection';
import type { CandidateBuffer } from './candidate-buffer';
import type { CandidateRecovery } from './candidate-recovery';

export async function saveWorkspace(id: string, buffers: Map<string, CandidateBuffer>, recovery: CandidateRecovery, client: CoreClient) {
  for (const buffer of buffers.values()) if (buffer.document.changeset_id === id) {
    await buffer.save(input => client.request('/v1/changeset/candidate', input));
    await recovery.persist(buffer.snapshot(), buffer.dirty);
  }
  if ([...buffers.values()].some(buffer => buffer.document.changeset_id === id && buffer.dirty)) throw new Error('保存期间出现了新编辑。已保留，请再次保存后批准。');
}
export function approvalRequest(id: string, draft: string, inspection: ChangeSetInspection, buffers: Map<string, CandidateBuffer>): ChangeSetApproval {
  if (inspection.selected_draft !== draft || inspection.review.decisions.some(item => item.decision === 'undecided')) throw new Error('请决定每个条目的取舍，且保留有效的 Reviewed Draft。');
  const included = inspection.review.decisions.filter(item => item.decision === 'include');
  return { request_id: randomUUID(), changeset_id: id, manifest_revision: inspection.manifest_revision, review_revision: inspection.review.revision,
    source_revision: inspection.source_revision, draft_path: draft, related_drafts: inspection.related_drafts,
    items: included.map(decision => {
      const target = inspection.targets.find(item => item.item_id === decision.item_id)!; const buffer = buffers.get(`${id}/${decision.item_id}`);
      if (buffer?.dirty) throw new Error('Candidate 有未保存编辑。');
      return { item_id: decision.item_id, current_revision: target.current_revision, candidate_revision: buffer?.revision ?? target.candidate_revision };
    }) };
}
export function checkedJob(job: unknown): IntegrationJob | null { if (job === null) return null; if (!Value.Check(IntegrationJobSchema, job)) throw new Error('执行结果不符合合同，请保留原请求并查明。'); return job; }
