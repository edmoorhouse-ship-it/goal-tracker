export type TaskStatus = 'pending' | 'in_progress' | 'completed'

export type Task = {
  id: string
  subject: string
  status: TaskStatus
  startedAt?: number
  doneAt?: number
}

export type Goal = { text: string; setAt: number }

export type Usage = {
  contextTokens?: number
  costUsd?: number
  fiveHour?: number
  sevenDay?: number
}

declare module 'claude-code' {
  interface PluginState {
    'goal-tracker': {
      goal: Goal | null
      tasks: Task[]
      usage: Usage
      lastTurnAt: number | null
      tick: number
    }
  }
}
