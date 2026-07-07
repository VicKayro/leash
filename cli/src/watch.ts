import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { costOf } from './pricing'

// getleash watch — `top` for your agents. Tails the transcript files that are
// being written right now and renders a live cost/activity monitor.

const LIVE_WINDOW_MS = 5 * 60_000 // a session is "live" if its file moved recently
const REFRESH_MS = 2_000
const BURN_WINDOW_MS = 120_000

const useColor = process.stdout.isTTY && !process.env.NO_COLOR
const c = {
  bold: (s: string) => (useColor ? `\x1b[1m${s}\x1b[0m` : s),
  dim: (s: string) => (useColor ? `\x1b[2m${s}\x1b[0m` : s),
  green: (s: string) => (useColor ? `\x1b[32m${s}\x1b[0m` : s),
  yellow: (s: string) => (useColor ? `\x1b[33m${s}\x1b[0m` : s),
  cyan: (s: string) => (useColor ? `\x1b[36m${s}\x1b[0m` : s),
}
const usd = (n: number) => '$' + (n >= 100 ? Math.round(n).toLocaleString('en-US') : n.toFixed(2))

interface LiveSession {
  file: string
  project: string
  offset: number
  remainder: string
  costUSD: number
  recentCosts: Array<{ ts: number; cost: number }> // for burn rate
  lastTool: string
  lastActivity: number
  seenRequests: Set<string>
}

function configDir(): string {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
}

function projectFromCwd(cwd: string | undefined, dirName: string): string {
  if (cwd) {
    const parts = cwd.split('/').filter(Boolean)
    if (parts.length > 2) return parts.slice(-2).join('/')
    return '~ (home)'
  }
  return dirName.replace(/^-/, '').split('-').slice(-2).join('/')
}

function toolLabel(name: string, input: any): string {
  let detail = ''
  if (input && typeof input === 'object') {
    const raw = input.command || input.file_path || input.pattern || input.url || input.prompt || ''
    if (typeof raw === 'string' && raw) {
      const flat = raw.replace(/\s+/g, ' ').trim()
      detail = input.file_path ? path.basename(flat) : flat
    }
  }
  if (detail.length > 34) detail = detail.slice(0, 33) + '…'
  return detail ? `${name}: ${detail}` : name
}

function consumeLines(s: LiveSession): void {
  let stat: fs.Stats
  try {
    stat = fs.statSync(s.file)
  } catch {
    return
  }
  if (stat.size <= s.offset) return
  const fd = fs.openSync(s.file, 'r')
  const buf = Buffer.alloc(stat.size - s.offset)
  fs.readSync(fd, buf, 0, buf.length, s.offset)
  fs.closeSync(fd)
  s.offset = stat.size

  const chunk = s.remainder + buf.toString('utf8')
  const lines = chunk.split('\n')
  s.remainder = lines.pop() ?? ''

  for (const line of lines) {
    if (!line.includes('"type":"assistant"')) continue
    let e: any
    try {
      e = JSON.parse(line)
    } catch {
      continue
    }
    if (e.type !== 'assistant' || !e.message) continue
    if (s.project === '?' && typeof e.cwd === 'string') s.project = projectFromCwd(e.cwd, '')

    // Use the message's own timestamp, not wall-clock: the initial full-file
    // parse would otherwise count the whole session history as "just spent"
    // and show a monster burn rate.
    const msgTs = Date.parse(e.timestamp)
    const ts = Number.isFinite(msgTs) ? msgTs : Date.now()

    const reqKey = (e.message.id || '') + ':' + (e.requestId || '')
    const dup = reqKey !== ':' && s.seenRequests.has(reqKey)
    if (reqKey !== ':') s.seenRequests.add(reqKey)
    if (e.message.usage && !dup) {
      const cost = costOf(e.message.model, e.message.usage)
      s.costUSD += cost
      s.recentCosts.push({ ts, cost })
    }
    if (Array.isArray(e.message.content)) {
      for (const block of e.message.content) {
        if (block?.type === 'tool_use') s.lastTool = toolLabel(block.name, block.input)
      }
    }
    if (ts > s.lastActivity) s.lastActivity = ts
  }
  // trim burn window
  const cutoff = Date.now() - BURN_WINDOW_MS
  s.recentCosts = s.recentCosts.filter((r) => r.ts >= cutoff)
}

function discover(sessions: Map<string, LiveSession>): void {
  const root = path.join(configDir(), 'projects')
  let dirs: string[]
  try {
    dirs = fs.readdirSync(root)
  } catch {
    return
  }
  const liveCutoff = Date.now() - LIVE_WINDOW_MS
  for (const d of dirs) {
    const dir = path.join(root, d)
    let files: string[]
    try {
      files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'))
    } catch {
      continue
    }
    for (const f of files) {
      const file = path.join(dir, f)
      let stat: fs.Stats
      try {
        stat = fs.statSync(file)
      } catch {
        continue
      }
      if (stat.mtimeMs < liveCutoff) continue
      if (!sessions.has(file)) {
        // New live session: parse it fully once so its cost-so-far is right.
        sessions.set(file, {
          file,
          project: '?',
          offset: 0,
          remainder: '',
          costUSD: 0,
          recentCosts: [],
          lastTool: '',
          lastActivity: stat.mtimeMs,
          seenRequests: new Set(),
        })
      }
    }
  }
}

function burnPerHour(s: LiveSession): number {
  const total = s.recentCosts.reduce((sum, r) => sum + r.cost, 0)
  return total * (3_600_000 / BURN_WINDOW_MS)
}

function ago(ts: number): string {
  const sec = Math.max(0, Math.round((Date.now() - ts) / 1000))
  if (sec < 60) return `${sec}s ago`
  return `${Math.round(sec / 60)}min ago`
}

function guardLine(): string {
  try {
    const leashDir = process.env.LEASH_DIR || path.join(os.homedir(), '.leash')
    const cfg = JSON.parse(fs.readFileSync(path.join(leashDir, 'guard.json'), 'utf8'))
    const parts: string[] = []
    if (cfg.dailyUSD) parts.push(`$${cfg.dailyUSD}/day`)
    if (cfg.hourlyUSD) parts.push(`$${cfg.hourlyUSD}/h`)
    return parts.length ? `guard: ${parts.join(' · ')}` : 'guard: off (getleash guard --daily 25)'
  } catch {
    return 'guard: off (getleash guard --daily 25)'
  }
}

function renderFrame(sessions: Map<string, LiveSession>, startedAt: number): string {
  const L: string[] = []
  const liveCutoff = Date.now() - LIVE_WINDOW_MS
  const live = [...sessions.values()]
    .filter((s) => s.lastActivity >= liveCutoff)
    .sort((a, b) => b.lastActivity - a.lastActivity)
  const ended = [...sessions.values()]
    .filter((s) => s.lastActivity < liveCutoff)
    .sort((a, b) => b.lastActivity - a.lastActivity)
    .slice(0, 3)

  L.push(c.bold('🐕 leash watch') + c.dim(` · live agent monitor · ${guardLine()} · Ctrl+C to quit`))
  L.push('')

  if (live.length === 0) {
    L.push(c.dim('  No live sessions right now. The moment an agent acts, it appears here.'))
  } else {
    const totalBurn = live.reduce((s, x) => s + burnPerHour(x), 0)
    L.push(
      '  ' +
        c.bold(`LIVE · ${live.length} session${live.length > 1 ? 's' : ''}`) +
        (totalBurn > 0.01 ? c.yellow(`  burning ${usd(totalBurn)}/hour right now`) : ''),
    )
    const label = (s: LiveSession) => `${s.project} · ${path.basename(s.file, '.jsonl').slice(0, 8)}`
    const w = Math.max(...live.map((s) => label(s).length), 10)
    for (const s of live) {
      const burn = burnPerHour(s)
      L.push(
        '  ' +
          c.green('●') +
          ' ' +
          c.cyan(label(s).padEnd(w + 2)) +
          c.bold(usd(s.costUSD).padStart(8)) +
          (burn > 0.01 ? c.yellow(`  ↑${usd(burn)}/h`.padEnd(12)) : ' '.repeat(12)) +
          c.dim(`  ${s.lastTool || 'thinking…'}`.padEnd(40)) +
          c.dim(ago(s.lastActivity)),
      )
    }
  }
  if (ended.length > 0) {
    L.push('')
    L.push(c.dim('  Recently ended'))
    for (const s of ended) {
      L.push(c.dim(`  ○ ${s.project}  ${usd(s.costUSD)}  ${ago(s.lastActivity)}`))
    }
  }
  L.push('')
  L.push(c.dim(`  watching for ${Math.round((Date.now() - startedAt) / 1000)}s · session costs since watch start are exact, earlier spend included at launch`))
  return L.join('\n')
}

export async function watchCommand(args: string[]): Promise<void> {
  const once = args.includes('--once')
  const sessions = new Map<string, LiveSession>()
  const startedAt = Date.now()

  const tick = () => {
    discover(sessions)
    for (const s of sessions.values()) consumeLines(s)
  }

  tick()
  if (once) {
    console.log(renderFrame(sessions, startedAt))
    return
  }

  process.stdout.write('\x1b[?25l') // hide cursor
  const cleanup = () => {
    process.stdout.write('\x1b[?25h\n')
    process.exit(0)
  }
  process.on('SIGINT', cleanup)
  process.on('SIGTERM', cleanup)

  // eslint-disable-next-line no-constant-condition
  while (true) {
    tick()
    process.stdout.write('\x1b[2J\x1b[H' + renderFrame(sessions, startedAt) + '\n')
    await new Promise((r) => setTimeout(r, REFRESH_MS))
  }
}
