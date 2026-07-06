import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import * as readline from 'node:readline'
import { costOf, type Usage } from '../pricing'
import type { LoopIncident, ProjectStats } from '../types'

// A tool call repeated this many times with the exact same input within
// one session is almost never intentional.
const LOOP_THRESHOLD = 10

export interface ClaudeScanResult {
  available: boolean
  totalCostUSD: number
  totalSessions: number
  projects: ProjectStats[]
  loops: LoopIncident[]
}

function configDir(): string {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
}

function nameFromCwd(cwd: string): string {
  const parts = cwd.split('/').filter(Boolean)
  if (parts.length <= 2) return '~' // home or root sessions
  return parts.slice(-2).join('/')
}

function hashInput(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return h.toString(36)
}

interface SessionTally {
  toolCounts: Map<string, { tool: string; count: number }>
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
    if (!proj.name && typeof entry.cwd === 'string') proj.name = nameFromCwd(entry.cwd)

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
        const cur = session.toolCounts.get(key)
        if (cur) cur.count++
        else session.toolCounts.set(key, { tool: block.name, count: 1 })
      }
    }
  }
}

export async function scanClaude(windowDays: number): Promise<ClaudeScanResult> {
  const projectsDir = path.join(configDir(), 'projects')
  if (!fs.existsSync(projectsDir)) {
    return { available: false, totalCostUSD: 0, totalSessions: 0, projects: [], loops: [] }
  }

  const cutoffMs = Date.now() - windowDays * 86_400_000
  const projects = new Map<string, ProjectStats>()
  const loops: LoopIncident[] = []
  const seenRequests = new Set<string>()
  let totalSessions = 0

  for (const dirName of fs.readdirSync(projectsDir)) {
    const dir = path.join(projectsDir, dirName)
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
      if (stat.mtimeMs < cutoffMs) continue

      let proj = projects.get(dirName)
      if (!proj) {
        proj = {
          name: '', // filled from the first cwd seen in a transcript
          dir: dirName,
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

      for (const { tool, count } of session.toolCounts.values()) {
        if (count >= LOOP_THRESHOLD) {
          loops.push({
            project: proj.name,
            sessionId: path.basename(f, '.jsonl'),
            tool,
            count,
            date: session.lastDate,
            estCostUSD:
              session.toolCallsTotal > 0
                ? (session.costUSD * count) / session.toolCallsTotal
                : 0,
          })
        }
      }
    }
  }

  const list = [...projects.values()].sort((a, b) => b.costUSD - a.costUSD)
  for (const p of list) if (!p.name) p.name = p.dir.replace(/^-/, '').split('-').slice(-2).join('/')
  return {
    available: true,
    totalCostUSD: list.reduce((s, p) => s + p.costUSD, 0),
    totalSessions,
    projects: list,
    loops: loops.sort((a, b) => b.count - a.count),
  }
}
