import { RankedSource } from '../search/rank.js';

export interface SourceEventItem {
  n: number;
  title: string;
  url: string;
  domain: string;
  publishedAt: string | null;
  kind: 'primary' | 'news' | 'review' | 'aggregator' | 'other';
}

export interface Timings {
  firstEventMs: number;
  contextBuildMs: number;
  firstSearchStartMs?: number;
  searchDoneMs?: number;
  firstTokenMs?: number;
  totalMs: number;
}

export interface Usage {
  llmCalls: number;
  totalSearches: number;
  promptTokens?: number;
  completionTokens?: number;
}

export type AgentEvent =
  | { type: 'status'; text: string }
  | { type: 'search'; queries: Array<{ query: string; since?: string; domains?: string[]; news?: boolean }> }
  | { type: 'sources'; items: SourceEventItem[] }
  | { type: 'delta'; text: string }
  | { type: 'reset' }
  | { type: 'done'; sessionId: string; messageId: string; usage: Usage; timings: Timings; invalidCitations: number[] }
  | { type: 'error'; code: string; message: string };

export type EventEmitter = (event: AgentEvent) => void;
