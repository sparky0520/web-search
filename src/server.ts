import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from './config.js';
import { sessionStore } from './memory/store.js';
import { runTurn } from './agent/run.js';
import { AgentEvent } from './agent/events.js';

type Variables = {
  uid: string;
};

const app = new Hono<{ Variables: Variables }>();
const activeSessions = new Set<string>();

// Middleware: Anonymous UID resolution (header override for evals, or cookie)
app.use('*', async (c, next) => {
  const headerUid = c.req.header('x-user-id');
  if (headerUid) {
    c.set('uid', headerUid);
    await next();
    return;
  }

  const cookieHeader = c.req.header('cookie') || '';
  const match = cookieHeader.match(/\buid=([a-zA-Z0-9_-]+)/);
  let uid = match ? match[1] : '';

  if (!uid) {
    uid = randomUUID();
    c.header('Set-Cookie', `uid=${uid}; Path=/; HttpOnly; SameSite=Lax`);
  }
  c.set('uid', uid);
  await next();
});

// Health check
app.get('/api/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// List sessions for user
app.get('/api/sessions', (c) => {
  const uid = c.get('uid') as string;
  const sessions = sessionStore.listSessions(uid);
  return c.json({ sessions });
});

// Get individual session
app.get('/api/sessions/:id', (c) => {
  const session = sessionStore.getSession(c.req.param('id'));
  if (!session) {
    return c.json({ error: 'Session not found' }, 404);
  }
  return c.json(session);
});

// Vendor script delivery (direct from node_modules, no CDN / bundler)
app.get('/vendor/marked.js', (c) => {
  const p = join(process.cwd(), 'node_modules', 'marked', 'marked.min.js');
  c.header('Content-Type', 'application/javascript');
  return c.body(readFileSync(p, 'utf-8'));
});

app.get('/vendor/purify.js', (c) => {
  const p = join(process.cwd(), 'node_modules', 'dompurify', 'dist', 'purify.min.js');
  c.header('Content-Type', 'application/javascript');
  return c.body(readFileSync(p, 'utf-8'));
});

// SSE Chat Endpoint
app.post('/api/chat', async (c) => {
  const uid = c.get('uid') as string;
  let body: { message?: string; sessionId?: string; tz?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const message = body.message?.trim();
  if (!message) {
    return c.json({ error: 'Message cannot be empty' }, 400);
  }

  const sessionId = body.sessionId || randomUUID();
  const tz = body.tz || 'Asia/Kolkata';

  // Concurrency guard: one turn at a time per session
  if (activeSessions.has(sessionId)) {
    return c.json({ error: 'A turn is already in progress for this session.' }, 409);
  }

  activeSessions.add(sessionId);

  return streamSSE(c, async (stream) => {
    const abortController = new AbortController();
    c.req.raw.signal.addEventListener('abort', () => {
      abortController.abort();
    });

    const eventQueue: AgentEvent[] = [];
    let resolveWait: (() => void) | null = null;
    let turnDone = false;

    const notify = () => {
      if (typeof resolveWait === 'function') {
        const cb = resolveWait;
        resolveWait = null;
        cb();
      }
    };

    const emit = (event: AgentEvent) => {
      eventQueue.push(event);
      notify();
    };

    // Run the agent turn asynchronously
    const turnPromise = (async () => {
      try {
        console.log(`\n💬 [Chat] Processing message for session ${sessionId}: "${message.slice(0, 50)}..."`);
        await runTurn(
          {
            sessionId,
            message,
            tz,
            uid,
            signal: abortController.signal,
          },
          emit
        );
        console.log(`✅ [Chat] Turn completed successfully for session ${sessionId}`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`❌ [Chat Error] Turn failed for session ${sessionId}:`, msg);
        if (!eventQueue.some((e) => e.type === 'error')) {
          emit({ type: 'error', code: 'TURN_ERROR', message: msg });
        }
      } finally {
        turnDone = true;
        notify();
      }
    })();

    try {
      while (!turnDone || eventQueue.length > 0) {
        if (eventQueue.length === 0) {
          await new Promise<void>((r) => {
            resolveWait = r;
          });
        }

        while (eventQueue.length > 0) {
          const ev = eventQueue.shift()!;
          await stream.writeSSE({
            event: ev.type,
            data: JSON.stringify(ev),
          });
        }
      }
      await turnPromise;
    } finally {
      activeSessions.delete(sessionId);
    }
  });
});

// Static assets from public/
app.get('/', (c) => {
  const htmlPath = join(process.cwd(), 'public', 'index.html');
  c.header('Content-Type', 'text/html; charset=utf-8');
  return c.body(readFileSync(htmlPath, 'utf-8'));
});

app.get('/app.js', (c) => {
  const jsPath = join(process.cwd(), 'public', 'app.js');
  c.header('Content-Type', 'application/javascript; charset=utf-8');
  return c.body(readFileSync(jsPath, 'utf-8'));
});

app.get('/styles.css', (c) => {
  const cssPath = join(process.cwd(), 'public', 'styles.css');
  c.header('Content-Type', 'text/css; charset=utf-8');
  return c.body(readFileSync(cssPath, 'utf-8'));
});

// Boot server
if (process.env.NODE_ENV !== 'test') {
  console.log(`\n🚀 Web Search Agent server starting on http://localhost:${config.PORT}`);
  serve({
    fetch: app.fetch,
    port: config.PORT,
  });
}

export default app;
