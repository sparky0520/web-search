import { randomUUID } from 'node:crypto';
import OpenAI from 'openai';
import { DateTime } from 'luxon';
import { EventEmitter, Timings } from './events.js';
import { getNow, formatDisplayDate } from '../clock.js';
import { resolve } from '../time/resolve.js';
import { assembleRecall } from '../memory/recall.js';
import { SessionStore, sessionStore, Session, ChatMessage } from '../memory/store.js';
import { buildSystemPrompt } from './prompt.js';
import { runAgentLoop } from './loop.js';
import { LlmClient } from './llm.js';
import { WebSearchTool } from '../search/tool.js';
import { appendTrace } from '../trace.js';

export interface RunTurnInput {
  sessionId?: string;
  message: string;
  tz?: string;
  uid?: string;
  signal?: AbortSignal;
  store?: SessionStore;
  client?: LlmClient;
  searchTool?: WebSearchTool;
  now?: DateTime;
}

export interface RunTurnOutput {
  sessionId: string;
  messageId: string;
  reply: string;
  sources: Array<{ n: number; title: string; url: string; domain: string; publishedAt: string | null; kind: string }>;
  timings: Timings;
  invalidCitations: number[];
}

export async function runTurn(input: RunTurnInput, emit: EventEmitter): Promise<RunTurnOutput> {
  const startTime = Date.now();
  const tz = input.tz || 'Asia/Kolkata';
  const now = input.now || getNow(tz);
  const store = input.store || sessionStore;
  const uid = input.uid || 'anonymous';

  // 1. Context Assembly (< 20ms)
  const contextStart = Date.now();
  const timeRes = resolve(input.message, now, tz);
  const recallRes = assembleRecall(input.message, timeRes, now, tz, store, uid);
  const contextBuildMs = Date.now() - contextStart;

  // Immediate first event within ~150 ms
  const firstEventMs = Date.now() - startTime;
  if (timeRes.assumptionLine) {
    emit({ type: 'status', text: timeRes.assumptionLine });
  } else if (recallRes.status === 'matched') {
    emit({ type: 'status', text: `Found ${recallRes.matchedSessions.length} saved chat${recallRes.matchedSessions.length === 1 ? '' : 's'} in archive` });
  } else {
    emit({ type: 'status', text: `Analyzing request (local time: ${now.toFormat('EEE d MMM yyyy, HH:mm')})` });
  }

  // 2. Prepare Session
  let session: Session | null = input.sessionId ? store.getSession(input.sessionId) : null;
  const isNewSession = !session;
  if (!session) {
    const newId = input.sessionId || randomUUID();
    const cleanTitle = input.message.replace(/\s+/g, ' ').trim().slice(0, 50);
    session = {
      id: newId,
      uid,
      title: cleanTitle || 'New Chat',
      createdAt: now.toUTC().toISO() || new Date().toISOString(),
      updatedAt: now.toUTC().toISO() || new Date().toISOString(),
      messages: [],
    };
  }

  // 3. Assemble Messages for the Model
  const systemPrompt = buildSystemPrompt(formatDisplayDate(now), tz);
  const modelMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: `${systemPrompt}\n\n${recallRes.block}` },
  ];

  // Include previous conversation turns (User and Assistant only, dropping raw tool payloads)
  for (const m of session.messages) {
    modelMessages.push({
      role: m.role,
      content: m.content,
    });
  }

  // Append new user message
  const userMsgId = randomUUID();
  const userMsg: ChatMessage = {
    id: userMsgId,
    role: 'user',
    content: input.message,
    ts: now.toUTC().toISO() || new Date().toISOString(),
  };
  session.messages.push(userMsg);
  modelMessages.push({ role: 'user', content: input.message });

  // 4. Run Agent Loop
  let loopResult;
  try {
    loopResult = await runAgentLoop(modelMessages, emit, {
      client: input.client,
      searchTool: input.searchTool,
      signal: input.signal,
      startTime,
      initialTimings: {
        firstEventMs,
        contextBuildMs,
      },
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    emit({ type: 'error', code: 'AGENT_ERROR', message: errorMsg });
    throw err;
  }

  const totalMs = Date.now() - startTime;
  const fullTimings: Timings = {
    firstEventMs,
    contextBuildMs,
    firstSearchStartMs: loopResult.timings.firstSearchStartMs,
    searchDoneMs: loopResult.timings.searchDoneMs,
    firstTokenMs: loopResult.timings.firstTokenMs,
    totalMs,
  };

  // 5. Persist Assistant Message
  const assistantMsgId = randomUUID();
  const assistantMsg: ChatMessage = {
    id: assistantMsgId,
    role: 'assistant',
    content: loopResult.finalText,
    ts: now.toUTC().toISO() || new Date().toISOString(),
    sources: loopResult.accumulatedSources.map((s) => ({
      n: s.n,
      title: s.title,
      url: s.url,
      domain: s.domain,
      publishedAt: s.publishedAt,
      kind: s.kind,
    })),
  };
  session.messages.push(assistantMsg);
  session.updatedAt = now.toUTC().toISO() || new Date().toISOString();
  store.saveSession(session);

  // 6. Append Trace JSONL (Observability)
  appendTrace({
    timestamp: now.toUTC().toISO() || new Date().toISOString(),
    sessionId: session.id,
    messageId: assistantMsgId,
    model: loopResult.modelUsed,
    usage: loopResult.usage,
    timings: fullTimings,
    invalidCitations: loopResult.invalidCitations,
  });

  // 7. Emit Done Event
  emit({
    type: 'done',
    sessionId: session.id,
    messageId: assistantMsgId,
    usage: loopResult.usage,
    timings: fullTimings,
    invalidCitations: loopResult.invalidCitations,
  });

  return {
    sessionId: session.id,
    messageId: assistantMsgId,
    reply: loopResult.finalText,
    sources: assistantMsg.sources || [],
    timings: fullTimings,
    invalidCitations: loopResult.invalidCitations,
  };
}

