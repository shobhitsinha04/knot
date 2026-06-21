import * as vscode from "vscode";

import { MAX_CONTEXT_FILE_LINES } from "./constants";
import { IndexManager } from "./services/indexManager";
import { PendingBarrier } from "./services/pendingBarrier";
import type { OllamaService } from "./services/ollamaService";
import type {
  FileContext,
  IndexProgress,
  IndexStats,
  Logger,
  RetrievedChunk,
} from "./types";

// The single context seam for the workspace (DECISIONS 016, DATA_FLOW.md §3–4).
// Owns the one IndexManager every feature shares and the active-file context
// gathering. `vscode`-coupled, so it lives at src/ root (like ChatViewProvider
// and CmdKController); the index logic it wraps stays `vscode`-free in
// src/services/. Constructed once in activate() and injected wherever context or
// retrieval is needed (chat, the activation index step, the watcher, rebuild).

export interface ContextServiceOptions {
  ollama: OllamaService;
  /** Extension global storage path (context.globalStorageUri.fsPath). */
  storageDir: string;
  /** Absolute path of the workspace this index covers. */
  workspacePath: string;
  embeddingModel: string;
  logger: Logger;
}

export class ContextService {
  private readonly index: IndexManager;
  /**
   * In-flight index writes (saves, reconcile, rebuild). retrieve() waits on
   * these so an @codebase search never reads a half-updated index — the source
   * of stale/hallucinated answers when querying right after a save.
   */
  private readonly indexing = new PendingBarrier();
  /**
   * The most recent editor the user worked in. Tracked because focusing the
   * chat webview clears `window.activeTextEditor`, which would otherwise lose
   * the current-file context (FEATURES.md §3).
   */
  private lastEditor?: vscode.TextEditor;

  constructor(opts: ContextServiceOptions) {
    this.index = new IndexManager({
      ollama: opts.ollama,
      storageDir: opts.storageDir,
      workspacePath: opts.workspacePath,
      embeddingModel: opts.embeddingModel,
      logger: opts.logger,
    });
    this.lastEditor = vscode.window.activeTextEditor;
  }

  /** Record the active editor so chat keeps its file context when focused. */
  noteActiveEditor(editor: vscode.TextEditor | undefined): void {
    if (editor) this.lastEditor = editor;
  }

  /** Automatic context from the active (or last-active) editor (FEATURES.md §3). */
  gatherFileContext(): FileContext | undefined {
    const editor = vscode.window.activeTextEditor ?? this.lastEditor;
    if (!editor) return undefined;
    const doc = editor.document;
    const withinLimit = doc.lineCount <= MAX_CONTEXT_FILE_LINES;
    const selection = editor.selection;
    return {
      filename: vscode.workspace.asRelativePath(doc.uri),
      languageId: doc.languageId,
      content: withinLimit ? doc.getText() : undefined,
      cursorLine: selection.active.line + 1,
      selectedText: selection.isEmpty ? undefined : doc.getText(selection),
    };
  }

  // --- Index lifecycle (delegates to the owned IndexManager) ----------------

  /** Incremental reconcile against on-disk mtimes (activation path). */
  reconcile(onProgress?: (p: IndexProgress) => void): Promise<IndexStats> {
    return this.indexing.track(this.index.reconcile(onProgress));
  }

  /** Clean drop-then-rebuild of the whole index (Rebuild Index command). */
  indexWorkspace(onProgress?: (p: IndexProgress) => void): Promise<IndexStats> {
    return this.indexing.track(this.index.indexWorkspace(onProgress));
  }

  /** True if this workspace already has a non-empty index. */
  isIndexed(): Promise<boolean> {
    return this.index.isIndexed();
  }

  /** Re-index a single changed file (file watcher / save). */
  updateFile(filePath: string): Promise<void> {
    return this.indexing.track(this.index.updateFile(filePath));
  }

  /** Drop a deleted file's chunks (file watcher). */
  deleteFile(filePath: string): Promise<void> {
    return this.indexing.track(this.index.deleteFile(filePath));
  }

  /**
   * Retrieve the reranked top chunks for an @codebase query (DATA_FLOW.md §4
   * steps 2–4). Waits for any in-flight index writes (a just-saved file, a
   * running reconcile/rebuild) to settle first, so the search never reads a
   * half-updated index. Returns [] when nothing is indexed yet, so callers can
   * show a graceful "index not ready" / "no results" state.
   */
  async retrieve(query: string): Promise<RetrievedChunk[]> {
    await this.indexing.settle();
    return this.index.search(query);
  }
}
