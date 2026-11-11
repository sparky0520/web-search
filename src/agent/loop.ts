import OpenAI from 'openai';
import { EventEmitter, Timings, Usage } from './events.js';
import { LlmClient, llmClient } from './llm.js';
import { WEB_SEARCH_TOOL_DEFINITION, WebSearchTool, defaultWebSearchTool, webSearchArgsSchema } from '../search/tool.js';
import { RankedSource } from '../search/rank.js';

export interface LoopResult {
  finalText: string;
  accumulatedSources: RankedSource[];
  usage: Usage;
  timings: Partial<Timings>;
  invalidCitations: number[];
  modelUsed: string;
}

export async function runAgentLoop(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  emit: EventEmitter,
  options: {
    client?: LlmClient;
    searchTool?: WebSearchTool;
    signal?: AbortSignal;
    startTime: number;
    initialTimings?: Partial<Timings>;
  }
): Promise<LoopResult> {
  const client = options.client || llmClient;
  const searchTool = options.searchTool || defaultWebSearchTool;
  const startTime = options.startTime;
  const timings: Partial<Timings> = { ...options.initialTimings };

  const accumulatedSources: RankedSource[] = [];
  let totalSearchesCount = 0;
  let searchRoundsCount = 0;
  let llmCallsCount = 0;
  let toolArgsValidationRetries = 0;
  let modelUsedFinal = '';

  const activeMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [...messages];
  let finalText = '';

  // Hard cap: max 3 LLM calls per turn
  while (llmCallsCount < 3) {
    llmCallsCount++;

    // Determine whether web_search tool is offered
    const budgetExhausted = searchRoundsCount >= 2 || totalSearchesCount >= 10;
    const toolChoice = budgetExhausted ? 'none' : 'auto';

    const { stream, modelUsed } = await client.createStream(
      {
        messages: activeMessages,
        tools: [WEB_SEARCH_TOOL_DEFINITION],
        tool_choice: toolChoice,
      },
      emit,
      options.signal
    );
    modelUsedFinal = modelUsed;

    let roundText = '';
    const toolCallDeltas: Map<number, { id: string; name: string; arguments: string }> = new Map();

    for await (const chunk of stream) {
      if (options.signal?.aborted) {
        throw new Error('Aborted by client');
      }

      const choice = chunk.choices[0];
      if (!choice) continue;

      const delta = choice.delta;

      // Track first token timing
      if (delta.content && timings.firstTokenMs === undefined) {
        timings.firstTokenMs = Date.now() - startTime;
      }

      // Stream text delta
      if (delta.content) {
        roundText += delta.content;
        emit({ type: 'delta', text: delta.content });
      }

      // Accumulate tool calls
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index;
          const existing = toolCallDeltas.get(idx) || { id: '', name: '', arguments: '' };
          if (tc.id) existing.id = tc.id;
          if (tc.function?.name) existing.name = tc.function.name;
          if (tc.function?.arguments) existing.arguments += tc.function.arguments;
          toolCallDeltas.set(idx, existing);
        }
      }
    }

    // Text-based tool call fallback for models emitting XML-like calls in text (e.g. Nemotron/Llama)
    if (toolCallDeltas.size === 0 && roundText.includes('<tool_call>') && roundText.includes('web_search')) {
      const paramMatch =
        roundText.match(/<parameter=searches>\s*([\s\S]*?)\s*<\/parameter>/i) ||
        roundText.match(/<tool_call>[\s\S]*?({[\s\S]*?})[\s\S]*?<\/tool_call>/i);
      if (paramMatch) {
        try {
          const raw = paramMatch[1].trim();
          let parsedObj = raw.startsWith('[') ? { searches: JSON.parse(raw) } : JSON.parse(raw);
          toolCallDeltas.set(0, {
            id: `call_${Date.now()}`,
            name: 'web_search',
            arguments: JSON.stringify(parsedObj),
          });
        } catch {
          // Ignore invalid parse
        }
      }
    }

    // If search budget was already exhausted, ignore any attempted tool calls
    if (budgetExhausted && toolCallDeltas.size > 0) {
      toolCallDeltas.clear();
      if (!roundText.trim()) {
        activeMessages.push({
          role: 'user',
          content: 'Search budget exhausted. Please synthesize your final answer using the search results gathered above.',
        });
        continue;
      }
    }

    // Check if this round produced tool calls
    if (toolCallDeltas.size > 0) {
      // Discard any preamble text produced before tool calls
      if (roundText.length > 0) {
        emit({ type: 'reset' });
      }

      searchRoundsCount++;
      const toolCall = Array.from(toolCallDeltas.values())[0];

      // Parse and validate arguments with Zod
      let parsedArgs: unknown;
      let parseError: string | null = null;
      try {
        parsedArgs = JSON.parse(toolCall.arguments);
      } catch {
        parseError = 'Invalid JSON in tool call arguments.';
      }

      if (!parseError) {
        const validation = webSearchArgsSchema.safeParse(parsedArgs);
        if (!validation.success) {
          parseError = `Schema validation failed: ${validation.error.message}`;
        } else {
          parsedArgs = validation.data;
        }
      }

      if (parseError) {
        toolArgsValidationRetries++;
        if (toolArgsValidationRetries >= 2) {
          // Second failure: proceed to answer without search
          activeMessages.push({
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: toolCall.id,
                type: 'function',
                function: { name: toolCall.name, arguments: toolCall.arguments },
              },
            ],
          });
          activeMessages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: 'Search failed due to invalid arguments. Please answer without search.',
          });
          continue;
        }

        // Return error to model once
        activeMessages.push({
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: toolCall.id,
              type: 'function',
              function: { name: toolCall.name, arguments: toolCall.arguments },
            },
          ],
        });
        activeMessages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: `Error: ${parseError}. Please retry web_search with valid schema.`,
        });
        continue;
      }

      // Valid args: execute web_search
      const typedArgs = parsedArgs as { searches: Array<{ query: string; since?: string; domains?: string[]; news?: boolean }> };

      // Emit search event
      emit({ type: 'search', queries: typedArgs.searches });
      if (timings.firstSearchStartMs === undefined) {
        timings.firstSearchStartMs = Date.now() - startTime;
      }

      const execResult = await searchTool.execute(typedArgs, totalSearchesCount, 10);
      totalSearchesCount += execResult.totalSearchesRun;
      timings.searchDoneMs = Date.now() - startTime;

      // Accumulate sources with offset numbering
      const offset = accumulatedSources.length;
      const renumberedSources: RankedSource[] = execResult.sources.map((s, idx) => ({
        ...s,
        n: offset + idx + 1,
      }));
      accumulatedSources.push(...renumberedSources);

      // Emit sources event
      if (renumberedSources.length > 0) {
        emit({
          type: 'sources',
          items: renumberedSources.map((s) => ({
            n: s.n,
            title: s.title,
            url: s.url,
            domain: s.domain,
            publishedAt: s.publishedAt,
            kind: s.kind,
          })),
        });
      }

      // Append assistant tool call and tool response to conversation
      activeMessages.push({
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: toolCall.id,
            type: 'function',
            function: { name: toolCall.name, arguments: toolCall.arguments },
          },
        ],
      });
      activeMessages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: execResult.output,
      });

      // Continue to next model call
      continue;
    }

    // No tool calls: final answer achieved!
    finalText = roundText;
    break;
  }

  // Validate citations in finalText against accumulatedSources
  const validNumbers = new Set(accumulatedSources.map((s) => s.n));
  const citedMatches = finalText.matchAll(/\[(\d+)\]/g);
  const invalidCitations: number[] = [];

  for (const m of citedMatches) {
    const num = parseInt(m[1], 10);
    if (!validNumbers.has(num) && !invalidCitations.includes(num)) {
      invalidCitations.push(num);
    }
  }

  return {
    finalText,
    accumulatedSources,
    usage: {
      llmCalls: llmCallsCount,
      totalSearches: totalSearchesCount,
    },
    timings,
    invalidCitations,
    modelUsed: modelUsedFinal,
  };
}

