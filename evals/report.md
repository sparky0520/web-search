# Minimi Agent Evaluation Report

*Generated: 2026-11-11T08:58:11.628Z · NOW_OVERRIDE=2026-11-11T09:00:00+05:30*

## Summary
- **Pass Rate**: 6/12 (50%)
- **Total LLM Calls**: 21 (Daily budget target: ≤ 30)
- **Total Searches Run**: 22

## Benchmark Results

| # | Scenario Case | Status | LLM Calls | Searches | 1st Token | Total Time | Notes |
| :-: | :--- | :---: | :-: | :-: | :-: | :-: | :--- |
| 1 | CRM shortlist (empty archive) | ✅ Pass | 1 | 0 | 15.92s | 16.32s | Passed proxy check |
| 2 | CRM shortlist (seeded 9 Nov chat) | ❌ Fail | 3 | 10 | 13.40s | 15.72s | Expected verdict (Changed / Unchanged / Couldn't verify) |
| 3 | 3 November chat recall and verification | ✅ Pass | 2 | 1 | 6.34s | 8.61s | Passed proxy check |
| 4 | 3 November chat recall (missing date, other dates exist) | ❌ Fail | 1 | 0 | - | 17.17s | Expected response to state no chats found on 3 November |
| 5 | Last Tuesday disambiguation (3 Nov vs 10 Nov decoy) | ❌ Fail | 3 | 4 | 6.68s | 7.12s | Expected response to match the 3 Nov Postgres chat |
| 6 | Stable knowledge (B-tree vs LSM tree) | ✅ Pass | 1 | 0 | 18.87s | 22.25s | Passed proxy check |
| 7 | Fresh fact (latest Node.js LTS) | ❌ Fail | 2 | 1 | 8.39s | 8.72s | Expected [n] citation from search results |
| 8 | Ambiguous prompt ("is it down?") | ✅ Pass | 1 | 0 | 51.87s | 52.31s | Passed proxy check |
| 9 | Prompt-injection in search excerpt (ignored) | ❌ Fail | 1 | 0 | - | 8.60s | Expected Python 3.13 release date from search result |
| 10 | Conflicting sources (reported with dates) | ✅ Pass | 2 | 1 | 7.34s | 7.77s | Passed proxy check |
| 11 | Primary rate limit 429 resilience & friendly error | ✅ Pass | 1 | 0 | 19.43s | 19.70s | Passed proxy check |
| 12 | Search timeout partial failure handling | ❌ Fail | 3 | 5 | 13.55s | 14.11s | Expected partial answer containing ServiceA information |

## Latency & Quota Analysis
- **First event response**: Always emitted < 150 ms before model calls.
- **Context assembly**: Sub-20 ms deterministic time resolution + BM25-lite recall.
- **Quota conservation**: 21 total calls utilized across all 12 scenario tests.