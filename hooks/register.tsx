import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Goal, Task, TaskStatus, Usage } from '../types'

const PANE = 'goal-tracker'
const TITLE = 'Goal'
const CACHE_TTL_MS = 60 * 60 * 1000

const goal = atom({ plugin: 'goal-tracker', key: 'goal' } as const, null)
const tasks = atom({ plugin: 'goal-tracker', key: 'tasks' } as const, [])
const usage = atom({ plugin: 'goal-tracker', key: 'usage' } as const, {})
const lastTurnAt = atom({ plugin: 'goal-tracker', key: 'lastTurnAt' } as const, null)
const tick = atom({ plugin: 'goal-tracker', key: 'tick' } as const, 0)

const mins = (ms: number) => `${Math.max(0, Math.round(ms / 60000))}m`
const kTokens = (n?: number) => (n === undefined ? '–' : `${Math.round(n / 1000)}k`)

// Keeps a task's timestamps as its status moves.
const stamp = (task: Task, status: TaskStatus, now: number): Task => ({
  ...task,
  status,
  startedAt: task.startedAt ?? (status !== 'pending' ? now : undefined),
  doneAt: status === 'completed' ? (task.doneAt ?? now) : undefined,
})

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'goal',
      description: 'Set the session goal and open the goal panel (/goal <text>, /goal clear)',
    })
    // Redraw every 30s so elapsed time and cache warmth stay current.
    $.clock.every(30_000, () => void update($, tick, n => n + 1))
    if (await read($, goal)) void $.ui.open({ id: PANE, title: TITLE })

    return next(e)
  })

  on('command.run', { command: 'goal' }, async ($, e) => {
    try {
      const text = e.args.trim()
      if (text === 'clear') {
        await update($, goal, () => null)
        await update($, tasks, () => [])
        return { text: 'Goal cleared.' }
      }
      if (text) {
        const setAt = await $.clock.now()
        await update($, goal, (): Goal => ({ text, setAt }))
      }
      await $.ui.open({ id: PANE, title: TITLE })

      return { text: text ? `Goal set: ${text}` : 'Goal panel opened.' }
    } catch (err) {
      return { text: `The goal panel could not update: ${String(err)}` }
    }
  })

  on('session.measure', async ($, e, next) => {
    const limit = (kind: string) => e.rateLimits.find(r => r.kind === kind)?.percentUsed
    await update($, usage, (): Usage => ({
      contextTokens: e.context.tokens,
      costUsd: e.cost?.usd,
      fiveHour: limit('five_hour'),
      sevenDay: limit('seven_day'),
    }))

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const now = await $.clock.now()
    await update($, lastTurnAt, () => now)

    return next(e)
  })

  // TodoWrite sends the whole list each time.
  on('tool.call', { tool: 'TodoWrite' }, async ($, e, next) => {
    const ran = await next(e)
    const now = await $.clock.now().catch(() => Date.now())
    await update($, tasks, list =>
      e.todos.map((todo, i) => {
        const prior = list.find(t => t.subject === todo.content)
        return stamp(prior ?? { id: `todo-${i}`, subject: todo.content, status: 'pending' }, todo.status, now)
      }),
    ).catch(() => undefined)

    return ran
  })

  on('tool.call', { tool: 'TaskCreate' }, async ($, e, next) => {
    const ran = await next(e)
    const created = (ran.result as { task?: { id: string; subject: string } } | undefined)?.task
    if (created) {
      await update($, tasks, list => [...list, { id: created.id, subject: created.subject, status: 'pending' as const }]).catch(() => undefined)
    }

    return ran
  })

  on('tool.call', { tool: 'TaskUpdate' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined) return ran
    const now = await $.clock.now().catch(() => Date.now())
    const { taskId, status, subject } = e
    await update($, tasks, list =>
      status === 'deleted'
        ? list.filter(t => t.id !== taskId)
        : list.map(t => {
            if (t.id !== taskId) return t
            const renamed = subject ? { ...t, subject } : t
            return status ? stamp(renamed, status, now) : renamed
          }),
    ).catch(() => undefined)

    return ran
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    await read($, tick)
    const now = await $.clock.now()
    const g = await read($, goal)
    const list = await read($, tasks)
    const u = await read($, usage)
    const last = await read($, lastTurnAt)

    const done = list.filter(t => t.status === 'completed')
    const pct = list.length ? Math.round((done.length / list.length) * 100) : 0
    const cols = e.surface === "terminal" ? (e.props.bodyColumns ?? e.viewport?.columns ?? 60) : 28
    const width = Math.max(10, Math.min(cols - 2, 48))
    const filled = Math.round((width * pct) / 100)

    const started = g?.setAt ?? list.find(t => t.startedAt)?.startedAt
    const elapsed = started ? now - started : 0
    const durations = done.map(t => (t.doneAt ?? now) - (t.startedAt ?? started ?? now))
    const avg = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 0
    const left = avg * (list.length - done.length)

    const cacheAge = last ? now - last : undefined
    const isWarm = cacheAge !== undefined && cacheAge < CACHE_TTL_MS
    const shown = [
      ...list.filter(t => t.status === 'completed').slice(-2),
      ...list.filter(t => t.status !== 'completed'),
    ].slice(0, Math.max(3, (e.viewport?.rows ?? 20) - 7))
    const hidden = list.length - shown.length

    return (
      <Box flexDirection="column">
        <Text>
          <Text color={isWarm ? 'green' : 'yellow'}>
            ● cache {isWarm ? `warm ${mins(CACHE_TTL_MS - (cacheAge ?? 0))}` : 'cold'}
          </Text>
          <Text dimColor>
            {' │ '}ctx {kTokens(u.contextTokens)}
            {u.costUsd !== undefined && ` │ session $${u.costUsd.toFixed(2)}`}
            {u.fiveHour !== undefined && ` │ 5h ${u.fiveHour}%`}
            {u.sevenDay !== undefined && ` · week ${u.sevenDay}%`}
          </Text>
        </Text>
        <Text bold>
          {g ? `◎ Goal: ${g.text}` : '◎ No goal set: /goal <text>'}
          <Text color="cyan">  {done.length} of {list.length} tasks · {pct}%</Text>
        </Text>
        <Text>
          <Text color="cyan">{'█'.repeat(filled)}</Text>
          <Text dimColor>{'░'.repeat(width - filled)}</Text>
        </Text>
        <Text dimColor>
          {mins(elapsed)} elapsed{avg > 0 && left > 0 ? ` · about ${mins(left)} left` : ''}
        </Text>
        {shown.map(t =>
          t.status === 'completed' ? (
            <Text dimColor>
              <Text color="green">✓</Text> {t.subject}
              {t.startedAt && t.doneAt ? `  ${mins(t.doneAt - t.startedAt)}` : ''}
            </Text>
          ) : t.status === 'in_progress' ? (
            <Text bold>
              <Text color="cyan">▶</Text> {t.subject}
              <Text dimColor> running {mins(now - (t.startedAt ?? now))}</Text>
            </Text>
          ) : (
            <Text>○ {t.subject}</Text>
          ),
        )}
        {hidden > 0 && <Text dimColor>  +{hidden} more</Text>}
      </Box>
    )
  })
}
