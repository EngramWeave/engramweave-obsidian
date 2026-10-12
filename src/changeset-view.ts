import { ItemView, Notice, Scope, Modal, TFile, type WorkspaceLeaf, type ViewStateResult } from 'obsidian';
import type { ChangeSet, CandidateDocument, ChangeSetInspection, ChangeSetApproval, IntegrationJob, PlannerJob } from '@engramweave/contracts';
import { CandidateEditor } from './candidate-editor';
import { CandidateBuffer } from './candidate-buffer';
import type { CandidateRecovery } from './candidate-recovery';
import { CoreResponseError, type CoreClient } from './connection';
import { randomUUID } from 'node:crypto';
import { saveWorkspace, approvalRequest, checkedJob } from './changeset-approval';

export const CHANGESET_VIEW = 'engramweave-changeset';
export interface CandidateHost {
  client: CoreClient; candidateRecovery: CandidateRecovery; candidateBuffers: Map<string, CandidateBuffer>;
  flushEditors(): Promise<void>; refreshViews(): void; activateChangeSet(view: ChangeSetView): void; releaseChangeSet(view: ChangeSetView): void;
}
const message = (error: unknown) => error instanceof Error ? error.message : 'Candidate operation failed';

export class ChangeSetView extends ItemView {
  editor: CandidateEditor | null = null;
  private id = ''; private itemId = ''; private epoch = 0; private closed = false;
  private buffer: CandidateBuffer | null = null;
  private manifest: ChangeSet | null = null;
  private inspection: ChangeSetInspection | null = null;
  private pendingApproval: ChangeSetApproval | null = null;
  private execution: IntegrationJob | null = null;
  private working = false; private unaccepted = false;
  private current = ''; private currentAvailable = false;
  private leftLabel: HTMLElement | null = null;
  private status: HTMLElement | null = null;
  private lastError: string | null = null;
  private confirmation: Modal | null = null;
  constructor(leaf: WorkspaceLeaf, private readonly host: CandidateHost) {
    super(leaf); this.scope = new Scope(this.app.scope);
    this.scope.register(['Mod'], 's', () => { void this.save(); return false; });
    this.contentEl.addClass('ew-changeset-content');
  }
  getViewType() { return CHANGESET_VIEW; }
  getDisplayText() { return 'EngramWeave ChangeSet'; }
  getState() { return { changeset_id: this.id, item_id: this.itemId }; }
  async setState(state: { changeset_id?: string; item_id?: string }, result: ViewStateResult) {
    this.id = state.changeset_id ?? ''; this.itemId = state.item_id ?? '';
    await this.render(); await super.setState(state, result);
  }
  async onOpen() { this.closed = false; this.host.activateChangeSet(this); await this.render(); }
  async onClose() {
    this.closed = true; this.epoch++; this.confirmation?.close(); this.host.releaseChangeSet(this);
    try { await this.persist(); } finally { this.editor?.destroy(); this.editor = null; }
  }
  matchesPreview(relative: string) { return !this.closed && Boolean(this.manifest?.items.some(item => item.candidate_path === relative)); }
  private async persist() { if (this.buffer) await this.host.candidateRecovery.persist(this.buffer.snapshot(), this.buffer.dirty); }
  private report(error: unknown) { this.lastError = message(error); this.status?.setText(this.lastError); new Notice(this.lastError); }
  private showState() { this.status?.setText(this.lastError ?? (this.buffer?.dirty ? '未保存 · 仅保存 Candidate' : 'Candidate 已保存 · 正式内容未应用')); }
  private updateComparison() {
    this.editor?.refreshCurrent(this.current);
    this.leftLabel?.setText(!this.currentAvailable ? 'Current · 新建文件，无现有内容' : 'Current · Read only');
  }
  private async save(): Promise<boolean> {
    if (!this.buffer || this.pendingApproval) return false;
    const buffer = this.buffer;
    try {
      await buffer.save(request => this.host.client.request<{ revision: string }>('/v1/changeset/candidate', request));
      await this.host.candidateRecovery.persist(buffer.snapshot(), buffer.dirty);
      if (buffer === this.buffer) { this.lastError = null; this.showState(); }
      return !buffer.dirty;
    } catch (error) {
      await this.host.candidateRecovery.persist(buffer.snapshot(), true).catch(() => {});
      if (buffer === this.buffer && !this.closed) this.report(error); return false;
    }
  }
  private async preview() {
    const buffer = this.buffer;
    if (!buffer || !await this.save()) return;
    if (buffer !== this.buffer || buffer.dirty || this.closed) { new Notice('预览前出现了新编辑，已保留。请再次保存并预览。'); return; }
    const file = buffer.document.item.candidate_path;
    if (!file) return;
    const leaf = this.app.workspace.getLeaf('tab');
    await leaf.setViewState({ type: 'markdown', active: true, state: { file, mode: 'preview' } });
    await this.app.workspace.revealLeaf(leaf);
  }
  private async openDraft() {
    const relative = this.manifest?.draft_path;
    if (!relative || !/^30_Drafts\/.+\.md$/i.test(relative)) throw new Error('方案没有有效的原 Draft 路径。');
    const file = this.app.vault.getAbstractFileByPath(relative);
    if (!(file instanceof TFile)) throw new Error('原 Draft 文件不存在，请检查是否移动或删除。');
    const leaf = this.app.workspace.getLeaf('tab'); await leaf.openFile(file); await this.app.workspace.revealLeaf(leaf);
  }
  private reloadCandidate() {
    if (!this.buffer) return;
    const buffer = this.buffer; const confirmedContent = buffer.content;
    const reload = async () => {
      if (buffer !== this.buffer || this.closed) return;
      const key = `${buffer.document.changeset_id}/${buffer.document.item.id}`;
      const document = await this.host.client.request<CandidateDocument>(`/v1/changeset/candidate?id=${buffer.document.changeset_id}&item_id=${buffer.document.item.id}`);
      if (buffer !== this.buffer || this.closed) return;
      if (buffer.content !== confirmedContent) throw new Error('Reload 期间产生了新编辑，已保留。请重新确认。');
      await this.host.candidateRecovery.persist(buffer.snapshot(), false);
      if (buffer !== this.buffer || this.closed) return;
      if (buffer.content !== confirmedContent) { await this.persist(); throw new Error('Reload 期间产生了新编辑，已保留。请重新确认。'); }
      this.host.candidateBuffers.set(key, new CandidateBuffer(document)); this.buffer = null; await this.render();
    };
    if (!buffer.dirty) { void reload().catch(error => this.report(error)); return; }
    this.confirmation?.close();
    this.confirmation = new CandidateConfirmation(this.app, 'Reload Candidate 将丢弃此文件的未保存编辑，读取磁盘上的当前候选。正式笔记不会改变。', '丢弃编辑并重新载入', reload, error => this.report(error));
    this.confirmation.open();
  }
  private cancelProposal() {
    if (!this.id) return;
    const id = this.id; this.confirmation?.close();
    this.confirmation = new CandidateConfirmation(this.app, '取消此 ChangeSet 将清理候选及未保存编辑。所选 Draft 和 Intent 保留；有效 Source 返回 reviewed，等待重新规划。正式笔记不会改变。', '取消 ChangeSet', async () => {
      await this.host.client.request('/v1/changeset/cancel', { id });
      for (const [key, buffer] of this.host.candidateBuffers) if (buffer.document.changeset_id === id) { await this.host.candidateRecovery.persist(buffer.snapshot(), false); this.host.candidateBuffers.delete(key); }
      if (this.id === id) { this.buffer = null; this.leaf.detach(); }
    }, error => this.report(error)); this.confirmation.open();
  }
  private async refreshCurrent() {
    if (!this.buffer) return;
    const buffer = this.buffer; const epoch = this.epoch;
    try {
      await this.host.flushEditors();
      const document = await this.host.client.request<CandidateDocument>(`/v1/changeset/candidate?id=${this.id}&item_id=${this.itemId}`);
      if (epoch === this.epoch && buffer === this.buffer && !this.closed) { this.current = document.current ?? ''; this.currentAvailable = document.current !== null;
        const target = this.inspection?.targets.find(item => item.item_id === this.itemId); if (target) { target.current = document.current; target.current_revision = document.current_revision; }
        this.updateComparison(); }
    } catch (error) { this.report(error); }
  }
  private async choices(decision: 'include' | 'reject', itemId?: string, domain?: boolean) {
    if (!this.inspection || this.working || this.pendingApproval) return;
    this.working = true;
    try {
      const review = this.inspection.review;
      this.inspection.review = await this.host.client.request('/v1/changeset/review', { ...review,
        decisions: review.decisions.map(item => !itemId || item.item_id === itemId ? { ...item, decision, domain_approved: domain ?? item.domain_approved } : item) });
    } finally { this.working = false; this.host.refreshViews(); }
  }
  private async prepareApproval() {
    if (!this.manifest || !this.inspection || this.pendingApproval || this.working) return;
    this.working = true; this.editor?.setEditable(false); this.host.refreshViews();
    try {
      await this.host.flushEditors();
      await saveWorkspace(this.id, this.host.candidateBuffers, this.host.candidateRecovery, this.host.client);
      const request = approvalRequest(this.id, this.manifest.draft_path, this.inspection, this.host.candidateBuffers);
      const included = this.manifest.items.filter(item => request.items.some(entry => entry.item_id === item.id));
      if (!included.some(item => item.kind === 'write')) throw new Error('批准至少需要一项正文写入。全部拒绝请取消方案。');
      if (included.some(item => item.requires_domain_approval && !this.inspection!.review.decisions.find(entry => entry.item_id === item.id)?.domain_approved)) throw new Error('请明确勾选新领域授权。');
      const explanation = ['批准后立即应用以下操作：', ...included.map(item => `${item.kind} · ${item.target}`),
        `Source → archived · ${this.manifest.source_path}`, ...request.related_drafts.map(item => `Draft → discarded · ${item.path}`),
        '仅使用已批准候选；不调用 AI。Git 自动提交将在 D 实现。'].join('\n');
      this.confirmation?.close(); this.confirmation = new CandidateConfirmation(this.app, explanation, 'Approve & Apply', async () => {
        if ([...this.host.candidateBuffers.values()].some(buffer => buffer.document.changeset_id === this.id && (buffer.dirty || request.items.some(item => item.item_id === buffer.document.item.id && item.candidate_revision !== buffer.revision)))) throw new Error('批准确认期间候选产生了新编辑，请重新检查。');
        this.pendingApproval = request; await this.host.candidateRecovery.persistApproval(this.id, request); await this.applyApproval();
      }, error => this.report(error)); this.confirmation.open();
    } finally { this.working = false; this.editor?.setEditable(!this.pendingApproval); this.host.refreshViews(); }
  }
  private async applyApproval() {
    if (!this.pendingApproval || this.working) return;
    const request = this.pendingApproval; this.working = true; this.unaccepted = false; this.editor?.setEditable(false); this.host.refreshViews();
    try {
      await this.host.candidateRecovery.persistApproval(this.id, request);
      const response = await this.host.client.request<{job: IntegrationJob}>('/v1/changeset/approve', request);
      this.execution = checkedJob(response.job); this.lastError = null;
      if (this.execution?.status === 'succeeded') await this.clearBuffers();
    } catch (error) {
      if (error instanceof CoreResponseError && error.status >= 400 && error.status < 500) {
        const response = await this.host.client.request<{job: IntegrationJob | null}>(`/v1/integration?id=${request.request_id}`).catch(() => null);
        if (response) { this.execution = checkedJob(response.job); this.unaccepted = !this.execution; }
      }
      this.report(error);
    } finally { this.working = false; this.host.refreshViews(); }
  }
  private async queryApproval() {
    if (!this.pendingApproval || this.working) return;
    const result = await this.host.client.request<{job: IntegrationJob | null}>(`/v1/integration?id=${this.pendingApproval.request_id}`);
    this.execution = checkedJob(result.job); this.lastError = this.execution ? null : 'Core 尚无此请求回执；继续使用原 ID 重试，不自动新建请求。';
    if (this.execution?.status === 'succeeded') await this.clearBuffers(); this.host.refreshViews();
  }
  private async clearBuffers() {
    for (const [key, buffer] of this.host.candidateBuffers) if (buffer.document.changeset_id === this.id) {
      await this.host.candidateRecovery.persist(buffer.snapshot(), false); this.host.candidateBuffers.delete(key);
    }
    this.buffer = null; this.editor?.setEditable(false);
  }
  private async replan() {
    const manifest = this.manifest; if (!manifest || this.pendingApproval) return;
    await this.host.client.request('/v1/changeset/cancel', { id: this.id }); await this.clearBuffers();
    const source = await this.host.client.request<{revision: string}>(`/v1/documents?path=${encodeURIComponent(manifest.source_path)}`);
    const result = await this.host.client.request<{job: PlannerJob}>('/v1/plans', { request_id: randomUUID(), source_path: manifest.source_path, source_revision: source.revision });
    new Notice(`重新规划任务已提交：${result.job.id}。可在 Draft 侧栏或 Desktop 查看结果。`); await this.openDraft(); this.leaf.detach();
  }
  renderControls(parent: HTMLElement) {
    parent.createEl('h2', { text: 'ChangeSet' });
    if (this.pendingApproval) {
      parent.createEl('p', { text: `执行请求 · ${this.pendingApproval.request_id}`, cls: 'ew-target-path' });
      this.status = parent.createEl('p', { attr: { role: 'status' }, text: this.lastError ?? (this.execution ? `${this.execution.status} · ${this.execution.completed_paths.length}/${this.execution.target_paths.length}` : '批准送达结果待查明。') });
      if (this.execution?.error) parent.createEl('p', { text: `${this.execution.error.code} · ${this.execution.error.message}` });
      for (const target of this.execution?.target_paths ?? []) parent.createEl('p', { text: target, cls: 'ew-target-path' });
      const query = parent.createEl('button', { text: '查询执行结果' }); query.disabled = this.working; query.onclick = () => { void this.queryApproval().catch(error => this.report(error)); };
      if (this.execution?.status !== 'succeeded') {
        const retry = parent.createEl('button', { text: '以原 ID 重试执行' }); retry.disabled = this.working; retry.onclick = () => { void this.applyApproval(); };
      } else parent.createEl('p', { text: '正式内容已应用，Source 已归档，相关 Draft 已标记 discarded，候选工作区已清理。' });
      if (this.unaccepted) parent.createEl('button', { text: '回到审查（此批准未被接受）' }).onclick = () => { void (async () => { await this.host.candidateRecovery.persistApproval(this.id, null); this.pendingApproval = null; this.execution = null; this.unaccepted = false; await this.render(); })().catch(error => this.report(error)); };
      return;
    }
    if (!this.manifest || !this.inspection) { parent.createEl('p', { text: this.lastError ?? '正在读取候选方案…' }); return; }
    const controls = parent.createDiv({ cls: 'ew-changeset-controls' });
    const fileLabel = controls.createEl('label', { text: 'Proposal item' });
    const select = fileLabel.createEl('select', { attr: { 'aria-label': 'Proposal item' } });
    for (const item of this.manifest.items) select.createEl('option', { value: item.id, text: `${item.kind} · ${item.target}` });
    select.value = this.itemId; select.disabled = this.working;
    select.onchange = () => { this.itemId = select.value; void this.render().catch(error => this.report(error)); };
    this.status = controls.createEl('p', { cls: 'ew-muted', attr: { role: 'status' } }); this.showState();
    const actions = controls.createDiv({ cls: 'ew-changeset-actions' });
    const button = (text: string, action: () => void) => { const button = actions.createEl('button', { text }); button.disabled = this.working; button.onclick = action; };
    if (this.buffer) {
      button('Save Candidate', () => { void this.save(); }); button('Preview Candidate', () => { void this.preview().catch(error => this.report(error)); });
      button('Refresh Current', () => { void this.refreshCurrent(); }); button('Reload Candidate', () => this.reloadCandidate());
    } else button('Refresh Current', () => { void (async () => { const fresh = await this.host.client.request<ChangeSetInspection>(`/v1/changeset/review?id=${this.id}`); if (this.inspection) this.inspection.targets = this.inspection.targets.map(item => item.item_id === this.itemId ? fresh.targets.find(entry => entry.item_id === item.item_id)! : item); await this.render(); })().catch(error => this.report(error)); });
    button('刷新审查清单', () => { this.inspection = null; void this.render(); });
    button('Open original Draft', () => { void this.openDraft().catch(error => this.report(error)); });
    button('Cancel ChangeSet', () => this.cancelProposal());
    button('打回重新规划', () => { this.confirmation?.close(); this.confirmation = new CandidateConfirmation(this.app, '清理当前未批准方案及未保存候选编辑，并按当前 Draft、Intent 和知识库重新调用 Planner。正式内容不会应用。', '重新规划', () => this.replan(), error => this.report(error)); this.confirmation.open(); });
    const impacts = controls.createEl('details', { attr: { open: '' } }); impacts.createEl('summary', { text: '全部影响与取舍' });
    const all = impacts.createDiv({ cls: 'ew-changeset-actions' });
    for (const decision of ['include', 'reject'] as const) { const button = all.createEl('button', { text: decision === 'include' ? '全部纳入' : '全部拒绝' }); button.disabled = this.working; button.onclick = () => { void this.choices(decision).catch(error => this.report(error)); }; }
    for (const item of this.manifest.items) {
      const row = impacts.createDiv({ cls: 'ew-impact-item' }); const choice = this.inspection.review.decisions.find(entry => entry.item_id === item.id)!;
      row.createEl('p', { text: `${item.kind} · ${item.target}`, cls: 'ew-target-path' });
      const selection = row.createEl('select', { attr: { 'aria-label': `Decision ${item.target}` } });
      for (const [value, text] of [['undecided','待决定'],['include','纳入'],['reject','拒绝']]) selection.createEl('option', { value, text });
      selection.value = choice.decision; selection.disabled = this.working;
      selection.onchange = () => { if (selection.value !== 'undecided') void this.choices(selection.value as 'include' | 'reject', item.id).catch(error => this.report(error)); };
      if (item.requires_domain_approval) {
        const label = row.createEl('label', { text: ' 允许创建新领域 ' }); const checkbox = label.createEl('input', { type: 'checkbox' }); checkbox.checked = choice.domain_approved; checkbox.disabled = this.working;
        checkbox.onchange = () => { void this.choices(choice.decision === 'reject' ? 'reject' : 'include', item.id, checkbox.checked).catch(error => this.report(error)); };
      }
      const reason = row.createEl('details'); reason.createEl('summary', { text: 'AI 提案理由与证据（人工编辑后仅供参考）' }); reason.createEl('p', { text: item.reason });
      for (const evidence of item.evidence) reason.createEl('p', { text: `${evidence.path}:${evidence.start_line}-${evidence.end_line} · ${evidence.revision.slice(0,12)}` });
    }
    controls.createEl('p', { text: `Source → archived · ${this.manifest.source_path}`, cls: 'ew-target-path' });
    for (const draft of this.inspection.related_drafts) controls.createEl('p', { text: `Draft → discarded · ${draft.path}`, cls: 'ew-target-path' });
    controls.createEl('p', { text: this.manifest.intent || '本轮没有 Integration Intent。', cls: 'ew-intent' });
    const approve = controls.createEl('button', { text: '审查批准清单', cls: 'mod-cta' });
    approve.disabled = this.working || this.inspection.review.decisions.some(item => item.decision === 'undecided') || !this.manifest.items.some(item => item.kind === 'write' && this.inspection!.review.decisions.some(decision => decision.item_id === item.id && decision.decision === 'include'));
    approve.onclick = () => { void this.prepareApproval().catch(error => this.report(error)); };
    controls.createEl('p', { cls: 'ew-muted', text: '批准前只保存候选与取舍；批准后立即写入。Current 是本地内容，可 Refresh 后合入你新增的内容。原 Draft 按钮打开当前文件供你对照。' });
  }
  private async render() {
    const epoch = ++this.epoch; await this.persist(); if (epoch !== this.epoch || this.closed) return;
    this.editor?.destroy(); this.editor = null; this.buffer = null; this.manifest = null;
    this.lastError = null; this.contentEl.empty(); this.host.activateChangeSet(this);
    const labels = this.contentEl.createDiv({ cls: 'ew-merge-labels' });
    this.leftLabel = labels.createEl('span', { text: 'Current · Read only' }); labels.createEl('span', { text: 'Candidate · Editable' });
    const parent = this.contentEl.createDiv({ cls: 'ew-merge-editor' });
    if (!this.id) { this.lastError = '选择一个已生成的 ChangeSet。'; this.host.refreshViews(); return; }
    try {
      this.pendingApproval = await this.host.candidateRecovery.loadApproval(this.id);
      if (this.pendingApproval) { await this.queryApproval(); this.contentEl.createEl('p', { text: '已批准请求的内容固定。请在侧栏查询结果或以原 ID 恢复执行。' }); this.host.refreshViews(); return; }
      const { manifest } = await this.host.client.request<{ manifest: ChangeSet }>(`/v1/changeset?id=${this.id}`);
      if (epoch !== this.epoch || this.closed) return;
      if (manifest.state !== 'ready') throw new Error('Planner 尚未发布完整方案。');
      const files = manifest.items;
      if (!files.some(item => item.id === this.itemId)) this.itemId = files[0]?.id ?? '';
      if (!this.itemId) throw new Error('方案没有条目。');
      this.manifest = manifest; if (!this.inspection || this.inspection.review.changeset_id !== this.id) this.inspection = await this.host.client.request<ChangeSetInspection>(`/v1/changeset/review?id=${this.id}`);
      if (epoch !== this.epoch || this.closed) return;
      for (const item of manifest.items.filter(item => item.kind === 'write')) {
        const key = `${this.id}/${item.id}`;
        if (!this.host.candidateBuffers.has(key)) { const cached = await this.host.candidateRecovery.load(this.id, item.id);
          if (cached) { const document = await this.host.client.request<CandidateDocument>(`/v1/changeset/candidate?id=${this.id}&item_id=${item.id}`); const buffer = new CandidateBuffer(document); buffer.restore(cached); this.host.candidateBuffers.set(key, buffer); }
        }
      }
      const selected = files.find(item => item.id === this.itemId)!;
      if (selected.kind !== 'write') { labels.empty(); parent.createEl('h3', { text: `${selected.kind} · ${selected.target}` });
        parent.createEl('p', { text: selected.kind === 'directory' ? '目录操作只创建目录，不写正文。' : '只标记 lifecycle_status: discarded，不物理删除。' });
        parent.createEl('pre', { text: this.inspection.targets.find(item => item.item_id === selected.id)?.current ?? '当前路径不存在。' }); this.host.refreshViews(); return;
      }
      const document = await this.host.client.request<CandidateDocument>(`/v1/changeset/candidate?id=${this.id}&item_id=${this.itemId}`);
      if (epoch !== this.epoch || this.closed) return;
      const key = `${this.id}/${this.itemId}`; let buffer = this.host.candidateBuffers.get(key);
      if (!buffer || !buffer.dirty) {
        buffer = new CandidateBuffer(document); const cached = await this.host.candidateRecovery.load(this.id, this.itemId);
        if (epoch !== this.epoch || this.closed) return;
        if (cached) buffer.restore(cached); this.host.candidateBuffers.set(key, buffer);
      }
      this.manifest = manifest;
      this.buffer = buffer; this.current = document.current ?? ''; this.currentAvailable = document.current !== null;
      const target = this.inspection.targets.find(item => item.item_id === this.itemId); if (target) { target.current_revision = document.current_revision; target.current = document.current; }
      this.editor = new CandidateEditor(parent, this.current, buffer.content, content => {
        if (!this.buffer) return; this.buffer.content = content; this.showState(); void this.persist().catch(error => this.report(error));
      }, async () => { await this.save(); }); this.updateComparison();
      if (buffer.revision !== document.revision) this.lastError = 'Candidate 在其他位置被修改。未保存内容已保留；保存将校验版本。';
      this.host.refreshViews();
    } catch (error) { this.report(error); this.host.refreshViews(); }
  }
}

class CandidateConfirmation extends Modal {
  constructor(app: Modal['app'], private readonly explanation: string, private readonly actionLabel: string, private readonly action: () => Promise<void>, private readonly failed: (error: unknown) => void) { super(app); }
  onOpen() {
    this.contentEl.createEl('p', { text: this.explanation, attr: { style: 'white-space: pre-wrap' } });
    this.contentEl.createEl('button', { text: '取消' }).onclick = () => this.close();
    this.contentEl.createEl('button', { text: this.actionLabel }).onclick = () => { this.close(); void this.action().catch(this.failed); };
  }
  onClose() { this.contentEl.empty(); }
}
