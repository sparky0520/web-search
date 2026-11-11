# Non-Negotiables & Hard Constraints

## Hard Constraints
- **Platform**: TypeScript on Node 20+. `npm install` then `npm run dev` works from a clean clone across macOS, Windows, and Linux. No native modules, Docker, global installs, dev build step, or shell-only scripts.
- **Keys**: Exactly two keys in total (one LLM, one search: `LLM_API_KEY`, `TAVILY_API_KEY`), both listed in `.env.example`.
- **Tools**: The model sees exactly ONE tool: `web_search`. Recall of earlier chats is deterministic context assembly in code, never a tool.
- **Repository & Docs**: Public GitHub repo with a one-page `DESIGN.md` (~500 words).
- **Code Quality**: Every decision must be explainable. Small, readable code with comments explaining *why*.
- **Dependency Budget**: At most 8 runtime dependencies, each one justified.
- **Free-Tier Friendly**: OpenAI-compatible LLM endpoint (OpenRouter by default); Tavily free plan for search (basic search depth, 1 credit per query, never enable auto_parameters).

## Do Not Build
- Do not use LangChain, LangGraph, or the Vercel AI SDK.
- Do not build multi-agent architectures, planners, or critic passes.
- Do not use a vector DB or embeddings (date-anchored + BM25-lite keyword overlap in code).
- Do not build accounts or authentication (use anonymous `uid` cookie / header override).
- Do not build Docker or deployment scripts.
- Do not expose extra model-facing tools (no fetch, no recall, no calculator).
- Do not make LLM calls for session titles, summaries, or post-generation critiques.
- Do not use a frontend bundler (Webpack, Vite), CDN, or UI framework (React, Vue). Pure static vanilla HTML/CSS/JS with vendor files served directly.
- Do not build a claims ledger.
- Do not hardcode model slugs or API keys.

