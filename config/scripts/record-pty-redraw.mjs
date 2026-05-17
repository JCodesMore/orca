import pty from 'node-pty'
import { mkdirSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const mode = process.argv[2] ?? 'powershell'
const outputDir = path.join(process.cwd(), 'tmp', 'terminal-cursor-diagnostics')
mkdirSync(outputDir, { recursive: true })

function resolveSpawn(modeName) {
  if (modeName === 'powershell') {
    return {
      file: 'powershell.exe',
      args: ['-NoLogo'],
      initialDelayMs: 1200
    }
  }
  if (modeName === 'cmd') {
    return {
      file: 'cmd.exe',
      args: [],
      initialDelayMs: 700
    }
  }
  if (modeName === 'wsl') {
    return {
      file: 'wsl.exe',
      args: ['--', 'bash', '-li'],
      initialDelayMs: 1500
    }
  }
  throw new Error(`unknown mode: ${modeName}`)
}

function summarize(data) {
  const esc = String.fromCharCode(27)
  const bel = String.fromCharCode(7)
  const patterns = [
    ['cursorLeft', new RegExp(`${esc}\\[[0-9;?]*D`, 'g')],
    ['cursorRight', new RegExp(`${esc}\\[[0-9;?]*C`, 'g')],
    ['cursorPosition', new RegExp(`${esc}\\[[0-9;?]*[HfG]`, 'g')],
    ['erase', new RegExp(`${esc}\\[[0-9;?]*[JK]`, 'g')],
    ['cursorHide', new RegExp(`${esc}\\[\\?25l`, 'g')],
    ['cursorShow', new RegExp(`${esc}\\[\\?25h`, 'g')],
    ['sgr', new RegExp(`${esc}\\[[0-9;:]*m`, 'g')],
    ['osc', new RegExp(`${esc}\\].*?(?:${bel}|${esc}\\\\)`, 'gs')]
  ]
  return Object.fromEntries(
    patterns.map(([name, pattern]) => [name, [...data.matchAll(pattern)].length])
  )
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function main() {
  if (process.platform !== 'win32' && mode !== 'wsl') {
    console.warn('[record-pty-redraw] native Windows modes are most useful on Windows')
  }
  const spawn = resolveSpawn(mode)
  const chunks = []
  const startedAt = Date.now()
  const env = {
    ...process.env,
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    TERM_PROGRAM: 'OrcaDiagnostic'
  }
  const term = pty.spawn(spawn.file, spawn.args, {
    name: 'xterm-256color',
    cols: 100,
    rows: 30,
    cwd: process.cwd(),
    env
  })
  term.onData((data) => {
    chunks.push({ t: Date.now() - startedAt, data })
  })
  term.onExit(({ exitCode }) => {
    console.log(`[record-pty-redraw] child exited: ${exitCode}`)
  })

  await sleep(spawn.initialDelayMs)
  const input = `ORCA_CURSOR_DIAGNOSTIC_${'abcdefghijklmnopqrstuvwxyz_ABCDEFGHIJKLMNOPQRSTUVWXYZ_0123456789_'.repeat(3)}`
  term.write('\x15')
  await sleep(100)
  term.write(input)
  await sleep(250)
  const beforeArrowsIndex = chunks.length
  for (let i = 0; i < 140; i += 1) {
    term.write('\x1b[D')
    await sleep(8)
  }
  await sleep(700)
  term.write('\x03')
  await sleep(200)
  try {
    term.kill()
  } catch {}

  const allData = chunks.map((chunk) => chunk.data).join('')
  const arrowData = chunks
    .slice(beforeArrowsIndex)
    .map((chunk) => chunk.data)
    .join('')
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const rawPath = path.join(outputDir, `pty-${mode}-${stamp}.raw.txt`)
  const jsonPath = path.join(outputDir, `pty-${mode}-${stamp}.json`)
  const summary = {
    mode,
    platform: process.platform,
    release: os.release(),
    chunkCount: chunks.length,
    totalBytes: Buffer.byteLength(allData),
    arrowChunkCount: chunks.length - beforeArrowsIndex,
    arrowBytes: Buffer.byteLength(arrowData),
    allSequences: summarize(allData),
    arrowSequences: summarize(arrowData),
    largestChunks: [...chunks]
      .sort((a, b) => Buffer.byteLength(b.data) - Buffer.byteLength(a.data))
      .slice(0, 10)
      .map((chunk) => ({ t: chunk.t, bytes: Buffer.byteLength(chunk.data) }))
  }
  writeFileSync(rawPath, allData)
  writeFileSync(jsonPath, `${JSON.stringify({ summary, chunks }, null, 2)}\n`)
  console.log(JSON.stringify({ rawPath, jsonPath, summary }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
