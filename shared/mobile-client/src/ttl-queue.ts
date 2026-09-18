export interface QueueClock {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(timer: unknown): void;
}

export interface QueueExpiredError extends Error {
  code: "queue_expired";
  queueType: string;
}

interface QueueEntry<T> {
  value: T;
  expiresAt: number;
  resolve: () => void;
  reject: (error: QueueExpiredError) => void;
  timer: unknown;
}

const systemClock: QueueClock = {
  now: () => Date.now(),
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
};

function expiredError(queueType: string): QueueExpiredError {
  const error = new Error(`Mobile queue expired: ${queueType}`) as QueueExpiredError;
  error.code = "queue_expired";
  error.queueType = queueType;
  return error;
}

/** 有界 FIFO；每個項目有獨立 TTL，閒置期間都會準時淘汰。 */
export class TtlFifoQueue<T> {
  readonly queueType: string;
  readonly ttlMs: number;
  readonly maxLength: number;
  private readonly clock: QueueClock;
  private readonly entries: QueueEntry<T>[] = [];

  constructor(options: { queueType: string; ttlMs: number; maxLength: number; clock?: QueueClock }) {
    if (!options.queueType) throw new Error("queueType is required");
    if (!Number.isFinite(options.ttlMs) || options.ttlMs <= 0) throw new Error("ttlMs must be positive");
    if (!Number.isInteger(options.maxLength) || options.maxLength <= 0) throw new Error("maxLength must be positive");
    this.queueType = options.queueType;
    this.ttlMs = options.ttlMs;
    this.maxLength = options.maxLength;
    this.clock = options.clock ?? systemClock;
  }

  get size(): number {
    return this.entries.length;
  }

  enqueue(value: T): Promise<void> {
    this.pruneExpired();
    if (this.entries.length >= this.maxLength) return Promise.reject(expiredError(this.queueType));
    return new Promise<void>((resolve, reject) => {
      const entry: QueueEntry<T> = {
        value,
        expiresAt: this.clock.now() + this.ttlMs,
        resolve,
        reject,
        timer: undefined,
      };
      entry.timer = this.clock.setTimeout(() => {
        const index = this.entries.indexOf(entry);
        if (index < 0) return;
        this.entries.splice(index, 1);
        reject(expiredError(this.queueType));
      }, this.ttlMs);
      this.entries.push(entry);
    });
  }

  dequeue(): T | undefined {
    this.pruneExpired();
    const entry = this.entries.shift();
    if (!entry) return undefined;
    this.clock.clearTimeout(entry.timer);
    entry.resolve();
    return entry.value;
  }

  pruneExpired(): number {
    const now = this.clock.now();
    let removed = 0;
    for (let index = this.entries.length - 1; index >= 0; index -= 1) {
      const entry = this.entries[index];
      if (!entry || entry.expiresAt > now) continue;
      this.entries.splice(index, 1);
      this.clock.clearTimeout(entry.timer);
      entry.reject(expiredError(this.queueType));
      removed += 1;
    }
    return removed;
  }

  dispose(reason = "Mobile queue disposed"): void {
    while (this.entries.length > 0) {
      const entry = this.entries.shift();
      if (!entry) continue;
      this.clock.clearTimeout(entry.timer);
      const error = expiredError(this.queueType);
      error.message = reason;
      entry.reject(error);
    }
  }
}
