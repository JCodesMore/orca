import { _electron as electron } from '@stablyai/playwright-test'
import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const repoRoot = process.cwd()
const mainPath = path.join(repoRoot, 'out', 'main', 'index.js')
const outputDir = path.join(repoRoot, 'tmp', 'terminal-cursor-diagnostics')

function createDiagnosticRepo() {
  const repoPath = mkdtempSync(path.join(os.tmpdir(), 'orca-cursor-diagnostic-repo-'))
  execSync('git init', { cwd: repoPath, stdio: 'ignore' })
  execSync('git config user.email "cursor-diagnostic@test.local"', { cwd: repoPath, stdio: 'ignore' })
  execSync('git config user.name "Cursor Diagnostic"', { cwd: repoPath, stdio: 'ignore' })
  writeFileSync(path.join(repoPath, 'README.md'), '# Cursor diagnostic\n')
  execSync('git add -A', { cwd: repoPath, stdio: 'ignore' })
  execSync('git commit -m "Initial diagnostic repo"', { cwd: repoPath, stdio: 'ignore' })
  return repoPath
}

function createUserDataDir() {
  const userDataDir = mkdtempSync(path.join(os.tmpdir(), 'orca-cursor-diagnostic-'))
  writeFileSync(
    path.join(userDataDir, 'orca-data.json'),
    `${JSON.stringify(
      {
        settings: {
          telemetry: {
            optedIn: true,
            installId: '00000000-0000-4000-8000-000000000000',
            existedBeforeTelemetryRelease: false
          },
          terminalGpuAcceleration: 'off'
        },
        onboarding: {
          closedAt: 1,
          outcome: 'completed',
          lastCompletedStep: 4
        }
      },
      null,
      2
    )}\n`
  )
  return userDataDir
}

async function addRepoAndOpenTerminal(page, repoPath) {
  console.log('[cursor-diagnostic] waiting for renderer')
  await page.waitForLoadState('domcontentloaded')
  await page.waitForFunction(() => Boolean(window.__store), null, { timeout: 30_000 })
  console.log('[cursor-diagnostic] seeding diagnostic worktree')
  await page.evaluate((repoPathArg) => {
    const store = window.__store
    if (!store) {
      throw new Error('window.__store unavailable')
    }
    const repoId = 'cursor-diagnostic-repo'
    const worktreeId = `${repoId}::${repoPathArg}`
    store.setState({
      workspaceSessionReady: true,
      repos: [
        {
          id: repoId,
          path: repoPathArg,
          displayName: 'Cursor Diagnostic',
          badgeColor: '#64748b',
          addedAt: Date.now(),
          connectionId: null
        }
      ],
      worktreesByRepo: {
        [repoId]: [
          {
            id: worktreeId,
            repoId,
            path: repoPathArg,
            head: 'diagnostic',
            branch: 'refs/heads/main',
            isBare: false,
            isMainWorktree: true,
            displayName: 'Cursor Diagnostic',
            comment: '',
            linkedIssue: null,
            linkedPR: null,
            linkedLinearIssue: null,
            isArchived: false,
            isUnread: false,
            isPinned: false,
            sortOrder: 0,
            lastActivityAt: Date.now()
          }
        ]
      },
      activeView: 'terminal',
      activeWorktreeId: worktreeId,
      activeTabType: 'terminal'
    })
    store.getState().createTab(worktreeId)
    store.getState().setActiveWorktree(worktreeId)
  }, repoPath)
  console.log('[cursor-diagnostic] waiting for terminal pane')
  await page.waitForFunction(
    () => {
      const store = window.__store
      const tabId = store?.getState().activeTabId
      return Boolean(tabId && window.__paneManagers?.get(tabId)?.getPanes?.().length)
    },
    null,
    { timeout: 30_000 }
  )
  await page.waitForFunction(
    () => Boolean(document.querySelector('.xterm-helper-textarea')),
    null,
    { timeout: 15_000 }
  )
  console.log('[cursor-diagnostic] terminal pane ready')
}

async function focusTerminal(page) {
  await page.evaluate(() => {
    const textarea = document.querySelector('.xterm-helper-textarea')
    textarea?.focus()
  })
}

async function installSampler(page) {
  await page.evaluate(() => {
    const globalScope = window
    if (globalScope.__orcaCursorDiagnostic?.running) {
      return
    }
    const store = window.__store
    const tabId = store?.getState().activeTabId
    const manager = tabId ? window.__paneManagers?.get(tabId) : null
    const pane = manager?.getActivePane?.() ?? manager?.getPanes?.()[0] ?? null
    const terminal = pane?.terminal
    if (!pane || !terminal) {
      throw new Error('active terminal pane not available')
    }
    const isHiddenByAncestor = (element) => {
      let node = element
      while (node && node !== pane.container) {
        const style = window.getComputedStyle(node)
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
          return true
        }
        node = node.parentElement
      }
      return false
    }
    const renderService = terminal._core?._renderService
    const cell = renderService?.dimensions?.css?.cell ?? { width: 0, height: 0 }
    const container = pane.container.getBoundingClientRect()
    const xterm = pane.container.querySelector('.xterm')
    const screen = pane.container.querySelector('.xterm-screen')
    const samples = []
    const sample = () => {
      const cursorCandidates = [
        ...pane.container.querySelectorAll(
          '.xterm-cursor, .xterm-cursor-layer .xterm-cursor, .xterm-cursor-layer *'
        )
      ]
        .map((element) => {
          const rect = element.getBoundingClientRect()
          const style = window.getComputedStyle(element)
          const nearestXterm = element.closest('.xterm')
          return {
            className: element.className,
            nearestXtermClassName: nearestXterm?.className ?? '',
            parentClassName: element.parentElement?.className ?? '',
            hiddenByAncestor: isHiddenByAncestor(element),
            left: rect.left - container.left,
            top: rect.top - container.top,
            width: rect.width,
            height: rect.height,
            display: style.display,
            visibility: style.visibility,
            opacity: style.opacity
          }
        })
        .filter(
          (rect) =>
            rect.width > 0 &&
            rect.height > 0 &&
            rect.display !== 'none' &&
            rect.visibility !== 'hidden' &&
            rect.opacity !== '0' &&
            !rect.hiddenByAncestor
        )
      const textarea = pane.container
        .querySelector('.xterm-helper-textarea')
        ?.getBoundingClientRect()
      samples.push({
        time: performance.now(),
        cursorX: terminal.buffer.active.cursorX,
        cursorY: terminal.buffer.active.cursorY,
        baseY: terminal.buffer.active.baseY,
        viewportY: terminal.buffer.active.viewportY,
        cellWidth: cell.width,
        cellHeight: cell.height,
        containerWidth: container.width,
        xtermClassName: xterm?.className ?? '',
        screenClassName: screen?.className ?? '',
        cursorCandidates,
        textarea: textarea
          ? {
              left: textarea.left - container.left,
              top: textarea.top - container.top,
              width: textarea.width,
              height: textarea.height
            }
          : null
      })
      if (globalScope.__orcaCursorDiagnostic?.running) {
        globalScope.__orcaCursorDiagnostic.raf = requestAnimationFrame(sample)
      }
    }
    globalScope.__orcaCursorDiagnostic = { running: true, samples, raf: 0 }
    sample()
  })
}

async function stopSampler(page) {
  return page.evaluate(() => {
    const diagnostic = window.__orcaCursorDiagnostic
    if (!diagnostic) {
      return []
    }
    diagnostic.running = false
    cancelAnimationFrame(diagnostic.raf)
    return diagnostic.samples
  })
}

function summarizeSamples(samples) {
  const withVisualCursor = samples.filter((sample) => sample.cursorCandidates.length > 0)
  const hiddenCursorSampleCount = samples.length - withVisualCursor.length
  const cellWidth = withVisualCursor.find((sample) => sample.cellWidth > 0)?.cellWidth ?? 0
  const anomalies = []
  for (const sample of withVisualCursor) {
    const cursor = sample.cursorCandidates[0]
    if (!cellWidth) {
      continue
    }
    const visualColumn = Math.round(cursor.left / cellWidth)
    const delta = visualColumn - sample.cursorX
    if (Math.abs(delta) > 3) {
      anomalies.push({
        time: sample.time,
        cursorX: sample.cursorX,
        visualColumn,
        delta,
        cursorLeft: cursor.left,
        candidateCount: sample.cursorCandidates.length
      })
    }
  }
  return {
    sampleCount: samples.length,
    visualCursorSampleCount: withVisualCursor.length,
    hiddenCursorSampleCount,
    cellWidth,
    anomalyCount: anomalies.length,
    firstAnomalies: anomalies.slice(0, 25),
    cursorClasses: [
      ...new Set(
        withVisualCursor.flatMap((sample) =>
          sample.cursorCandidates.map((candidate) => String(candidate.className))
        )
      )
    ]
  }
}

async function driveArrowLeftRepro(page) {
  console.log('[cursor-diagnostic] driving ArrowLeft repro')
  await focusTerminal(page)
  await page.evaluate(() => window.__terminalOutputSchedulerDebug?.reset?.())
  await page.keyboard.press('Control+u')
  await page.keyboard.type(
    `ORCA_CURSOR_DIAGNOSTIC_${'abcdefghijklmnopqrstuvwxyz_ABCDEFGHIJKLMNOPQRSTUVWXYZ_0123456789_'.repeat(3)}`,
    { delay: 1 }
  )
  await installSampler(page)
  for (let i = 0; i < 140; i += 1) {
    await page.keyboard.press('ArrowLeft', { delay: 2 })
  }
  await page.waitForTimeout(250)
  const samples = await stopSampler(page)
  const scheduler = await page.evaluate(
    () => window.__terminalOutputSchedulerDebug?.snapshot?.() ?? null
  )
  console.log(`[cursor-diagnostic] collected ${samples.length} frame samples`)
  return { samples, scheduler }
}

async function main() {
  if (!existsSync(mainPath)) {
    throw new Error('out/main/index.js does not exist; run pnpm run build:electron-vite first')
  }
  mkdirSync(outputDir, { recursive: true })
  const userDataDir = createUserDataDir()
  const diagnosticRepo = createDiagnosticRepo()
  const { ELECTRON_RUN_AS_NODE: _unused, ...cleanEnv } = process.env
  void _unused
  const app = await electron.launch({
    args: [mainPath],
    env: {
      ...cleanEnv,
      NODE_ENV: 'development',
      ORCA_E2E_USER_DATA_DIR: userDataDir,
      ORCA_E2E_HEADFUL: '1'
    }
  })
  try {
    console.log('[cursor-diagnostic] launched Electron')
    const page = await app.firstWindow({ timeout: 120_000 })
    await addRepoAndOpenTerminal(page, diagnosticRepo)
    const { samples, scheduler } = await driveArrowLeftRepro(page)
    const summary = summarizeSamples(samples)
    summary.scheduler = scheduler
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const samplesPath = path.join(outputDir, `cursor-samples-${stamp}.json`)
    const summaryPath = path.join(outputDir, `cursor-summary-${stamp}.json`)
    writeFileSync(samplesPath, `${JSON.stringify(samples, null, 2)}\n`)
    writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`)
    console.log(JSON.stringify({ samplesPath, summaryPath, summary }, null, 2))
    if (summary.anomalyCount > 0) {
      throw new Error(`cursor diagnostic failed with ${summary.anomalyCount} visible anomalies`)
    }
  } finally {
    await app.close().catch(() => {})
    rmSync(userDataDir, { recursive: true, force: true })
    rmSync(diagnosticRepo, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
