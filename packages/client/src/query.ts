export interface QueryState<T> {
  data: T | undefined;
  error: Error | null;
  loading: boolean;
}

const DROP_AFTER = 60_000;
/** Keep the topic a moment after the last subscriber left (re-renders resubscribe right away). */
const RELEASE_AFTER = 1000;

/**
 * Shared async value with live refetch. The first subscriber fetches and retains the
 * daemon topic; the last one releases it (data is dropped a minute later).
 */
export class Query<T> {
  data: T | undefined;
  error: Error | null = null;
  loading = false;
  private snapshot: QueryState<T> = { data: undefined, error: null, loading: false };
  private listeners = new Set<() => void>();
  private release: (() => void) | null = null;
  private dropTimer: ReturnType<typeof setTimeout> | null = null;
  private releaseTimer: ReturnType<typeof setTimeout> | null = null;
  private seq = 0;
  /** Live updates were off for a while (topic released): refetch on the next subscribe. */
  private stale = false;

  constructor(
    private fetcher: () => Promise<T>,
    private retainTopic: (() => () => void) | null,
  ) {}

  get active() {
    return this.listeners.size > 0;
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    if (this.listeners.size === 1) {
      if (this.dropTimer) clearTimeout(this.dropTimer);
      this.dropTimer = null;
      if (this.releaseTimer) clearTimeout(this.releaseTimer);
      this.releaseTimer = null;
      this.release ??= this.retainTopic?.() ?? null;
      if ((this.data === undefined || this.stale) && !this.loading) void this.refetch();
      this.stale = false;
    }
    return () => {
      if (!this.listeners.delete(fn) || this.listeners.size) return;
      this.releaseTimer = setTimeout(() => {
        this.releaseTimer = null;
        if (this.release) this.stale = true;
        this.release?.();
        this.release = null;
      }, RELEASE_AFTER);
      this.dropTimer = setTimeout(() => {
        this.data = undefined;
        this.error = null;
        this.publish();
      }, DROP_AFTER);
    };
  };

  getSnapshot = (): QueryState<T> => this.snapshot;

  /** Fetch again; the old data stays visible until the new one arrives. */
  refetch = async (): Promise<void> => {
    const seq = ++this.seq;
    this.loading = true;
    this.publish();
    try {
      const data = await this.fetcher();
      if (seq !== this.seq) return;
      this.data = data;
      this.error = null;
    } catch (e) {
      if (seq !== this.seq) return;
      this.error = e as Error;
    }
    this.loading = false;
    this.publish();
  };

  set(data: T) {
    this.seq++;
    this.data = data;
    this.error = null;
    this.loading = false;
    this.publish();
  }

  private publish() {
    this.snapshot = { data: this.data, error: this.error, loading: this.loading };
    for (const fn of [...this.listeners]) fn();
  }
}
