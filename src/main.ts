import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { FileSystemAdapter, ItemView, MarkdownRenderer, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, type WorkspaceLeaf } from 'obsidian';
import { requestUrl } from 'obsidian';
import type { AnalysisSettings, AnalyzerJob, CompilerJob, Job, DraftReview, Document, Status, ReviewResult, RelationResult, PublishDraftRequest, ProcessingRound, RecompileRequest } from '@engramweave/contracts';
import { CoreClient, readConnection } from './connection';
import { finished, knowledgeFilename, publicationRequest, Workflow } from './workflow';

const VIEW = 'engramweave-review';
interface Settings { config_path: string }
type Result = { job: AnalyzerJob; stale: boolean; stale_reasons: string[]; review: ReviewResult | null; relation: RelationResult | null;
  record?: { review: { evidence: { items: unknown[]; diagnostics: { message?: string }[] } }; relation: { evidence: { items: unknown[]; diagnostics: { message?: string }[] } } } };
const message = (error: unknown) => error instanceof Error ? error.message : 'EngramWeave operation failed';

export default class EngramWeavePlugin extends Plugin {
  settings: Settings = { config_path: '' };
  client!: CoreClient;
  workflow!: Workflow;
  focusedPath: string | null = null;
  async onload() {
    const saved = await this.loadData() as Partial<Settings> | null;
    this.settings.config_path = typeof saved?.config_path === 'string' ? saved.config_path :
      path.join(process.env.LOCALAPPDATA ?? '', 'EngramWeave', 'p1', 'config.json');
    this.client = new CoreClient(async (url, options) => {
      const response = await requestUrl({ url, ...options, throw: false });
      return { status: response.status, json: response.json };
    }, () => {
      if (!(this.app.vault.adapter instanceof FileSystemAdapter)) throw new Error('The MVP requires a local desktop Vault');
      return readConnection(this.settings.config_path, this.app.vault.adapter.getBasePath());
    });
    this.workflow = new Workflow(this.client);
    this.registerView(VIEW, leaf => new ReviewView(leaf, this));
    this.addSettingTab(new ConnectionSettings(this));
    this.addRibbonIcon('brain-circuit', 'Open EngramWeave review', () => { void this.openReview(); });
    this.addCommand({ id: 'open-review', name: 'Open Draft review sidebar', callback: () => { void this.openReview(); } });
    this.registerEvent(this.app.workspace.on('file-open', file => {
      if (file && /^(20_Sources|30_Drafts)\//.test(file.path)) this.focusedPath = file.path;
      else this.focusedPath = null;
      this.refreshViews();
    }));
    this.registerEvent(this.app.workspace.on('active-leaf-change', leaf => {
      if (leaf?.view instanceof MarkdownView) {
        const file = leaf.view.file;
        this.focusedPath = file && /^(20_Sources|30_Drafts)\//.test(file.path) ? file.path : null;
        this.refreshViews();
      }
    }));
    let timer: ReturnType<typeof setTimeout> | null = null;
    this.registerEvent(this.app.vault.on('modify', file => {
      if (!this.focusedPath || file.path !== this.focusedPath) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { timer = null; this.refreshViews(); }, 750);
    }));
    this.register(() => { if (timer) clearTimeout(timer); });
    this.app.workspace.onLayoutReady(() => {
      const recent = this.app.workspace.getMostRecentLeaf()?.view;
      this.focusedPath = (recent instanceof MarkdownView ? recent.file : this.app.workspace.getActiveFile())?.path ?? null;
      this.refreshViews();
    });
  }
  onunload() { this.client.disconnect(); }
  refreshViews() { for (const leaf of this.app.workspace.getLeavesOfType(VIEW)) if (leaf.view instanceof ReviewView) void leaf.view.refresh(); }
  async openReview() {
    try {
      const recent = this.app.workspace.getMostRecentLeaf()?.view;
      const file = recent instanceof MarkdownView ? recent.file : this.app.workspace.getActiveFile();
      if (file) this.focusedPath = /^(20_Sources|30_Drafts)\//.test(file.path) ? file.path : null;
      let leaf = this.app.workspace.getLeavesOfType(VIEW)[0];
      if (!leaf) { leaf = this.app.workspace.getRightLeaf(false) ?? undefined; if (!leaf) return; await leaf.setViewState({ type: VIEW, active: true }); }
      await this.app.workspace.revealLeaf(leaf);
      this.refreshViews();
    } catch (error) { new Notice(message(error)); }
  }
  async flushEditors() {
    for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
      const view = leaf.view;
      if (view instanceof MarkdownView && view.file && /^(20_Sources|30_Drafts)\//.test(view.file.path)) await view.save();
    }
  }
  async openFile(relative: string) { await this.app.workspace.openLinkText(relative, '', false); }
}

class ConnectionSettings extends PluginSettingTab {
  constructor(private readonly plugin: EngramWeavePlugin) { super(plugin.app, plugin); }
  display() {
    this.containerEl.empty(); this.containerEl.createEl('h2', { text: 'EngramWeave' });
    new Setting(this.containerEl).setName('Core config.json').setDesc('选择当前 Vault 的 Core 配置绝对路径。先启动 Desktop 或独立 Core；API／Codex 模型与 Analysis Profiles 在 Desktop 设置。')
      .addText(text => text.setValue(this.plugin.settings.config_path).setPlaceholder('D:\\...\\config.json').onChange(async value => {
        this.plugin.settings.config_path = value.trim(); this.plugin.client.disconnect(); await this.plugin.saveData({ config_path: this.plugin.settings.config_path });
      }));
    new Setting(this.containerEl).setName('Connection').addButton(button => button.setButtonText('Test connection').onClick(async () => {
      button.setDisabled(true);
      try { const status = await this.plugin.client.connect(); new Notice(`Core connected · ${status.vault_path}`); this.plugin.refreshViews(); }
      catch (error) { new Notice(message(error)); }
      finally { button.setDisabled(false); }
    }));
  }
}

class ReviewView extends ItemView {
  private epoch = 0;
  private operating = false;
  private closed = false;
  private profileId = '';
  private readonly feedback: HTMLElement;
  private readonly panel: HTMLElement;
  private polling = false;
  constructor(leaf: WorkspaceLeaf, private readonly plugin: EngramWeavePlugin) {
    super(leaf);
    this.contentEl.addClass('engramweave-review');
    this.feedback = this.contentEl.createDiv({ cls: 'ew-feedback', attr: { role: 'status', 'aria-live': 'polite' } });
    this.panel = this.contentEl.createDiv();
  }
  getViewType() { return VIEW; }
  getDisplayText() { return 'EngramWeave Review'; }
  getIcon() { return 'brain-circuit'; }
  async onOpen() { this.closed = false; await this.refresh(); }
  async onClose() { this.closed = true; this.epoch++; }
  private button(parent: HTMLElement, label: string, action: () => Promise<unknown>, disabled = false) {
    const button = parent.createEl('button', { text: label }); button.disabled = disabled || this.operating;
    button.addEventListener('click', () => { void this.perform(action); }); return button;
  }
  private async perform(action: () => Promise<unknown>) {
    if (this.operating) return;
    this.operating = true; this.feedback.setText('Working…');
    this.panel.querySelectorAll('button').forEach(button => { button.disabled = true; });
    try { await action(); this.feedback.setText(''); }
    catch (error) { new Notice(message(error)); }
    finally { this.feedback.setText(''); this.operating = false; if (!this.closed) await this.refresh(); }
  }
  private section(title: string) { const section = this.panel.createEl('section', { cls: 'ew-section' }); section.createEl('h3', { text: title }); return section; }
  private async markdown(parent: HTMLElement, body: string, source: string) {
    if (!body) { parent.createEl('p', { text: '—', cls: 'ew-muted' }); return; }
    await MarkdownRenderer.render(this.app, body, parent.createDiv({ cls: 'ew-markdown' }), source, this);
  }
  async refresh() {
    if (this.closed || this.operating) return;
    const epoch = ++this.epoch;
    const relative = this.plugin.focusedPath;
    try {
      if (!relative || !/^(20_Sources|30_Drafts)\/.+\.md$/i.test(relative)) {
        this.panel.empty(); this.panel.createEl('h2', { text: 'EngramWeave' }); this.panel.createEl('p', { text: '打开 Source 或 Draft，查看上下文和分析。正文使用 Obsidian 原生编辑。' });
        return;
      }
      const settings = await this.plugin.client.request<{ settings: AnalysisSettings }>('/v1/analysis/settings');
      if (this.profileId && !settings.settings.profiles.some(profile => profile.id === this.profileId)) this.profileId = '';
      const document = relative.startsWith('30_Drafts/') ? await this.plugin.workflow.review(relative) : await this.plugin.workflow.source(relative);
      if (epoch !== this.epoch || this.closed) return;
      const scroll = this.contentEl.scrollTop; this.panel.empty();
      this.panel.createEl('h2', { text: relative.startsWith('30_Drafts/') ? (document as DraftReview).draft.title : (document as Document).title });
      const toolbar = this.panel.createDiv({ cls: 'ew-actions' }); this.button(toolbar, 'Refresh', async () => { await this.refresh(); });
      const select = toolbar.createEl('select', { attr: { 'aria-label': 'Analysis Profile' } });
      select.createEl('option', { value: '', text: 'Source / Default Profile' });
      for (const profile of settings.settings.profiles) select.createEl('option', { value: profile.id, text: profile.name });
      select.value = this.profileId; select.addEventListener('change', () => { this.profileId = select.value; });
      if (relative.startsWith('30_Drafts/')) await this.renderDraft(document as DraftReview);
      else await this.renderSource(document as Document);
      this.contentEl.scrollTop = scroll;
    } catch (error) { if (epoch === this.epoch && !this.closed) { this.panel.empty(); this.panel.createEl('p', { text: message(error), cls: 'ew-error' }); this.button(this.panel, 'Reconnect', async () => { this.plugin.client.disconnect(); await this.plugin.client.connect(); }); } }
  }
  private async renderSource(source: Document) {
    if (source.kind !== 'source') return;
    this.panel.createEl('p', { text: `${source.processing_status ?? 'Pending'} · ${source.lifecycle_status ?? 'Unknown'}`, cls: 'ew-muted' });
    await this.markdown(this.section('Source Annotation'), source.annotation, source.path);
    const actions = this.section('Knowledge Compiler');
    const status = await this.plugin.client.request<Status>('/v1/status');
    if (this.plugin.focusedPath !== source.path) return;
    const active = status.processing_round ?? status.active_job;
    if (active) {
      actions.createEl('p', { text: `Core · ${'kind' in active ? active.kind : 'Processing round'} · ${active.status}`, cls: 'ew-muted' });
      this.pollDisplay();
    }
    if (source.index_stale) {
      actions.createEl('p', { text: 'Source 登记尚未更新。Refresh Workspace 会登记当前文件，并按配置增量更新已建立的语义索引。', cls: 'ew-muted' });
      this.button(actions, 'Refresh Workspace', async () => {
        await this.plugin.flushEditors();
        const response = await this.plugin.client.request<{ job: Job }>('/v1/scans', { mode: 'refresh' });
        const job = await this.waitJob<Job>(response.job.id);
        if (job.status !== 'succeeded') throw new Error(job.error?.message ?? `Registration ${job.status}`);
      }, Boolean(active));
    }
    actions.createEl('p', { text: 'Core 完成登记、Compiler 和两项 Analyzer；关闭侧边栏不会截断轮次。只有显式执行或已启用的计划调用模型。', cls: 'ew-muted' });
    this.button(actions, 'Run Knowledge Compiler', async () => {
      const sourcePath = source.path; const profile = this.profileId;
      await this.plugin.flushEditors();
      const fresh = await this.plugin.workflow.source(sourcePath);
      const round = await this.plugin.workflow.compile(fresh,profile);
      const result = await this.waitRound(round.id); const item = result.items[0];
      if (!item?.draft_path) throw new Error(item?.error?.message ?? result.error?.message ?? `Round ${result.status}`);
      if (result.status !== 'succeeded') new Notice('Draft 已保留；Analyzer 未全部成功，查看侧边栏后仍可人工入库。');
      if (this.plugin.focusedPath === sourcePath) await this.plugin.openFile(item.draft_path);
    }, Boolean(active) || source.lifecycle_status !== 'active' || !['pending','compiled', ''].includes(source.processing_status ?? ''));
    const drafts = await this.plugin.workflow.drafts(source.path);
    if (this.plugin.focusedPath !== source.path) return;
    const list = this.section('Drafts');
    if (!drafts.items.length) list.createEl('p', { text: '尚无 active Draft。', cls: 'ew-muted' });
    for (const draft of drafts.items) this.button(list, draft.title, () => this.plugin.openFile(draft.path));
  }
  private async renderDraft(review: DraftReview) {
    const { draft, source, analysis } = review;
    this.panel.createEl('p', { text: `${draft.lifecycle_status} · Source ${source.kind === 'source' ? source.processing_status : ''}`, cls: 'ew-muted' });
    await this.markdown(this.section('Source Annotation'), source.annotation, source.path);
    this.button(this.panel, 'Open Source', () => this.plugin.openFile(source.path));
    const tasks = this.section('Draft Analyzer');
    const analyses = review.analyses ?? {review:analysis,relation:analysis};
    tasks.createEl('p', { text: `Review: ${analyses.review?.review.status ?? 'Not run'} · Relation: ${analyses.relation?.relation.status ?? 'Not run'}`, cls: 'ew-muted' });
    this.button(tasks, 'Analyze Draft', async () => {
      const draftPath = draft.path; const profile = this.profileId;
      await this.plugin.flushEditors(); const fresh = await this.plugin.workflow.review(draftPath);
      const job = await this.plugin.workflow.analyze(fresh, profile); await this.waitJob<AnalyzerJob>(job.id);
    }, draft.lifecycle_status !== 'active' || source.lifecycle_status !== 'active' || source.kind !== 'source' || source.processing_status === 'archived' || Boolean(analysis && !finished(analysis.status)));
    for (const task of ['review','relation'] as const) this.button(tasks,task === 'review' ? 'Retry Review' : 'Retry Relation',async () => {
      await this.plugin.flushEditors(); const fresh = await this.plugin.workflow.review(draft.path); const job = await this.plugin.workflow.analyze(fresh,this.profileId,task); await this.waitJob<AnalyzerJob>(job.id);
    },draft.lifecycle_status !== 'active' || source.lifecycle_status !== 'active' || source.kind !== 'source' || source.processing_status === 'archived' || Boolean(analysis && !finished(analysis.status)));
    if (analysis) {
      for (const task of ['review','relation'] as const) if (analyses[task]?.[task].error) tasks.createEl('p', { text: `${task}: ${analyses[task]![task].error!.message}`, cls: 'ew-error' });
      try {
        const results = await Promise.all((['review','relation'] as const).map(async task => ({task,result:analyses[task] ? await this.plugin.client.request<Result>(`/v1/analysis/result?id=${encodeURIComponent(analyses[task]!.id)}`) : null})));
        if (this.plugin.focusedPath !== draft.path) return;
        for (const {task,result} of results) if (result) { if (result.stale) tasks.createEl('p', { text: `${task} 已过期：${result.stale_reasons.join('；')}。请按当前正文判断。`, cls: 'ew-warning' }); await this.renderResults(result,source.path,task); }
      } catch (error) { tasks.createEl('p', { text: message(error), cls: 'ew-muted' }); }
      if (!finished(analysis.status)) this.pollDisplay();
    }
    const publish = this.section('Human Review');
    this.button(publish,'Recompile feedback',async () => {await this.plugin.flushEditors();const fresh = await this.plugin.workflow.review(draft.path);new RecompileModal(this.plugin,fresh).open();},draft.lifecycle_status !== 'active' || source.kind !== 'source' || source.lifecycle_status !== 'active' || !['pending','compiled','reviewed'].includes(source.processing_status ?? '') || Boolean(analysis && !finished(analysis.status)));
    publish.createEl('p', { text: '修改和核对正文后，新建一份 Knowledge；保留 Source 和全部 Draft 文件，成功后 Source Archived、相关 Draft Discarded。', cls: 'ew-muted' });
    if (review.publication) {
      const record = review.publication;
      publish.createEl('p', { text: record.status === 'completed' ? `Published · ${record.request.target_path}` : `入库未完成：${record.error ?? '等待恢复'}`, cls: record.status === 'completed' ? 'ew-success' : 'ew-warning' });
      if (record.status === 'completed') this.button(publish, 'Open Knowledge', () => this.plugin.openFile(record.request.target_path));
      else this.button(publish, 'Retry approved publication', async () => { await this.plugin.workflow.publish(record.request); new Notice('Knowledge published'); });
    } else this.button(publish, 'Publish to Knowledge', async () => {
      await this.plugin.flushEditors();
      const fresh = await this.plugin.workflow.review(draft.path);
      new PublishModal(this.plugin, fresh, () => this.plugin.refreshViews()).open();
    }, draft.lifecycle_status !== 'active' || source.kind !== 'source' || source.lifecycle_status !== 'active' || !['compiled','reviewed'].includes(source.processing_status ?? '') || !analysis || !finished(analysis.status));
  }
  private async renderResults(result: Result, sourcePath: string, only?: 'review' | 'relation') {
    for (const task of ['review','relation'] as const) {
      if (only && task !== only) continue;
      const output = result[task]; const parent = this.section(task === 'review' ? 'Review Analyzer' : 'Relation Analyzer');
      if (!output) { parent.createEl('p', { text: '本轮无有效输出。', cls: 'ew-muted' }); continue; }
      const items = 'findings' in output ? output.findings : output.suggestions;
      if (!items.length) await this.markdown(parent, output.summary, sourcePath);
      for (const item of items) {
        const suggestion = parent.createDiv({ cls: 'ew-suggestion' });
        await this.markdown(suggestion, item.message, sourcePath);
        const detail = suggestion.createEl('details'); detail.createEl('summary', { text: 'Evidence' });
        for (const evidence of item.evidence) this.button(detail, `${evidence.path} · L${evidence.start_line}–${evidence.end_line}`, () => this.plugin.openFile(evidence.path));
      }
      const actual = result.record?.[task].evidence;
      const detail = parent.createEl('details'); detail.createEl('summary', { text: 'Coverage & details' });
      if (items.length && output.summary) await this.markdown(detail, output.summary, sourcePath);
      detail.createEl('p', { text: `Job ${result.job.id} · Draft ${result.job.draft_revision.slice(0,10)} · Library passages ${actual?.items.length ?? '—'}`, cls: 'ew-muted' });
      for (const diagnostic of actual?.diagnostics ?? []) if (diagnostic.message) detail.createEl('p', { text: diagnostic.message, cls: 'ew-muted' });
      for (const limitation of output.limitations) detail.createEl('p', { text: limitation, cls: 'ew-muted' });
    }
  }
  private pollDisplay() {
    if (this.polling) return;
    this.polling = true;
    const timer = window.setTimeout(() => { this.polling = false; if (!this.closed) void this.refresh(); }, 2000);
    this.register(() => window.clearTimeout(timer));
  }
  private async waitJob<T extends CompilerJob | AnalyzerJob | Job>(id: string): Promise<T> {
    while (!this.closed) {
      const job = await this.plugin.client.request<T>(`/v1/jobs/${encodeURIComponent(id)}`);
      this.feedback.setText(`${job.kind === 'compile_source' ? 'Compiler' : job.kind === 'scan_vault' ? 'Refresh Workspace' : 'Draft Analyzer'} · ${job.status}`);
      if (finished(job.status)) return job;
      await new Promise(resolve => window.setTimeout(resolve, 1000));
    }
    throw new Error('侧边栏已关闭；Core 继续运行。重新打开后查看结果。');
  }
  private async waitRound(id: string): Promise<ProcessingRound> {
    while (!this.closed) {const round = await this.plugin.workflow.round(id);this.feedback.setText(`Processing round · ${round.status} · ${round.items[0]?.phase ?? 'Registration'}`);if (finished(round.status)) return round;await new Promise(resolve => window.setTimeout(resolve,1000));}
    throw new Error('侧边栏已关闭；Core 继续完整轮次。重新打开后查看结果。');
  }
}

class RecompileModal extends Modal {
  private request: RecompileRequest | null = null;
  constructor(private readonly plugin: EngramWeavePlugin,private readonly review: DraftReview) {super(plugin.app);}
  onOpen() {
    this.contentEl.createEl('h2',{text:'Recompile feedback'}); this.contentEl.createEl('p',{text:'反馈追加到 Source Annotation，Source 回到 Pending。旧 Draft 和编辑保留；此操作不会立即调用模型。'});
    let feedback = ''; const input = this.contentEl.createEl('textarea',{attr:{'aria-label':'Recompile feedback',maxlength:'8000'}});input.addEventListener('input',() => {if (this.request) input.value = this.request.feedback;else feedback = input.value;});
    const status = this.contentEl.createEl('p',{cls:'ew-error',attr:{role:'status'}});
    new Setting(this.contentEl).addButton(button => button.setButtonText('Cancel').onClick(() => this.close())).addButton(button => button.setButtonText('Request Recompile').setCta().onClick(async () => {
      button.setDisabled(true);
      try {await this.plugin.flushEditors();this.request ??= {request_id:randomUUID(),source_path:this.review.source.path,source_revision:this.review.source.revision,draft_path:this.review.draft.path,draft_revision:this.review.draft.revision,feedback};const result = await this.plugin.workflow.recompile(this.request);this.close();new Notice(`Recompile requested · ${result.recompile_count}`);this.plugin.refreshViews();}
      catch(error) {status.setText(message(error));if (/^(SOURCE_CHANGED|PATH_CONFLICT|INVALID_SOURCE|VALIDATION_ERROR):/.test(message(error))) button.setButtonText('关闭后重新检查');else {button.setButtonText('Retry request');button.setDisabled(false);}}
    }));
  }
  onClose() {this.contentEl.empty();}
}

class PublishModal extends Modal {
  private request: PublishDraftRequest | null = null;
  constructor(private readonly plugin: EngramWeavePlugin, private readonly review: DraftReview, private readonly changed: () => void) { super(plugin.app); }
  onOpen() {
    this.contentEl.createEl('h2', { text: 'Publish to Knowledge' });
    this.contentEl.createEl('p', { text: '将当前 Draft 正文与 Properties 创建为正式 Knowledge。现有文件不会被覆盖；全部关联 Draft 只标记 discarded，保留文件。自动 Vault Git 本轮暂缓。' });
    let target = knowledgeFilename(this.review.draft.title);
    const targetPreview = this.contentEl.createEl('code', { text: target, cls: 'ew-target-path' });
    const feedback = this.contentEl.createEl('p', { cls: 'ew-error', attr: { role: 'status' } });
    new Setting(this.contentEl).setName('Knowledge path').setDesc('使用 40_Knowledge 下的新文件名；子目录需已存在。')
      .addText(text => text.setValue(target).onChange(value => { if (this.request) text.setValue(this.request.target_path); else target = value.trim(); targetPreview.setText(target); }));
    this.contentEl.createEl('h3', { text: 'Drafts to mark Discarded' });
    const list = this.contentEl.createEl('ul');
    for (const draft of this.review.related_drafts) list.createEl('li', { text: `${draft.title} · ${draft.path}` });
    if (this.review.diagnostics.length) feedback.setText(this.review.diagnostics.map(item => `${item.path}: ${item.message}`).join('\n'));
    new Setting(this.contentEl).addButton(button => button.setButtonText('Cancel').onClick(() => this.close()))
      .addButton(button => button.setButtonText('Approve & Publish').setCta().setDisabled(this.review.diagnostics.length > 0).onClick(async () => {
        button.setDisabled(true);
        try {
          await this.plugin.flushEditors();
          this.request ??= publicationRequest(this.review, target);
          const result = await this.plugin.workflow.publish(this.request);
          this.changed(); this.close(); new Notice('Knowledge published'); await this.plugin.openFile(result.target_path);
        } catch (error) {
          feedback.setText(message(error));
          // A new explicit preview is needed after a file/target conflict; uncertain delivery keeps its ID.
          if (/^(SOURCE_CHANGED|PATH_CONFLICT|INVALID_SOURCE|VALIDATION_ERROR):/.test(message(error))) {
            button.setButtonText('关闭后重新检查');
          } else { button.setButtonText('Retry approval'); button.setDisabled(false); }
        }
      }));
  }
  onClose() { this.contentEl.empty(); }
}
