import { ModelError, ServiceError } from './diagnostics';

const pending = new Map<string, Promise<void>>();

// Requests sharing credentials also share the queue, including their retry waits.
export async function serialModelRequest<T>(key: string, run: () => Promise<T>, onWait?: () => void): Promise<T> {
  if (pending.has(key)) onWait?.();
  const previous = pending.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>(resolve => { release = resolve; });
  pending.set(key, current);
  await previous;
  try { return await run(); }
  finally {
    release();
    if (pending.get(key) === current) pending.delete(key);
  }
}

export interface ModelRetry { attempt: number; delayMs: number; status: number }
interface RetryTiming {
  now(): number;
  sleep(ms: number): Promise<void>;
  random(): number;
}
const timing: RetryTiming = {
  now: () => performance.now(),
  sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
  random: Math.random,
};

export async function retryModelRequest<T>(run: (remainingMs: number) => Promise<T>, timeoutMs: number,
  onRetry?: (retry: ModelRetry) => void, clock: RetryTiming = timing): Promise<T> {
  const deadline = clock.now() + timeoutMs;
  for (let attempt = 0; ; attempt++) {
    const remaining = Math.floor(deadline - clock.now());
    if (remaining <= 0) throw new DOMException('Request deadline reached.', 'TimeoutError');
    try { return await run(remaining); }
    catch (error) {
      if (!(error instanceof ServiceError) || ![429, 500, 502, 503, 504].includes(error.status)
        || error.permanent || attempt >= 12) throw error;
      const backoff = Math.min(60_000, 1000 * 2 ** attempt) * (0.8 + clock.random() * 0.2);
      const delayMs = Math.ceil(Math.max(backoff, error.retryAfterMs ?? 0));
      const available = Math.floor(deadline - clock.now());
      if (available <= delayMs) {
        throw new ModelError('Retry wait exceeds the remaining model request timeout. Increase --model-timeout or try again later.');
      }
      onRetry?.({ attempt: attempt + 1, delayMs, status: error.status });
      await clock.sleep(delayMs);
    }
  }
}

export function retryAfterMs(value: string | null, now = Date.now()): number | undefined {
  if (!value?.trim()) return undefined;
  const seconds = Number(value);
  const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now;
  return Number.isFinite(delay) && delay >= 0 ? Math.ceil(delay) : undefined;
}
