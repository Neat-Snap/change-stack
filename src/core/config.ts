import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { DEFAULT_SYSTEM_PROMPT } from './analysis';
import { MODEL_DEFAULTS_VERSION, withModelDefaults } from './model-defaults';
import type { Config } from './types';

export function configPath(): string {
  return process.env.CHANGE_STACK_CONFIG ?? join(homedir(), '.change-stack', 'config.json');
}
export function promptPath(path = configPath()): string { return join(dirname(path), 'system-prompt.md'); }

async function readConfig(path: string): Promise<Config | undefined> {
  try {
    const config = JSON.parse(await readFile(path, 'utf8'));
    if (config.version !== 1 || typeof config.hosts !== 'object' || config.hosts === null
      || config.defaultLanguage !== undefined && !['en', 'ru'].includes(config.defaultLanguage)) throw new Error('Invalid configuration.');
    return config;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw new Error('Cannot read configuration. Check the config file format and permissions.');
  }
}

export async function loadConfig(path = configPath()): Promise<Config> {
  let config = await readConfig(path);
  let persist = false;
  // Migrate the previous default location once; leave its original file intact.
  if (!config && path === configPath() && !process.env.CHANGE_STACK_CONFIG) {
    config = await readConfig(join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'change-stack', 'config.json'));
    if (config) {
      config.defaultLanguage ??= config.ai?.language ?? 'en';
      persist = true;
    }
  }
  if (!config) return { version: 1, hosts: {} };
  if (config.ai && config.modelDefaultsVersion !== MODEL_DEFAULTS_VERSION) {
    config.ai = withModelDefaults(config.ai);
    config.modelDefaultsVersion = MODEL_DEFAULTS_VERSION;
    persist = true;
  }
  if (persist) await saveConfig(config, path);
  if (config.ai) {
    await ensurePrompt(config, path);
    const prompt = await readFile(promptPath(path), 'utf8');
    if (!prompt.trim() || prompt.length > 16_000) throw new Error('System prompt must contain 1–16000 characters.');
    config.ai = { ...config.ai, systemPrompt: prompt, language: config.defaultLanguage ?? config.ai.language ?? 'en' };
  }
  return config;
}

async function ensurePrompt(config: Config, path: string) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  try {
    await writeFile(promptPath(path), (config.ai?.systemPrompt ?? DEFAULT_SYSTEM_PROMPT) + '\n', { mode: 0o600, flag: 'wx' });
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
}

export async function saveConfig(config: Config, path = configPath()): Promise<void> {
  await ensurePrompt(config, path);
  const stored: Config = { ...config, defaultLanguage: config.defaultLanguage ?? config.ai?.language ?? 'en',
    ai: config.ai ? { ...config.ai } : undefined };
  if (stored.ai) stored.modelDefaultsVersion = MODEL_DEFAULTS_VERSION;
  if (stored.ai) { delete stored.ai.systemPrompt; delete stored.ai.language; }
  const temp = `${path}.${crypto.randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(stored, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  await chmod(temp, 0o600);
  await rename(temp, path);
}
