/** Jarvis Hub — 메인 프로세스.
 *
 * 데이터: ~/JarvisHub/{docs/*.html, models/, config.json, sessions.json}
 * 두뇌: 로컬 `claude -p`(헤드리스, stream-json) — 문서 보강 + 프로젝트 소스 작업
 * STT: whisper-cli (brew whisper-cpp) + ggml-small-q8_0 · TTS: macOS `say -v Yuna`
 */
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron')
const { spawn, execFile } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const HUB_DIR = path.join(os.homedir(), 'JarvisHub')
// 문서는 자비스 프로젝트 저장소에 차곡차곡 쌓인다 (config.docsPath로 변경 가능)
const DEFAULT_DOCS_DIR = path.join(os.homedir(), 'workflow', 'jarvis', 'docs')
const MODELS_DIR = path.join(HUB_DIR, 'models')
const CONFIG_PATH = path.join(HUB_DIR, 'config.json')
const SESSIONS_PATH = path.join(HUB_DIR, 'sessions.json')
const MODEL_FILE = 'ggml-small-q8_0.bin'

let win = null
let claudeProc = null   // 진행 중인 claude 프로세스 (동시 1개)
let sayProc = null

// ── 스토리지 ──────────────────────────────────────────────────────
function docsDir() {
  const cfg = readJson(CONFIG_PATH, {})
  return cfg.docsPath || DEFAULT_DOCS_DIR
}
function ensureDirs() {
  for (const d of [HUB_DIR, docsDir(), MODELS_DIR]) fs.mkdirSync(d, { recursive: true })
}
function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return fallback }
}
function writeJson(p, v) { fs.writeFileSync(p, JSON.stringify(v, null, 2)) }

function getConfig() {
  return {
    projectPath: os.homedir(),
    docsPath: DEFAULT_DOCS_DIR,
    voice: 'Yuna',
    speakReplies: true,
    ...readJson(CONFIG_PATH, {}),
  }
}
function setConfig(patch) {
  const next = { ...getConfig(), ...patch }
  writeJson(CONFIG_PATH, next)
  return next
}

// ── 문서 관리 ─────────────────────────────────────────────────────
function slugify(title) {
  const base = title.trim().replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'doc'
  let name = `${base}.html`
  let i = 2
  while (fs.existsSync(path.join(docsDir(), name))) { name = `${base}-${i}.html`; i += 1 }
  return name
}
function docTitle(file) {
  try {
    const head = fs.readFileSync(path.join(docsDir(), file), 'utf8').slice(0, 4096)
    const m = /<title>([^<]*)<\/title>/i.exec(head)
    if (m && m[1].trim()) return m[1].trim()
  } catch { /* noop */ }
  return file.replace(/\.html$/, '')
}
function listDocs() {
  ensureDirs()
  return fs.readdirSync(docsDir())
    .filter((f) => f.endsWith('.html'))
    .map((f) => {
      const st = fs.statSync(path.join(docsDir(), f))
      return { id: f, title: docTitle(f), mtime: st.mtimeMs }
    })
    .sort((a, b) => b.mtime - a.mtime)
}
function skeletonHtml(title) {
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  body{background:#1b1a18;color:#ece9e3;font-family:"Apple SD Gothic Neo",sans-serif;
       line-height:1.7;max-width:760px;margin:0 auto;padding:40px 24px;font-size:15px}
  h1{font-size:26px;line-height:1.3} h2{font-size:18px;margin-top:36px;border-top:1px solid #3a3733;padding-top:16px}
  code{background:#26241f;padding:1px 6px;border-radius:4px;font-size:.88em}
  .meta{color:#8d877c;font-size:12px}
</style></head><body>
<h1>${title}</h1>
<p class="meta">Jarvis 문서 · 음성/텍스트 피드백으로 보강됩니다</p>
<p>(아직 내용이 없습니다 — 아래 입력창에 질문이나 지시를 보내면 채워집니다)</p>
</body></html>\n`
}

// ── Claude 실행 ───────────────────────────────────────────────────
function findClaude() {
  const candidates = [
    path.join(os.homedir(), '.local/bin/claude'),
    '/opt/homebrew/bin/claude', '/usr/local/bin/claude',
  ]
  for (const c of candidates) if (fs.existsSync(c)) return c
  return 'claude'
}

function systemPrompt(docPath) {
  return [
    '너는 "Jarvis"라는 로컬 소통창구 앱의 백엔드 에이전트다. 사용자와 음성/텍스트로 대화한다.',
    `이 대화의 살아있는 문서: ${docPath}`,
    '규칙:',
    '1) 사용자의 질문/피드백 내용을 반영해 위 HTML 문서를 직접 수정(Write/Edit)해 보강한다.',
    '   문서는 self-contained 한국어 HTML(다크 배경 유지)로, 대화가 쌓일수록 좋은 참조 문서가 되게 다듬어라.',
    '2) 소스코드·프로젝트 작업을 요청하면 현재 작업 디렉토리의 프로젝트에서 실제로 수행하고,',
    '   수행 결과 요약을 문서 하단 "작업 로그" 섹션(없으면 생성, 최신이 위)에 날짜와 함께 추가한다.',
    '3) 최종 응답 텍스트는 음성으로 낭독된다 — 2문장 이내, 한국어로 간결하게. 코드/경로 나열 금지.',
  ].join('\n')
}

function runClaude(docId, message, sender) {
  if (claudeProc) return Promise.reject(new Error('이전 작업이 아직 실행 중입니다'))
  const cfg = getConfig()
  const docPath = path.join(docsDir(), docId)
  const sessions = readJson(SESSIONS_PATH, {})
  const prev = sessions[docId]

  const args = [
    '-p', message,
    '--output-format', 'stream-json', '--verbose',
    '--append-system-prompt', systemPrompt(docPath),
    '--dangerously-skip-permissions',
  ]
  if (prev) args.push('--resume', prev)
  // 문서 디렉토리 접근 허용 (cwd 밖 파일 수정)
  args.push('--add-dir', docsDir())

  const emit = (ev) => { if (sender && !sender.isDestroyed()) sender.send('chat:event', ev) }

  return new Promise((resolve) => {
    const proc = spawn(findClaude(), args, {
      cwd: cfg.projectPath,
      env: { ...process.env },
    })
    claudeProc = proc
    let buf = ''
    let resultText = ''
    let sessionId = prev || null
    let stderr = ''

    proc.stdout.on('data', (chunk) => {
      buf += chunk.toString()
      let idx
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim()
        buf = buf.slice(idx + 1)
        if (!line) continue
        let ev
        try { ev = JSON.parse(line) } catch { continue }
        if (ev.type === 'system' && ev.subtype === 'init' && ev.session_id) sessionId = ev.session_id
        if (ev.type === 'assistant' && ev.message && Array.isArray(ev.message.content)) {
          for (const c of ev.message.content) {
            if (c.type === 'tool_use') emit({ kind: 'tool', name: c.name })
            if (c.type === 'text' && c.text) emit({ kind: 'thinking', text: c.text.slice(0, 200) })
          }
        }
        if (ev.type === 'result') {
          resultText = ev.result || ''
          if (ev.session_id) sessionId = ev.session_id
        }
      }
    })
    proc.stderr.on('data', (d) => { stderr += d.toString() })
    proc.on('close', (code) => {
      claudeProc = null
      if (sessionId) {
        const s = readJson(SESSIONS_PATH, {})
        s[docId] = sessionId
        writeJson(SESSIONS_PATH, s)
      }
      if (code === 0) {
        resolve({ ok: true, text: resultText })
      } else {
        // resume 실패(만료 세션 등) → 세션 초기화 안내
        const s = readJson(SESSIONS_PATH, {})
        delete s[docId]
        writeJson(SESSIONS_PATH, s)
        resolve({ ok: false, text: (stderr || resultText || `claude 종료 코드 ${code}`).slice(0, 400) })
      }
    })
    proc.on('error', (e) => {
      claudeProc = null
      resolve({ ok: false, text: `claude 실행 실패: ${e.message}` })
    })
  })
}

// ── STT (whisper.cpp) ─────────────────────────────────────────────
function findWhisper() {
  for (const c of ['/opt/homebrew/bin/whisper-cli', '/usr/local/bin/whisper-cli',
                   '/opt/homebrew/bin/whisper-cpp', '/usr/local/bin/whisper-cpp']) {
    if (fs.existsSync(c)) return c
  }
  return null
}
function transcribe(wavBuffer) {
  return new Promise((resolve) => {
    const bin = findWhisper()
    const model = path.join(MODELS_DIR, MODEL_FILE)
    if (!bin) return resolve({ ok: false, text: 'whisper-cli가 없습니다 — brew install whisper-cpp' })
    if (!fs.existsSync(model)) return resolve({ ok: false, text: `모델이 없습니다 — ${model}` })
    const tmp = path.join(os.tmpdir(), `jarvis-${Date.now()}.wav`)
    fs.writeFileSync(tmp, wavBuffer)
    execFile(bin, ['-m', model, '-f', tmp, '-l', 'ko', '-nt', '-np', '-t', '4'],
      { timeout: 60_000, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => {
        try { fs.unlinkSync(tmp) } catch { /* noop */ }
        if (err) return resolve({ ok: false, text: `인식 실패: ${err.message.slice(0, 200)}` })
        resolve({ ok: true, text: stdout.replace(/\s+/g, ' ').trim() })
      })
  })
}

// ── TTS (macOS say) ───────────────────────────────────────────────
function speak(text) {
  stopSpeak()
  const cfg = getConfig()
  if (!cfg.speakReplies || !text) return
  sayProc = spawn('/usr/bin/say', ['-v', cfg.voice, text.slice(0, 500)])
  sayProc.on('close', () => { sayProc = null })
}
function stopSpeak() {
  if (sayProc) { try { sayProc.kill() } catch { /* noop */ } sayProc = null }
}

// ── IPC ───────────────────────────────────────────────────────────
function registerIpc() {
  ipcMain.handle('docs:list', () => listDocs())
  ipcMain.handle('docs:create', (_e, title) => {
    ensureDirs()
    const id = slugify(title)
    fs.writeFileSync(path.join(docsDir(), id), skeletonHtml(title))
    return { id }
  })
  ipcMain.handle('docs:delete', (_e, id) => {
    const p = path.join(docsDir(), path.basename(id))
    if (fs.existsSync(p)) fs.unlinkSync(p)
    const s = readJson(SESSIONS_PATH, {})
    delete s[id]
    writeJson(SESSIONS_PATH, s)
    return { ok: true }
  })
  ipcMain.handle('docs:path', (_e, id) => path.join(docsDir(), path.basename(id)))
  ipcMain.handle('docs:reveal', (_e, id) => shell.showItemInFolder(path.join(docsDir(), path.basename(id))))

  ipcMain.handle('chat:send', async (e, { docId, text }) => {
    const res = await runClaude(docId, text, e.sender)
    if (res.ok && res.text) speak(res.text)
    return res
  })
  ipcMain.handle('chat:busy', () => !!claudeProc)

  ipcMain.handle('stt:transcribe', async (_e, wavArrayBuffer) => transcribe(Buffer.from(wavArrayBuffer)))
  ipcMain.handle('stt:ready', () => {
    const bin = findWhisper()
    const model = fs.existsSync(path.join(MODELS_DIR, MODEL_FILE))
    return { bin: !!bin, model }
  })

  ipcMain.handle('tts:stop', () => { stopSpeak(); return true })

  ipcMain.handle('config:get', () => getConfig())
  ipcMain.handle('config:set', (_e, patch) => setConfig(patch))
  ipcMain.handle('config:pickProject', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'], title: '프로젝트 폴더 선택' })
    if (r.canceled || !r.filePaths[0]) return getConfig()
    return setConfig({ projectPath: r.filePaths[0] })
  })
}

// ── 윈도우 ────────────────────────────────────────────────────────
function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 860,
    minWidth: 900, minHeight: 600,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#161513',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'))
}

app.whenReady().then(() => {
  ensureDirs()
  registerIpc()
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})
app.on('window-all-closed', () => { stopSpeak(); app.quit() })
