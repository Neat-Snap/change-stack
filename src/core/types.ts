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
// A part is a logically grouped subset of a layer's rows, explained beside the code.
export interface LayerPart { title: string; summary: string; ranges: ChangeRange[] }
export interface Layer {
  ranges?: ChangeRange[]; id: string; title: string; summary: string; files: string[];
  category?: string; parts?: LayerPart[]; dependsOn?: string[];
}
export interface LayerGroup { id: string; title: string; layers: string[] }
export interface Analysis { summary: string; layers: Layer[]; groups?: LayerGroup[]; source: 'model' | 'local'; warnings: string[] }
export interface Session { review: Review; analysis: Analysis; aiEnabled: boolean; demo: boolean }
