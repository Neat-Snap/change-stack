import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { complete } from '../src/core/analysis';
import { loadConfig, promptPath, saveConfig } from '../src/core/config';
import { configureDiagnostics } from '../src/core/diagnostics';
import { withModelDefaults } from '../src/core/model-defaults';
import { parseModelSettings } from '../src/core/model-settings';
import type { Config } from '../src/core/types';

const servers: ReturnType<typeof Bun.serve>[] = [];
afterEach(() => { configureDiagnostics(); for (const server of servers.splice(0)) server.stop(true); });

test('upgrades existing settings once and preserves credentials, custom options, and the editable prompt', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cstack-defaults-'));
  try {
    const path = join(directory, 'config.json');
    const previous: Config = { version: 1, defaultLanguage: 'ru', hosts: {
      'https://git.example.test': { provider: 'gitlab', baseUrl: 'https://git.example.test', token: 'fixture-token' },
    }, ai: { baseUrl: 'https://models.example.test/v1', model: 'fixture-model', apiKey: 'fixture-key',
      reasoningEffort: 'max', timeoutMs: 60_000, maxContextChars: 48_000, maxOutputTokens: 16_000,
      customHeaders: { 'X-Model-Version': 'test' }, temperature: 0.6, jsonMode: false,
      extraBody: { reasoning_effort: 'max', reasoning: { effort: 'max', exclude: true }, enable_thinking: true } } };
    await writeFile(path, JSON.stringify(previous));
    await writeFile(promptPath(path), 'My custom prompt.\n');
    const upgraded = await loadConfig(path);
    expect(upgraded.hosts).toEqual(previous.hosts);
    expect(upgraded.ai).toEqual({ ...previous.ai!, reasoningEffort: 'high', timeoutMs: 600_000, maxContextChars: 30_000,
      extraBody: { reasoning_effort: 'high', reasoning: { effort: 'high', exclude: true }, enable_thinking: true },
      language: 'ru', systemPrompt: 'My custom prompt.\n' });
    expect(upgraded.modelDefaultsVersion).toBe(1);
    if (process.platform !== 'win32') expect((await stat(path)).mode & 0o777).toBe(0o600);
    const persisted = JSON.parse(await readFile(path, 'utf8'));
    expect(persisted.ai.timeoutMs).toBe(600_000);
    expect(persisted.ai.systemPrompt).toBeUndefined();
    const before = await readFile(path, 'utf8');
    await loadConfig(path);
    expect(await readFile(path, 'utf8')).toBe(before);
    upgraded.ai = { ...upgraded.ai!, reasoningEffort: 'xhigh', timeoutMs: 120_000, maxContextChars: 40_000 };
    await saveConfig(upgraded, path);
    expect((await loadConfig(path)).ai).toMatchObject({ reasoningEffort: 'xhigh', timeoutMs: 120_000, maxContextChars: 40_000 });
    expect(await readFile(promptPath(path), 'utf8')).toBe('My custom prompt.\n');
  } finally { await rm(directory, { recursive: true }); }
});

test('setup defaults override imported generation values without changing identity or vendor options', () => {
  const imported = parseModelSettings({ modelProviders: { openai: [{ id: 'fixture', baseUrl: 'https://models.example.test/v1',
    generationConfig: { timeout: 60_000, extra_body: { reasoning_effort: 'max', enable_thinking: true } },
  }] } }, {}).models[0]!.config;
  const configured = withModelDefaults({ ...imported, apiKey: 'fixture-key' });
  expect(configured).toMatchObject({ baseUrl: imported.baseUrl, model: 'fixture', apiKey: 'fixture-key',
    reasoningEffort: 'high', timeoutMs: 600_000, maxContextChars: 30_000,
    extraBody: { reasoning_effort: 'high', enable_thinking: true } });
  expect(imported.timeoutMs).toBe(60_000);
  expect(imported.extraBody!.reasoning_effort).toBe('max');
});

test('default requests use high reasoning, a 600-second deadline, and 30000 input characters', async () => {
  const events: unknown[] = [];
  configureDiagnostics(event => events.push(event));
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    const body = await request.json() as any;
    expect(body.reasoning_effort).toBe('high');
    expect(body.messages[1].content).toHaveLength(30_000);
    expect(body.max_tokens).toBeUndefined();
    return Response.json({ choices: [{ message: { content: 'OK' } }] });
  } }); servers.push(server);
  expect(await complete({ baseUrl: server.url.origin, model: 'fixture', apiKey: 'fixture-key' }, 'x'.repeat(40_000))).toBe('OK');
  expect(events[0]).toMatchObject({ timeoutMs: 600_000, inputChars: 30_000, reasoningEffort: 'high' });
});

test('the CLI uses migrated values immediately while retaining explicit timeout overrides', async () => {
  let calls = 0;
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    calls++;
    const body = await request.json() as any;
    expect(body.reasoning_effort).toBe('high');
    return Response.json({ choices: [{ message: { content: body.response_format ? '{"ok":true}' : 'OK' } }] });
  } }); servers.push(server);
  const directory = await mkdtemp(join(tmpdir(), 'cstack-upgrade-check-'));
  try {
    const path = join(directory, 'config.json');
    await writeFile(path, JSON.stringify({ version: 1, hosts: {}, ai: { baseUrl: server.url.origin, model: 'fixture',
      apiKey: 'fixture-key', reasoningEffort: 'max', timeoutMs: 60_000, maxContextChars: 48_000 } }));
    for (const override of [false, true]) {
      const child = Bun.spawn([process.execPath, 'src/cli.ts', '--check-ai', '--debug', ...(override ? ['--model-timeout', '3'] : [])], {
        env: { ...process.env, CHANGE_STACK_CONFIG: path }, stdout: 'pipe', stderr: 'pipe',
      });
      const [stdout, stderr] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
      expect(await child.exited).toBe(0);
      expect(stdout).toContain('JSON completion: OK');
      expect(stderr).toContain(`"timeoutMs":${override ? 3000 : 600_000}`);
      expect(stderr).not.toContain('fixture-key');
    }
    expect(calls).toBe(4);
    expect(JSON.parse(await readFile(path, 'utf8')).ai).toMatchObject({ reasoningEffort: 'high', timeoutMs: 600_000, maxContextChars: 30_000 });
  } finally { await rm(directory, { recursive: true }); }
});
