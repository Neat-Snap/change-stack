import type { AIConfig } from './types';

export const MODEL_DEFAULTS = {
  reasoningEffort: 'high',
  timeoutMs: 600_000,
  maxContextChars: 30_000,
} as const;
export const MODEL_DEFAULTS_VERSION = 1;

// Setup and the one-time upgrade use the same values, including imported settings.
export function withModelDefaults(ai: AIConfig): AIConfig {
  const extraBody = ai.extraBody ? { ...ai.extraBody } : undefined;
  if (extraBody) {
    if ('reasoning_effort' in extraBody) extraBody.reasoning_effort = MODEL_DEFAULTS.reasoningEffort;
    const reasoning = extraBody.reasoning;
    if (reasoning && typeof reasoning === 'object' && !Array.isArray(reasoning) && 'effort' in reasoning) {
      extraBody.reasoning = { ...reasoning, effort: MODEL_DEFAULTS.reasoningEffort };
    }
  }
  return { ...ai, ...MODEL_DEFAULTS, ...(extraBody ? { extraBody } : {}) };
}
