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
  }
  scheduled: ScheduledAgent[]
  cloud: CloudAgent[]
}
