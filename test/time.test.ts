import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import { resolve } from '../src/time/resolve.js';

describe('Time Resolver (§5 Semantics)', () => {
  const tz = 'Asia/Kolkata';
  // Wed 11 Nov 2026, 14:05 IST
  const now = DateTime.fromISO('2026-11-11T14:05:00', { zone: tz });

  it('resolves "yesterday" -> Tue 10 Nov 2026', () => {
    const res = resolve('What happened yesterday?', now, tz);
    expect(res.hasPastReference).toBe(true);
    const p = res.phrases.find((x) => x.phrase === 'yesterday');
    expect(p).toBeDefined();
    expect(p?.primary.start.toISODate()).toBe('2026-11-10');
    expect(p?.primary.kind).toBe('day');
  });

  it('resolves "2 days ago" -> Mon 9 Nov 2026', () => {
    const res = resolve('What did we discuss 2 days ago?', now, tz);
    expect(res.hasPastReference).toBe(true);
    const p = res.phrases.find((x) => x.phrase === '2 days ago');
    expect(p).toBeDefined();
    expect(p?.primary.start.toISODate()).toBe('2026-11-09');
  });

  it('resolves "on Monday we..." -> Mon 9 Nov, alt Mon 2 Nov', () => {
    const res = resolve('On Monday we shortlisted 5 CRM tools for a 20-person sales team.', now, tz);
    expect(res.hasPastReference).toBe(true);
    const p = res.phrases.find((x) => x.primary.start.weekday === 1);
    expect(p).toBeDefined();
    expect(p?.primary.start.toISODate()).toBe('2026-11-09');
    expect(p?.alternatives[0]?.start.toISODate()).toBe('2026-11-02');
  });

  it('resolves "last Tuesday" -> Tue 3 Nov (previous week), alt Tue 10 Nov', () => {
    const res = resolve('Last Tuesday I asked you about Postgres hosting.', now, tz);
    expect(res.hasPastReference).toBe(true);
    const p = res.phrases.find((x) => x.phrase.toLowerCase().includes('last tuesday'));
    expect(p).toBeDefined();
    expect(p?.primary.start.toISODate()).toBe('2026-11-03');
    expect(p?.alternatives[0]?.start.toISODate()).toBe('2026-11-10');
    expect(p?.assumptionDisclosure).toContain("Assuming 'last Tuesday' refers to Tue 3 Nov");
  });

  it('resolves "3 November" -> 3 Nov 2026 and "3 December" -> 3 Dec 2025', () => {
    const resNov = resolve('What did I ask you on 3 November?', now, tz);
    expect(resNov.hasPastReference).toBe(true);
    const pNov = resNov.phrases.find((x) => x.phrase.includes('3 November') || x.phrase.includes('3 november'));
    expect(pNov?.primary.start.toISODate()).toBe('2026-11-03');

    const resDec = resolve('Did we talk on 3 December?', now, tz);
    const pDec = resDec.phrases.find((x) => x.phrase.includes('3 December') || x.phrase.includes('3 december'));
    expect(pDec?.primary.start.toISODate()).toBe('2025-12-03');
  });

  it('resolves "since Monday" -> since=2026-11-09', () => {
    const res = resolve('Has any of them changed pricing since Monday?', now, tz);
    expect(res.hasPastReference).toBe(true);
    expect(res.sinceDate).toBe('2026-11-09');
  });

  it('resolves "last week" and "recently" as widened windows with disclosures', () => {
    const resLastWeek = resolve('What did we do last week?', now, tz);
    expect(resLastWeek.hasPastReference).toBe(true);
    expect(resLastWeek.assumptionLine).toContain("Assuming 'last week'");

    const resRecently = resolve('What was updated recently?', now, tz);
    expect(resRecently.hasPastReference).toBe(true);
    expect(resRecently.assumptionLine).toContain("Assuming 'recently'");
  });

  it('handles 00:30 IST as Wednesday locally (Tuesday in UTC)', () => {
    // 00:30 IST on 11 Nov 2026 is 19:00 UTC on 10 Nov 2026
    const earlyMorningIst = DateTime.fromISO('2026-11-11T00:30:00+05:30', { zone: tz });
    expect(earlyMorningIst.weekdayShort).toBe('Wed');
    expect(earlyMorningIst.startOf('day').toISODate()).toBe('2026-11-11');

    const res = resolve('What did we discuss yesterday?', earlyMorningIst, tz);
    // Yesterday from 11 Nov is 10 Nov
    const p = res.phrases.find((x) => x.phrase === 'yesterday');
    expect(p?.primary.start.toISODate()).toBe('2026-11-10');
  });
});
