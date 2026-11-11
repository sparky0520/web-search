import OpenAI from 'openai';
import { config } from '../config.js';
import { EventEmitter } from './events.js';

export class TokenBucket {
  private capacity: number;
  private tokens: number;
  private lastRefill: number;
  private refillRatePerMs: number;

  constructor(rpm: number = config.LLM_MAX_RPM) {
    this.capacity = rpm;
    this.tokens = rpm;
    this.lastRefill = Date.now();
    this.refillRatePerMs = rpm / 60000;
  }

  public async acquire(): Promise<void> {
    while (true) {
      const now = Date.now();
      const elapsed = now - this.lastRefill;
      this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillRatePerMs);
      this.lastRefill = now;

      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }

      // Wait until at least 1 token is available
      const needed = 1 - this.tokens;
      const waitMs = Math.ceil(needed / this.refillRatePerMs);
      await new Promise((resolve) => setTimeout(resolve, Math.max(50, waitMs)));
    }
  }
}

export const globalTokenBucket = new TokenBucket();

export class LlmClient {
  private primaryClient: OpenAI;
  private fallbackClient?: OpenAI;

  constructor() {
    this.primaryClient = new OpenAI({
      baseURL: config.LLM_BASE_URL,
      apiKey: config.LLM_API_KEY,
    });

    if (config.LLM_FALLBACK_BASE_URL && config.LLM_FALLBACK_API_KEY) {
      this.fallbackClient = new OpenAI({
        baseURL: config.LLM_FALLBACK_BASE_URL,
        apiKey: config.LLM_FALLBACK_API_KEY,
      });
    }
  }

  public async createStream(
    params: Omit<OpenAI.Chat.ChatCompletionCreateParamsStreaming, 'model' | 'stream'>,
    emit?: EventEmitter,
    signal?: AbortSignal
  ): Promise<{ stream: AsyncIterable<OpenAI.Chat.ChatCompletionChunk>; modelUsed: string }> {
    await globalTokenBucket.acquire();

    const callWithRetry = async (
      client: OpenAI,
      model: string,
      isFallback: boolean = false
    ): Promise<AsyncIterable<OpenAI.Chat.ChatCompletionChunk>> => {
      try {
        const payload: OpenAI.Chat.ChatCompletionCreateParamsStreaming = {
          ...params,
          model,
          stream: true,
          max_tokens: 2048,
          parallel_tool_calls: false,
        };

        return await client.chat.completions.create(payload, { signal });
      } catch (err: unknown) {
        const error = err as { status?: number; headers?: Record<string, string>; message?: string };
        const status = error.status;

        // Differentiate credit issue (402)
        if (status === 402) {
          throw new Error('LLM credit limit reached (HTTP 402). Please add credits to your provider account.');
        }

        // Retry once on 429, 5xx, or timeout
        const isRetryable = status === 429 || (status && status >= 500 && status < 600) || error.message?.includes('timeout');
        if (isRetryable && !isFallback) {
          let waitMs = 1500 + Math.random() * 1000;
          if (error.headers && error.headers['retry-after']) {
            const retryAfterSec = parseFloat(error.headers['retry-after']);
            if (!isNaN(retryAfterSec)) {
              waitMs = retryAfterSec * 1000 + Math.random() * 500;
            }
          }

          if (emit) {
            emit({
              type: 'status',
              text: `LLM rate limit or server issue (${status}). Retrying in ${Math.round(waitMs / 100) / 10}s...`,
            });
          }

          await new Promise((resolve) => setTimeout(resolve, waitMs));

          try {
            return await client.chat.completions.create(
              {
                ...params,
                model,
                stream: true,
                max_tokens: 2048,
                parallel_tool_calls: false,
              },
              { signal }
            );
          } catch (retryErr) {
            // If primary retry failed and fallback is available, proceed to fallback
            if (this.fallbackClient && config.LLM_FALLBACK_MODEL) {
              if (emit) {
                emit({
                  type: 'status',
                  text: `Switching to fallback model (${config.LLM_FALLBACK_MODEL})...`,
                });
              }
              return await callWithRetry(this.fallbackClient, config.LLM_FALLBACK_MODEL, true);
            }
            throw retryErr;
          }
        }

        // If not retryable or retry already failed, check fallback
        if (!isFallback && this.fallbackClient && config.LLM_FALLBACK_MODEL) {
          if (emit) {
            emit({
              type: 'status',
              text: `Switching to fallback model (${config.LLM_FALLBACK_MODEL})...`,
            });
          }
          return await callWithRetry(this.fallbackClient, config.LLM_FALLBACK_MODEL, true);
        }

        if (status === 429) {
          throw new Error('LLM rate limit or daily quota exceeded (HTTP 429). Please switch model or provider in .env.');
        }

        throw err;
      }
    };

    const stream = await callWithRetry(this.primaryClient, config.LLM_MODEL, false);
    return { stream, modelUsed: config.LLM_MODEL };
  }
}

export const llmClient = new LlmClient();
