interface OpenRouterModel {
  id: string;
  name: string;
  context_length: number;
  pricing: {
    prompt: string | number;
    completion: string | number;
  };
  supported_parameters?: string[];
  top_provider?: {
    max_completion_tokens?: number;
    is_moderated?: boolean;
  };
}

async function scanModels() {
  console.log('🔍 Fetching tool-capable models from OpenRouter API...\n');
  const url = 'https://openrouter.ai/api/v1/models?supported_parameters=tools';

  try {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Failed to fetch models: HTTP ${res.status}`);
    }

    const json = (await res.json()) as { data: OpenRouterModel[] };
    const allModels = json.data || [];

    // Filter free models (price is 0 or slug ends with :free)
    const freeToolModels = allModels.filter((m) => {
      const promptPrice = typeof m.pricing?.prompt === 'string' ? parseFloat(m.pricing.prompt) : m.pricing?.prompt || 0;
      const completionPrice = typeof m.pricing?.completion === 'string' ? parseFloat(m.pricing.completion) : m.pricing?.completion || 0;
      const isZeroCost = promptPrice === 0 && completionPrice === 0;
      const hasFreeSlug = m.id.endsWith(':free');
      return isZeroCost || hasFreeSlug;
    });

    console.log(`Found ${freeToolModels.length} free models supporting tool calls:\n`);
    console.log('ID'.padEnd(50) + 'CONTEXT'.padEnd(12) + 'NAME');
    console.log('-'.repeat(90));

    for (const m of freeToolModels) {
      const ctx = `${Math.round((m.context_length || 0) / 1024)}k`.padEnd(12);
      console.log(m.id.padEnd(50) + ctx + m.name);
    }

    console.log('\nTop Recommended Models for .env (free, fast, reliable tool callers):');
    const recommended = [
      'meta-llama/llama-3.3-70b-instruct:free',
      'google/gemini-2.0-flash-exp:free',
      'qwen/qwen-2.5-72b-instruct:free',
    ];

    for (const rec of recommended) {
      const exists = freeToolModels.some((m) => m.id === rec);
      console.log(` - ${rec} ${exists ? '(available)' : '(check OpenRouter status)'}`);
    }

    console.log('\nTo set a model, update LLM_MODEL in .env\n');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('Error fetching OpenRouter models:', msg);
    process.exit(1);
  }
}

scanModels();

