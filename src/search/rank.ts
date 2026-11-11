import { RawSearchResult, SingleSearchQuery } from './provider.js';

export type SourceKind = 'primary' | 'news' | 'review' | 'aggregator' | 'other';

export interface RankedSource {
  n: number;
  title: string;
  url: string;
  domain: string;
  publishedAt: string | null;
  kind: SourceKind;
  excerpt: string;
}

const REVIEW_AGGREGATOR_DOMAINS = new Set([
  'g2.com',
  'capterra.com',
  'trustradius.com',
  'getapp.com',
  'softwareadvice.com',
  'reddit.com',
  'producthunt.com',
  'techradar.com',
  'pcmag.com',
  'wikipedia.org',
]);

const NEWS_DOMAINS = new Set([
  'techcrunch.com',
  'theverge.com',
  'venturebeat.com',
  'reuters.com',
  'bloomberg.com',
  'wsj.com',
  'cnbc.com',
  'zdnet.com',
  'arstechnica.com',
  'wired.com',
]);

/**
 * Normalizes URL by removing common tracking parameters, hash fragments, and trailing slashes.
 */
export function normalizeUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    parsed.hash = '';

    const trackingParams = [
      'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
      'ref', 'fbclid', 'gclid', 'msclkid', 'source', 'trk',
    ];
    for (const p of trackingParams) {
      parsed.searchParams.delete(p);
    }

    let pathname = parsed.pathname;
    if (pathname.length > 1 && pathname.endsWith('/')) {
      pathname = pathname.slice(0, -1);
    }
    parsed.pathname = pathname;

    return parsed.toString();
  } catch {
    return rawUrl.trim();
  }
}

/**
 * Extracts normalized root domain (e.g. "hubspot.com" from "www.hubspot.com/pricing").
 */
export function extractDomain(url: string): string {
  try {
    const parsed = new URL(url);
    let host = parsed.hostname.toLowerCase();
    if (host.startsWith('www.')) {
      host = host.slice(4);
    }
    return host;
  } catch {
    return 'unknown';
  }
}

/**
 * Determines the kind of source based on domain and search query.
 */
export function classifySourceKind(domain: string, query: string, isNewsLane: boolean): SourceKind {
  const queryLower = query.toLowerCase();
  const domainLower = domain.toLowerCase();
  const domainBase = domainLower.split('.')[0] || domainLower;

  // Primary: if the domain matches an entity mentioned in the query
  const queryWords = queryLower.replace(/[^\w\s]/g, ' ').split(/\s+/).filter((w) => w.length > 2);
  const matchesEntity = queryWords.some((w) => domainBase.includes(w) || (w.length > 3 && domainBase.startsWith(w.slice(0, 4))));

  if (matchesEntity) {
    return 'primary';
  }

  if (isNewsLane || NEWS_DOMAINS.has(domainLower)) {
    return 'news';
  }

  if (REVIEW_AGGREGATOR_DOMAINS.has(domainLower)) {
    return 'review';
  }

  return 'other';
}

/**
 * Truncates text cleanly to at most maxLen characters.
 */
export function truncateExcerpt(text: string, maxLen: number = 500): string {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= maxLen) {
    return cleaned;
  }
  return cleaned.slice(0, maxLen - 1) + '…';
}

/**
 * Deduplicates, filters max 2 per domain, categorizes, orders primary first, and truncates.
 */
export function rankAndFilterSources(
  queryResults: Array<{ query: SingleSearchQuery; results: RawSearchResult[] }>
): RankedSource[] {
  const seenUrls = new Set<string>();
  const domainCounts = new Map<string, number>();
  const allCandidates: Array<Omit<RankedSource, 'n'>> = [];

  for (const { query, results } of queryResults) {
    for (const item of results) {
      const normUrl = normalizeUrl(item.url);
      if (seenUrls.has(normUrl)) continue;
      seenUrls.add(normUrl);

      const domain = extractDomain(normUrl);
      const count = domainCounts.get(domain) || 0;
      if (count >= 2) continue; // max 2 per domain
      domainCounts.set(domain, count + 1);

      const kind = classifySourceKind(domain, query.query, Boolean(query.news));
      const excerpt = truncateExcerpt(item.content, 500);

      allCandidates.push({
        title: item.title,
        url: normUrl,
        domain,
        publishedAt: item.publishedDate || null,
        kind,
        excerpt,
      });
    }
  }

  // Sorting order: primary > news > other > review
  const kindPriority: Record<SourceKind, number> = {
    primary: 1,
    news: 2,
    other: 3,
    aggregator: 4,
    review: 5,
  };

  allCandidates.sort((a, b) => kindPriority[a.kind] - kindPriority[b.kind]);

  // Assign sequential [n] citations starting from 1
  return allCandidates.map((c, i) => ({
    n: i + 1,
    ...c,
  }));
}
