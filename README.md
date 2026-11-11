# Minimi Web-Search Chat Agent

A fast, resilient web-search chat agent built for the minimi challenge.
Deterministic code handles time resolution, memory recall, and search ranking; a single LLM loop handles judgment.

## Architecture
- **One tool**: Batched `web_search({ searches: [...] })` fans out parallel queries in a single round trip.
- **Two-lane temporal search**: Lane A checks primary source current state; Lane B checks news window with `since`.
- **Honest recall**: Deterministic BM25-lite keyword matching over past sessions; never fabricates history.
- **Zero build step**: Pure TypeScript on Node 20+, vanilla client with vendor assets served locally. Exactly 8 runtime dependencies.

## Setup & Running
1. Clone the repo and install dependencies:
```bash
npm install
```
2. Configure your keys:
```bash
cp .env.example .env
# Set LLM_API_KEY and TAVILY_API_KEY in .env
```
3. Start the application:
```bash
npm run dev
```
Open `http://localhost:3000` (or `http://localhost:3000/?debug=1` for the live trace).

## Commands
- `npm run dev`: Start dev server with watch mode
- `npm test`: Run unit tests (Vitest)
- `npm run typecheck`: Run TypeScript typechecking
- `npm run models`: Scan OpenRouter for free, tool-capable models
- `npm run eval`: Run deterministic scenario evaluation suite
