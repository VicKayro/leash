export interface ProjectStats {
  name: string
  dir: string
  cwd: string | null // real working directory, from the first transcript entry seen
  costUSD: number
  sessions: number
  messages: number
  lastActivity: number // epoch ms
}

export interface CloudAgent {
  repo: string // local repo folder, or project/account name for platform-fetched agents
  kind: 'github-actions' | 'vercel-cron' | 'render-cron' | 'railway' | 'cloudflare-worker'
  name: string // workflow file or cron path
  schedule: string | null
  // live health, filled by enrichCloudAgents when a GitHub token is available locally
  slug?: string | null // owner/repo parsed from the git remote
  file?: string | null // workflow filename with extension, to match the GitHub API
  status?: 'ok' | 'failing' | 'disabled' | 'stale' | 'unknown'
  note?: string | null
  url?: string | null
}

export interface LoopIncident {
  project: string
  sessionId: string
  tool: string
  count: number
  spanMin: number | null // minutes between first and last repetition
  date: string // YYYY-MM-DD
  estCostUSD: number
}

export interface ScheduledAgent {
  label: string
  source: 'launchd' | 'cron' | 'systemd'
  schedule: string
  intervalSec: number | null
  loaded: boolean
  disabled: boolean
  lastExitCode: number | null
  zombie: boolean // target script no longer exists
  missingPath: string | null
  silentForSec: number | null // log file untouched for this long (vs expected interval)
  plistPath: string | null
  logPath: string | null // error log if defined, else stdout log
}

export interface FleetInsights {
  nightSessions: number // sessions with activity between midnight and 7am local
  activeDays: number // distinct days with any agent activity
  totalToolCalls: number
  topTools: Array<{ tool: string; count: number }>
  topSession: { project: string; date: string; costUSD: number } | null
}

export interface FleetReport {
  generatedAt: string
  windowDays: number
  claude: {
    available: boolean
    totalCostUSD: number
    totalSessions: number
    projects: ProjectStats[]
    inactiveProjects: number
    loops: LoopIncident[]
    insights: FleetInsights
    daily: Array<{ date: string; costUSD: number }>
    nights: Array<{ project: string; startTs: number; endTs: number; costUSD: number; toolCalls: number }>
  }
  scheduled: ScheduledAgent[]
  cloud: CloudAgent[]
}
