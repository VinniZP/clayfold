import { expect, mock, test } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { FinishedRun, SystemView } from '../types'

const NOW = Date.parse('2026-10-03T16:10:00.000Z')

const system = (over: Partial<SystemView> = {}): SystemView => ({
  backend: {
    pid: 4242,
    startedAt: '2026-10-03T15:00:00.000Z',
    bun: '1.3.6',
    port: 4317,
    rssMb: 160,
    heapMb: 23,
    cpuPercent: 0.4,
    dbMb: 0.5,
    model: 'opus',
    criticModel: 'sonnet',
    maxBudgetUsd: 5,
  },
  frontend: { builtAt: '2026-10-03T16:00:00.000Z', streams: 1 },
  instances: [
    {
      pid: 5151,
      kind: 'lesson',
      model: 'opus',
      startedAt: '2026-10-03T15:55:00.000Z',
      conversationId: 'cv1',
      topicId: 'tp1',
      topicTitle: 'Bayesian statistics',
      lessonId: 'ls1',
      activities: ['Searching for sources', 'Reading a page', 'Building the knowledge map', 'Planning the lesson'],
      queued: 1,
      rssMb: 231,
      cpuPercent: 12.1,
    },
  ],
  finished: [],
  ...over,
})

const done = (finishedAt: string, over: Partial<FinishedRun> = {}): FinishedRun => ({
  conversationId: 'cv2',
  kind: 'lesson',
  topicId: 'tp2',
  topicTitle: 'Git basics',
  lessonId: 'ls2',
  startedAt: '2026-10-03T16:00:00.000Z',
  finishedAt,
  costUsd: 0.84,
  error: null,
  cancelled: false,
  ...over,
})

const PANE = {
  component: 'Pane',
  requestId: 'clayfold',
  props: {
    title: 'Clayfold',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

/**
 * The engine beneath the plugin: a clock, the command and tool lists, panes, the status line, and a server
 * answering `world.system` (null: connection refused). Records toasts, POSTs and host commands.
 */
async function start($: Engine, on: On, initial: SystemView | null) {
  const world = {
    system: initial,
    toasts: [] as string[],
    posts: [] as string[],
    commands: [] as { argv: readonly string[]; cwd: string | undefined }[],
    clock: undefined as unknown as MockClock,
  }
  world.clock = mock.clock(on, { now: NOW })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('tool.register', (_$, e) => ({ value: { tool: `mcp__clayfold-monitor__${e.name}` } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', (_$, e) => {
    world.toasts.push(e.text)
    return { value: undefined }
  })
  on('fs.exists', (_$, e) => ({ value: e.path.endsWith('/server/index.ts') }))
  on('process.run', (_$, e) => {
    world.commands.push({ argv: e.argv, cwd: e.init?.cwd })
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('http.fetch', async (_$, e) => {
    if (e.init?.method === 'POST') {
      world.posts.push(e.url)
      return { value: { status: 202, ok: true, headers: {}, text: '' } }
    }
    if (world.system && e.url === 'http://127.0.0.1:4317/api/system') {
      return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify(world.system) } }
    }
    throw new Error('connection refused')
  })
  await $.session.start({ cwd: '/work/clayfold', surface: 'terminal', isInteractive: true })
  await world.clock.settle()
  return world
}

test('the pane shows the backend, the frontend and each Claude Code instance', async ($, on) => {
  await start($, on, system())
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'clayfold-monitor', surface, ...PANE })
    expect(await ui.find({ text: /^Backend/ })).toBeDefined()
    expect(await ui.find({ text: '1:10:00' })).toBeDefined()
    expect(await ui.find({ text: /web\/dist built 10:00 ago/ })).toBeDefined()
    expect(await ui.find({ text: 'Claude Code instances: 1' })).toBeDefined()
    expect(await ui.find({ text: 'Bayesian statistics' })).toBeDefined()
    expect(await ui.find({ text: 'PID 5151 · opus · 231 MB · CPU 12.1% · 1 queued' })).toBeDefined()
    // The three latest activities, the current one last.
    expect(await ui.find({ text: /Searching for sources/ })).toBeUndefined()
    expect(await ui.find({ text: /▸ Planning the lesson/ })).toBeDefined()
    expect(await ui.find({ type: 'Link', text: /open in browser/ })).toBeDefined()
    await ui.unmount()
  }
})

test('a run older than the threshold is marked as a long run', async ($, on) => {
  await start($, on, system())
  const ui = await $.ui.mount({ plugin: 'clayfold-monitor', surface: 'terminal', ...PANE })
  expect(await ui.find({ text: /15:00 long run/ })).toBeDefined()
  await ui.unmount()
})

test('stop cancels the conversation through the server', async ($, on) => {
  const world = await start($, on, system())
  const ui = await $.ui.mount({ plugin: 'clayfold-monitor', surface: 'terminal', ...PANE })
  await ui.press({ key: 'stop-cv1' })
  expect(world.posts).toEqual(['http://127.0.0.1:4317/api/conversations/cv1/cancel'])
  expect(world.toasts).toContain('Clayfold: stopping the run…')
  await ui.unmount()
})

test('a run that finishes after the first answer is announced once, older ones never', async ($, on) => {
  const world = await start($, on, system({ finished: [done('2026-10-03T16:05:00.000Z')] }))
  expect(world.toasts).toEqual([])
  world.system = system({
    finished: [
      done('2026-10-03T16:10:01.000Z', { topicTitle: 'Linear algebra', error: 'claude exited with code 1' }),
      done('2026-10-03T16:05:00.000Z'),
    ],
  })
  await world.clock.advance(2000)
  await world.clock.advance(2000)
  expect(world.toasts).toEqual(['Clayfold: lesson "Linear algebra" failed after 10:01: claude exited with code 1'])
})

test('the server_state tool answers the server state', async ($, on) => {
  await start($, on, system())
  // This build's tool table lists only the tools connected at the last reload, so the plugin's own is cast.
  const called = await $.tool.call({ tool: 'mcp__clayfold-monitor__server_state' } as unknown as Parameters<Engine['tool']['call']>[0])
  expect(String(called.result)).toContain('"topicTitle": "Bayesian statistics"')
})

test('with the backend down, Start server launches dev:server detached in the checkout the mod lives in', async ($, on) => {
  const world = await start($, on, null)
  const ui = await $.ui.mount({ plugin: 'clayfold-monitor', surface: 'terminal', ...PANE })
  expect(await ui.find({ text: 'down' })).toBeDefined()
  expect(await ui.find({ text: /^127\.0\.0\.1:4317 · \S/ })).toBeDefined()
  await ui.press({ key: 'start' })
  expect(world.commands).toHaveLength(1)
  expect(world.commands[0]?.argv.slice(0, 2)).toEqual(['bun', '-e'])
  expect(world.commands[0]?.argv[2]).toContain("spawn('bun', ['run', 'dev:server'], { detached: true")
  expect(world.commands[0]?.argv[2]).toContain("CLAYFOLD_PORT: '4317'")
  expect(world.commands[0]?.cwd).toMatch(/clayfold-monitor\/\.\.\/\.\.\/\.\.$/)
  expect(world.toasts).toContain('Clayfold: starting the server; its log is data/dev-server.log')
  await ui.unmount()
})

test('a server running older code is reported, not drawn from', async ($, on) => {
  const { finished: _, ...old } = system()
  await start($, on, old as SystemView)
  const ui = await $.ui.mount({ plugin: 'clayfold-monitor', surface: 'terminal', ...PANE })
  expect(await ui.find({ text: /the server runs older code; restart it/ })).toBeDefined()
  await ui.unmount()
})
