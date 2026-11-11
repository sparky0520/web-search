import { describe, it, expect } from 'vitest';
import app from '../src/server.js';

describe('Server & SSE Framing (§10)', () => {
  it('GET /api/health returns 200 and ok status', async () => {
    const res = await app.request('/api/health');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('ok');
    expect(data.timestamp).toBeDefined();
  });

  it('serves vendor scripts marked.js and purify.js directly from node_modules', async () => {
    const markedRes = await app.request('/vendor/marked.js');
    expect(markedRes.status).toBe(200);
    expect(markedRes.headers.get('content-type')).toContain('javascript');

    const purifyRes = await app.request('/vendor/purify.js');
    expect(purifyRes.status).toBe(200);
    expect(purifyRes.headers.get('content-type')).toContain('javascript');
  });

  it('rejects POST /api/chat with empty or invalid JSON', async () => {
    const res = await app.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '' }),
    });
    expect(res.status).toBe(400);
  });
});

