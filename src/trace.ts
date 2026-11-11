import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config.js';
import { Timings, Usage } from './agent/events.js';

export interface TraceRecord {
  timestamp: string;
  sessionId: string;
  messageId: string;
  model: string;
  usage: Usage;
  timings: Timings;
  invalidCitations: number[];
  warning?: string;
}

export function appendTrace(record: TraceRecord, dataDir: string = config.DATA_DIR): void {
  try {
    const tracesDir = join(dataDir, 'traces');
    if (!existsSync(tracesDir)) {
      mkdirSync(tracesDir, { recursive: true });
    }
    const traceFile = join(tracesDir, 'traces.jsonl');
    appendFileSync(traceFile, JSON.stringify(record) + '\n', 'utf-8');
  } catch (err) {
    console.warn('Could not write trace record:', err);
  }
}
