import { describe, it, expect } from 'vitest';
import { WebSearchTool } from '../src/search/tool.js';
import { SearchProvider, RawSearchResult, SingleSearchQuery } from '../src/search/provider.js';

class MockSearchProvider implements SearchProvider {
  public callCount = 0;
  async search(params: SingleSearchQuery): Promise<RawSearchResult[]> {
    this.callCount++;
    return [{ title: `Result for ${params.query}`, url: `https://${params.query.replace(/\s+/g, '')}.com`, content: 'Content' }];
  }
}

describe('Search Budget Enforcement (§7 & §8)', () => {
  it('truncates search queries when remaining budget is less than requested', async () => {
    const provider = new MockSearchProvider();
    const tool = new WebSearchTool(provider);

    // Current turn count is 8, max is 10. Requesting 4 searches should only execute 2.
    const result = await tool.execute(
      {
        searches: [
          { query: 'crm1' },
          { query: 'crm2' },
          { query: 'crm3' },
          { query: 'crm4' },
        ],
      },
      8, // current count
      10 // max budget
    );

    expect(result.totalSearchesRun).toBe(2);
    expect(provider.callCount).toBe(2);
  });

  it('refuses to execute searches when budget is exhausted', async () => {
    const provider = new MockSearchProvider();
    const tool = new WebSearchTool(provider);

    const result = await tool.execute(
      { searches: [{ query: 'crm' }] },
      10, // already at limit
      10
    );

    expect(result.totalSearchesRun).toBe(0);
    expect(provider.callCount).toBe(0);
    expect(result.output).toContain('budget exhausted');
  });
});
