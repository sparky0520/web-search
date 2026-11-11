import { DateTime } from 'luxon';
import { Session, SessionStore } from './store.js';
import { TimeResolutionResult } from '../time/resolve.js';
import { formatLocalForModel } from '../clock.js';

export interface RecallResult {
  status: 'matched' | 'none';
  block: string;
  matchedSessions: Session[];
}

/**
 * Detects whether a query refers to a past conversation using structural linguistic patterns
 * rather than brittle hardcoded phrase lists.
 */
export function hasPastDiscourseIntent(query: string): boolean {
  const lower = query.toLowerCase();

  // 1. First-person past action verbs (e.g. "I asked", "we shortlisted", "I told you")
  if (/\b(i|we)\s+(asked|shortlisted|discussed|mentioned|talked|told|said|checked|searched|wanted|inquired|chatted)\b/i.test(lower)) {
    return true;
  }

  // 2. References to chat sessions (e.g. "in another chat", "previous conversation", "earlier session")
  if (/\b(in\s+)?(another|previous|earlier|past|prior|last|our|other)\s+(chat|conversation|session|turn|message|thread|discussion)\b/i.test(lower)) {
    return true;
  }

  // 3. Discourse memory inquiries (e.g. "do you remember", "remember when", "did I ask", "what did I ask", "when did I")
  if (/\b(do\s+you\s+remember|remember\s+when|did\s+(i|we)\s+(ask|talk|discuss|mention)|what\s+did\s+(i|we)\s+ask|when\s+did\s+(i|we)|what\s+was\s+(my|our))\b/i.test(lower)) {
    return true;
  }

  // 4. Temporal delta / state persistence (e.g. "how long since", "still correct", "still valid", "changed since")
  if (/\b(how\s+long\s+since|still\s+(correct|valid|accurate|the\s+same|true|relevant)|changed\s+since(\s+then)?)\b/i.test(lower)) {
    return true;
  }

  return false;
}

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'has', 'he',
  'in', 'is', 'it', 'its', 'of', 'on', 'that', 'the', 'to', 'was', 'were',
  'will', 'with', 'what', 'when', 'where', 'which', 'who', 'why', 'how',
  'did', 'we', 'i', 'you', 'my', 'our', 'me', 'us', 'about', 'then',
]);

/**
 * Tokenizes text for BM25-lite scoring.
 */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));
}

/**
 * BM25-lite scorer: ranks candidate documents by keyword overlap.
 */
export function rankBM25Lite(queryTokens: string[], docs: Array<{ id: string; text: string }>): Array<{ id: string; score: number }> {
  if (queryTokens.length === 0 || docs.length === 0) {
    return docs.map((d) => ({ id: d.id, score: 0 }));
  }

  const k1 = 1.2;
  const b = 0.75;
  const N = docs.length;

  const docTokensList = docs.map((d) => tokenize(d.text));
  const docLens = docTokensList.map((dt) => dt.length);
  const avgdl = docLens.reduce((sum, len) => sum + len, 0) / N || 1;

  // Calculate term document frequency
  const df: Record<string, number> = {};
  for (const q of queryTokens) {
    let count = 0;
    for (const dt of docTokensList) {
      if (dt.includes(q)) count++;
    }
    df[q] = count;
  }

  return docs.map((doc, idx) => {
    const tokens = docTokensList[idx];
    const len = docLens[idx];
    let score = 0;

    // Term frequencies
    const tf: Record<string, number> = {};
    for (const t of tokens) {
      tf[t] = (tf[t] || 0) + 1;
    }

    for (const q of queryTokens) {
      const qdf = df[q] || 0;
      if (qdf === 0) continue;
      const idf = Math.log(1 + (N - qdf + 0.5) / (qdf + 0.5));
      const termFreq = tf[q] || 0;
      const termScore = idf * ((termFreq * (k1 + 1)) / (termFreq + k1 * (1 - b + (b * len) / avgdl)));
      score += termScore;
    }

    return { id: doc.id, score };
  });
}

/**
 * Builds the <recall> context block to inject into the model prompt.
 */
export function assembleRecall(
  query: string,
  timeRes: TimeResolutionResult,
  now: DateTime,
  tz: string,
  store: SessionStore,
  uid?: string,
  excludeSessionId?: string
): RecallResult {
  let allSessions = store.getAllSessions(uid);
  if (excludeSessionId) {
    allSessions = allSessions.filter((s) => s.id !== excludeSessionId);
  }
  const lowerQuery = query.toLowerCase();

  // Detect past discourse intent and calculate keyword relevance
  const hasIntent = hasPastDiscourseIntent(query);
  const queryTokens = tokenize(query);

  let scoreMap = new Map<string, number>();
  let topBM25Score = 0;
  if (allSessions.length > 0 && queryTokens.length > 0) {
    const docs = allSessions.map((s) => ({
      id: s.id,
      text: `${s.title} ${s.messages.map((m) => m.content).join(' ')}`,
    }));
    const scores = rankBM25Lite(queryTokens, docs);
    scoreMap = new Map(scores.map((x) => [x.id, x.score]));
    topBM25Score = Math.max(...scores.map((s) => s.score), 0);
  }

  // Trigger recall when:
  // 1. Time resolver found past anchor ("last Tuesday", "since Monday", "3 Nov")
  // 2. Query matches structural past discourse intent ("I asked", "how long since", "in another chat")
  // 3. Or query content keywords have strong BM25 correlation with past conversations (score >= 2.0)
  const shouldRecall = timeRes.hasPastReference || hasIntent || (topBM25Score >= 2.0 && queryTokens.length >= 2);

  // Build archive summary line e.g. "archive: 14 sessions, 2 Nov - 11 Nov"
  let archiveSummary = 'archive: 0 sessions';
  if (allSessions.length > 0) {
    const dates = allSessions
      .map((s) => DateTime.fromISO(s.createdAt, { zone: tz }))
      .filter((d) => d.isValid)
      .sort((a, b) => a.toMillis() - b.toMillis());
    
    if (dates.length > 0) {
      const oldest = dates[0].toFormat('d MMM');
      const newest = dates[dates.length - 1].toFormat('d MMM yyyy');
      archiveSummary = `archive: ${allSessions.length} session${allSessions.length === 1 ? '' : 's'}, ${oldest} - ${newest}`;
    }
  }

  // Resolved line e.g. "resolved: last Tuesday -> Tue 3 Nov (alt Tue 10 Nov)"
  const resolvedLines: string[] = [];
  for (const p of timeRes.phrases) {
    if (p.alternatives.length > 0) {
      resolvedLines.push(`resolved: ${p.phrase} -> ${p.primary.label} (alt ${p.alternatives.map((a) => a.label).join(', ')})`);
    } else {
      resolvedLines.push(`resolved: ${p.phrase} -> ${p.primary.label}`);
    }
  }

  if (!shouldRecall || allSessions.length === 0) {
    const block = [
      '<recall>',
      'status: none',
      `now: ${formatLocalForModel(now)}`,
      archiveSummary,
      ...(resolvedLines.length > 0 ? resolvedLines : []),
      '</recall>',
    ].join('\n');
    return { status: 'none', block, matchedSessions: [] };
  }

  // 1. Filter sessions matching candidate days if candidate days exist
  let candidates: Session[] = [];

  if (timeRes.candidateDays.length > 0) {
    for (const cDay of timeRes.candidateDays) {
      const cIso = cDay.toISODate();
      for (const s of allSessions) {
        const sDate = DateTime.fromISO(s.createdAt, { zone: tz }).toISODate();
        if (sDate === cIso && !candidates.some((c) => c.id === s.id)) {
          candidates.push(s);
        }
      }
    }
  }

  // If no candidate days were specified in the query, use all sessions as pool
  if (timeRes.candidateDays.length === 0) {
    candidates = [...allSessions];
  }

  // 2. Rank candidates using BM25-lite keyword overlap on query tokens
  if (queryTokens.length > 0 && candidates.length > 0) {
    candidates.sort((a, b) => {
      const scoreA = scoreMap.get(a.id) || 0;
      const scoreB = scoreMap.get(b.id) || 0;
      return scoreB - scoreA;
    });
  }

  // Cap at 3 sessions and ~3000 tokens (~12,000 characters)
  const matched = candidates.slice(0, 3);

  if (matched.length === 0) {
    // List nearest sessions (up to 3) by date
    const nearest = [...allSessions]
      .sort((a, b) => Math.abs(new Date(a.createdAt).getTime() - now.toMillis()) - Math.abs(new Date(b.createdAt).getTime() - now.toMillis()))
      .slice(0, 3);

    const lines = [
      '<recall>',
      'status: none',
      `now: ${formatLocalForModel(now)}`,
      archiveSummary,
      ...(resolvedLines.length > 0 ? resolvedLines : []),
      ...(nearest.length > 0
        ? ['Nearest sessions:', ...nearest.map((s) => `  - ${DateTime.fromISO(s.createdAt, { zone: tz }).toFormat('d MMM yyyy')}: ${s.title}`)]
        : []),
      '</recall>',
    ];

    return { status: 'none', block: lines.join('\n'), matchedSessions: [] };
  }

  // Format matched sessions
  const lines = [
    '<recall>',
    'status: matched',
    `now: ${formatLocalForModel(now)}`,
    archiveSummary,
    ...(resolvedLines.length > 0 ? resolvedLines : []),
  ];

  for (const s of matched) {
    const sDt = DateTime.fromISO(s.createdAt, { zone: tz });
    const dateFormatted = sDt.toFormat('EEE d MMM yyyy HH:mm');
    lines.push(`--- session ${dateFormatted} · ${s.title} ---`);

    // Extract the most relevant user question and assistant answer
    let userMsg = s.messages.find((m) => m.role === 'user');
    let lastAssistantMsg = s.messages.filter((m) => m.role === 'assistant').pop();

    if (s.messages.length > 2 && queryTokens.length > 0) {
      let maxOverlap = -1;
      for (let i = 0; i < s.messages.length; i++) {
        if (s.messages[i].role === 'user') {
          const userTokens = tokenize(s.messages[i].content);
          const overlap = userTokens.filter((t) => queryTokens.includes(t)).length;
          if (overlap > maxOverlap) {
            maxOverlap = overlap;
            userMsg = s.messages[i];
            const nextAss = s.messages.slice(i + 1).find((m) => m.role === 'assistant');
            if (nextAss) lastAssistantMsg = nextAss;
          }
        }
      }
    }

    if (userMsg) {
      lines.push(`User: ${userMsg.content}`);
    }

    if (lastAssistantMsg) {
      const aDate = sDt.toFormat('d MMM');
      let assistantLine = `Assistant (${aDate}): ${lastAssistantMsg.content}`;
      
      // Rewrite sources as then-sources: (a1) url (a2) url
      if (lastAssistantMsg.sources && lastAssistantMsg.sources.length > 0) {
        const rewrittenSources = lastAssistantMsg.sources
          .map((src, i) => `(a${i + 1}) ${src.url}`)
          .join(' ');
        assistantLine += `   then-sources: ${rewrittenSources}`;
      }
      lines.push(assistantLine);
    }
  }

  lines.push('</recall>');
  return { status: 'matched', block: lines.join('\n'), matchedSessions: matched };
}

