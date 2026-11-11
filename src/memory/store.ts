import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config.js';

export interface SourceItem {
  n: number;
  title: string;
  url: string;
  domain: string;
  publishedAt: string | null;
  kind: 'primary' | 'news' | 'review' | 'aggregator' | 'other';
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  ts: string; // UTC ISO
  sources?: SourceItem[];
}

export interface Session {
  id: string;
  uid: string;
  title: string;
  createdAt: string; // UTC ISO
  updatedAt: string; // UTC ISO
  messages: ChatMessage[];
}

export interface SessionSummary {
  id: string;
  uid: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export class SessionStore {
  private sessionsDir: string;
  private cache: Map<string, Session> = new Map();

  constructor(dataDir: string = config.DATA_DIR) {
    this.sessionsDir = join(dataDir, 'sessions');
    this.init();
  }

  private init(): void {
    if (!existsSync(this.sessionsDir)) {
      mkdirSync(this.sessionsDir, { recursive: true });
    }
    this.reloadIndex();
  }

  public reloadIndex(): void {
    this.cache.clear();
    if (!existsSync(this.sessionsDir)) return;

    const files = readdirSync(this.sessionsDir);
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const fullPath = join(this.sessionsDir, file);
      try {
        const raw = readFileSync(fullPath, 'utf-8');
        const session = JSON.parse(raw) as Session;
        if (session.id && session.messages) {
          this.cache.set(session.id, session);
        }
      } catch (err) {
        console.warn(`Failed to read session file ${file}:`, err);
      }
    }
  }

  public getSession(id: string): Session | null {
    return this.cache.get(id) || null;
  }

  public saveSession(session: Session): void {
    if (!existsSync(this.sessionsDir)) {
      mkdirSync(this.sessionsDir, { recursive: true });
    }

    // Atomic write via temporary file + rename
    const finalPath = join(this.sessionsDir, `${session.id}.json`);
    const tmpPath = join(this.sessionsDir, `${session.id}.tmp.${Date.now()}`);

    const payload = JSON.stringify(session, null, 2);
    writeFileSync(tmpPath, payload, 'utf-8');
    renameSync(tmpPath, finalPath);

    this.cache.set(session.id, session);
  }

  public listSessions(uid?: string): SessionSummary[] {
    const list: SessionSummary[] = [];
    for (const session of this.cache.values()) {
      if (uid && session.uid !== uid) continue;
      list.push({
        id: session.id,
        uid: session.uid,
        title: session.title,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        messageCount: session.messages.length,
      });
    }
    // Most recent first
    return list.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }

  public getAllSessions(uid?: string): Session[] {
    const list: Session[] = [];
    for (const session of this.cache.values()) {
      if (uid && session.uid !== uid) continue;
      list.push(session);
    }
    return list;
  }
}

export const sessionStore = new SessionStore();
