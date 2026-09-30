import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverModelSettings, parseModelSettings, readModelSettings } from '../src/core/model-settings';

const sample = () => ({
  model: { name: 'fast-model' },
  modelProviders: { openai: [
    { id: 'reasoning-model', name: 'Reasoning model', baseUrl: 'https://models.example.test/v1', envKey: 'MODEL_KEY',
      generationConfig: { timeout: 60_000, customHeaders: { 'X-Model-Version': 'test', Authorization: 'wrong-key' },
        extra_body: { enable_thinking: true, reasoning_effort: 'max', chat_template_kwargs: { thinking: true }, model: 'wrong-model', messages: [] },
        samplingParams: { temperature: 0.6 } } },
    { id: 'fast-model', name: 'Fast model', baseUrl: 'https://models.example.test/v1', envKey: 'MODEL_KEY' },
  ] },
  env: { MODEL_KEY: 'fake-file-key', UNRELATED_SECRET: 'must-not-import' },
});

test('imports models and named key sources without changing request identity', () => {
  const settings = parseModelSettings(sample(), { MODEL_KEY: 'fake-env-key' });
  expect(settings.models).toHaveLength(2);
  expect(settings.preferredModel).toBe(1);
  expect(settings.keys).toEqual([
    { name: 'MODEL_KEY', source: 'environment', value: 'fake-env-key' },
    { name: 'MODEL_KEY', source: 'settings file', value: 'fake-file-key' },
  ]);
  expect(settings.models[0]!.config).toEqual({ model: 'reasoning-model', baseUrl: 'https://models.example.test/v1',
    timeoutMs: 60_000, reasoningEffort: 'max', temperature: 0.6, customHeaders: { 'X-Model-Version': 'test' },
    extraBody: { enable_thinking: true, reasoning_effort: 'max', chat_template_kwargs: { thinking: true } } });
});

test('skips malformed models and offers manual keys when no referenced key exists', () => {
  expect(() => parseModelSettings({ modelProviders: {} }, {})).toThrow('No OpenAI-compatible models');
  expect(() => parseModelSettings({ modelProviders: { openai: [{ id: 'x', baseUrl: 'https://user:secret@models.example.test' }] } }, {})).toThrow();
  const value = sample(); value.env = { MODEL_KEY: '', UNRELATED_SECRET: 'unused' };
  expect(parseModelSettings(value, {}).keys).toEqual([]);
});

test('discovers compatible settings without knowing the tool directory name', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cstack-model-settings-'));
  try {
    await mkdir(join(root, '.example-tool')); await mkdir(join(root, '.other-tool')); await mkdir(join(root, '.ssh'));
    const path = join(root, '.example-tool', 'settings.json');
    await writeFile(path, JSON.stringify(sample()));
    await writeFile(join(root, '.other-tool', 'settings.json'), '{"unrelated":true}');
    await writeFile(join(root, '.ssh', 'settings.json'), JSON.stringify(sample()));
    const found = await discoverModelSettings(root);
    expect(found.map(item => item.path)).toEqual([path]);
    expect(found[0]!.settings.models).toHaveLength(2);
    expect(await readModelSettings(join(root, 'missing.json'))).toBeUndefined();
    await writeFile(path, '{"secret":"fake-key", INVALID');
    await expect(readModelSettings(path)).rejects.toThrow('Check the file format');
    expect(await discoverModelSettings(root)).toEqual([]);
  } finally { await rm(root, { recursive: true }); }
});
