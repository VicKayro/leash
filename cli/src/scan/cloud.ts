import * as fs from 'node:fs'
import * as path from 'node:path'
import type { CloudAgent } from '../types'

// Agents scheduled in the cloud (GitHub Actions cron, Vercel crons) are
// invisible to a local scan — but their *definitions* live in local repos.
// We surface them so the fleet count is honest about what leash can't see.

const MAX_DIRS = 200

function gitChildren(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => path.join(dir, e.name))
      .filter((p) => fs.existsSync(path.join(p, '.git')))
  } catch {
    return []
  }
}

function candidateRepos(cwds: string[]): string[] {
  const set = new Set<string>()
  for (const cwd of cwds) {
    if (!cwd) continue
    if (fs.existsSync(path.join(cwd, '.git'))) set.add(cwd)
    for (const c of gitChildren(cwd)) set.add(c)
    for (const c of gitChildren(path.dirname(cwd))) set.add(c)
    if (set.size >= MAX_DIRS) break
  }
  return [...set].slice(0, MAX_DIRS)
}

function scanRepo(repo: string): CloudAgent[] {
  const found: CloudAgent[] = []
  const repoName = path.basename(repo)

  const wfDir = path.join(repo, '.github', 'workflows')
  if (fs.existsSync(wfDir)) {
    let files: string[] = []
    try {
      files = fs.readdirSync(wfDir).filter((f) => /\.ya?ml$/.test(f)).slice(0, 20)
    } catch {
      files = []
    }
    for (const f of files) {
      try {
        const src = fs.readFileSync(path.join(wfDir, f), 'utf8')
        if (!/^\s*schedule:/m.test(src)) continue
        const cron = src.match(/-\s*cron:\s*['"]?([^'"\n]+)['"]?/)
        found.push({
          repo: repoName,
          kind: 'github-actions',
          name: f.replace(/\.ya?ml$/, ''),
          schedule: cron ? cron[1].trim() : null,
        })
      } catch {
        continue
      }
    }
  }

  try {
    const vercel = JSON.parse(fs.readFileSync(path.join(repo, 'vercel.json'), 'utf8'))
    if (Array.isArray(vercel?.crons)) {
      for (const c of vercel.crons.slice(0, 20)) {
        found.push({
          repo: repoName,
          kind: 'vercel-cron',
          name: typeof c?.path === 'string' ? c.path : 'cron',
          schedule: typeof c?.schedule === 'string' ? c.schedule : null,
        })
      }
    }
  } catch {
    // no vercel.json or unreadable — fine
  }

  return found
}

export function scanCloud(cwds: Array<string | null>): CloudAgent[] {
  const repos = candidateRepos(cwds.filter((c): c is string => !!c))
  const all: CloudAgent[] = []
  for (const r of repos) all.push(...scanRepo(r))
  return all
}
