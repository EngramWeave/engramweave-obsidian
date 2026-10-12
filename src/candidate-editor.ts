import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { MergeView } from '@codemirror/merge';

/** Current is never editable; programmatic refresh does not replace Candidate's state. */
export class CandidateEditor {
  private readonly editing = new Compartment();
  readonly merge: MergeView;
  constructor(parent: HTMLElement, current: string, candidate: string, changed: (content: string) => void, save: () => Promise<void>) {
    const shared = [markdown(), EditorView.lineWrapping, EditorView.theme({ '&': { height: '100%' }, '.cm-scroller': { overflow: 'auto' } })];
    this.merge = new MergeView({
      a: { doc: current, extensions: [...shared, EditorState.readOnly.of(true), EditorView.editable.of(false)] },
      b: { doc: candidate, extensions: [...shared, this.editing.of([]), history(), keymap.of([{ key: 'Mod-s', run: () => { void save(); return true; } }, ...defaultKeymap, ...historyKeymap]),
        EditorView.updateListener.of(update => { if (update.docChanged) changed(update.state.doc.toString()); })] },
      parent, orientation: 'a-b', gutter: true, highlightChanges: true,
    });
  }
  refreshCurrent(content: string) { this.merge.a.dispatch({ changes: { from: 0, to: this.merge.a.state.doc.length, insert: content } }); }
  setEditable(enabled: boolean) { this.merge.b.dispatch({ effects: this.editing.reconfigure([EditorState.readOnly.of(!enabled), EditorView.editable.of(enabled)]) }); }
  content() { return this.merge.b.state.doc.toString(); }
  destroy() { this.merge.destroy(); }
}
