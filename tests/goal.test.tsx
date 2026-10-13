import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'goal-tracker',
  surface: 'terminal',
  component: 'Pane',
  requestId: 'goal-tracker',
  props: { title: 'Goal', isFocused: false } as never,
} as const

test('/goal sets the goal and the pane tracks TodoWrite progress', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('tool.call', { tool: 'TodoWrite' }, () => ({ result: { oldTodos: [], newTodos: [] } as never }))

  const ran = await $.command.run({ command: 'goal', args: 'Ship the short film' } as never)
  expect(ran.text).toBe('Goal set: Ship the short film')

  await $.tool.call({
    tool: 'TodoWrite',
    todos: [
      { content: 'Generate shots', status: 'completed', activeForm: 'Generating shots' },
      { content: 'Build composition', status: 'in_progress', activeForm: 'Building composition' },
      { content: 'Render', status: 'pending', activeForm: 'Rendering' },
    ],
  })

  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ text: /Goal: Ship the short film/ })).toBeDefined()
  expect(await ui.find({ text: /1 of 3 tasks · 33%/ })).toBeDefined()
  expect(await ui.find({ text: /▶ Build composition/ })).toBeDefined()
  await ui.unmount()
})

test('/goal clear empties the panel', async ($, on) => {
  mock.clock(on)
  await $.command.run({ command: 'goal', args: 'Something' } as never)
  const ran = await $.command.run({ command: 'goal', args: 'clear' } as never)
  expect(ran.text).toBe('Goal cleared.')

  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ text: /No goal set/ })).toBeDefined()
  await ui.unmount()
})
