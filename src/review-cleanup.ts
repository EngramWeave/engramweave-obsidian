import { Modal, type App } from 'obsidian';

export function confirmReviewCleanup(app: App, selectedTitle: string, drafts: { path: string; title: string }[]): Promise<boolean | null> {
  return new Promise(resolve => { new ReviewCleanupModal(app, selectedTitle, drafts, resolve).open(); });
}
class ReviewCleanupModal extends Modal {
  private discard = true;
  constructor(app: App, private readonly selectedTitle: string, private readonly drafts: { path: string; title: string }[], private readonly resolve: (value: boolean | null) => void) { super(app); }
  onOpen() {
    const { contentEl } = this;
    contentEl.createEl('h2', { text: 'Complete Review' });
    contentEl.createEl('p', { text: `当前审阅稿：${this.selectedTitle}` });
    contentEl.createEl('p', { text: '此 Source 还有其他 active Draft。建议标记为 discarded；只改变生命周期，不修改正文或删除文件。也可以保留其他稿件。' });
    const list = contentEl.createEl('ul', { cls: 'ew-cleanup-list' });
    for (const draft of this.drafts) { const item = list.createEl('li'); item.createEl('strong', { text: draft.title }); item.createEl('div', { text: draft.path, cls: 'ew-muted' }); }
    if (this.drafts.length > 100) contentEl.createEl('p', { text: '本次最多整理 100 份其他稿件。可取消下方勾选，先完成当前稿件的审阅。', cls: 'ew-warning' });
    const label = contentEl.createEl('label');
    const checkbox = label.createEl('input', { type: 'checkbox' }); checkbox.checked = true;
    label.appendText(' Mark other Drafts as Discarded');
    checkbox.addEventListener('change', () => { this.discard = checkbox.checked; });
    const actions = contentEl.createDiv({ cls: 'ew-actions' });
    actions.createEl('button', { text: 'Cancel' }).onclick = () => this.close();
    actions.createEl('button', { text: 'Review Complete', cls: 'mod-cta' }).onclick = () => { if (this.discard && this.drafts.length > 100) return; this.resolve(this.discard); this.close(); };
  }
  onClose() { this.contentEl.empty(); this.resolve(null); }
}
