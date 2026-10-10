import type { DraftReview, HumanReviewResponse } from '@engramweave/contracts';
import { Notice } from 'obsidian';
import type { NoteAction, ReviewNotes } from './review-note';

interface Host {
  notes: ReviewNotes; review: DraftReview; error: string | null;
  parent: HTMLElement;
  button(parent: HTMLElement, label: string, action: () => Promise<unknown>, disabled?: boolean): HTMLButtonElement;
  fresh(): Promise<DraftReview>;
  open(path: string): Promise<void>;
  focused(): string | null;
}
export function renderHumanReview(host: Host) {
  const {review,parent,notes}=host;const {source,draft,analysis}=review;
  parent.createEl('p',{text:'Review Note 按当前 Draft 保留在本次插件会话中。选择一个动作提交；重载插件后未提交文字不保留。',cls:'ew-muted'});
  const input=parent.createEl('textarea',{cls:'ew-review-note',attr:{'aria-label':'Review Note',maxlength:'8000','data-draft':draft.path}});
  input.value=notes.text(draft.path);input.addEventListener('input',()=>notes.edit(draft.path,input.value));
  const current=review.human_review?.selected_draft;
  parent.createEl('p',{text:current ? `Reviewed Draft · ${current}${current===draft.path?' · Current Draft':''}`:'尚未选择 Reviewed Draft。',cls:'ew-muted'});
  if(current && current!==draft.path)host.button(parent,'Open Reviewed Draft',()=>host.open(current));
  const intent=parent.createEl('details');intent.createEl('summary',{text:'This Draft · Integration Intent'});
  intent.createEl('p',{text:review.human_review?.intent ?? '尚无已提交 Intent。',cls:'ew-intent'});
  if(host.error)parent.createEl('p',{text:host.error,cls:'ew-error'});
  const pending=notes.operation(draft.path);
  if(pending)parent.createEl('p',{text:`待查明 ${pending.action} · ${pending.request.request_id}。使用上方 Check Result / Retry Original。`,cls:'ew-warning'});
  const active=draft.lifecycle_status==='active' && source.kind==='source' && source.lifecycle_status==='active';
  const disabled=Boolean(host.error||pending||analysis && ['queued','running'].includes(analysis.status));
  const execute=async(action:NoteAction)=>{
    const fresh=await host.fresh();const result=await notes.submit(action,fresh);
    new Notice(action==='complete'?'Review Complete · 等待 Integration Planner':action==='cancel'?'Review Complete cancelled':action==='recompile'?'Recompile requested · Pending':'Idea created');
    if(action==='idea' && (result as HumanReviewResponse).idea_path && host.focused()===draft.path)await host.open((result as HumanReviewResponse).idea_path!);
  };
  const actions=parent.createDiv({cls:'ew-actions'});
  host.button(actions,'Create Idea',()=>execute('idea'),disabled||!active||source.kind!=='source'||source.processing_status==='archived');
  host.button(actions,'Recompile',()=>execute('recompile'),disabled||!active||source.kind!=='source'||!['pending','compiled','reviewed'].includes(source.processing_status??''));
  host.button(actions,'Review Complete',()=>execute('complete'),disabled||!active||source.kind!=='source'||!['compiled','reviewed'].includes(source.processing_status??''));
  host.button(parent,'Cancel Review Complete',()=>execute('cancel'),disabled||!active||current!==draft.path);
  parent.createEl('p',{text:'Idea 保存原输入；Recompile 追加 Source Annotation、返回 Pending；Review Complete 保存此 Draft 的 Intent 并允许后续规划。取消只撤销许可，不消费 Review Note。',cls:'ew-muted'});
}
