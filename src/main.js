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
    wakeMode: false,
    gestureMode: false,
    model: '',   // '' = Claude Code 기본 설정 따름 (전역 — 모든 문서·프로젝트 동일 적용)
    ...readJson(CONFIG_PATH, {}),
  }
}
function setConfig(patch) {
  const next = { ...getConfig(), ...patch }
  writeJson(CONFIG_PATH, next)
  return next
}

// ── 문서 트리 (갈래) — docs/.doctree.json: { childId: parentId } ──
function treePath() { return path.join(docsDir(), '.doctree.json') }
function orderPath() { return path.join(docsDir(), '.docorder.json') }
function docProjectsPath() { return path.join(docsDir(), '.docprojects.json') }
function rootsPath() { return path.join(docsDir(), '.docroots.json') }

/** 문서에 연결된 프로젝트 — 자신에 없으면 상위 갈래로 거슬러 올라가 상속 */
function docProject(docId) {
  const m = readJson(docProjectsPath(), {})
  const tree = readTree()
  let cur = docId
  for (let hop = 0; cur && hop < 12; hop += 1) {
    const v = m[cur]
    if (v && fs.existsSync(v)) return v
    cur = tree[cur]
  }
  return null
}

/** 문서 파일이 실제로 놓인 폴더 — 프로젝트 연결 시 <프로젝트>/jarvis, 아니면 중앙 docs */
function docRoots() { return readJson(rootsPath(), {}) }
function rootOf(id) {
  const r = docRoots()[id]
  return r && fs.existsSync(r) ? r : docsDir()
}
function docFile(id) { return path.join(rootOf(id), path.basename(id)) }

/** 하위 갈래 전체 (자신 제외, 깊이 우선) */
function descendantsOf(id) {
  const tree = readTree()
  const out = []
  const walk = (p) => {
    for (const [c, par] of Object.entries(tree)) {
      if (par === p) { out.push(c); walk(c) }
    }
  }
  walk(id)
  return out
}

/** 문서+하위 갈래를 targetDir로 물리 이동 (중앙 docs면 루트 매핑 제거) */
function moveDocTree(id, targetDir) {
  fs.mkdirSync(targetDir, { recursive: true })
  const roots = docRoots()
  const central = docsDir()
  for (const d of [id, ...descendantsOf(id)]) {
    const from = docFile(d)
    const to = path.join(targetDir, path.basename(d))
    if (from !== to && fs.existsSync(from)) fs.renameSync(from, to)
    if (path.resolve(targetDir) === path.resolve(central)) delete roots[d]
    else roots[d] = targetDir
  }
  writeJson(rootsPath(), roots)
}
function readTree() { return readJson(treePath(), {}) }
function writeTree(t) { writeJson(treePath(), t) }

/** 상위 문서의 '갈래' 섹션에 하위 문서 링크 추가 (md/html 자동 판별, 없으면 섹션 생성) */
function addBranchLink(parentId, childId, childTitle) {
  const pp = docFile(parentId)
  if (!fs.existsSync(pp)) return
  let doc = fs.readFileSync(pp, 'utf8')
  if (parentId.endsWith('.md')) {
    const li = `- [${childTitle}](${childId})`
    if (/^## 갈래\s*$/m.test(doc)) {
      doc = doc.replace(/^## 갈래\s*$/m, `## 갈래\n\n${li}`)
    } else {
      doc = `${doc.replace(/\s*$/, '')}\n\n## 갈래\n\n${li}\n`
    }
  } else {
    const li = `<li><a href="${childId}" style="color:#d99a3d">${childTitle}</a></li>`
    if (doc.includes('<ul id="branches">')) {
      doc = doc.replace('<ul id="branches">', `<ul id="branches">\n${li}`)
    } else {
      const block = `<h2>갈래</h2>\n<ul id="branches">\n${li}\n</ul>\n`
      doc = doc.includes('</body>') ? doc.replace('</body>', `${block}</body>`) : doc + block
    }
  }
  fs.writeFileSync(pp, doc)
}
function removeBranchLink(parentId, childId) {
  const pp = docFile(parentId)
  if (!fs.existsSync(pp)) return
  const html = fs.readFileSync(pp, 'utf8')
  const re = new RegExp(`\\s*<li><a href="${childId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>[^<]*</a></li>`, 'g')
  fs.writeFileSync(pp, html.replace(re, ''))
}

// ── 문서 관리 ─────────────────────────────────────────────────────
function slugify(title) {
  const base = title.trim().replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'doc'
  const dirs = [docsDir(), ...new Set(Object.values(docRoots()))]
  const taken = (n) => dirs.some((d) =>
    fs.existsSync(path.join(d, `${n}.md`)) || fs.existsSync(path.join(d, `${n}.html`)))
  let name = base
  let i = 2
  while (taken(name)) { name = `${base}-${i}`; i += 1 }
  return `${name}.md`
}
function docTitle(file) {
  try {
    const head = fs.readFileSync(docFile(file), 'utf8').slice(0, 4096)
    if (file.endsWith('.md')) {
      const m = /^#\s+(.+)$/m.exec(head)
      if (m && m[1].trim()) return m[1].trim()
    } else {
      const m = /<title>([^<]*)<\/title>/i.exec(head)
      if (m && m[1].trim()) return m[1].trim()
    }
  } catch { /* noop */ }
  return file.replace(/\.(html|md)$/, '')
}
function listDocs() {
  ensureDirs()
  const tree = readTree()
  // 중앙 docs + 프로젝트별 jarvis 폴더에 흩어진 문서를 모두 나열
  const entry = new Map()
  for (const f of fs.readdirSync(docsDir())) {
    if (f.endsWith('.html') || f.endsWith('.md')) entry.set(f, path.join(docsDir(), f))
  }
  for (const [id, dir] of Object.entries(docRoots())) {
    const fp = path.join(dir, path.basename(id))
    if (fs.existsSync(fp)) entry.set(id, fp)
  }
  const files = new Set(entry.keys())
  return [...files]
    .map((f) => {
      const st = fs.statSync(entry.get(f))
      const parent = tree[f]
      return {
        id: f, title: docTitle(f), mtime: st.mtimeMs, birthtime: st.birthtimeMs,
        // 상위 문서가 삭제됐으면 루트로 취급
        parentId: parent && files.has(parent) ? parent : null,
      }
    })
    .sort((a, b) => b.mtime - a.mtime)
}
function skeletonHtml(title, parentId, parentTitle) {
  const parentLink = parentId ? `↰ 상위 문서: [${parentTitle || parentId}](${parentId})\n\n` : ''
  return `# ${title}

${parentLink}> Jarvis 문서 · 음성/텍스트 피드백으로 보강됩니다 · 블록을 클릭하면 직접 편집

## ✅ 완성된 기능

- (아직 없음)

## ➕ 추가할 기능

- (아이디어를 말하면 여기에 쌓입니다)

## 🔧 개선할 기능

- (완성된 기능의 보완점이 여기로 옮겨집니다)
`
}
function baseSkeleton(title, parentLink) {
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
${parentLink}<p class="meta">Jarvis 문서 · 음성/텍스트 피드백으로 보강됩니다</p>

<h2>✅ 완성된 기능</h2>
<ul id="done"><li class="meta">아직 없음</li></ul>

<h2>➕ 추가할 기능</h2>
<ul id="todo"><li class="meta">아이디어를 말하면 여기에 쌓입니다</li></ul>

<h2>🔧 개선할 기능</h2>
<ul id="improve"><li class="meta">완성된 기능의 보완점이 여기로 옮겨집니다</li></ul>
</body></html>\n`
}

/** 문서 id 변경 시 모든 매핑(세션·트리·순서·프로젝트·루트·부모 링크) 일괄 갱신 */
function renameDocId(oldId, newId) {
  const ss = readJson(SESSIONS_PATH, {})
  if (ss[oldId]) { ss[newId] = ss[oldId]; delete ss[oldId]; writeJson(SESSIONS_PATH, ss) }
  const tree = readTree()
  let changed = false
  if (tree[oldId] !== undefined) { tree[newId] = tree[oldId]; delete tree[oldId]; changed = true }
  for (const k of Object.keys(tree)) if (tree[k] === oldId) { tree[k] = newId; changed = true }
  if (changed) writeTree(tree)
  const o = readJson(orderPath(), {})
  let oc = false
  for (const g of Object.keys(o)) {
    const i = (o[g] || []).indexOf(oldId)
    if (i >= 0) { o[g][i] = newId; oc = true }
  }
  if (o[oldId]) { o[newId] = o[oldId]; delete o[oldId]; oc = true }
  if (oc) writeJson(orderPath(), o)
  for (const pth of [docProjectsPath(), rootsPath()]) {
    const m = readJson(pth, {})
    if (m[oldId] !== undefined) { m[newId] = m[oldId]; delete m[oldId]; writeJson(pth, m) }
  }
  const parent = readTree()[newId]
  if (parent && fs.existsSync(docFile(parent))) {
    const f = docFile(parent)
    fs.writeFileSync(f, fs.readFileSync(f, 'utf8').split(oldId).join(newId))
  }
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

function systemPrompt(docPath, parentPath) {
  return [
    '너는 "Jarvis"라는 로컬 소통창구 앱의 백엔드 에이전트다. 사용자와 음성/텍스트로 대화한다.',
    `이 대화의 살아있는 문서: ${docPath}`,
    ...(parentPath ? [
      `이 문서는 상위 문서의 '갈래'다 — 상위 문서: ${parentPath}`,
      '상위 문서의 맥락을 이어받아 이 갈래의 주제를 더 깊게 발전시켜라. 상위 문서와 중복 서술하지 말 것.',
    ] : []),
    '규칙:',
    docPath.endsWith('.md')
      ? '1) 사용자의 질문/피드백 내용을 반영해 위 Markdown 문서를 직접 수정(Write/Edit)해 보강한다. 한국어. HTML 태그는 <details> 외 사용 금지.'
      : '1) 사용자의 질문/피드백 내용을 반영해 위 HTML 문서를 직접 수정(Write/Edit)해 보강한다. 문서는 self-contained 한국어 HTML(다크 배경 유지).',
    '1-a) 문서 상단(제목 바로 아래)에 다음 3개 섹션(헤딩)을 항상 유지·갱신한다 (없으면 생성):',
    '   "## ✅ 완성된 기능" · "## ➕ 추가할 기능" · "## 🔧 개선할 기능"',
    '   - 새 아이디어/요청 → "추가할 기능"에 항목 추가 후 대화로 발전시킨다.',
    '   - 구현이 끝난 항목 → "완성된 기능"으로 옮기고, 보완 여지는 "개선할 기능"에 후속 항목으로 남긴다.',
    '   - 개선까지 반영되면 해당 개선 항목을 완성으로 승격한다. 섹션 제목·id는 바꾸지 않는다.',
    '1-b) "완성된 기능"의 각 항목에는 <details><summary>변화 과정</summary>…</details>를 붙여,',
    '   연결된 프로젝트(cwd)의 git 로그를 조회(git log --oneline, 필요 시 -- 파일경로)해 그 기능과 관련된',
    '   주요 커밋 해시·메시지를 시간순으로 정리한다. 기능을 완성/갱신할 때마다 이 목록을 최신화한다.',
    '2) 소스코드·프로젝트 작업을 요청하면 현재 작업 디렉토리의 프로젝트에서 실제로 수행하고,',
    '   수행 결과 요약을 문서 하단 "작업 로그" 섹션(없으면 생성, 최신이 위)에 날짜와 함께 추가한다.',
    '3) 최종 응답 형식(텍스트로 표시됨): 첫 줄에 "이해한 요청: …" 으로 네가 이해한 바를 한 줄 요약하고,',
    '   다음 줄부터 수행한 내용을 3줄 이내로 정리한다. 한국어.',
  ].join('\n')
}

/** 도구 입력에서 로그에 보여줄 핵심 한 줄 추출 (Bash 명령·파일 경로 등) */
function toolDetail(input) {
  if (!input || typeof input !== 'object') return ''
  const pick = (v) => String(v ?? '').replace(/\s+/g, ' ').slice(0, 160)
  for (const k of ['command', 'file_path', 'pattern', 'path', 'query', 'url', 'description']) {
    if (input[k]) return pick(input[k])
  }
  const first = Object.keys(input)[0]
  return first ? pick(input[first]) : ''
}

function runClaude(docId, message, sender) {
  if (claudeProc) return Promise.reject(new Error('이전 작업이 아직 실행 중입니다'))
  const cfg = getConfig()
  const docPath = docFile(docId)
  const parentId = readTree()[docId]
  const parentPath = parentId && fs.existsSync(docFile(parentId)) ? docFile(parentId) : null
  const sessions = readJson(SESSIONS_PATH, {})
  const prev = sessions[docId]

  const args = [
    '-p', message,
    '--output-format', 'stream-json', '--verbose',
    '--append-system-prompt', systemPrompt(docPath, parentPath),
    '--dangerously-skip-permissions',
  ]
  if (cfg.model) args.push('--model', cfg.model)
  if (prev) args.push('--resume', prev)
  // 문서 디렉토리 접근 허용 (중앙 + 이 문서의 저장 폴더)
  args.push('--add-dir', docsDir())
  const own = rootOf(docId)
  if (path.resolve(own) !== path.resolve(docsDir())) args.push('--add-dir', own)

  const emit = (ev) => { if (sender && !sender.isDestroyed()) sender.send('chat:event', ev) }

  const cwd = docProject(docId) || cfg.projectPath
  return new Promise((resolve) => {
    const proc = spawn(findClaude(), args, {
      cwd,
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
            if (c.type === 'tool_use') emit({ kind: 'tool', name: c.name, detail: toolDetail(c.input) })
            if (c.type === 'text' && c.text) emit({ kind: 'text', text: c.text.slice(0, 600) })
          }
        }
        // 도구 실행 결과 (성공/실패 + 미리보기)
        if (ev.type === 'user' && ev.message && Array.isArray(ev.message.content)) {
          for (const c of ev.message.content) {
            if (c.type === 'tool_result') {
              let preview = ''
              if (typeof c.content === 'string') preview = c.content
              else if (Array.isArray(c.content)) {
                preview = c.content.filter((x) => x.type === 'text').map((x) => x.text).join(' ')
              }
              emit({
                kind: 'tool_result',
                error: c.is_error === true,
                text: String(preview || '').replace(/\s+/g, ' ').slice(0, 160),
              })
            }
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
      const wasAborted = proc.aborted === true
      claudeProc = null
      if (sessionId) {
        const s = readJson(SESSIONS_PATH, {})
        s[docId] = sessionId
        writeJson(SESSIONS_PATH, s)
      }
      if (wasAborted) {
        // 사용자 ESC 중단 — 세션은 보존 (다음 피드백에서 이어짐)
        resolve({ ok: false, aborted: true, text: '⏹ 중단했습니다' })
      } else if (code === 0) {
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
    fs.writeFileSync(path.join(docsDir(), id), skeletonHtml(title, null, null))
    return { id }
  })
  ipcMain.handle('docs:createBranch', (_e, { parentId, title }) => {
    ensureDirs()
    const id = slugify(title)
    // 하위 갈래는 상위 문서의 저장 폴더(프로젝트/jarvis)에 자동 배치
    const dir = rootOf(parentId)
    fs.writeFileSync(path.join(dir, id), skeletonHtml(title, parentId, docTitle(parentId)))
    if (path.resolve(dir) !== path.resolve(docsDir())) {
      const roots = docRoots()
      roots[id] = dir
      writeJson(rootsPath(), roots)
    }
    const tree = readTree()
    tree[id] = parentId
    writeTree(tree)
    addBranchLink(parentId, id, title)
    return { id }
  })
  ipcMain.handle('docs:delete', (_e, id) => {
    const p = docFile(id)
    if (fs.existsSync(p)) fs.unlinkSync(p)
    const s = readJson(SESSIONS_PATH, {})
    delete s[id]
    writeJson(SESSIONS_PATH, s)
    // 트리 정리: 본인 항목 제거 + 상위 문서의 갈래 링크 제거, 하위 갈래는 루트로 승격
    const tree = readTree()
    if (tree[id]) removeBranchLink(tree[id], id)
    delete tree[id]
    for (const k of Object.keys(tree)) if (tree[k] === id) delete tree[k]
    writeTree(tree)
    const pm = readJson(docProjectsPath(), {})
    delete pm[id]
    writeJson(docProjectsPath(), pm)
    const roots = docRoots()
    delete roots[id]
    writeJson(rootsPath(), roots)
    return { ok: true }
  })
  ipcMain.handle('docs:path', (_e, id) => docFile(id))
  ipcMain.handle('docs:read', (_e, id) => {
    try { return fs.readFileSync(docFile(id), 'utf8') } catch { return '' }
  })
  // 문서 제목 변경 — 파일 id는 유지(세션·매핑 불변), 첫 H1(md) 또는 <title>(html)만 교체
  ipcMain.handle('docs:rename', (_e, { id, title }) => {
    const t = String(title || '').replace(/[\r\n]+/g, ' ').trim()
    if (!t) return { ok: false, error: '제목이 비어 있습니다' }
    const f = docFile(id)
    if (!fs.existsSync(f)) return { ok: false, error: '문서 파일이 없습니다' }
    let src = fs.readFileSync(f, 'utf8')
    if (id.endsWith('.md')) {
      if (/^#\s+.+$/m.test(src)) src = src.replace(/^#\s+.+$/m, `# ${t}`)
      else src = `# ${t}\n\n${src}`
    } else {
      if (/<title>[^<]*<\/title>/i.test(src)) src = src.replace(/<title>[^<]*<\/title>/i, `<title>${t}</title>`)
      else src = src.replace(/<head[^>]*>/i, (m) => `${m}<title>${t}</title>`)
    }
    fs.writeFileSync(f, src)
    return { ok: true, title: t }
  })
  ipcMain.handle('docs:write', (_e, { id, content }) => {
    fs.writeFileSync(docFile(id), content)
    return { ok: true }
  })
  // 레거시 HTML 문서 → Markdown 전환 (블록 편집용). content = 변환된 md.
  ipcMain.handle('docs:convertToMd', (_e, { id, content }) => {
    const dir = rootOf(id)
    let newId = path.basename(id).replace(/\.html$/, '.md')
    let i = 2
    while (fs.existsSync(path.join(dir, newId))) { newId = path.basename(id).replace(/\.html$/, `-${i}.md`); i += 1 }
    fs.writeFileSync(path.join(dir, newId), content)
    if (path.resolve(dir) !== path.resolve(docsDir())) {
      const roots = docRoots()
      roots[newId] = dir
      writeJson(rootsPath(), roots)
    }
    try { fs.unlinkSync(path.join(dir, path.basename(id))) } catch { /* noop */ }
    renameDocId(id, newId)
    return { id: newId }
  })
  // 수동 정렬 순서 — { "": [루트 ids], "<parentId>": [하위 ids] }
  ipcMain.handle('docs:getOrder', () => readJson(orderPath(), {}))
  ipcMain.handle('docs:projectsMap', () => readJson(docProjectsPath(), {}))
  ipcMain.handle('docs:getProject', (_e, id) => {
    const m = readJson(docProjectsPath(), {})
    const own = m[id] && fs.existsSync(m[id]) ? m[id] : null
    const walked = docProject(id)
    return {
      path: own,
      effective: walked || getConfig().projectPath,
      isOwn: !!own,
      inherited: !own && !!walked,   // 상위 갈래에서 상속
    }
  })
  ipcMain.handle('docs:pickProject', async (_e, id) => {
    const r = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
      title: '이 문서와 연결할 프로젝트 폴더 선택',
      defaultPath: path.join(os.homedir(), 'workflow'),
    })
    if (!r.canceled && r.filePaths[0]) {
      const proj = r.filePaths[0]
      const m = readJson(docProjectsPath(), {})
      m[id] = proj
      writeJson(docProjectsPath(), m)
      // 문서(+하위 갈래)를 <프로젝트>/jarvis 폴더로 이동 — 이후 갈래도 이 폴더에 생성됨
      moveDocTree(id, path.join(proj, 'jarvis'))
    }
    const own = docProject(id)
    return { path: own, effective: own || getConfig().projectPath, isOwn: !!own }
  })
  ipcMain.handle('docs:clearProject', (_e, id) => {
    const m = readJson(docProjectsPath(), {})
    delete m[id]
    writeJson(docProjectsPath(), m)
    // 문서(+하위 갈래)를 중앙 docs 폴더로 회수
    moveDocTree(id, docsDir())
    return { path: null, effective: getConfig().projectPath, isOwn: false }
  })
  ipcMain.handle('docs:setOrder', (_e, { group, ids }) => {
    const o = readJson(orderPath(), {})
    o[group || ''] = ids
    writeJson(orderPath(), o)
    return { ok: true }
  })
  ipcMain.handle('docs:reveal', (_e, id) => shell.showItemInFolder(path.join(docsDir(), path.basename(id))))

  ipcMain.handle('chat:send', async (e, { docId, text }) => {
    try {
      return await runClaude(docId, text, e.sender)
    } catch (err) {
      return { ok: false, text: (err && err.message) || '실행 실패' }
    }
  })
  ipcMain.handle('chat:busy', () => !!claudeProc)
  ipcMain.handle('app:toggleFullscreen', () => {
    if (!win || win.isDestroyed()) return false
    const next = !win.isFullScreen()
    win.setFullScreen(next)
    return next
  })
  ipcMain.handle('chat:abort', () => {
    if (!claudeProc) return false
    const proc = claudeProc
    try {
      proc.aborted = true
      proc.kill('SIGTERM')
      // 3초 내 안 죽으면 강제 종료 — 반드시 '그' 프로세스만 (참조 캡처, exitCode 확인)
      setTimeout(() => {
        try { if (proc.exitCode === null && !proc.killed) proc.kill('SIGKILL') } catch { /* noop */ }
      }, 3000)
    } catch { /* noop */ }
    return true
  })

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

// ── ~/workflow 프로젝트 자동 스캔 — 새 프로젝트 → 메인 분석 문서 자동 생성 ──
const WORKFLOW_DIR = path.join(os.homedir(), 'workflow')
const SCAN_INTERVAL_MS = 10 * 60 * 1000

function scanWorkflowProjects() {
  let created = []
  try {
    if (!fs.existsSync(WORKFLOW_DIR)) return created
    const linked = new Set(Object.values(readJson(docProjectsPath(), {})).map((v) => path.resolve(v)))
    for (const name of fs.readdirSync(WORKFLOW_DIR)) {
      if (name.startsWith('.')) continue
      const proj = path.join(WORKFLOW_DIR, name)
      try { if (!fs.statSync(proj).isDirectory()) continue } catch { continue }
      if (linked.has(path.resolve(proj))) continue   // 이미 메인 문서가 연결된 프로젝트
      // 메인 문서 생성 → <프로젝트>/jarvis/ 에 배치 + 프로젝트 연결
      const id = slugify(name)
      const dir = path.join(proj, 'jarvis')
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, id), skeletonHtml(name, null, null))
      const roots = docRoots()
      roots[id] = dir
      writeJson(rootsPath(), roots)
      const pm = readJson(docProjectsPath(), {})
      pm[id] = proj
      writeJson(docProjectsPath(), pm)
      created.push({ id, name, project: proj })
      logToRenderer(`프로젝트 감지: ${name} → 메인 문서 생성`)
    }
  } catch (e) { console.error('workflow scan 실패:', e) }
  if (created.length && win && !win.isDestroyed()) {
    win.webContents.send('docs:autocreated', created)
  }
  return created
}
function logToRenderer(msg) {
  if (win && !win.isDestroyed()) win.webContents.send('app:notice', msg)
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
      // 로컬 개인용 앱 — MediaPipe wasm/모델을 file://에서 fetch하기 위해 완화
      webSecurity: false,
    },
  })
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'))
}

app.whenReady().then(() => {
  ensureDirs()
  registerIpc()
  createWindow()
  // 앱 시작 3초 후 + 주기적으로 workflow 프로젝트 스캔
  setTimeout(scanWorkflowProjects, 3000)
  setInterval(scanWorkflowProjects, SCAN_INTERVAL_MS)
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})
function killClaude() {
  if (!claudeProc) return
  const proc = claudeProc
  try {
    proc.aborted = true
    proc.kill('SIGTERM')
    setTimeout(() => {
      try { if (proc.exitCode === null && !proc.killed) proc.kill('SIGKILL') } catch { /* noop */ }
    }, 2000)
  } catch { /* noop */ }
}
app.on('before-quit', killClaude)
app.on('window-all-closed', () => { stopSpeak(); killClaude(); app.quit() })
