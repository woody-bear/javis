/* Jarvis Hub 렌더러 — 문서 목록 · 대화 전송 · 음성 녹음(무음 자동 종료) → WAV → STT */
const $ = (id) => document.getElementById(id)

let currentDoc = null
let recording = false
let busy = false

// ── 문서 목록 ─────────────────────────────────────────────────────
async function refreshDocs(selectId) {
  const docs = await window.jarvis.docs.list()
  const list = $('docList')
  list.innerHTML = ''
  for (const d of docs) {
    const el = document.createElement('div')
    el.className = 'doc-item' + (d.id === (selectId ?? currentDoc) ? ' active' : '')
    el.innerHTML = `<span class="t"></span><button class="del" title="삭제">✕</button>`
    el.querySelector('.t').textContent = d.title
    el.addEventListener('click', () => selectDoc(d.id))
    el.querySelector('.del').addEventListener('click', async (e) => {
      e.stopPropagation()
      if (!confirm(`"${d.title}" 문서를 삭제할까요?`)) return
      await window.jarvis.docs.remove(d.id)
      if (currentDoc === d.id) { currentDoc = null; showEmpty() }
      refreshDocs()
    })
    list.appendChild(el)
  }
  if (selectId) selectDoc(selectId)
}

function showEmpty() {
  $('docFrame').hidden = true
  $('emptyState').style.display = 'flex'
}

async function selectDoc(id) {
  currentDoc = id
  const p = await window.jarvis.docs.path(id)
  const frame = $('docFrame')
  frame.src = `file://${encodeURI(p)}?t=${Date.now()}`
  frame.hidden = false
  $('emptyState').style.display = 'none'
  document.querySelectorAll('.doc-item').forEach((el) => el.classList.remove('active'))
  refreshDocs()  // active 클래스 갱신
  $('input').focus()
}

function reloadFrame() {
  if (!currentDoc) return
  const frame = $('docFrame')
  const base = frame.src.split('?')[0]
  frame.src = `${base}?t=${Date.now()}`
}

// ── 새 문서 모달 ──────────────────────────────────────────────────
$('btnNewDoc').addEventListener('click', () => {
  $('modal').hidden = false
  $('modalInput').value = ''
  $('modalInput').focus()
})
$('modalCancel').addEventListener('click', () => { $('modal').hidden = true })
async function createDoc() {
  const title = $('modalInput').value.trim()
  if (!title) return
  $('modal').hidden = true
  const { id } = await window.jarvis.docs.create(title)
  await refreshDocs(id)
  // 제목이 곧 첫 질문 — 바로 내용 생성 요청
  sendMessage(`"${title}" 주제로 문서를 시작한다. 이 주제에 대해 아는 것을 정리해 문서를 채워줘.`)
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

window.jarvis.chat.onEvent((ev) => {
  if (ev.kind === 'tool') $('activityText').textContent = `도구 실행: ${ev.name}`
  if (ev.kind === 'thinking') $('activityText').textContent = ev.text.slice(0, 90)
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

// init
refreshDocs()
loadConfig()
