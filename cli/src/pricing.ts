// USD per million tokens. All costs shown to users are estimates —
// rates change and cache TTL tiers differ; we deliberately round up
// cache writes to the 1.25x tier only.
interface Rate {
  input: number
  output: number
  cacheWrite: number
  cacheRead: number
}

// Order matters: first match wins, generation-specific entries go first.
// Rates cross-checked against LiteLLM's pricing DB on 2026-07-07.
const RATES: Array<{ match: RegExp; rate: Rate }> = [
  { match: /fable|mythos/i, rate: { input: 10, output: 50, cacheWrite: 12.5, cacheRead: 1 } },
  { match: /opus-4-[78]/i, rate: { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 } },
  { match: /opus/i, rate: { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.5 } },
  { match: /sonnet-5/i, rate: { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 } },
  { match: /sonnet/i, rate: { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 } },
  { match: /haiku/i, rate: { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 } },
]

const FALLBACK: Rate = { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 }

export interface Usage {
  input_tokens?: number
  output_tokens?: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
  cache_creation?: {
    ephemeral_5m_input_tokens?: number
    ephemeral_1h_input_tokens?: number
  }
}

export function costOf(model: string | undefined, usage: Usage): number {
  const rate = (model && RATES.find((r) => r.match.test(model))?.rate) || FALLBACK
  const m = 1_000_000

  // Cache writes are billed by TTL tier: 1.25x input for 5m, 2x for 1h.
  // Use the per-tier breakdown when present, else assume the 1.25x tier.
  const cc = usage.cache_creation
  const cacheWriteCost = cc
    ? (((cc.ephemeral_5m_input_tokens ?? 0) * 1.25 + (cc.ephemeral_1h_input_tokens ?? 0) * 2) *
        rate.input) /
      m
    : ((usage.cache_creation_input_tokens ?? 0) * rate.cacheWrite) / m

  return (
    ((usage.input_tokens ?? 0) * rate.input) / m +
    ((usage.output_tokens ?? 0) * rate.output) / m +
    cacheWriteCost +
    ((usage.cache_read_input_tokens ?? 0) * rate.cacheRead) / m
  )
}
