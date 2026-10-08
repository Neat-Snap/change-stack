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
  customHeaders?: Record<string, string>;
  extraBody?: Record<string, unknown>;
  temperature?: number;
  timeoutMs?: number;
  jsonMode?: boolean;
  reasoningEnabled?: boolean;
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
  diffNote?: string;
  oldMode?: string;
  newMode?: string;
  oldBlobSha?: string;
  newBlobSha?: string;
  // Provider-specific file hash used in diff page anchors: SHA-256 (GitHub) or SHA-1 (GitLab) of the path.
  diffAnchor?: string;
}
export interface Review {
  target: ReviewTarget;
  title: string;
  description: string;
  author: string;
  sourceBranch: string;
  targetBranch: string;
  headSha: string;
  targetSha?: string;
  repository?: string;
  baseSha?: string;
  startSha?: string;
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
export interface Session { review: Review; analysis: Analysis; aiEnabled: boolean; demo: boolean; commentsEnabled?: boolean }
export type LineSide = 'old' | 'current';
export interface CommentInput { path: string; side: LineSide; start: number; end: number; endSide?: LineSide; body: string }
