// The response of the Clayfold server's GET /api/system (SystemView in shared/api.ts).

export type ClaudeInstance = {
  pid: number
  kind: 'onboard' | 'lesson' | 'tutor' | 'review' | 'critic' | 'grading'
  model: string
  startedAt: string
  conversationId: string | null
  topicId: string | null
  topicTitle: string | null
  lessonId: string | null
  /** Oldest first; the last one is current. */
  activities: string[]
  queued: number
  rssMb: number | null
  cpuPercent: number | null
}

export type SystemView = {
  backend: {
    pid: number
    startedAt: string
    bun: string
    port: number
    rssMb: number
    heapMb: number
    cpuPercent: number
    dbMb: number
    model: string
    criticModel: string
    maxBudgetUsd: number
  }
  frontend: { builtAt: string | null; streams: number }
  instances: ClaudeInstance[]
  /** Newest first. */
  finished: FinishedRun[]
}

export type FinishedRun = {
  conversationId: string
  kind: 'onboard' | 'lesson' | 'tutor' | 'review'
  topicId: string
  topicTitle: string
  lessonId: string | null
  startedAt: string
  finishedAt: string
  costUsd: number | null
  error: string | null
  cancelled: boolean
}

export type Snapshot = {
  /** Clock time of the poll, in milliseconds. */
  at: number
  /** Null when the server did not answer. */
  system: SystemView | null
  error: string | null
  viteUp: boolean
}

/** Backend samples for the sparklines, oldest first. */
export type Samples = { cpu: number[]; rssMb: number[] }

declare module 'claude-code' {
  interface PluginState {
    'clayfold-monitor': {
      snapshot: Snapshot | null
      autoOpened: boolean
      samples: Samples
      /** finishedAt of the newest finished run already announced; null until the first answer. */
      notifiedUntil: string | null
    }
  }
}
