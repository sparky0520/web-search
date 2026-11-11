import { config } from '../config.js';
import { SearchProvider, SingleSearchQuery, RawSearchResult } from './provider.js';
import { searchCache } from './cache.js';

interface TavilyApiResponse {
  results?: Array<{
    title: string;
    url: string;
    content: string;
    score?: number;
    published_date?: string;
  }>;
}

export class TavilySearchProvider implements SearchProvider {
  private apiKey: string;
  private endpoint = 'https://api.tavily.com/search';

  constructor(apiKey: string = config.TAVILY_API_KEY) {
    this.apiKey = apiKey;
  }

  public async search(params: SingleSearchQuery): Promise<RawSearchResult[]> {
    const cacheKey = `tavily:${JSON.stringify(params)}`;
    const cached = searchCache.get<RawSearchResult[]>(cacheKey);
    if (cached) {
      return cached;
    }

    const topic = params.news ? 'news' : 'general';
    const body: Record<string, unknown> = {
      query: params.query,
      search_depth: 'basic',
      topic,
      max_results: 3,
      auto_parameters: false,
    };

    if (params.domains && params.domains.length > 0) {
      body.include_domains = params.domains;
    }

    if (params.since) {
      body.start_date = params.since;
    }

    // 6 second timeout per single search
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);

    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Tavily API responded with ${response.status}: ${errorText}`);
      }

      const data = (await response.json()) as TavilyApiResponse;
      const rawResults = data.results || [];

      const mapped: RawSearchResult[] = rawResults.map((r) => ({
        title: r.title || 'Untitled',
        url: r.url,
        content: r.content || '',
        // published_date is only trusted if topic is news
        publishedDate: params.news && r.published_date ? r.published_date.slice(0, 10) : undefined,
        score: r.score,
      }));

      searchCache.set(cacheKey, mapped);
      return mapped;
    } catch (err) {
      clearTimeout(timeoutId);
      throw err;
    }
  }
}

export const defaultSearchProvider = new TavilySearchProvider();
