import { afterEach, expect, test } from 'bun:test';
import { complete } from '../src/core/analysis';
import { configureDiagnostics, ServiceError } from '../src/core/diagnostics';
import { retryAfterMs, retryModelRequest } from '../src/core/model-requests';
import { serviceFetch } from '../src/core/network';

const servers: ReturnType<typeof Bun.serve>[] = [];
afterEach(() => { configureDiagnostics(); for (const server of servers.splice(0)) server.stop(true); });
const mock = (fetch: (request: Request) => Response | Promise<Response>) => {
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch }); servers.push(server); return server.url.origin;
};
const response = (content = 'OK') => Response.json({ choices: [{ message: { content } }] });
function clock() {
  let elapsed = 0;
  const waits: number[] = [];
  return { waits, advance: (ms: number) => { elapsed += ms; }, now: () => elapsed,
    sleep: async (ms: number) => { waits.push(ms); elapsed += ms; }, random: () => 1 };
}

test('serializes requests sharing credentials and releases the queue after a failure', async () => {
  let active = 0, peak = 0;
  const received: string[] = [];
  const origin = mock(async request => {
    const body = await request.json() as any;
    received.push(body.messages[1].content);
    active++; peak = Math.max(peak, active);
    await Bun.sleep(20);
    active--;
    return body.messages[1].content === 'second' ? new Response(null, { status: 400 }) : response();
  });
  const ai = { baseUrl: origin, model: 'fixture', apiKey: 'fake-key' };
  const results = await Promise.allSettled([
    complete(ai, 'first'), complete({ ...ai, model: 'other-fixture' }, 'second'), complete({ ...ai }, 'third'),
  ]);
  expect(peak).toBe(1);
  expect(received).toEqual(['first', 'second', 'third']);
  expect(results.map(result => result.status)).toEqual(['fulfilled', 'rejected', 'fulfilled']);
});

test('a retry holds the model queue, shows a safe wait, and does not delay Git requests', async () => {
  const events: unknown[] = [], progress: string[] = [], received: string[] = [];
  configureDiagnostics(event => events.push(event));
  let first = true;
  const origin = mock(async request => {
    if (new URL(request.url).pathname === '/git') return response();
    const body = await request.json() as any;
    const prompt = body.messages[1].content;
    received.push(prompt);
    if (first) { first = false; return Response.json({ error: { message: 'PRIVATE_RESPONSE fake-key' } }, { status: 429, headers: { 'Retry-After': '0' } }); }
    return response();
  });
  const ai = { baseUrl: origin, model: 'fixture', apiKey: 'fake-key' };
  const firstRequest = complete(ai, 'first', false, message => progress.push(message));
  const secondRequest = complete(ai, 'second');
  expect((await serviceFetch(`${origin}/git`, origin)).ok).toBe(true);
  await Promise.all([firstRequest, secondRequest]);
  expect(received).toEqual(['first', 'first', 'second']);
  expect(progress.some(message => message.includes('retry 1/12 (HTTP 429)'))).toBe(true);
  expect(JSON.stringify(events)).toContain('delayMs');
  for (const secret of ['PRIVATE_RESPONSE', 'fake-key']) expect(JSON.stringify(events) + progress.join(' ')).not.toContain(secret);
});

test('honors Retry-After, shrinks each attempt deadline, and bounds repeated overload', async () => {
  const time = clock(), budgets: number[] = [];
  let calls = 0;
  expect(await retryModelRequest(async remaining => {
    budgets.push(remaining); calls++; time.advance(100);
    if (calls === 1) throw new ServiceError(429, undefined, undefined, 5000);
    return 'ready';
  }, 10_000, undefined, time)).toBe('ready');
  expect(time.waits).toEqual([5000]);
  expect(budgets).toEqual([10_000, 4900]);
  const endless = clock(); calls = 0;
  await expect(retryModelRequest(async () => { calls++; throw new ServiceError(503); }, 1_000_000, undefined, endless)).rejects.toThrow('HTTP 503');
  expect(calls).toBe(13);
  expect(endless.waits.every(delay => delay <= 60_000)).toBe(true);
  const short = clock();
  await expect(retryModelRequest(async () => { throw new ServiceError(429, undefined, undefined, 20_000); }, 10_000, undefined, short)).rejects.toThrow('Retry wait exceeds');
  expect(short.waits).toEqual([]);
});

test('does not retry authentication, permanent quota, TLS, timeout, or malformed JSON failures', async () => {
  for (const error of [new ServiceError(401), new ServiceError(400), new ServiceError(429, undefined, 'insufficient_quota'),
    Object.assign(new Error('PRIVATE_CERTIFICATE_DETAIL'), { code: 'CERT_HAS_EXPIRED' }),
    new DOMException('deadline', 'TimeoutError'), new SyntaxError('PRIVATE_RESPONSE')]) {
    const time = clock(); let calls = 0;
    await expect(retryModelRequest(async () => { calls++; throw error; }, 10_000, undefined, time)).rejects.toBe(error);
    expect(calls).toBe(1); expect(time.waits).toEqual([]);
  }
});

test('reads numeric and date Retry-After values without accepting invalid delays', () => {
  const now = Date.UTC(2026, 0, 1);
  expect(retryAfterMs('3', now)).toBe(3000);
  expect(retryAfterMs(new Date(now + 10_000).toUTCString(), now)).toBe(10_000);
  for (const value of [null, '', 'invalid', '-1']) expect(retryAfterMs(value, now)).toBeUndefined();
});

test('uses provider output defaults and can omit reasoning without mutating saved options', async () => {
  const origin = mock(async request => {
    const body = await request.json() as any;
    for (const key of ['max_tokens', 'max_completion_tokens', 'reasoning', 'reasoning_effort', 'enable_thinking']) expect(body[key]).toBeUndefined();
    expect(body.chat_template_kwargs).toEqual({ fixture_option: true });
    expect(body.temperature).toBe(0.2);
    return response();
  });
  const extraBody = { max_tokens: 32_000, max_completion_tokens: 32_000, reasoning_effort: 'max', reasoning: { effort: 'max' },
    enable_thinking: true, chat_template_kwargs: { thinking: true, fixture_option: true } };
  await complete({ baseUrl: origin, model: 'fixture', apiKey: 'fake-key', reasoningEffort: 'max', reasoningEnabled: false, extraBody }, 'OK');
  expect(extraBody.chat_template_kwargs.thinking).toBe(true);
  expect(extraBody.reasoning_effort).toBe('max');
  const explicit = mock(async request => { expect((await request.json() as any).max_tokens).toBe(2000); return response(); });
  await complete({ baseUrl: explicit, model: 'fixture', apiKey: 'fake-key', maxOutputTokens: 2000 }, 'OK');
});
