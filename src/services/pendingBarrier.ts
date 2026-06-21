// A tiny barrier that tracks in-flight async operations so a reader can wait
// for them to finish (DATA_FLOW.md §4/§6). Used by ContextService so an
// @codebase search waits for any in-flight index writes (a just-saved file, a
// running reconcile) to settle before it queries — otherwise the search can
// read the index mid-update and return stale chunks. Pure and `vscode`-free so
// it is unit-tested directly.

export class PendingBarrier {
  private readonly pending = new Set<Promise<unknown>>();

  /** Register an operation; it is auto-removed when it settles (ok or error). */
  track<T>(op: Promise<T>): Promise<T> {
    this.pending.add(op);
    void op
      .catch(() => undefined) // failures are handled by the caller, not here
      .finally(() => this.pending.delete(op));
    return op;
  }

  /** Number of operations currently in flight. */
  get size(): number {
    return this.pending.size;
  }

  /**
   * Resolve once nothing is in flight. Re-checks after each drain so operations
   * queued *while* waiting (e.g. another save mid-wait) are also awaited.
   */
  async settle(): Promise<void> {
    while (this.pending.size > 0) {
      await Promise.allSettled([...this.pending]);
    }
  }
}
