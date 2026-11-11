import { describe, it, expect } from 'vitest';

describe('Citation Validation (§10)', () => {
  function validateCitations(text: string, validSourceIds: number[]): { valid: number[]; invalid: number[] } {
    const validSet = new Set(validSourceIds);
    const matches = Array.from(text.matchAll(/\[(\d+)\]/g));
    const valid: number[] = [];
    const invalid: number[] = [];

    for (const m of matches) {
      const num = parseInt(m[1], 10);
      if (validSet.has(num)) {
        if (!valid.includes(num)) valid.push(num);
      } else {
        if (!invalid.includes(num)) invalid.push(num);
      }
    }

    return { valid, invalid };
  }

  it('identifies cited valid sources and catches hallucinated citations', () => {
    const text = 'HubSpot starts at $20/mo [1]. Salesforce is $25/mo [2]. Pipedrive is $14/mo [9]. Close is $49/mo [99].';
    const availableSources = [1, 2, 3];

    const result = validateCitations(text, availableSources);
    expect(result.valid).toEqual([1, 2]);
    expect(result.invalid).toEqual([9, 99]);
  });
});

