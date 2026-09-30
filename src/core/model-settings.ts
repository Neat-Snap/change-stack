import { readFile, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { serviceUrl } from './target';
import type { AIConfig } from './types';

export interface ImportedModel {
  name: string;
  envKey?: string;
  config: Omit<AIConfig, 'apiKey'>;
}
export interface ImportedKey { name: string; source: 'settings file' | 'environment'; value: string }
export interface ModelSettings { models: ImportedModel[]; keys: ImportedKey[]; preferredModel?: number }
const record = (value: unknown): Record<string, any> | undefined => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : undefined;
const nonempty = (value: unknown): value is string => typeof value === 'string' && !!value.trim();

export async function discoverModelSettings(root = homedir()): Promise<{ path: string; settings: ModelSettings }[]> {
  const paths = [join(root, 'settings.json')];
  try {
    const directories = await readdir(root, { withFileTypes: true });
    paths.push(...directories.filter(entry => entry.isDirectory() && entry.name.startsWith('.')
      && !['.cache', '.git', '.ssh', '.Trash', '.local'].includes(entry.name))
      .sort((a, b) => a.name.localeCompare(b.name)).slice(0, 100).map(entry => join(root, entry.name, 'settings.json')));
  } catch { return []; }
  const found = await Promise.all(paths.map(async path => {
    try { const settings = await readModelSettings(path); return settings ? { path, settings } : undefined; }
    catch { return undefined; }
  }));
  return found.filter((item): item is NonNullable<typeof item> => !!item);
}

export function parseModelSettings(value: unknown, environment: Record<string, string | undefined> = process.env): ModelSettings {
  const data = record(value);
  const entries = data?.modelProviders?.openai;
  if (!Array.isArray(entries)) throw new Error('No OpenAI-compatible models found in this settings file.');
  const models: ImportedModel[] = [];
  for (const entry of entries.slice(0, 100)) {
    const item = record(entry);
    if (!item || !nonempty(item.id)) continue;
    const baseUrl = item.baseUrl ?? data?.model?.baseUrl;
    if (!nonempty(baseUrl)) continue;
    try { serviceUrl(baseUrl); } catch { continue; }
    const generation = record(item.generationConfig) ?? {};
    const config: ImportedModel['config'] = { model: item.id.trim(), baseUrl: baseUrl.trim().replace(/\/$/, '') };
    const headers = record(generation.customHeaders);
    if (headers) {
      config.customHeaders = Object.fromEntries(Object.entries(headers).filter(([name, content]) =>
        /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) && typeof content === 'string' && !/[\r\n]/.test(content)
        && !['authorization', 'proxy-authorization', 'cookie', 'host', 'content-type', 'content-length'].includes(name.toLowerCase())));
    }
    const extra = record(generation.extra_body);
    if (extra) {
      // Keep model-specific options, while our protocol and budgets stay authoritative.
      config.extraBody = Object.fromEntries(Object.entries(extra).filter(([name]) =>
        !['model', 'messages', 'stream', 'max_tokens', 'max_completion_tokens', 'response_format', 'tools', 'tool_choice'].includes(name)));
    }
    const effort = config.extraBody?.reasoning_effort ?? generation.reasoning?.effort;
    if (['high', 'xhigh', 'max'].includes(effort)) config.reasoningEffort = effort;
    const temperature = generation.samplingParams?.temperature;
    if (typeof temperature === 'number' && Number.isFinite(temperature) && temperature >= 0 && temperature <= 2) config.temperature = temperature;
    if (Number.isInteger(generation.timeout) && generation.timeout >= 1_000 && generation.timeout <= 600_000) config.timeoutMs = generation.timeout;
    models.push({ name: nonempty(item.name) ? item.name.trim() : config.model,
      envKey: nonempty(item.envKey) && /^[A-Za-z_][A-Za-z0-9_]*$/.test(item.envKey) ? item.envKey : undefined, config });
  }
  if (!models.length) throw new Error('No valid OpenAI-compatible models found in this settings file.');
  const keys: ImportedKey[] = [];
  for (const name of new Set(models.flatMap(model => model.envKey ? [model.envKey] : []))) {
    for (const [source, content] of [['environment', environment[name]], ['settings file', data?.env?.[name]]] as const) {
      if (nonempty(content)) keys.push({ name, source, value: content.trim() });
    }
  }
  const preferredModel = models.findIndex(model => model.config.model === data?.model?.name);
  return { models, keys, ...(preferredModel >= 0 ? { preferredModel } : {}) };
}

export async function readModelSettings(path: string, environment?: Record<string, string | undefined>): Promise<ModelSettings | undefined> {
  const expanded = path.startsWith('~/') ? join(homedir(), path.slice(2)) : resolve(path);
  try {
    if ((await stat(expanded)).size > 1_000_000) throw new Error('Settings file is too large.');
    return parseModelSettings(JSON.parse(await readFile(expanded, 'utf8')), environment);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    // Parser errors can quote file contents, including keys.
    throw new Error('Could not import model settings. Check the file format and permissions.');
  }
}
