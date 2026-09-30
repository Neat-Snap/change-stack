import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Config } from './types';

export function configPath(): string {
  return process.env.CHANGE_STACK_CONFIG ?? join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'change-stack', 'config.json');
}
export async function loadConfig(path = configPath()): Promise<Config> {
  try {
    const config = JSON.parse(await readFile(path, 'utf8'));
    if (config.version !== 1 || typeof config.hosts !== 'object' || config.hosts === null) throw new Error('Unsupported or invalid configuration.');
    return config;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, hosts: {} };
    throw new Error('Cannot read configuration. Check the config file format and permissions.');
  }
}
export async function saveConfig(config: Config, path = configPath()): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${crypto.randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(config, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  await chmod(temp, 0o600);
  await rename(temp, path);
}
