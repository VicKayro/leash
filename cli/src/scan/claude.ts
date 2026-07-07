import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import * as readline from 'node:readline'
import { costOf, type Usage } from '../pricing'
import type { LoopIncident, ProjectStats } from '../types'

// A tool call repeated with the exact same input is almost never intentional:
// flag at 10+ repetitions overall, or 6+ packed into a ten-minute window
// (the signature of a genuine runaway loop).
const LOOP_THRESHOLD = 10
const LOOP_FAST_THRESHOLD = 6
const LOOP_FAST_WINDOW_MS = 10 * 60_000

export interface ClaudeScanResult {
  available: boolean
  totalCostUSD: number
  totalSessions: number
  projects: ProjectStats[]
  inactiveProjects: number // projects with history but no activity in the window
  loops: LoopIncident[]
}

function configDir(): string {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
}

function nameFromCwd(cwd: string): string {
  const parts = cwd.split('/').filter(Boolean)
  if (parts.length <= 2) return '~ (home)' // sessions started from the home folder
  return parts.slice(-2).join('/')
}

function hashInput(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return h.toString(36)
}

interface ToolTally {
  tool: string
  count: number
  firstTs: number
  lastTs: number
}

interface SessionTally {
  toolCounts: Map<string, ToolTally>
  toolCallsTotal: number
  costUSD: number
  lastDate: string
}

async function scanFile(
  file: string,
  cutoffMs: number,
  proj: ProjectStats,
  session: SessionTally,
  seenRequests: Set<string>,
): Promise<void> {
  const rl = readline.createInterface({
    input: fs.createReadStream(file, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  })
  for await (const line of rl) {
    // Cheap prefilter: only assistant entries carry usage and tool_use blocks.
    if (!line.includes('"type":"assistant"')) continue
    let entry: any
    try {
      entry = JSON.parse(line)
    } catch {
      continue // transcript format is internal; skip anything unreadable
    }
    if (entry.type !== 'assistant' || !entry.message) continue
    const ts = entry.timestamp ? Date.parse(entry.timestamp) : NaN
    if (Number.isFinite(ts) && ts < cutoffMs) continue
    if (!proj.name && typeof entry.cwd === 'string') {
      proj.name = nameFromCwd(entry.cwd)
      proj.cwd = entry.cwd
    }

    // Retries, streaming and session resumes rewrite the same API response
    // into several lines or files: count each (message, request) pair once,
    // globally. Same dedup key as ccusage.
    const usage: Usage | undefined = entry.message.usage
    const reqKey = (entry.message.id || '') + ':' + (entry.requestId || '')
    const dup = reqKey !== ':' && seenRequests.has(reqKey)
    if (reqKey !== ':') seenRequests.add(reqKey)
    if (usage && !dup) {
      const cost = costOf(entry.message.model, usage)
      proj.costUSD += cost
      session.costUSD += cost
    }
    proj.messages++
    if (Number.isFinite(ts)) {
      if (ts > proj.lastActivity) proj.lastActivity = ts
      session.lastDate = new Date(ts).toISOString().slice(0, 10)
    }

    const content = entry.message.content
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block?.type !== 'tool_use') continue
        session.toolCallsTotal++
        const key = block.name + ':' + hashInput(JSON.stringify(block.input ?? ''))
        const blockTs = Number.isFinite(ts) ? ts : Date.now()
        const cur = session.toolCounts.get(key)
        if (cur) {
          cur.count++
          if (blockTs < cur.firstTs) cur.firstTs = blockTs
          if (blockTs > cur.lastTs) cur.lastTs = blockTs
        } else {
          session.toolCounts.set(key, { tool: block.name, count: 1, firstTs: blockTs, lastTs: blockTs })
        }
      }
    }
  }
}

export async function scanClaude(windowDays: number): Promise<ClaudeScanResult> {
  const projectsDir = path.join(configDir(), 'projects')
  if (!fs.existsSync(projectsDir)) {
    return { available: false, totalCostUSD: 0, totalSessions: 0, projects: [], inactiveProjects: 0, loops: [] }
  }

  const cutoffMs = Date.now() - windowDays * 86_400_000
  const projects = new Map<string, ProjectStats>()
  const loops: LoopIncident[] = []
  const seenRequests = new Set<string>()
  let totalSessions = 0
  let inactiveProjects = 0

  for (const dirName of fs.readdirSync(projectsDir)) {
    const dir = path.join(projectsDir, dirName)
    let files: string[]
    try {
      files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'))
    } catch {
      continue
    }
    const hadHistory = files.length > 0
    let hadRecent = false
    for (const f of files) {
      const file = path.join(dir, f)
      let stat: fs.Stats
      try {
        stat = fs.statSync(file)
      } catch {
        continue
      }
      if (stat.mtimeMs < cutoffMs) continue
      hadRecent = true

      let proj = projects.get(dirName)
      if (!proj) {
        proj = {
          name: '', // filled from the first cwd seen in a transcript
          dir: dirName,
          cwd: null,
          costUSD: 0,
          sessions: 0,
          messages: 0,
          lastActivity: 0,
        }
        projects.set(dirName, proj)
      }
      proj.sessions++
      totalSessions++

      const session: SessionTally = {
        toolCounts: new Map(),
        toolCallsTotal: 0,
        costUSD: 0,
        lastDate: new Date(stat.mtimeMs).toISOString().slice(0, 10),
      }
      try {
        await scanFile(file, cutoffMs, proj, session, seenRequests)
      } catch {
        continue
      }

      for (const t of session.toolCounts.values()) {
        const span = t.lastTs - t.firstTs
        const isLoop =
          t.count >= LOOP_THRESHOLD ||
          (t.count >= LOOP_FAST_THRESHOLD && span <= LOOP_FAST_WINDOW_MS)
        if (isLoop) {
          loops.push({
            project: proj.name,
            sessionId: path.basename(f, '.jsonl'),
            tool: t.tool,
            count: t.count,
            spanMin: span > 0 ? Math.max(1, Math.round(span / 60_000)) : null,
            date: session.lastDate,
            estCostUSD:
              session.toolCallsTotal > 0
                ? (session.costUSD * t.count) / session.toolCallsTotal
                : 0,
          })
        }
      }
    }
    if (hadHistory && !hadRecent) inactiveProjects++
  }

  const list = [...projects.values()].sort((a, b) => b.costUSD - a.costUSD)
  for (const p of list) if (!p.name) p.name = p.dir.replace(/^-/, '').split('-').slice(-2).join('/')
  return {
    available: true,
    totalCostUSD: list.reduce((s, p) => s + p.costUSD, 0),
    totalSessions,
    projects: list,
    inactiveProjects,
    loops: loops.sort((a, b) => b.count - a.count),
  }
}
