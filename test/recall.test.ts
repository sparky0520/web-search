import { describe, it, expect, beforeEach } from 'vitest';
import { DateTime } from 'luxon';
import { SessionStore, Session } from '../src/memory/store.js';
import { assembleRecall, rankBM25Lite, tokenize } from '../src/memory/recall.js';
import { resolve } from '../src/time/resolve.js';
import { rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

describe('Memory Recall & BM25-lite (§6)', () => {
  const testDataDir = './test_data_recall';
  const tz = 'Asia/Kolkata';
  const now = DateTime.fromISO('2026-11-11T14:05:00', { zone: tz });
  let store: SessionStore;

  beforeEach(() => {
    try {
      rmSync(testDataDir, { recursive: true, force: true });
    } catch {}
    mkdirSync(join(testDataDir, 'sessions'), { recursive: true });
    store = new SessionStore(testDataDir);
  });

  it('ranks documents using BM25-lite correctly', () => {
    const tokens = tokenize('crm pricing hubspot');
    const docs = [
      { id: 'doc1', text: 'We shortlisted CRM tools like HubSpot and Salesforce with pricing details' },
      { id: 'doc2', text: 'Discussing postgres database hosting options and backups' },
    ];
    const scored = rankBM25Lite(tokens, docs);
    expect(scored[0].id).toBe('doc1');
    expect(scored[0].score).toBeGreaterThan(scored[1].score);
  });

  it('returns status: none with archive summary when no matching sessions exist', () => {
    const timeRes = resolve('On Monday we shortlisted 5 CRM tools', now, tz);
    const recall = assembleRecall('On Monday we shortlisted 5 CRM tools', timeRes, now, tz, store);
    expect(recall.status).toBe('none');
    expect(recall.block).toContain('<recall>');
    expect(recall.block).toContain('status: none');
    expect(recall.block).toContain('archive: 0 sessions');
    expect(recall.block).toContain('</recall>');
  });

  it('recalls past session, rewrites old citations to (a1), (a2) under then-sources', () => {
    // Seed a session from Tue 3 Nov 2026 15:20
    const pastSession: Session = {
      id: 'session-3-nov',
      uid: 'user-1',
      title: 'Postgres hosting options',
      createdAt: '2026-11-03T15:20:00+05:30',
      updatedAt: '2026-11-03T15:25:00+05:30',
      messages: [
        {
          id: 'm1',
          role: 'user',
          content: 'What are good Postgres hosting options?',
          ts: '2026-11-03T15:20:00+05:30',
        },
        {
          id: 'm2',
          role: 'assistant',
          content: 'Here are the top options: AWS RDS, Supabase, and Neon.',
          ts: '2026-11-03T15:21:00+05:30',
          sources: [
            { n: 1, title: 'AWS RDS', url: 'https://aws.amazon.com/rds', domain: 'aws.amazon.com', publishedAt: null, kind: 'primary' },
            { n: 2, title: 'Neon Postgres', url: 'https://neon.tech', domain: 'neon.tech', publishedAt: null, kind: 'primary' },
          ],
        },
      ],
    };
    store.saveSession(pastSession);

    const query = 'Last Tuesday I asked you about Postgres hosting. Has any pricing changed since then?';
    const timeRes = resolve(query, now, tz);
    const recall = assembleRecall(query, timeRes, now, tz, store);

    expect(recall.status).toBe('matched');
    expect(recall.matchedSessions.length).toBe(1);
    expect(recall.block).toContain('status: matched');
    expect(recall.block).toContain('--- session Tue 3 Nov 2026 15:20 · Postgres hosting options ---');
    expect(recall.block).toContain('User: What are good Postgres hosting options?');
    expect(recall.block).toContain('then-sources: (a1) https://aws.amazon.com/rds (a2) https://neon.tech');
  });
});

