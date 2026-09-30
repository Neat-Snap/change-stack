import { afterEach, expect, test } from 'bun:test';
import { analyze, complete } from '../src/core/analysis';
import { configureDiagnostics, diagnosticReason } from '../src/core/diagnostics';
import { demoSession } from '../src/core/demo';
import { saveConfig } from '../src/core/config';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const servers: ReturnType<typeof Bun.serve>[] = [];
afterEach(() => { configureDiagnostics(); for (const server of servers.splice(0)) server.stop(true); });
const mock = (fetch: (request: Request) => Response | Promise<Response>) => {
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch }); servers.push(server); return server.url.origin;
};

test('reports HTTP failures and timing without keys, code, headers, or response bodies', async () => {
  const events: unknown[] = []; configureDiagnostics(event => events.push(event));
  const origin = mock(() => new Response('PRIVATE_CODE fake-api-key fake-header', { status: 401 }));
  const analysis = await analyze(demoSession().review, { baseUrl: origin, model: 'test', apiKey: 'fake-api-key', customHeaders: { 'X-Secret': 'fake-header' } });
  expect(analysis.source).toBe('local');
  expect(analysis.warnings[0]).toContain('HTTP 401');
  const log = JSON.stringify(events);
  expect(log).toContain('elapsedMs'); expect(log).toContain('inputChars'); expect(log).toContain('HTTP 401');
  for (const privateValue of ['PRIVATE_CODE', 'fake-api-key', 'fake-header', demoSession().review.files[0]!.patch]) expect(log).not.toContain(privateValue);
  expect(diagnosticReason(new SyntaxError('PRIVATE_CODE'))).not.toContain('PRIVATE_CODE');
  expect(diagnosticReason(new Error('fake-api-key'))).not.toContain('fake-api-key');
});

test('sends imported headers and generation settings while enforcing the model protocol', async () => {
  const origin = mock(async request => {
    const body = await request.json() as any;
    expect(request.headers.get('Authorization')).toBe('Bearer selected-key');
    expect(request.headers.get('X-Model-Version')).toBe('test');
    expect(body).toMatchObject({ model: 'selected-model', stream: false, enable_thinking: true,
      reasoning_effort: 'max', temperature: 0.6, chat_template_kwargs: { thinking: true }, response_format: { type: 'json_object' } });
    expect(body.messages).toHaveLength(2);
    expect(body.max_tokens).toBe(16_000);
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: '{"ok":true}' } }] });
  });
  const answer = await complete({ baseUrl: origin, model: 'selected-model', apiKey: 'selected-key',
    customHeaders: { Authorization: 'unselected-key', 'X-Model-Version': 'test' }, reasoningEffort: 'max', temperature: 0.6, maxOutputTokens: 16_000,
    extraBody: { model: 'unselected-model', stream: true, messages: [], enable_thinking: true, chat_template_kwargs: { thinking: true } } }, 'Return JSON', true);
  expect(JSON.parse(answer)).toEqual({ ok: true });
});

test('diagnoses exhausted input and output budgets separately from service failures', async () => {
  let calls = 0;
  const origin = mock(() => { calls++; return Response.json({ choices: [{ finish_reason: 'length', message: { content: '{"incomplete":' } }] }); });
  await expect(complete({ baseUrl: origin, model: 'test', apiKey: 'test' }, 'test', true)).rejects.toThrow('output-token limit');
  const review = demoSession().review;
  review.files = [{ ...review.files[0]!, patch: 'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -0,0 +1,100 @@\n' + Array.from({ length: 100 }, () => '+' + 'x'.repeat(1000)).join('\n') + '\n' }];
  const analysis = await analyze(review, { baseUrl: origin, model: 'test', apiKey: 'test', maxContextChars: 8_000 });
  expect(analysis.warnings.join(' ')).toContain('input budget');
  expect(calls).toBe(1);
});

test('can validate model JSON without requiring the response_format option', async () => {
  const origin = mock(async request => {
    expect((await request.json() as any).response_format).toBeUndefined();
    return Response.json({ choices: [{ message: { content: '{"ok":true}' } }] });
  });
  expect(await complete({ baseUrl: origin, model: 'test', apiKey: 'test', jsonMode: false }, 'Return JSON', true)).toBe('{"ok":true}');
});

test('the CLI connection check diagnoses unsupported JSON mode without accessing a repository', async () => {
  let calls = 0;
  const origin = mock(async request => {
    expect(new URL(request.url).pathname).toBe('/v1/chat/completions');
    calls++;
    const body = await request.json() as any;
    if (body.response_format) return Response.json({ error: { param: 'response_format', code: 'unsupported_parameter', message: 'DO_NOT_LOG_THIS fake-key' } }, { status: 400 });
    return Response.json({ choices: [{ message: { content: body.messages[1].content.includes('JSON') ? '{"ok":true}' : 'OK' } }] });
  });
  const directory = await mkdtemp(join(tmpdir(), 'cstack-model-check-'));
  try {
    const path = join(directory, 'config.json');
    await saveConfig({ version: 1, hosts: {}, ai: { baseUrl: `${origin}/v1`, model: 'test', apiKey: 'fake-key' } }, path);
    for (const noJsonMode of [false, true]) {
      const child = Bun.spawn([process.execPath, 'src/cli.ts', '--check-ai', '--debug', ...(noJsonMode ? ['--no-json-mode'] : [])], {
        env: { ...process.env, CHANGE_STACK_CONFIG: path }, stdout: 'pipe', stderr: 'pipe',
      });
      const log = await new Response(child.stdout).text() + await new Response(child.stderr).text();
      expect(await child.exited).toBe(noJsonMode ? 0 : 1);
      expect(log).toContain('Chat completion: OK');
      expect(log).toContain(noJsonMode ? 'JSON completion: OK' : 'Rejected parameter: response_format');
      expect(log).not.toContain('DO_NOT_LOG_THIS'); expect(log).not.toContain('fake-key');
    }
    expect(calls).toBe(4);
  } finally { await rm(directory, { recursive: true }); }
});

test('a CLI timeout override allows slow model checks without changing the saved timeout', async () => {
  const origin = mock(async request => {
    const body = await request.json() as any;
    await Bun.sleep(1200);
    return Response.json({ choices: [{ message: { content: body.messages[1].content.includes('JSON') ? '{"ok":true}' : 'OK' } }] });
  });
  const directory = await mkdtemp(join(tmpdir(), 'cstack-timeout-check-'));
  try {
    const path = join(directory, 'config.json');
    await saveConfig({ version: 1, hosts: {}, ai: { baseUrl: origin, model: 'test', apiKey: 'fake-key', timeoutMs: 1000 } }, path);
    for (const override of [false, true]) {
      const child = Bun.spawn([process.execPath, 'src/cli.ts', '--check-ai', '--debug', ...(override ? ['--model-timeout', '3'] : [])], {
        env: { ...process.env, CHANGE_STACK_CONFIG: path }, stdout: 'pipe', stderr: 'pipe',
      });
      const [stdout, stderr] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
      expect(await child.exited).toBe(override ? 0 : 1);
      expect(stderr).toContain(`"timeoutMs":${override ? 3000 : 1000}`);
      if (override) expect(stdout).toContain('JSON completion: OK');
      else expect(stderr).toContain('timed out after 1 second. Increase --model-timeout');
      expect(stdout + stderr).not.toContain('fake-key');
    }
    expect(JSON.parse(await readFile(path, 'utf8')).ai.timeoutMs).toBe(1000);
  } finally { await rm(directory, { recursive: true }); }
}, 10_000);

test('CLI generation overrides omit saved output and reasoning options without rewriting settings', async () => {
  let calls = 0;
  const origin = mock(async request => {
    calls++;
    const body = await request.json() as any;
    for (const key of ['max_tokens', 'reasoning_effort', 'enable_thinking', 'chat_template_kwargs']) expect(body[key]).toBeUndefined();
    return Response.json({ choices: [{ message: { content: body.response_format ? '{"ok":true}' : 'OK' } }] });
  });
  const directory = await mkdtemp(join(tmpdir(), 'cstack-generation-check-'));
  try {
    const path = join(directory, 'config.json');
    await saveConfig({ version: 1, hosts: {}, ai: { baseUrl: origin, model: 'fixture', apiKey: 'fake-key', maxOutputTokens: 20_000,
      reasoningEffort: 'max', extraBody: { enable_thinking: true, chat_template_kwargs: { thinking: true } } } }, path);
    const before = await readFile(path, 'utf8');
    const child = Bun.spawn([process.execPath, 'src/cli.ts', '--check-ai', '--no-reasoning', '--max-output-tokens', '0'], {
      env: { ...process.env, CHANGE_STACK_CONFIG: path }, stdout: 'pipe', stderr: 'pipe',
    });
    const output = await new Response(child.stdout).text();
    expect(await child.exited).toBe(0);
    expect(output).toContain('JSON completion: OK');
    expect(calls).toBe(2);
    expect(await readFile(path, 'utf8')).toBe(before);
  } finally { await rm(directory, { recursive: true }); }
});
