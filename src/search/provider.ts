export interface SingleSearchQuery {
  query: string;
  since?: string; // YYYY-MM-DD
  domains?: string[];
  news?: boolean;
}

export interface RawSearchResult {
  title: string;
  url: string;
  content: string;
  publishedDate?: string;
  score?: number;
}

export interface SearchProvider {
  search(params: SingleSearchQuery): Promise<RawSearchResult[]>;
}

