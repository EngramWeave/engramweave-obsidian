import { ItemView, Notice, Scope, Modal, TFile, type WorkspaceLeaf, type ViewStateResult } from 'obsidian';
import type { ChangeSet, CandidateDocument } from '@engramweave/contracts';
import { CandidateEditor } from './candidate-editor';
import { CandidateBuffer } from './candidate-buffer';
import type { CandidateRecovery } from './candidate-recovery';
import type { CoreClient } from './connection';

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
    if (!this.buffer) return false;
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
      if (epoch === this.epoch && buffer === this.buffer && !this.closed) { this.current = document.current ?? ''; this.currentAvailable = document.current !== null; this.updateComparison(); }
    } catch (error) { this.report(error); }
  }
  renderControls(parent: HTMLElement) {
    parent.createEl('h2', { text: 'ChangeSet' });
    if (!this.manifest || !this.buffer) { parent.createEl('p', { text: this.lastError ?? '正在读取候选方案…' }); return; }
    const controls = parent.createDiv({ cls: 'ew-changeset-controls' });
    const fileLabel = controls.createEl('label', { text: 'Candidate file' });
    const select = fileLabel.createEl('select', { attr: { 'aria-label': 'Candidate file' } });
    for (const item of this.manifest.items.filter(item => item.kind === 'write')) select.createEl('option', { value: item.id, text: item.target });
    select.value = this.itemId;
    select.onchange = () => { this.itemId = select.value; void this.render().catch(error => this.report(error)); };
    controls.createEl('p', { text: this.buffer.document.item.target, cls: 'ew-target-path' });
    this.status = controls.createEl('p', { cls: 'ew-muted', attr: { role: 'status' } }); this.showState();
    const actions = controls.createDiv({ cls: 'ew-changeset-actions' });
    const button = (text: string, action: () => void) => { actions.createEl('button', { text }).onclick = action; };
    button('Save Candidate', () => { void this.save(); });
    button('Preview Candidate', () => { void this.preview().catch(error => this.report(error)); });
    button('Open original Draft', () => { void this.openDraft().catch(error => this.report(error)); });
    button('Refresh Current', () => { void this.refreshCurrent(); });
    button('Reload Candidate', () => this.reloadCandidate());
    button('Cancel ChangeSet', () => this.cancelProposal());
    controls.createEl('p', { cls: 'ew-muted', text: '预览先保存 Candidate，再用 Obsidian 原生阅读视图打开；不会应用正式内容。' });
    controls.createEl('p', { cls: 'ew-muted', text: '打开原 Draft，在原生编辑器中自行对照。打开的是该文件当前内容；本页不计算改动比例。' });
    const explanation = controls.createEl('details'); explanation.createEl('summary', { text: '整合说明' });
    explanation.createEl('p', { text: this.manifest.draft_path, cls: 'ew-target-path' });
    explanation.createEl('p', { text: this.buffer.document.item.reason });
    explanation.createEl('p', { text: this.manifest.intent || '本轮没有 Integration Intent。', cls: 'ew-intent' });
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
      const { manifest } = await this.host.client.request<{ manifest: ChangeSet }>(`/v1/changeset?id=${this.id}`);
      if (epoch !== this.epoch || this.closed) return;
      if (manifest.state !== 'ready') throw new Error('Planner 尚未发布完整方案。');
      const files = manifest.items.filter(item => item.kind === 'write');
      if (!files.some(item => item.id === this.itemId)) this.itemId = files[0]?.id ?? '';
      if (!this.itemId) throw new Error('方案没有可编辑的 Candidate。');
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
    this.contentEl.createEl('p', { text: this.explanation });
    this.contentEl.createEl('button', { text: '取消' }).onclick = () => this.close();
    this.contentEl.createEl('button', { text: this.actionLabel }).onclick = () => { this.close(); void this.action().catch(this.failed); };
  }
  onClose() { this.contentEl.empty(); }
}
