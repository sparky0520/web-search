import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

// Load .env if present without needing external packages
function loadEnv(): void {
  const envPath = resolve(process.cwd(), '.env');
  if (!existsSync(envPath)) return;

  try {
    if (typeof (process as unknown as { loadEnvFile?: (path?: string) => void }).loadEnvFile === 'function') {
      (process as unknown as { loadEnvFile: (path?: string) => void }).loadEnvFile(envPath);
      return;
    }
  } catch {
    // If native loader errors or doesn't exist, use simple line parser
  }

  const content = readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (process.env[key] === undefined) {
      process.env[key] = val;
    }
  }
}

loadEnv();

const configSchema = z.object({
  LLM_BASE_URL: z.string().url().default('https://openrouter.ai/api/v1'),
  LLM_API_KEY: z.string().min(1, 'LLM_API_KEY is required in .env'),
  LLM_MODEL: z.string().min(1, 'LLM_MODEL is required in .env'),
  LLM_MAX_RPM: z.coerce.number().int().positive().default(15),
  LLM_FALLBACK_BASE_URL: z.string().url().optional().or(z.literal('')),
  LLM_FALLBACK_API_KEY: z.string().optional().or(z.literal('')),
  LLM_FALLBACK_MODEL: z.string().optional().or(z.literal('')),
  TAVILY_API_KEY: z.string().min(1, 'TAVILY_API_KEY is required in .env'),
  SEARCH_CACHE: z.enum(['off', 'record', 'replay']).default('off'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATA_DIR: z.string().default('./data'),
  NOW_OVERRIDE: z.string().optional().or(z.literal('')),
});

export type Config = z.infer<typeof configSchema>;

function parseConfig(): Config {
  const result = configSchema.safeParse(process.env);
  if (!result.success) {
    console.error('\n❌ Configuration Error: Missing or invalid environment variables in .env:');
    for (const issue of result.error.issues) {
      console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
    }
    console.error('\nPlease copy .env.example to .env and configure your keys.\n');
    process.exit(1);
  }
  return result.data;
}

export const config = parseConfig();

