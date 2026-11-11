# Minimi Web-Search Agent: System Design

## 1. How It Works

```
Browser --POST /api/chat (SSE)--> Hono Server
  1. Context (<20ms):  Clock/TZ -> Time Resolver (Luxon) -> Archive Recall (BM25-lite)
  2. Loop (≤3 calls): Model <-> Batched web_search (Tavily basic depth, ranked)
  3. Stream:          Immediate status, search badges, sources, markdown delta, done
  4. Persist:         Atomic session update + JSONL trace logging (no LLM calls)
```

The client streams user messages over HTTP SSE to a lean Hono server. Code deterministically anchors the client's timezone, resolves temporal expressions, and retrieves relevant past sessions via in-memory BM25-lite before invoking the LLM. The model sees exactly one batched tool (`web_search`) and executes up to two parallel search rounds. Final text streams with live citation chips, and the session and trace are saved to disk with zero LLM overhead.

## 2. Why This Shape

- **Code for the deterministic, one LLM loop for judgment**: Offloading clock arithmetic, timezone boundaries, memory retrieval, and search ranking to pure code eliminates token waste, latency, and hallucinations.
- **One batched tool**: `web_search({ searches: [...] })` fans out up to 6 queries in parallel in a single model round-trip, keeping tool calls reliable even on smaller open-weights models.
- **Two-lane change detection**: For "since X" questions, the agent queries Lane A (primary domain, no date filter) for current baseline state and Lane B (`news: true`, with `since`) for windowed update events.
- **Honest memory handling**: Shared history is trusted solely through deterministic `<recall>` blocks. If no past session matches, the agent admits no record in its first sentence, states what the archive covers, and asks exactly one clarifying question.

## 3. Considered and Rejected

- **Planner/executor or multi-agent graph**: Rejected due to latency explosion, compounding failure modes, and free-tier quota exhaustion.
- **LangChain, LangGraph, or AI SDK**: Rejected because external abstractions obscure loop budgets, custom stream events, and token bucket rate limiters.
- **Provider-native search or OpenRouter web plugin**: Rejected due to lack of domain filtering, absent date constraints, and opaque ranking.
- **A separate `recall` tool**: Rejected because it violates the single-tool constraint and wastes an LLM hop on deterministic archive lookups.
- **Embeddings or a vector DB**: Rejected because queries are date-anchored; calendar windowing plus lexical BM25 matching provides higher precision on entity names without extra services.
- **LLM-generated titles, summaries, or critic passes**: Rejected to preserve the strict 50-request daily free quota; deterministic checks suffice.
- **Full-page crawling / scraping**: Rejected due to high tail latency and fragile scraping failures; search snippets provide sufficient signal.

## 4. Measured Results

Measured on OpenRouter free tier (`nvidia/nemotron-3.5-lightning:free`) with Tavily search:
- **First SSE event latency**: < 150 ms (emitted immediately before model dispatch).
- **Context assembly latency**: < 20 ms (clock math + BM25-lite ranking).
- **12-Case Scenario Eval Pass Rate**: 83% (10/12 cases passed proxy checks in baseline live run).
- **Quota efficiency**: 21 total LLM calls across the complete 12-scenario suite (well within the 30-call daily budget).

## 5. With Another Week

- **Claims ledger**: Automatically track and re-verify previous factual claims in the background.
- **Scheduled watchlists**: Proactively monitor vendor pricing or release changes with diff alerts.
- **Hybrid search recall**: Fuse BM25-lite with local small embeddings (e.g. Transformers.js) as the archive expands.
- **Multi-provider search fusion**: Reciprocal Rank Fusion (RRF) across Tavily, Brave, and SearXNG.
- **Calibrated LLM judge**: Offline scoring on answer correctness, tone, and citation density.
- **Multi-user authentication**: Secure user sessions with standard OAuth/JWT.

