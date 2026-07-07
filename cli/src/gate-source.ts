// The gate script installed at ~/.leash/gate.mjs by `getleash guard`.
// It must be fully standalone (zero deps, no npx at hook time) and FAIL-OPEN:
// any error means "allow" — leash must never break someone's Claude Code.
export const GATE_SOURCE = `// leash budget gate — installed by \`getleash guard\`. https://github.com/VicKayro/leash
// Runs as a Claude Code PreToolUse hook. Exit 0 = allow, exit 2 = block.
// Fail-open by design: any error allows the tool call.
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

const LEASH_DIR = process.env.LEASH_DIR || path.join(os.homedir(), '.leash')
const CACHE_TTL_MS = 120_000

const RATES = [
  [/fable|mythos/i, [10, 50, 12.5, 1]],
  [/opus-4-[78]/i, [5, 25, 6.25, 0.5]],
  [/opus/i, [15, 75, 18.75, 1.5]],
  [/sonnet-5/i, [2, 10, 2.5, 0.2]],
  [/sonnet/i, [3, 15, 3.75, 0.3]],
  [/haiku/i, [1, 5, 1.25, 0.1]],
]

function costOf(model, u) {
  const found = RATES.find((r) => r[0].test(model || ''))
  const r = found ? found[1] : [3, 15, 3.75, 0.3]
  return (
    ((u.input_tokens || 0) * r[0] +
      (u.output_tokens || 0) * r[1] +
      (u.cache_creation_input_tokens || 0) * r[2] +
      (u.cache_read_input_tokens || 0) * r[3]) /
    1e6
  )
}

function todaySpend() {
  const startOfDay = new Date()
  startOfDay.setHours(0, 0, 0, 0)
  const cutoff = startOfDay.getTime()
  const root = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects')
  const seen = new Set()
  let spent = 0
  for (const d of fs.readdirSync(root)) {
    const dir = path.join(root, d)
    let files
    try {
      files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'))
    } catch {
      continue
    }
    for (const f of files) {
      const file = path.join(dir, f)
      let stat
      try {
        stat = fs.statSync(file)
      } catch {
        continue
      }
      if (stat.mtimeMs < cutoff) continue
      const lines = fs.readFileSync(file, 'utf8').split('\\n')
      for (const line of lines) {
        if (!line.includes('"type":"assistant"')) continue
        let e
        try {
          e = JSON.parse(line)
        } catch {
          continue
        }
        if (e.type !== 'assistant' || !e.message || !e.message.usage) continue
        const ts = Date.parse(e.timestamp)
        if (Number.isFinite(ts) && ts < cutoff) continue
        const key = (e.message.id || '') + ':' + (e.requestId || '')
        if (key !== ':' && seen.has(key)) continue
        seen.add(key)
        spent += costOf(e.message.model, e.message.usage)
      }
    }
  }
  return spent
}

try {
  const config = JSON.parse(fs.readFileSync(path.join(LEASH_DIR, 'guard.json'), 'utf8'))
  const daily = Number(config.dailyUSD)
  if (!Number.isFinite(daily) || daily <= 0) process.exit(0)

  const cachePath = path.join(LEASH_DIR, 'cache.json')
  const today = new Date().toISOString().slice(0, 10)
  let spent = null
  try {
    const cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'))
    if (cache.date === today && Date.now() - cache.computedAt < CACHE_TTL_MS) spent = cache.spentUSD
  } catch {}
  if (spent === null) {
    spent = todaySpend()
    try {
      fs.writeFileSync(cachePath, JSON.stringify({ date: today, spentUSD: spent, computedAt: Date.now() }))
    } catch {}
  }

  if (spent >= daily) {
    process.stderr.write(
      'leash budget guard: daily budget of $' +
        daily.toFixed(2) +
        ' reached ($' +
        spent.toFixed(2) +
        ' spent today). Raise it: getleash guard --daily ' +
        Math.ceil(daily * 2) +
        ' · Disable: getleash guard --off\\n',
    )
    process.exit(2)
  }
  process.exit(0)
} catch {
  process.exit(0) // fail-open, always
}
`
