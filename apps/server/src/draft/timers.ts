// One pending timer per draft: when the team on the clock runs out of time.
// The timer only *asks* the engine to check; the engine re-verifies against
// the database (same pick still on the clock, deadline really passed), so a
// stale or duplicate timer can never cause a wrong pick.

export interface TimerApi {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const realTimers: TimerApi = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

// setTimeout can't wait longer than ~24.8 days; slow drafts re-arm in steps.
const MAX_DELAY = 2 ** 31 - 1;

export class DraftTimers {
  private readonly handles = new Map<string, unknown>();

  constructor(
    private readonly onDue: (draftId: string, pickNo: number) => void,
    private readonly now: () => number = Date.now,
    private readonly api: TimerApi = realTimers,
  ) {}

  schedule(draftId: string, pickNo: number, deadline: Date) {
    this.cancel(draftId);
    const delay = Math.max(0, deadline.getTime() - this.now());
    const handle = this.api.setTimeout(() => {
      this.handles.delete(draftId);
      if (delay > MAX_DELAY) this.schedule(draftId, pickNo, deadline);
      else this.onDue(draftId, pickNo);
    }, Math.min(delay, MAX_DELAY));
    this.handles.set(draftId, handle);
  }

  cancel(draftId: string) {
    const h = this.handles.get(draftId);
    if (h !== undefined) this.api.clearTimeout(h);
    this.handles.delete(draftId);
  }

  cancelAll() {
    for (const id of [...this.handles.keys()]) this.cancel(id);
  }

  has(draftId: string) {
    return this.handles.has(draftId);
  }
}
