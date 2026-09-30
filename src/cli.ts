#!/usr/bin/env bun
import packageInfo from '../package.json';
declare const CHANGE_STACK_BUILD_VERSION: string;
const version = typeof CHANGE_STACK_BUILD_VERSION === 'string' ? CHANGE_STACK_BUILD_VERSION : packageInfo.version;
import * as p from '@clack/prompts';
import { parseArgs } from 'node:util';
import { configPath, loadConfig, promptPath, saveConfig } from './core/config';
import { parseTarget, serviceUrl, tokenCreationUrl } from './core/target';
import { fetchReview, validateHost } from './core/providers';
import { analyze, complete, localAnalysis } from './core/analysis';
import { reviewTools, type ReviewTools } from './core/review-tools';
import { repositoryReader } from './core/repository';
import { readFile } from 'node:fs/promises';
import { configureDiagnostics, diagnose, diagnosticReason, ModelError } from './core/diagnostics';
import { discoverModelSettings, readModelSettings, type ModelSettings } from './core/model-settings';
import { demoSession } from './core/demo';
import { startServer } from './server';
import type { AIConfig, Config, HostConfig, Provider, ReviewTarget } from './core/types';

function answer<T>(value: T): Exclude<T, symbol> {
  if (p.isCancel(value)) { p.cancel('Setup cancelled.'); process.exit(0); }
  return value as Exclude<T, symbol>;
}
export async function openBrowser(url: string): Promise<void> {
  const command = process.platform === 'darwin' ? ['open', url] : process.platform === 'win32'
    ? ['rundll32.exe', 'url.dll,FileProtocolHandler', url] : ['xdg-open', url];
  try { const child = Bun.spawn(command, { stdout: 'ignore', stderr: 'ignore' }); await child.exited; } catch { /* The printed URL also works in headless environments. */ }
}

async function setupHost(config: Config, target: ReviewTarget, noOpen: boolean): Promise<HostConfig> {
  const baseUrl = answer(await p.text({ message: 'Git service base URL (include its prefix if hosted under a subpath)', initialValue: target.origin,
    validate(value) { try { if (serviceUrl(value ?? '').origin !== target.origin) return 'Use the same host as your review URL.'; } catch { return 'Enter a valid HTTP(S) URL.'; } } }));
  const url = tokenCreationUrl(target.provider, baseUrl);
  p.note(target.provider === 'gitlab' ? 'Create a personal access token with read_api scope. Set an expiry according to your company policy.'
    : 'Create a fine-grained token for this repository with Pull requests: Read and Contents: Read. Organization approval may be required.', 'Read-only access');
  p.log.info(`Create your token: ${url}`);
  if (!noOpen) await openBrowser(url);
  while (true) {
    const token = answer(await p.password({ message: 'Paste your access token (input is hidden)', validate: value => value?.trim() ? undefined : 'A token is required.' })).trim();
    const host = { provider: target.provider, baseUrl: baseUrl.replace(/\/$/, ''), token };
    const spinner = p.spinner(); spinner.start('Checking access to your Git service');
    try {
      await validateHost(host); spinner.stop('Credentials verified');
      config.hosts[target.origin] = host; await saveConfig(config); return host;
    } catch {
      spinner.stop('Could not verify credentials');
      const retry = answer(await p.confirm({ message: 'Check the URL and token permissions. Try another token?' }));
      if (!retry) throw new Error('Git authentication was not completed.');
    }
  }
}

async function setupAI(config: Config, importPath?: string): Promise<AIConfig | undefined> {
  const enable = answer(await p.confirm({ message: 'Connect your internal AI endpoint for explanations?', initialValue: true }));
  if (!enable) { config.aiSetupSkipped = true; delete config.ai; await saveConfig(config); return undefined; }
  let ai: AIConfig | undefined;
  let settings: ModelSettings | undefined;
  if (importPath) {
    try { settings = await readModelSettings(importPath); }
    catch { p.log.warn('Could not read model settings. Continuing with manual setup.'); }
    if (!settings) p.log.warn('No compatible model settings found at that path.');
  } else {
    const found = await discoverModelSettings();
    if (found.length && answer(await p.confirm({ message: 'Found existing model settings in your user folder. Import them?', initialValue: true }))) {
      const index = found.length === 1 ? 0 : answer(await p.select({ message: 'Which settings file should Change Stack use?',
        options: found.map((item, value) => ({ value, label: item.path })) }));
      settings = found[index]!.settings;
    }
  }
  if (settings) {
    const index = answer(await p.select({ message: 'Which model should Change Stack use?', initialValue: settings.preferredModel ?? 0,
      options: settings.models.map((model, value) => ({ value, label: model.name, hint: model.config.model === model.name ? undefined : model.config.model })) }));
    const selected = settings.models[index]!;
    const preferredKey = settings.keys.findIndex(key => key.name === selected.envKey);
    const keyIndex = answer(await p.select({ message: 'Which API key should Change Stack use? Values stay hidden.', initialValue: preferredKey >= 0 ? preferredKey : -1,
      options: [...settings.keys.map((key, value) => ({ value, label: `${key.name} (${key.source})` })), { value: -1, label: 'Enter a different API key' }] }));
    const apiKey = keyIndex >= 0 ? settings.keys[keyIndex]!.value : answer(await p.password({ message: 'Your AI API key (input is hidden)', validate: v => v?.trim() ? undefined : 'An API key is required.' })).trim();
    ai = { ...selected.config, apiKey };
    p.log.info('Imported the model endpoint, headers, and supported generation settings.');
  }
  if (!ai) {
    const baseUrl = answer(await p.text({ message: 'OpenAI-compatible API base URL (for example https://ai.company.internal/v1)',
      validate(value) { try { serviceUrl(value ?? ''); } catch { return 'Enter a valid HTTP(S) API base URL.'; } } }));
    const model = answer(await p.text({ message: 'Model ID provided by your company', validate: v => v?.trim() ? undefined : 'A model ID is required.' }));
    const apiKey = answer(await p.password({ message: 'Your AI API key (input is hidden)', validate: v => v?.trim() ? undefined : 'An API key is required.' }));
    ai = { baseUrl: baseUrl.replace(/\/$/, ''), model: model.trim(), apiKey: apiKey.trim() };
    if (serviceUrl(baseUrl).hostname === 'openrouter.ai' && model.trim() === 'openai/gpt-6-luna') {
      ai.reasoningEffort = 'high'; ai.serviceTier = 'flex';
    }
  }
  const language = answer(await p.select({ message: 'Explanation language', initialValue: config.defaultLanguage ?? 'en', options: [{ value: 'en' as const, label: 'English' }, { value: 'ru' as const, label: 'Русский' }] }));
  config.defaultLanguage = language;
  config.ai = { ...ai, language };
  delete config.aiSetupSkipped;
  await saveConfig(config); return config.ai;
}

async function main() {
  const { values, positionals } = parseArgs({ args: Bun.argv.slice(2), allowPositionals: true, options: {
    help: { type: 'boolean', short: 'h' }, version: { type: 'boolean' }, demo: { type: 'boolean' }, 'no-open': { type: 'boolean' }, 'no-ai': { type: 'boolean' },
    setup: { type: 'boolean' }, 'setup-ai': { type: 'boolean' }, 'import-settings': { type: 'string' }, debug: { type: 'boolean' }, 'check-ai': { type: 'boolean' },
    'no-json-mode': { type: 'boolean' }, 'no-reasoning': { type: 'boolean' }, port: { type: 'string' }, listen: { type: 'string' }, 'public-url': { type: 'string' },
    'system-prompt': { type: 'string' }, 'system-prompt-file': { type: 'string' }, language: { type: 'string' }, 'default-language': { type: 'string' },
    'max-tool-calls': { type: 'string' }, 'max-context-chars': { type: 'string' }, 'max-output-tokens': { type: 'string' }, 'model-timeout': { type: 'string' },
  } });
  if (values.version) { console.log(version); return; }
  if (values.debug) configureDiagnostics(event => console.error(`[cstack debug] ${JSON.stringify(event)}`));
  if (values.help) { console.log(`Change Stack\n\nUsage: cstack [review-url] [options]\n\n  --version    Show the executable version\n  --setup      Configure or replace Git and AI credentials\n  --setup-ai   Configure the model; offer existing settings import\n  --import-settings PATH      Import models and key choices from another file\n  --check-ai    Test chat and JSON completions without a review\n  --debug       Print request timings and safe failure details\n  --no-json-mode              Omit response_format for endpoints without JSON mode\n  --no-reasoning              Omit optional reasoning and thinking settings\n  --no-ai      Review without contacting the model\n  --no-open    Print URLs without launching a browser\n  --port N     Choose the local server port (default: 4317; 0: automatic)\n  --listen HOST               Bind address (default: 127.0.0.1)\n  --public-url ORIGIN          Browser origin for container/proxy access\n  --language en|ru             Override language for this review\n  --default-language en|ru     Save the default language (no URL needed)\n  --system-prompt TEXT         Replace the default explanation prompt\n  --system-prompt-file PATH    Read a replacement prompt from a UTF-8 file\n  --max-tool-calls N           Repository reads (default: 6, range: 0–20)\n  --max-context-chars N        Input characters per model call (default: 48000)\n  --max-output-tokens N        Output cap (default: provider setting; 0: omit)\n  --model-timeout SECONDS      Override the model request timeout (1–600)\n  --demo       Open a sample review with no outbound requests\n\nSettings and credentials: ${configPath()}\nEditable system prompt: ${promptPath()}\nCredentials are saved in a local plaintext file with mode 0600 on POSIX.\nCode, questions, and analysis are held in memory and discarded on exit.`); return; }
  const port = values.port === undefined ? 4317 : Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Port must be an integer between 0 and 65535.');
  const listen = values.listen ?? '127.0.0.1';
  if (listen !== '127.0.0.1' && !values['public-url']) throw new Error('A public URL is required when using another bind address.');
  if (values['public-url']) serviceUrl(values['public-url']);
  const overrides: Partial<AIConfig> = {};
  if (values['no-json-mode']) overrides.jsonMode = false;
  if (values['no-reasoning']) overrides.reasoningEnabled = false;
  if (values['model-timeout'] !== undefined) {
    const seconds = Number(values['model-timeout']);
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > 600) throw new ModelError('Model timeout must be 1–600 seconds.');
    overrides.timeoutMs = seconds * 1000;
  }
  if (values['default-language'] && !['en', 'ru'].includes(values['default-language'])) throw new Error('Default language must be en or ru.');
  if (values.language) {
    if (!['en', 'ru'].includes(values.language)) throw new Error('Language must be en or ru.');
    overrides.language = values.language as 'en' | 'ru';
  }
  if (values['system-prompt'] !== undefined && values['system-prompt-file'] !== undefined) throw new Error('Choose one prompt option.');
  const prompt = values['system-prompt-file'] !== undefined ? await readFile(values['system-prompt-file'], 'utf8') : values['system-prompt'];
  if (prompt !== undefined) {
    if (!prompt.trim() || prompt.length > 16_000) throw new Error('System prompt must contain 1–16000 characters.');
    overrides.systemPrompt = prompt;
  }
  for (const [flag, field, min, max] of [
    ['max-tool-calls', 'maxToolCalls', 0, 20], ['max-context-chars', 'maxContextChars', 8_000, 200_000],
    ['max-output-tokens', 'maxOutputTokens', 1_000, 32_000],
  ] as const) {
    if (values[flag] !== undefined) {
      const n = Number(values[flag]);
      if (!Number.isInteger(n) || (n < min && !(field === 'maxOutputTokens' && n === 0)) || n > max) throw new Error('Invalid model budget.');
      overrides[field] = n;
    }
  }
  const config = await loadConfig();
  let modelConfigured = false;
  if (values['setup-ai'] || values['import-settings']) {
    if (!process.stdin.isTTY) throw new ModelError('Model setup requires an interactive terminal.');
    await setupAI(config, values['import-settings']);
    modelConfigured = true;
    if (!positionals.length && !values['check-ai'] && !values.demo) return;
  }
  if (values['check-ai']) {
    if (!config.ai) throw new ModelError('No saved model configuration. Run cstack --setup-ai first.');
    const ai = { ...config.ai, ...overrides };
    console.log(`Checking model ${ai.model} at ${new URL(ai.baseUrl).origin}`);
    try {
      await complete(ai, 'Reply with the word OK.');
      console.log('Chat completion: OK');
      const result = JSON.parse(await complete(ai, 'Return ONLY JSON: {"ok":true}', true));
      if (result?.ok !== true) throw new ModelError('The model did not return the expected health-check JSON.');
      console.log('JSON completion: OK');
    } catch (error) {
      console.error(`Model check failed: ${diagnosticReason(error)}`);
      process.exitCode = 1;
    }
    return;
  }
  if (values['default-language']) {
    config.defaultLanguage = values['default-language'] as 'en' | 'ru';
    if (config.ai) config.ai.language = config.defaultLanguage;
    await saveConfig(config);
    p.log.success(`Default language saved: ${config.defaultLanguage}`);
    if (!positionals.length && !values.demo && !values.setup) return;
  }
  p.intro('Change Stack · Local review');
  let session;
  let ai: AIConfig | undefined;
  let tools: ReviewTools | undefined;
  if (values.demo) session = demoSession();
  else {
    let url = positionals[0];
    let provider: Provider | undefined;
    if (!url) {
      if (!process.stdin.isTTY) throw new Error('Provide a review URL. First-run setup requires an interactive terminal.');
      provider = answer(await p.select({ message: 'Which Git service are you reviewing?', options: [{ value: 'gitlab' as const, label: 'GitLab (including self-hosted)' }, { value: 'github' as const, label: 'GitHub (including Enterprise)' }] }));
      url = answer(await p.text({ message: 'Paste a merge request or pull request URL', validate(v) { try { parseTarget(v ?? '', provider); } catch (e) { return (e as Error).message; } } }));
    }
    const target = parseTarget(url, provider);
    let host = config.hosts[target.origin];
    if (!host || values.setup) {
      if (!process.stdin.isTTY) throw new Error('No saved credentials. Run interactively to configure this Git host.');
      p.log.info(`Git service: ${target.provider} · ${target.origin}`);
      p.log.info(`Credentials are saved to ${configPath()} (owner-only plaintext file on POSIX).`);
      host = await setupHost(config, target, !!values['no-open']);
    }
    ai = values['no-ai'] ? undefined : config.ai;
    if (!modelConfigured && !values['no-ai'] && ((!ai && !config.aiSetupSkipped) || values.setup) && process.stdin.isTTY) ai = await setupAI(config);
    if (ai) {
      const savedPrompt = await readFile(promptPath(), 'utf8');
      ai = { ...ai, systemPrompt: savedPrompt, language: config.defaultLanguage ?? ai.language ?? 'en', ...overrides };
    }
    const spinner = p.spinner({ indicator: 'timer' }); spinner.start('Fetching review metadata and changed files');
    let review;
    try { review = await fetchReview(target, host); spinner.stop(`Loaded ${review.files.length} changed files`); }
    catch (e) { spinner.stop('Could not load the review'); throw e; }
    let analysis = localAnalysis(review);
    if (ai) {
      spinner.start('Preparing review layers with your configured model');
      try {
        analysis = await analyze(review, ai, repositoryReader(review, host), message => spinner.message(message));
        spinner.stop(analysis.source === 'model' ? 'Review layers prepared' : 'Model explanations unavailable; showing local groups');
        for (const warning of analysis.warnings ?? []) p.log.warn(warning);
      }
      catch (e) { spinner.stop('Review preparation failed'); throw e; }
    }
    tools = reviewTools(review, host);
    session = { review, analysis, aiEnabled: !!ai, demo: false };
  }
  const { server, url } = startServer(session, ai, port, values['public-url'], listen, tools);
  p.outro(`Review ready: ${url}\nKeep this terminal running. Press Ctrl+C to close the review.`);
  if (!values['no-open']) void openBrowser(url);
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { server.stop(true); process.exit(0); });
}
if (import.meta.main) main().catch(error => {
  // Do not print arbitrary library errors: they may include API response bodies or credentials.
  p.log.error('Could not start the review. Check the URL, saved credentials, and service connectivity. Use --help for usage or --setup to replace credentials.');
  diagnose({ stage: 'startup.failed', error: diagnosticReason(error) });
  process.exitCode = 1;
});
