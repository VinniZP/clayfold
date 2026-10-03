import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ClaudeInstance, FinishedRun, Samples, Snapshot, SystemView } from '../types'

const PANE = 'clayfold'
const COMMAND = 'clayfold'
const TOOL = 'server_state'
const POLL_MS = 2000
const KEPT_SAMPLES = 60
const SHOWN_ACTIVITIES = 3
const SHOWN_FINISHED = 3
const SPARK_LABEL = 6

const snapshot = atom({ plugin: 'clayfold-monitor', key: 'snapshot' } as const, null)
const autoOpened = atom({ plugin: 'clayfold-monitor', key: 'autoOpened' } as const, false)
const samples = atom({ plugin: 'clayfold-monitor', key: 'samples' } as const, { cpu: [], rssMb: [] })
const notifiedUntil = atom({ plugin: 'clayfold-monitor', key: 'notifiedUntil' } as const, null)

type Config = { port: number; vitePort: number; longRunMs: number }

const mb = (v: number) => `${v.toFixed(v < 10 ? 1 : 0)} MB`
const pct = (v: number) => `${v.toFixed(1)}%`
const usd = (v: number) => `$${v.toFixed(v < 0.1 ? 3 : 2)}`

/** "m:ss", or "h:mm:ss" from an hour on. */
export function elapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

const since = (at: number, iso: string) => elapsed(at - Date.parse(iso))

const appUrl = (port: number, path = '/') => `http://localhost:${port}${path}`

/** Where an instance or a finished run lives in the app: its lesson, else its topic. */
function pagePath(run: { lessonId: string | null; topicId: string | null }): string | null {
  if (run.lessonId) return `/lessons/${encodeURIComponent(run.lessonId)}`
  if (run.topicId) return `/topics/${encodeURIComponent(run.topicId)}`
  return null
}

const instanceMeta = (it: ClaudeInstance) =>
  [
    `PID ${it.pid}`,
    it.model,
    it.rssMb !== null ? mb(it.rssMb) : null,
    it.cpuPercent !== null ? `CPU ${pct(it.cpuPercent)}` : null,
    it.queued ? `${it.queued} queued` : null,
  ]
    .filter(Boolean)
    .join(' · ')

export function statusLine(snap: Snapshot | null): string | undefined {
  const sys = snap?.system
  if (!sys) return undefined
  return `clayfold: ${sys.instances.length} claude · ${mb(sys.backend.rssMb)} · cpu ${pct(sys.backend.cpuPercent)}`
}

export function finishedText(run: FinishedRun): string {
  const what = `${run.kind} "${run.topicTitle}"`
  const took = elapsed(Date.parse(run.finishedAt) - Date.parse(run.startedAt))
  const cost = run.costUsd !== null ? `, ${usd(run.costUsd)}` : ''
  if (run.cancelled) return `Clayfold: ${what} stopped after ${took}`
  if (run.error) return `Clayfold: ${what} failed after ${took}: ${run.error.slice(0, 120)}`
  return `Clayfold: ${what} finished in ${took}${cost}`
}

/** Runs finished after `until`, oldest first. */
export function newlyFinished(finished: FinishedRun[], until: string): FinishedRun[] {
  return finished.filter(run => run.finishedAt > until).reverse()
}

/** One terminal row of block characters, scaled from `min` to `max`, as RasterProps.cells. */
export function sparkCells(values: number[], min: number, max: number, color: number): string {
  const span = max - min || 1
  const words = new Uint32Array(values.length * 3)
  values.forEach((v, i) => {
    const level = Math.round(((Math.min(max, Math.max(min, v)) - min) / span) * 7)
    words.set([0x2581 + level, color, 0x01000000], i * 3)
  })
  let binary = ''
  for (const byte of new Uint8Array(words.buffer)) binary += String.fromCharCode(byte)
  return btoa(binary)
}

async function fetchSystem($: EngineInterface, port: number): Promise<{ system: SystemView | null; error: string | null }> {
  try {
    const r = await $.http.fetch(`http://127.0.0.1:${port}/api/system`)
    if (!r.ok) return { system: null, error: `HTTP ${r.status}` }
    const system = JSON.parse(r.text) as Partial<SystemView>
    // A server started before /api/system gained these fields keeps answering without them until it restarts.
    if (!Array.isArray(system.finished) || !system.instances?.every(it => Array.isArray(it.activities))) {
      return { system: null, error: 'the server runs older code; restart it' }
    }
    return { system: system as SystemView, error: null }
  } catch (err) {
    return { system: null, error: err instanceof Error ? err.message : String(err) }
  }
}

async function poll($: EngineInterface, config: Config): Promise<void> {
  const [answer, viteUp] = await Promise.all([
    fetchSystem($, config.port),
    $.http.fetch(`http://localhost:${config.vitePort}/`).then(
      r => r.ok,
      () => false,
    ),
  ])
  const next: Snapshot = { at: await $.clock.now(), ...answer, viteUp }
  await update($, snapshot, () => next)
  $.ui.status(statusLine(next))
  const system = answer.system
  if (!system) return

  await update($, samples, (old): Samples => ({
    cpu: [...(old?.cpu ?? []), system.backend.cpuPercent].slice(-KEPT_SAMPLES),
    rssMb: [...(old?.rssMb ?? []), system.backend.rssMb].slice(-KEPT_SAMPLES),
  }))

  // The first answer of a session only sets the mark, so runs finished before it are not announced.
  const until = await read($, notifiedUntil)
  const newest = system.finished[0]?.finishedAt ?? ''
  if (until !== null) for (const run of newlyFinished(system.finished, until)) $.ui.toast(finishedText(run), { timeoutMs: 8000 })
  if (until === null || newest > until) await update($, notifiedUntil, () => newest)
}

async function stopRun($: EngineInterface, port: number, conversationId: string): Promise<void> {
  try {
    const r = await $.http.fetch(`http://127.0.0.1:${port}/api/conversations/${encodeURIComponent(conversationId)}/cancel`, {
      method: 'POST',
    })
    $.ui.toast(r.ok ? 'Clayfold: stopping the run…' : `Clayfold: stop failed, HTTP ${r.status}`)
  } catch (err) {
    $.ui.toast(`Clayfold: stop failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/**
 * Starts `bun run dev:server` detached, so it outlives this mod and this session; works on macOS, Linux and Windows.
 * The mod lives in `.claude/skills/clayfold-monitor` of the checkout it starts.
 */
async function startServer($: EngineInterface, config: Config): Promise<void> {
  const dir = `${$.plugin.root}/../../..`
  if (!(await $.fs.exists(`${dir}/server/index.ts`))) {
    $.ui.toast(`Clayfold: no server/index.ts in ${dir}`)
    return
  }
  const script = [
    "const { spawn } = require('node:child_process')",
    "const fs = require('node:fs')",
    "fs.mkdirSync('data', { recursive: true })",
    "const log = fs.openSync('data/dev-server.log', 'a')",
    `spawn('bun', ['run', 'dev:server'], { detached: true, windowsHide: true, stdio: ['ignore', log, log], env: { ...process.env, CLAYFOLD_PORT: '${config.port}' } }).unref()`,
  ].join(';')
  const ran = await $.process.run(['bun', '-e', script], { cwd: dir, timeoutMs: 15000 })
  $.ui.toast(
    ran.exitCode === 0
      ? 'Clayfold: starting the server; its log is data/dev-server.log'
      : `Clayfold: start failed: ${(ran.stderr || ran.stdout).slice(0, 160)}`,
  )
}

export const register: Register = (on, options) => {
  const config: Config = {
    port: Number(options.port ?? 4317),
    vitePort: Number(options.vitePort ?? 5173),
    longRunMs: Number(options.longRunMinutes ?? 10) * 60_000,
  }

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: 'Show the Clayfold server, its frontend and the Claude Code instances it runs',
    })
    await $.tool.register({
      name: TOOL,
      description:
        'Reads the local Clayfold server state: backend process stats, frontend build, the running Claude Code ' +
        'instances with their latest activities, and recently finished conversation turns with duration, cost and ' +
        'error. Use it to find out why a lesson, onboarding or tutor run is slow, stuck or failed.',
      inputSchema: { type: 'object', properties: {} },
    })
    void poll($, config)
    $.clock.every(POLL_MS, () => void poll($, config))
    // A reload fires session.start again; the pane opens unasked once per session.
    if (!(await read($, autoOpened))) {
      await update($, autoOpened, () => true)
      void $.ui.open({ id: PANE, title: 'Clayfold' })
    }
    return next(e)
  })

  on('command.run', { command: COMMAND }, async $ => {
    const opened = await $.ui.open({ id: PANE, title: 'Clayfold' })
    return { text: opened.isPlaced ? 'Clayfold pane opened.' : 'Clayfold pane is waiting for a wider terminal.' }
  })

  // The tool is registered at session start, so this build's tool names do not list it for a matcher.
  on('tool.call', async ($, e, next) => {
    if (String(e.tool) !== `mcp__clayfold-monitor__${TOOL}`) return next(e)
    const { system, error } = await fetchSystem($, config.port)
    if (!system) return { result: `The Clayfold server at 127.0.0.1:${config.port} did not answer: ${error}` }
    return { result: JSON.stringify(system, null, 2) }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const elements = $.ui.resolve(e)
    const { Box, Text, Button, Link } = elements
    const snap = await read($, snapshot)

    if (!snap) return <Text dimColor>Connecting to 127.0.0.1:{config.port}…</Text>

    const vite = (
      <Text>
        Vite :{config.vitePort} <Text color={snap.viteUp ? 'green' : 'gray'}>{snap.viteUp ? 'up' : 'down'}</Text>
      </Text>
    )

    if (!snap.system) {
      return (
        <Box flexDirection="column">
          <Text>
            <Text bold>Backend</Text> <Text color="red">down</Text>{' '}
            <Text dimColor>
              127.0.0.1:{config.port} · {snap.error}
            </Text>
          </Text>
          <Box marginTop={1}>
            <Button key="start" hotkey="s" variant="primary" onPress={() => startServer($, config)}>
              Start server
            </Button>
          </Box>
          <Text dimColor>Runs `bun run dev:server` in the project folder.</Text>
          <Text> </Text>
          <Text bold>Frontend</Text>
          {vite}
        </Box>
      )
    }

    const { backend: b, frontend: f, instances, finished } = snap.system
    const history = await read($, samples)
    const width = Math.max(1, Math.min(KEPT_SAMPLES, (e.viewport?.columns ?? 40) - SPARK_LABEL - 12))
    const cpu = history?.cpu.slice(-width) ?? []
    const rss = history?.rssMb.slice(-width) ?? []
    const sparks =
      e.surface === 'terminal' && cpu.length > 1 && 'Raster' in elements
        ? (() => {
            const { Raster } = elements
            return (
              <Box flexDirection="column">
                <Box flexDirection="row">
                  <Text dimColor>{'cpu'.padEnd(SPARK_LABEL)}</Text>
                  <Raster key="cpu" columns={cpu.length} rows={1} cells={sparkCells(cpu, 0, Math.max(5, ...cpu), 0x5fd75f)} />
                  <Text dimColor> max {pct(Math.max(...cpu))}</Text>
                </Box>
                <Box flexDirection="row">
                  <Text dimColor>{'mem'.padEnd(SPARK_LABEL)}</Text>
                  <Raster key="rss" columns={rss.length} rows={1} cells={sparkCells(rss, Math.min(...rss), Math.max(...rss), 0x5fafff)} />
                  <Text dimColor> max {mb(Math.max(...rss))}</Text>
                </Box>
              </Box>
            )
          })()
        : null

    let hotkey = 0
    return (
      <Box flexDirection="column">
        <Text>
          <Text bold>Backend</Text> <Text color="green">up</Text> {since(snap.at, b.startedAt)}{' '}
          <Link href={appUrl(config.port)} label="open app" />
        </Text>
        <Text wrap="truncate-end">
          PID {b.pid} · Bun {b.bun} · :{b.port}
        </Text>
        <Text wrap="truncate-end">
          {mb(b.rssMb)} (heap {mb(b.heapMb)}) · CPU {pct(b.cpuPercent)} · DB {mb(b.dbMb)}
        </Text>
        <Text dimColor wrap="truncate-end">
          {b.model}, critic {b.criticModel} · {usd(b.maxBudgetUsd)} per run
        </Text>
        {sparks}
        <Text> </Text>
        <Text bold>Frontend</Text>
        <Text wrap="truncate-end">web/dist {f.builtAt ? `built ${since(snap.at, f.builtAt)} ago` : 'not built'}</Text>
        {vite}
        <Text dimColor>
          {f.streams} open event stream{f.streams === 1 ? '' : 's'}
        </Text>
        <Text> </Text>
        <Text bold>Claude Code instances: {instances.length}</Text>
        {instances.length === 0 && <Text dimColor>None running.</Text>}
        {instances.map(it => {
          const age = snap.at - Date.parse(it.startedAt)
          const isLong = age > config.longRunMs
          const path = pagePath(it)
          const key = it.conversationId && hotkey < 9 ? String(++hotkey) : undefined
          const shown = it.activities.slice(-SHOWN_ACTIVITIES)
          return (
            <Box flexDirection="column" marginTop={1}>
              <Text wrap="truncate-end">
                <Text color="magenta">{it.kind}</Text> <Text bold>{it.topicTitle ?? '—'}</Text>{' '}
                <Text color={isLong ? 'yellow' : undefined} dimColor={!isLong}>
                  {elapsed(age)}
                  {isLong ? ' long run' : ''}
                </Text>
              </Text>
              {shown.map((label, i) => (
                <Text dimColor={i < shown.length - 1} wrap="truncate-end">
                  {i < shown.length - 1 ? '  ' : '▸ '}
                  {label}
                </Text>
              ))}
              <Text dimColor wrap="truncate-end">
                {instanceMeta(it)}
              </Text>
              {(it.conversationId || path) && (
                <Box flexDirection="row" gap={2}>
                  {it.conversationId && (
                    <Button key={`stop-${it.conversationId}`} hotkey={key} dimColor onPress={() => stopRun($, config.port, it.conversationId!)}>
                      stop
                    </Button>
                  )}
                  {path && <Link href={appUrl(config.port, path)} label="open in browser" />}
                </Box>
              )}
            </Box>
          )
        })}
        {finished.length > 0 && (
          <Box flexDirection="column" marginTop={1}>
            <Text bold>Recently finished</Text>
            {finished.slice(0, SHOWN_FINISHED).map(run => (
              <Text wrap="truncate-end" color={run.error && !run.cancelled ? 'red' : undefined} dimColor={!run.error || run.cancelled}>
                {finishedText(run).replace(/^Clayfold: /, '')} · {since(snap.at, run.finishedAt)} ago
              </Text>
            ))}
          </Box>
        )}
      </Box>
    )
  })
}
