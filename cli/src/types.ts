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
  repo: string // folder name of the local repo
  kind: 'github-actions' | 'vercel-cron'
  name: string // workflow file or cron path
  schedule: string | null
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
  }
  scheduled: ScheduledAgent[]
  cloud: CloudAgent[]
}
