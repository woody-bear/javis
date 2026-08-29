/* Jarvis Hub 렌더러 — 문서 목록 · 대화 전송 · 음성 녹음(무음 자동 종료) → WAV → STT */
const $ = (id) => document.getElementById(id)

let currentDoc = null
let recording = false
let busy = false
let docOrder = []   // 사이드바 렌더 순서 (제스처 위/아래 이동용)
let docFirstChild = {}   // parentId → 첫 번째 갈래 id (검지 오른쪽 제스처용)

// ── 문서 목록 ─────────────────────────────────────────────────────
let dragState = null   // { id, group }

async function refreshDocs(selectId) {
  const docs = await window.jarvis.docs.list()
  const order = await window.jarvis.docs.getOrder()
  const list = $('docList')
  list.innerHTML = ''

  // 수동 순서 적용: 저장된 순서 우선, 미등록 문서는 뒤에 (mtime 최신순 유지)
  const sortGroup = (items, groupKey) => {
    const saved = order[groupKey] || []
    const idx = (id) => { const i = saved.indexOf(id); return i === -1 ? Infinity : i }
    return [...items].sort((a, b) => idx(a.id) - idx(b.id))
  }

  // 트리 구성: 루트 → 하위 갈래 재귀 (depth 들여쓰기)
  const children = new Map()
  for (const d of docs) {
    if (d.parentId) {
      if (!children.has(d.parentId)) children.set(d.parentId, [])
      children.get(d.parentId).push(d)
    }
  }
  for (const [k, v] of children) children.set(k, sortGroup(v, k))
  docFirstChild = {}
  for (const [k, v] of children) if (v.length) docFirstChild[k] = v[0].id
  const siblingIds = (groupKey) =>
    (groupKey ? (children.get(groupKey) || []) : roots).map((x) => x.id)
  docOrder = []
  const renderItem = (d, depth) => {
    docOrder.push(d.id)
    const el = document.createElement('div')
    el.className = 'doc-item' + (d.id === (selectId ?? currentDoc) ? ' active' : '')
    el.style.paddingLeft = `${10 + depth * 14}px`
    const groupKey = d.parentId || ''

    // ── 마우스 드래그로 같은 그룹 내 순서 조정 ──
    el.draggable = true
    el.addEventListener('dragstart', (e) => {
      dragState = { id: d.id, group: groupKey }
      el.classList.add('dragging')
      e.dataTransfer.effectAllowed = 'move'
    })
    el.addEventListener('dragend', () => {
      el.classList.remove('dragging')
      document.querySelectorAll('.doc-item').forEach((x) => x.classList.remove('drop-above', 'drop-below'))
      dragState = null
    })
    el.addEventListener('dragover', (e) => {
      if (!dragState || dragState.id === d.id || dragState.group !== groupKey) return
      e.preventDefault()
      const r = el.getBoundingClientRect()
      const above = e.clientY < r.top + r.height / 2
      el.classList.toggle('drop-above', above)
      el.classList.toggle('drop-below', !above)
    })
    el.addEventListener('dragleave', () => el.classList.remove('drop-above', 'drop-below'))
    el.addEventListener('drop', async (e) => {
      if (!dragState || dragState.id === d.id || dragState.group !== groupKey) return
      e.preventDefault()
      const r = el.getBoundingClientRect()
      const above = e.clientY < r.top + r.height / 2
      const ids = siblingIds(groupKey).filter((x) => x !== dragState.id)
      const at = ids.indexOf(d.id) + (above ? 0 : 1)
      ids.splice(at, 0, dragState.id)
      await window.jarvis.docs.setOrder(groupKey, ids)
      dragState = null
      refreshDocs()
    })
    el.innerHTML = `${depth > 0 ? '<span class="tw">↳</span>' : ''}<span class="t"></span>` +
      `<button class="branch" title="갈래 만들기 — 이 문서에서 주제 분기">⑂</button>` +
      `<button class="del" title="삭제">✕</button>`
    el.querySelector('.t').textContent = d.title
    el.addEventListener('click', () => selectDoc(d.id))
    el.querySelector('.branch').addEventListener('click', (e) => {
      e.stopPropagation()
      openModal(d.id, d.title)
    })
    el.querySelector('.del').addEventListener('click', async (e) => {
      e.stopPropagation()
      const kids = children.get(d.id)?.length || 0
      const warn = kids ? ` (하위 갈래 ${kids}개는 최상위로 이동)` : ''
      if (!confirm(`"${d.title}" 문서를 삭제할까요?${warn}`)) return
      await window.jarvis.docs.remove(d.id)
      if (currentDoc === d.id) { currentDoc = null; showEmpty() }
      refreshDocs()
    })
    list.appendChild(el)
    for (const c of (children.get(d.id) || [])) renderItem(c, depth + 1)
  }
  const roots = sortGroup(docs.filter((x) => !x.parentId), '')
  for (const d of roots) renderItem(d, 0)
  if (selectId) selectDoc(selectId)
}

function showEmpty() {
  $('docFrame').hidden = true
  $('emptyState').style.display = 'flex'
}

async function refreshDocProject() {
  if (!currentDoc) { $('docBar').hidden = true; return }
  const info = await window.jarvis.docs.getProject(currentDoc)
  const base = (info.effective || '').split('/').filter(Boolean).pop() || info.effective
  $('docProj').textContent = info.isOwn ? `📁 ${base}` : `📁 전역 기본 (${base})`
  $('docProj').classList.toggle('own', info.isOwn)
  $('docProj').title = `작업 프로젝트: ${info.effective}\n클릭해서 이 문서 전용 프로젝트로 변경`
  $('docProjClear').hidden = !info.isOwn
  $('docBar').hidden = false
}
$('docProj').addEventListener('click', async () => {
  if (!currentDoc) return
  await window.jarvis.docs.pickProject(currentDoc)
  refreshDocProject()
})
$('docProjClear').addEventListener('click', async () => {
  if (!currentDoc) return
  await window.jarvis.docs.clearProject(currentDoc)
  refreshDocProject()
})

async function selectDoc(id) {
  currentDoc = id
  refreshDocProject()
  const p = await window.jarvis.docs.path(id)
  const frame = $('docFrame')
  frame.src = `file://${encodeURI(p)}?t=${Date.now()}`
  frame.hidden = false
  $('emptyState').style.display = 'none'
  document.querySelectorAll('.doc-item').forEach((el) => el.classList.remove('active'))
  refreshDocs()  // active 클래스 갱신
  $('input').focus()
}

// 문서 안의 갈래/상위 링크 클릭 → 앱 선택 상태 동기화
$('docFrame').addEventListener('load', () => {
  try {
    const file = decodeURI($('docFrame').contentWindow.location.pathname.split('/').pop() || '')
    if (file && file.endsWith('.html') && file !== currentDoc) {
      currentDoc = file
      refreshDocs()
    }
  } catch { /* cross-origin 등 접근 불가 시 무시 */ }
})

function reloadFrame() {
  if (!currentDoc) return
  const frame = $('docFrame')
  const base = frame.src.split('?')[0]
  frame.src = `${base}?t=${Date.now()}`
}

// ── 새 문서 / 갈래 모달 ───────────────────────────────────────────
let branchParent = null   // null = 최상위 문서, 값 있으면 해당 문서의 갈래
function openModal(parentId, parentTitle) {
  branchParent = parentId || null
  document.querySelector('.modal-title').textContent =
    branchParent ? `"${parentTitle}" 의 갈래 주제` : '새 주제 / 질문'
  $('modal').hidden = false
  $('modalInput').value = ''
  $('modalInput').focus()
}
$('btnNewDoc').addEventListener('click', () => openModal(null, null))
$('modalCancel').addEventListener('click', () => { $('modal').hidden = true })
async function createDoc() {
  const title = $('modalInput').value.trim()
  if (!title) return
  $('modal').hidden = true
  if (branchParent) {
    const { id } = await window.jarvis.docs.createBranch(branchParent, title)
    await refreshDocs(id)
    sendMessage(`상위 문서의 맥락을 읽고, 갈래 주제 "${title}"를 시작한다. 이 갈래에서 발전시킬 내용을 정리해 문서를 채워줘.`)
  } else {
    const { id } = await window.jarvis.docs.create(title)
    await refreshDocs(id)
    // 제목이 곧 첫 질문 — 바로 내용 생성 요청
    sendMessage(`"${title}" 주제로 문서를 시작한다. 이 주제에 대해 아는 것을 정리해 문서를 채워줘.`)
  }
}
$('modalOk').addEventListener('click', createDoc)
$('modalInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') createDoc() })

// ── 대화 전송 ─────────────────────────────────────────────────────
function setBusy(v, label) {
  busy = v
  $('btnSend').disabled = v
  $('btnMic').disabled = v && !recording
  $('activity').hidden = !v
  if (label) $('activityText').textContent = label
}

async function sendMessage(text) {
  if (!text || busy) return
  if (!currentDoc) { alert('먼저 문서를 만들거나 선택하세요 (＋ 버튼)'); return }
  setBusy(true, 'Claude 작업 중… (ESC로 중단)')
  procReset()
  procAppend('', `<span class="pl-tool">▶</span> ${esc(text)}`)
  const reply = $('lastReply')
  reply.style.color = ''
  reply.textContent = `▶ 요청: ${text}`   // 인식/입력된 내용을 먼저 텍스트로 확인
  reply.hidden = false
  const res = await window.jarvis.chat.send(currentDoc, text)
  setBusy(false)
  reloadFrame()
  refreshDocs()
  reply.textContent = `▶ 요청: ${text}\n${res.text || (res.ok ? '완료' : '실패')}`
  if (!res.ok) reply.style.color = 'var(--rec)'
}

$('btnSend').addEventListener('click', () => {
  const t = $('input').value.trim()
  if (!t) return
  $('input').value = ''
  autoGrow()
  sendMessage(t)
})
$('input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    $('btnSend').click()
  }
})
function autoGrow() {
  const el = $('input')
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, 140)}px`
}
$('input').addEventListener('input', autoGrow)

// ── 작업 과정 로그 ────────────────────────────────────────────────
function procAppend(cls, html) {
  const log = $('procLog')
  const el = document.createElement('div')
  el.className = `pl-line ${cls}`
  el.innerHTML = html
  log.appendChild(el)
  log.scrollTop = log.scrollHeight
  // 라인 수 제한 (렌더 보호)
  while (log.childElementCount > 400) log.removeChild(log.firstChild)
}
function procReset() {
  $('procLog').innerHTML = ''
  $('procWrap').hidden = false
  $('procLog').classList.remove('collapsed')
  $('procToggle').textContent = '▾'
}
function esc(t) {
  const d = document.createElement('span'); d.textContent = t ?? ''; return d.innerHTML
}
$('procToggle').addEventListener('click', () => {
  const log = $('procLog')
  const collapsed = log.classList.toggle('collapsed')
  $('procToggle').textContent = collapsed ? '▸' : '▾'
})

window.jarvis.chat.onEvent((ev) => {
  if (ev.kind === 'tool') {
    $('activityText').textContent = `도구 실행: ${ev.name}`
    procAppend('', `<span class="pl-tool">⚙ ${esc(ev.name)}</span> ${esc(ev.detail || '')}`)
  }
  if (ev.kind === 'text' || ev.kind === 'thinking') {
    $('activityText').textContent = (ev.text || '').slice(0, 90)
    procAppend('pl-text', `💬 ${esc(ev.text)}`)
  }
  if (ev.kind === 'tool_result') {
    procAppend(ev.error ? 'pl-err' : 'pl-result', `${ev.error ? '✗' : '↳'} ${esc(ev.text || (ev.error ? '오류' : '완료'))}`)
  }
})

// ── 음성 녹음 (무음 자동 종료) → 16k WAV → STT ────────────────────
const SILENCE_MS = 1600      // 발화 후 이 시간 무음이면 종료
const MAX_MS = 45000
const RMS_THRESHOLD = 0.012

let audioCtx = null
let recStream = null
let recNodes = []
let chunks = []
let stopTimer = null

async function startRecording() {
  recStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
  audioCtx = new AudioContext()
  const src = audioCtx.createMediaStreamSource(recStream)
  const proc = audioCtx.createScriptProcessor(4096, 1, 1)
  chunks = []
  let spoke = false
  let lastVoice = Date.now()
  const startedAt = Date.now()

  proc.onaudioprocess = (e) => {
    const data = e.inputBuffer.getChannelData(0)
    chunks.push(new Float32Array(data))
    let sum = 0
    for (let i = 0; i < data.length; i++) sum += data[i] * data[i]
    const rms = Math.sqrt(sum / data.length)
    const now = Date.now()
    if (rms > RMS_THRESHOLD) { spoke = true; lastVoice = now }
    if ((spoke && now - lastVoice > SILENCE_MS) || now - startedAt > MAX_MS) stopRecording(true)
  }
  src.connect(proc)
  proc.connect(audioCtx.destination)
  recNodes = [src, proc]
  recording = true
  $('btnMic').classList.add('rec')
  $('recDot').classList.add('live')
  $('input').placeholder = '듣고 있습니다… 말이 끝나면 자동으로 전송됩니다'
}

async function stopRecording(transcribeIt) {
  if (!recording) return
  recording = false
  for (const n of recNodes) { try { n.disconnect() } catch { /* noop */ } }
  recNodes = []
  const sampleRate = audioCtx ? audioCtx.sampleRate : 48000
  if (recStream) recStream.getTracks().forEach((t) => t.stop())
  if (audioCtx) { try { await audioCtx.close() } catch { /* noop */ } }
  audioCtx = null; recStream = null
  clearTimeout(stopTimer)
  $('btnMic').classList.remove('rec')
  $('recDot').classList.remove('live')
  $('input').placeholder = '피드백을 입력하거나 🎙 로 말하세요…  (Enter 전송 · Shift+Enter 줄바꿈)'
  if (!transcribeIt || chunks.length === 0) return

  setBusy(true, '음성 인식 중…')
  const wav = encodeWav16k(chunks, sampleRate)
  chunks = []
  const res = await window.jarvis.stt.transcribe(wav)
  setBusy(false)
  if (res.ok && res.text) {
    // 인식된 질문을 '요청:' 에코로 표시한 뒤 바로 실행
    sendMessage(res.text)
  } else if (!res.ok) {
    const reply = $('lastReply')
    reply.textContent = res.text
    reply.style.color = 'var(--rec)'
    reply.hidden = false
  }
}

$('btnMic').addEventListener('click', () => {
  if (recording) stopRecording(true)
  else startRecording().catch((e) => alert(`마이크 접근 실패: ${e.message}`))
})

/** Float32 청크 배열 → 16kHz mono 16-bit WAV ArrayBuffer */
function encodeWav16k(float32Chunks, srcRate) {
  let total = 0
  for (const c of float32Chunks) total += c.length
  const merged = new Float32Array(total)
  let off = 0
  for (const c of float32Chunks) { merged.set(c, off); off += c.length }

  const targetRate = 16000
  const ratio = srcRate / targetRate
  const outLen = Math.floor(merged.length / ratio)
  const pcm = new Int16Array(outLen)
  for (let i = 0; i < outLen; i++) {
    // 간단 구간 평균 다운샘플
    const start = Math.floor(i * ratio)
    const end = Math.min(Math.floor((i + 1) * ratio), merged.length)
    let sum = 0
    for (let j = start; j < end; j++) sum += merged[j]
    const v = sum / Math.max(end - start, 1)
    pcm[i] = Math.max(-1, Math.min(1, v)) * 0x7fff
  }

  const buf = new ArrayBuffer(44 + pcm.length * 2)
  const dv = new DataView(buf)
  const writeStr = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)) }
  writeStr(0, 'RIFF'); dv.setUint32(4, 36 + pcm.length * 2, true); writeStr(8, 'WAVE')
  writeStr(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true)
  dv.setUint32(24, targetRate, true); dv.setUint32(28, targetRate * 2, true)
  dv.setUint16(32, 2, true); dv.setUint16(34, 16, true)
  writeStr(36, 'data'); dv.setUint32(40, pcm.length * 2, true)
  new Int16Array(buf, 44).set(pcm)
  return buf
}

// ── 설정 ──────────────────────────────────────────────────────────
async function loadConfig() {
  const cfg = await window.jarvis.config.get()
  $('projPath').textContent = cfg.projectPath
  $('chkWake').checked = !!cfg.wakeMode
  if (cfg.wakeMode) startWake().catch(() => { $('chkWake').checked = false })
  $('chkGesture').checked = !!cfg.gestureMode
  if (cfg.gestureMode) startGesture().catch(() => { $('chkGesture').checked = false })
  const stt = await window.jarvis.stt.ready()
  const el = $('sttStatus')
  if (stt.bin && stt.model) { el.textContent = 'STT 준비됨 (whisper 로컬)'; el.classList.remove('err') }
  else {
    el.textContent = !stt.bin ? 'STT 미설치 — brew install whisper-cpp' : 'STT 모델 없음 — ~/JarvisHub/models'
    el.classList.add('err')
  }
}
$('projRow').addEventListener('click', async () => {
  const cfg = await window.jarvis.config.pickProject()
  $('projPath').textContent = cfg.projectPath
})

// ── ESC — 녹음 취소 또는 실행 중 작업 중단 ────────────────────────
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return
  if (!$('modal').hidden) { $('modal').hidden = true; return }
  if (recording) { stopRecording(false); return }   // 녹음 취소 (전송 안 함)
  if (busy) {
    window.jarvis.chat.abort()
    $('activityText').textContent = '중단하는 중…'
  }
})


// ── "자비스" 호출어 대기 모드 ─────────────────────────────────────
// 마이크를 상시로 열어두고 발화 구간(에너지 기반)만 잘라 로컬 whisper로 인식.
// "자비스"로 시작하면: 뒤에 명령이 붙어 있으면 바로 실행, 호출어만 말했으면
// 띵- 소리 후 일반 녹음 모드로 전환해 명령을 듣는다. 외부 서비스 불필요.
const WAKE_RMS = 0.015
const UTT_SIL_MS = 900       // 발화 종료 판정 무음
const UTT_MAX_MS = 8000
const UTT_MIN_MS = 350
const WAKE_RE = /(자비스|쟈비스|자비수|자비쓰|jarvis)[야아이,.!?~\s]*(.*)/i

let wakeOn = false
let wakeCtx = null
let wakeStream = null
let wakeNodes = []
let wakeSttBusy = false

function ding() {
  try {
    const ac = new AudioContext()
    const o = ac.createOscillator()
    const g = ac.createGain()
    o.frequency.value = 880
    g.gain.setValueAtTime(0.12, ac.currentTime)
    g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.25)
    o.connect(g); g.connect(ac.destination)
    o.start(); o.stop(ac.currentTime + 0.26)
    setTimeout(() => ac.close(), 400)
  } catch { /* noop */ }
}

async function handleUtterance(chunks, sampleRate) {
  if (wakeSttBusy || busy || recording) return
  wakeSttBusy = true
  try {
    const wav = encodeWav16k(chunks, sampleRate)
    const res = await window.jarvis.stt.transcribe(wav)
    const t = ((res.ok && res.text) || '').replace(/\s+/g, ' ').trim()
    if (!t) return
    const m = t.match(WAKE_RE)
    if (!m) return
    const cmd = (m[2] || '').trim()
    if (cmd.length >= 2) {
      ding()
      sendMessage(cmd)
    } else {
      // 호출어만 — 띵 소리 후 명령 듣기
      ding()
      startRecording().catch(() => {})
    }
  } finally {
    wakeSttBusy = false
  }
}

async function startWake() {
  if (wakeOn) return
  wakeStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
  wakeCtx = new AudioContext()
  const src = wakeCtx.createMediaStreamSource(wakeStream)
  const proc = wakeCtx.createScriptProcessor(4096, 1, 1)
  const preRoll = []          // 직전 ~0.35초 (호출어 앞부분 소실 방지)
  let uttActive = false
  let uttChunks = []
  let uttStart = 0
  let uttLastVoice = 0

  proc.onaudioprocess = (e) => {
    const data = e.inputBuffer.getChannelData(0)
    const copy = new Float32Array(data)
    let sum = 0
    for (let i = 0; i < data.length; i++) sum += data[i] * data[i]
    const rms = Math.sqrt(sum / data.length)
    const now = Date.now()

    preRoll.push(copy)
    if (preRoll.length > 4) preRoll.shift()

    // 수동 녹음/작업/인식 중에는 대기 감지 일시정지
    if (recording || busy || wakeSttBusy) { uttActive = false; uttChunks = []; return }

    if (!uttActive && rms > WAKE_RMS) {
      uttActive = true
      uttChunks = [...preRoll]
      uttStart = now
      uttLastVoice = now
    } else if (uttActive) {
      uttChunks.push(copy)
      if (rms > WAKE_RMS) uttLastVoice = now
      if (now - uttLastVoice > UTT_SIL_MS || now - uttStart > UTT_MAX_MS) {
        const seg = uttChunks
        const durMs = now - uttStart - (now - uttLastVoice)
        uttActive = false
        uttChunks = []
        if (durMs >= UTT_MIN_MS) handleUtterance(seg, wakeCtx.sampleRate)
      }
    }
  }
  src.connect(proc)
  proc.connect(wakeCtx.destination)
  wakeNodes = [src, proc]
  wakeOn = true
  $('recDot').classList.add('standby')
  $('wakeStatus').textContent = '대기 중 — "자비스, ○○해줘"라고 말하세요'
}

async function stopWake() {
  if (!wakeOn) return
  wakeOn = false
  for (const n of wakeNodes) { try { n.disconnect() } catch { /* noop */ } }
  wakeNodes = []
  if (wakeStream) wakeStream.getTracks().forEach((t) => t.stop())
  if (wakeCtx) { try { await wakeCtx.close() } catch { /* noop */ } }
  wakeStream = null; wakeCtx = null
  $('recDot').classList.remove('standby')
  $('wakeStatus').textContent = ''
}

$('chkWake').addEventListener('change', async (e) => {
  const on = e.target.checked
  window.jarvis.config.set({ wakeMode: on })
  try {
    if (on) await startWake()
    else await stopWake()
  } catch (err) {
    e.target.checked = false
    window.jarvis.config.set({ wakeMode: false })
    $('wakeStatus').textContent = `마이크 접근 실패: ${err.message}`
  }
})


// ── ✊ 주먹 제스처 대기 (카메라) ───────────────────────────────────
// MediaPipe GestureRecognizer(로컬 WASM·모델) — 'Closed_Fist' 연속 감지 시 녹음 시작.
const GESTURE_FPS_MS = 120        // ~8fps — CPU 절약
const GESTURE_SCORE = 0.55
const GESTURE_HITS = 3            // 연속 프레임 수 (오인식 방지)
const GESTURE_COOLDOWN_MS = 4000

let gestureOn = false
let gestureRecognizer = null
let gestureStream = null
let gestureTimer = null
let gestureHits = 0
let gestureLastFire = 0

/** 목록 이동 피드백용 짧은 틱 사운드 */
function tick() {
  try {
    const ac = new AudioContext()
    const o = ac.createOscillator(); const g = ac.createGain()
    o.frequency.value = 520
    g.gain.setValueAtTime(0.06, ac.currentTime)
    g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.09)
    o.connect(g); g.connect(ac.destination); o.start(); o.stop(ac.currentTime + 0.1)
    setTimeout(() => ac.close(), 200)
  } catch { /* noop */ }
}

function navigateDoc(delta) {
  if (!docOrder.length) return
  let idx = docOrder.indexOf(currentDoc)
  if (idx === -1) idx = delta > 0 ? -1 : 0
  const ni = Math.max(0, Math.min(docOrder.length - 1, idx + delta))
  if (docOrder[ni] === currentDoc) return
  tick()
  selectDoc(docOrder[ni])
}

function navigateInto() {
  const child = docFirstChild[currentDoc]
  if (!child) return   // 갈래 없음
  tick()
  selectDoc(child)
}

/** 손 랜드마크로 '검지만 편 손' 방향 판정 → 'up' | 'down' | 'right' | 'left' | null */
function pointingDir(lm) {
  const w = lm[0]
  const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)
  // 검지가 펴져 있고 (끝이 두 번째 관절보다 손목에서 멀리)
  if (d(lm[8], w) < d(lm[6], w) * 1.05) return null
  // 중지·약지·소지는 접혀 있어야 (주먹/보자기와 구분)
  const folded = (tip, pip) => d(tip, w) < d(pip, w)
  if (!folded(lm[12], lm[10]) || !folded(lm[16], lm[14]) || !folded(lm[20], lm[18])) return null
  // 방향 판정: MCP→검지끝 벡터의 지배축 (y 아래 증가, x는 카메라 원본 기준 — 사용자 오른쪽 = 이미지 왼쪽)
  const dy = lm[8].y - lm[5].y
  const dx = lm[8].x - lm[5].x
  if (Math.abs(dy) >= Math.abs(dx)) {
    if (Math.abs(dy) < 0.12) return null
    return dy < 0 ? 'up' : 'down'
  }
  if (Math.abs(dx) < 0.14) return null
  return dx < 0 ? 'right' : 'left'   // 미러 매핑: 사용자가 자기 오른쪽을 가리키면 'right'
}

const NAV_COOLDOWN_MS = 750
let navHits = 0
let navLastDir = null
let navLastFire = 0

async function startGesture() {
  if (gestureOn) return
  $('gestureStatus').textContent = '카메라·모델 로딩 중…'
  const video = $('gestureCam')
  gestureStream = await navigator.mediaDevices.getUserMedia({
    video: { width: 640, height: 480, frameRate: 15 },
  })
  video.srcObject = gestureStream
  await video.play()

  if (!gestureRecognizer) {
    const vision = await import('./vendor/tasks-vision/vision_bundle.mjs')
    const fileset = await vision.FilesetResolver.forVisionTasks('./vendor/tasks-vision/wasm')
    gestureRecognizer = await vision.GestureRecognizer.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: './vendor/models/gesture_recognizer.task' },
      runningMode: 'VIDEO',
      numHands: 1,
    })
  }

  gestureHits = 0
  gestureTimer = setInterval(() => {
    if (!gestureOn || recording || busy || wakeSttBusy) { gestureHits = 0; return }
    if (video.readyState < 2) return
    let result
    try { result = gestureRecognizer.recognizeForVideo(video, performance.now()) } catch { return }
    const g = result && result.gestures && result.gestures[0] && result.gestures[0][0]
    const lm = result && result.landmarks && result.landmarks[0]
    if (g && g.categoryName === 'Closed_Fist' && g.score >= GESTURE_SCORE) {
      gestureHits += 1
      navHits = 0
      if (gestureHits >= GESTURE_HITS && Date.now() - gestureLastFire > GESTURE_COOLDOWN_MS) {
        gestureLastFire = Date.now()
        gestureHits = 0
        ding()
        startRecording().catch(() => {})
      }
    } else {
      gestureHits = 0
      // ☝ 검지 위/아래 — 문서 목록 한 칸 이동
      const dir = lm ? pointingDir(lm) : null
      if (dir && dir === navLastDir) navHits += 1
      else { navHits = dir ? 1 : 0; navLastDir = dir }
      if (dir && navHits >= 2 && Date.now() - navLastFire > NAV_COOLDOWN_MS) {
        navLastFire = Date.now()
        navHits = 0
        if (dir === 'up') navigateDoc(-1)
        else if (dir === 'down') navigateDoc(1)
        else if (dir === 'right') navigateInto()   // 세부문서(첫 갈래)로 진입
        // 'left'는 예약 (현재 미사용)
      }
    }
  }, GESTURE_FPS_MS)

  gestureOn = true
  $('gestureStatus').textContent = '대기 중 — ✊ 듣기 · ☝ 위/아래 이동 · 👉 오른쪽: 세부문서 진입'
}

async function stopGesture() {
  if (!gestureOn) return
  gestureOn = false
  if (gestureTimer) { clearInterval(gestureTimer); gestureTimer = null }
  if (gestureStream) { gestureStream.getTracks().forEach((t) => t.stop()); gestureStream = null }
  $('gestureCam').srcObject = null
  $('gestureStatus').textContent = ''
}

$('chkGesture').addEventListener('change', async (e) => {
  const on = e.target.checked
  window.jarvis.config.set({ gestureMode: on })
  try {
    if (on) await startGesture()
    else await stopGesture()
  } catch (err) {
    e.target.checked = false
    window.jarvis.config.set({ gestureMode: false })
    $('gestureStatus').textContent = `카메라/모델 로드 실패: ${(err && err.message) || err}`
  }
})

// init
async function initDocs() {
  await refreshDocs()
  if (currentDoc) return
  const docs = await window.jarvis.docs.list()
  if (docs.length) {
    // '처음에 만든' 문서 = 생성 시각이 가장 오래된 문서
    const first = docs.reduce((a, b) => ((a.birthtime ?? a.mtime) <= (b.birthtime ?? b.mtime) ? a : b))
    selectDoc(first.id)
  }
}
initDocs()
loadConfig()
