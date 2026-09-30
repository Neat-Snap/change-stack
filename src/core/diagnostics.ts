export class ServiceError extends Error {
  constructor(readonly status: number, parameter?: unknown, code?: unknown) {
    const hint = status === 401 || status === 403 ? 'Check your token and access permissions.'
      : status === 400 || status === 422 ? 'Check the model ID and supported request options.'
      : status === 404 ? 'Check the API base URL and model ID.'
      : status === 429 ? 'Check your model quota or rate limit and retry.' : 'Check the service URL and retry.';
    const safeParameter = ['model', 'response_format', 'temperature', 'max_tokens', 'max_completion_tokens', 'reasoning_effort', 'reasoning', 'service_tier'].includes(parameter as string) ? ` Rejected parameter: ${parameter}.` : '';
    const safeCode = ['invalid_api_key', 'model_not_found', 'context_length_exceeded', 'unsupported_parameter', 'rate_limit_exceeded', 'insufficient_quota'].includes(code as string) ? ` Error code: ${code}.` : '';
    super(`Service returned HTTP ${status}.${safeParameter}${safeCode} ${hint}`);
  }
}

// These messages originate in our own validation, never in an API response.
export class ModelError extends Error {}

export function diagnosticReason(error: unknown, depth = 0): string {
  if (error instanceof ServiceError || error instanceof ModelError) return error.message;
  if (error instanceof SyntaxError) return 'The endpoint or model returned invalid JSON.';
  const value = error as { name?: string; code?: string; cause?: unknown } | undefined;
  if (value?.name === 'TimeoutError') return 'The model request timed out.';
  if (value?.name === 'AbortError') return 'The request was aborted.';
  if (['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
    'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN', 'CERT_HAS_EXPIRED', 'ERR_TLS_CERT_ALTNAME_INVALID'].includes(value?.code ?? '')) {
    return 'TLS certificate verification failed. Check your corporate CA certificate (CHANGE_STACK_CA_FILE).';
  }
  if (['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'ETIMEDOUT', 'ConnectionRefused', 'FailedToOpenSocket'].includes(value?.code ?? '')) {
    return 'Could not connect to the service. Check the hostname, VPN, and service availability.';
  }
  if (value?.cause && depth < 2) return diagnosticReason(value.cause, depth + 1);
  return 'The request failed. Check service connectivity or retry with --debug.';
}

type DiagnosticEvent = {
  stage: string;
  elapsedMs?: number;
  origin?: string;
  model?: string;
  inputChars?: number;
  maxOutputTokens?: number;
  json?: boolean;
  reasoningEffort?: string;
  serviceTier?: string;
  finishReason?: string;
  error?: string;
};
let writer: ((event: DiagnosticEvent) => void) | undefined;
export function configureDiagnostics(report?: (event: DiagnosticEvent) => void): void { writer = report; }
export function diagnose(event: DiagnosticEvent): void { writer?.(event); }
