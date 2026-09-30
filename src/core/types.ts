export type Provider = 'gitlab' | 'github';
export interface ReviewTarget {
  provider: Provider;
  origin: string;
  project: string;
  number: number;
  url: string;
}
export interface HostConfig {
  provider: Provider;
  baseUrl: string;
  token: string;
}
export interface AIConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
  reasoningEffort?: 'high' | 'xhigh' | 'max';
  serviceTier?: 'flex';
  systemPrompt?: string;
  language?: 'en' | 'ru';
  maxToolCalls?: number;
  maxContextChars?: number;
  maxOutputTokens?: number;
}
export interface Config { version: 1; hosts: Record<string, HostConfig>; ai?: AIConfig; aiSetupSkipped?: boolean; defaultLanguage?: 'en' | 'ru' }
export interface ChangedFile {
  path: string;
  oldPath: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  patch: string;
  additions: number;
  deletions: number;
  incomplete: boolean;
}
export interface Review {
  target: ReviewTarget;
  title: string;
  description: string;
  author: string;
  sourceBranch: string;
  targetBranch: string;
  headSha: string;
  repository?: string;
  baseSha?: string;
  baseRepository?: string;
  files: ChangedFile[];
  warnings: string[];
}
export interface ChangeRange { changeId: string; start: number; end: number }
export interface Layer { ranges?: ChangeRange[]; id: string; title: string; summary: string; files: string[]; questions: string[] }
export interface Analysis { summary: string; layers: Layer[]; source: 'model' | 'local'; warnings: string[] }
export interface Session { review: Review; analysis: Analysis; aiEnabled: boolean; demo: boolean }
