import { describe, it, expect } from 'vitest';
import { normalizeUrl, extractDomain, classifySourceKind, truncateExcerpt, rankAndFilterSources } from '../src/search/rank.js';
import { RawSearchResult, SingleSearchQuery } from '../src/search/provider.js';

describe('Search Ranking & Deduplication (§7)', () => {
  it('normalizes URLs by stripping tracking parameters, hashes, and trailing slashes', () => {
    const raw = 'https://www.hubspot.com/pricing/?utm_source=google&utm_medium=cpc#table';
    expect(normalizeUrl(raw)).toBe('https://www.hubspot.com/pricing');
  });

  it('extracts root domain correctly', () => {
    expect(extractDomain('https://www.postgresql.org/docs/current/')).toBe('postgresql.org');
    expect(extractDomain('https://sub.domain.co.uk/path')).toBe('sub.domain.co.uk');
  });

  it('classifies source kind: primary if domain matches entity', () => {
    expect(classifySourceKind('hubspot.com', 'hubspot pricing plans', false)).toBe('primary');
    expect(classifySourceKind('g2.com', 'hubspot pricing plans', false)).toBe('review');
    expect(classifySourceKind('techcrunch.com', 'hubspot news', true)).toBe('news');
  });

  it('truncates excerpts to at most 500 characters', () => {
    const longText = 'a'.repeat(600);
    const truncated = truncateExcerpt(longText, 500);
    expect(truncated.length).toBe(500);
    expect(truncated.endsWith('…')).toBe(true);
  });

  it('deduplicates identical URLs and enforces max 2 per domain', () => {
    const query: SingleSearchQuery = { query: 'postgres hosting' };
    const rawResults: RawSearchResult[] = [
      { title: 'Doc 1', url: 'https://aws.amazon.com/rds/postgresql/', content: 'Content 1' },
      { title: 'Doc 2', url: 'https://aws.amazon.com/rds/aurora/', content: 'Content 2' },
      { title: 'Doc 3 (duplicate)', url: 'https://aws.amazon.com/rds/postgresql/?ref=1', content: 'Content 3' },
      { title: 'Doc 4 (3rd from domain)', url: 'https://aws.amazon.com/pricing/', content: 'Content 4' },
      { title: 'PostgreSQL Official', url: 'https://www.postgresql.org/', content: 'Content 5' },
    ];

    const ranked = rankAndFilterSources([{ query, results: rawResults }]);

    // PostgreSQL is primary so should come first
    expect(ranked[0].domain).toBe('postgresql.org');
    expect(ranked[0].kind).toBe('primary');

    // Domain aws.amazon.com should have at most 2 entries
    const awsEntries = ranked.filter((r) => r.domain === 'aws.amazon.com');
    expect(awsEntries.length).toBe(2);

    // Citations are sequentially numbered starting at 1
    expect(ranked.map((r) => r.n)).toEqual([1, 2, 3]);
  });
});

