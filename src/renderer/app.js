/* Jarvis Hub 렌더러 — 문서 목록 · 대화 전송 · 음성 녹음(무음 자동 종료) → WAV → STT */
const $ = (id) => document.getElementById(id)

let currentDoc = null
let recording = false
let busy = false
let docOrder = []   // 사이드바 렌더 순서 (제스처 위/아래 이동용)
let docFirstChild = {}   // parentId → 첫 번째 갈래 id (검지 오른쪽 제스처용)
let docParent = {}       // childId → parentId (검지 왼쪽: 상위 문서 이동용)

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
  docParent = {}
  for (const d of docs) if (d.parentId) docParent[d.id] = d.parentId

  // 선택된 문서의 최상위(메인) 문서만 갈래를 펼친다 — 메인 클릭 → 하단에 갈래 순서대로 표시
  const parentOf = new Map(docs.map((x) => [x.id, x.parentId]))
  const rootIdOf = (id) => {
    let cur = id
    for (let i = 0; cur && parentOf.get(cur) && i < 12; i += 1) cur = parentOf.get(cur)
    return cur
  }
  const sel = selectId ?? currentDoc
  const expandedRoot = sel ? rootIdOf(sel) : null
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
    const kids0 = children.get(d.id) || []
    const caret = depth === 0 && kids0.length
      ? `<span class="tw">${d.id === expandedRoot ? '▾' : '▸'}</span>`
      : depth > 0 ? '<span class="tw">↳</span>' : ''
    el.innerHTML = `${caret}<span class="t"></span>` +
      `<button class="rename" title="이름 변경 (더블클릭도 가능)">✎</button>` +
      `<button class="branch" title="갈래 만들기 — 이 문서에서 주제 분기">⑂</button>` +
      `<button class="del" title="삭제">✕</button>`
    el.querySelector('.t').textContent = d.title
    el.addEventListener('click', () => { if (!el.classList.contains('editing')) selectDoc(d.id) })
    // ── 이름 변경: ✎ 버튼 또는 제목 더블클릭 → 인라인 입력 (Enter 저장 / Esc 취소) ──
    const startRename = (e) => {
      e.stopPropagation()
      if (el.classList.contains('editing')) return
      el.classList.add('editing')
      el.draggable = false
      const t = el.querySelector('.t')
      const input = document.createElement('input')
      input.className = 'rename-input'
      input.value = d.title
      t.replaceWith(input)
      input.focus(); input.select()
      let done = false
      const finish = async (save) => {
        if (done) return
        done = true
        const nt = input.value.trim()
        input.replaceWith(t)
        el.classList.remove('editing')
        el.draggable = true
        if (!save || !nt || nt === d.title) return
        const r = await window.jarvis.docs.rename(d.id, nt)
        if (!r || !r.ok) { alert((r && r.error) || '이름 변경 실패'); return }
        if (currentDoc === d.id) reloadFrame()
        refreshDocs()
      }
      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') { ev.preventDefault(); finish(true) }
        else if (ev.key === 'Escape') { ev.preventDefault(); finish(false) }
        ev.stopPropagation()
      })
      input.addEventListener('blur', () => finish(true))
      input.addEventListener('click', (ev) => ev.stopPropagation())
    }
    el.querySelector('.rename').addEventListener('click', startRename)
    el.addEventListener('dblclick', startRename)
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
    // 갈래는 선택된 메인 문서 아래에서만 펼침 (하위 갈래는 항상 따라 펼침)
    if (depth > 0 || d.id === expandedRoot) {
      for (const c of (children.get(d.id) || [])) renderItem(c, depth + 1)
    }
  }
  const roots = sortGroup(docs.filter((x) => !x.parentId), '')
  mapRoots = roots.map((r) => r.id)
  for (const d of roots) renderItem(d, 0)
  if (selectId) selectDoc(selectId)
}

function showEmpty() {
  $('docFrame').hidden = true
  $('mdView').hidden = true
  $('docBar').hidden = true
  $('emptyState').style.display = 'flex'
}

async function refreshDocProject() {
  if (!currentDoc) { $('docBar').hidden = true; return }
  const info = await window.jarvis.docs.getProject(currentDoc)
  const base = (info.effective || '').split('/').filter(Boolean).pop() || info.effective
  $('docProj').textContent = info.isOwn
    ? `📁 ${base}`
    : info.inherited
      ? `📁 ${base} (상위 문서에서 상속)`
      : `📁 전역 기본 (${base})`
  $('docProj').classList.toggle('own', !!info.isOwn || !!info.inherited)
  $('docProj').title = `작업 프로젝트: ${info.effective}` +
    (info.isOwn ? '\n이 문서에 직접 연결됨 — 문서는 <프로젝트>/jarvis/에 저장' :
     info.inherited ? '\n상위 갈래 문서의 연결을 상속' : '\n미연결 — 전역 기본 프로젝트 사용') +
    '\n클릭해서 이 문서 전용 프로젝트로 변경'
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

async function convertCurrentToMd() {
  if (!currentDoc || !currentDoc.endsWith('.html')) return
  const html = await window.jarvis.docs.read(currentDoc)
  const dom = new DOMParser().parseFromString(html, 'text/html')
  dom.querySelectorAll('style, script').forEach((n) => n.remove())
  const [{ default: TurndownService }, gfm] = await Promise.all([
    import('./vendor/turndown.es.js'),
    import('./vendor/turndown-gfm.es.js'),
  ])
  const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' })
  td.use(gfm.gfm)
  td.keep(['details', 'summary'])
  const md = td.turndown(dom.body ? dom.body.innerHTML : html).trim() + '\n'
  const { id } = await window.jarvis.docs.convertToMd(currentDoc, md)
  await refreshDocs(id)
}
$('docConvert').addEventListener('click', convertCurrentToMd)

async function selectDoc(id) {
  currentDoc = id
  refreshDocProject()
  $('docConvert').hidden = !id.endsWith('.html')
  $('emptyState').style.display = 'none'
  if (id.endsWith('.md')) {
    // 마크다운 문서 — 노션식 블록 편집 뷰
    $('docFrame').hidden = true
    $('mdView').hidden = false
    await renderMd(id)
  } else {
    // 레거시 HTML 문서 — iframe 뷰
    $('mdView').hidden = true
    const p = await window.jarvis.docs.path(id)
    const frame = $('docFrame')
    frame.src = `file://${encodeURI(p)}?t=${Date.now()}`
    frame.hidden = false
  }
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
  if (currentDoc.endsWith('.md')) {
    renderMd(currentDoc, true)
    return
  }
  const frame = $('docFrame')
  const base = frame.src.split('?')[0]
  frame.src = `${base}?t=${Date.now()}`
}

// ── 마크다운 블록 편집기 (노션 스타일) ─────────────────────────────
// 문서를 빈 줄 기준 블록으로 쪼개 렌더 — 블록 클릭 → 원문 마크다운 편집 →
// Cmd+Enter/포커스아웃 저장, ESC 취소. 코드펜스(```)는 한 블록으로 유지.
let markedMod = null
let mdBlocks = []          // 현재 문서의 블록(원문 마크다운) 배열
let mdEditing = false
let blockDrag = null       // { from } — 블록 드래그 이동 상태

async function getMarked() {
  if (!markedMod) {
    const m = await import('./vendor/marked.esm.js')
    markedMod = m.marked
    markedMod.setOptions({ gfm: true, breaks: false })
  }
  return markedMod
}

function splitBlocks(md) {
  const lines = md.replace(/\r\n/g, '\n').split('\n')
  const blocks = []
  let cur = []
  let inFence = false
  let detailsDepth = 0   // <details> 내부의 빈 줄에서는 블록을 자르지 않음 (아코디언 분리 버그 방지)
  for (const ln of lines) {
    if (/^```/.test(ln.trim())) { inFence = !inFence; cur.push(ln); continue }
    if (!inFence) {
      detailsDepth += (ln.match(/<details\b/gi) || []).length
      detailsDepth -= (ln.match(/<\/details>/gi) || []).length
      if (detailsDepth < 0) detailsDepth = 0
    }
    if (!inFence && detailsDepth === 0 && ln.trim() === '') {
      if (cur.length) { blocks.push(cur.join('\n')); cur = [] }
    } else {
      cur.push(ln)
    }
  }
  if (cur.length) blocks.push(cur.join('\n'))
  return blocks
}

async function saveBlocks() {
  const content = mdBlocks.join('\n\n') + '\n'
  await window.jarvis.docs.write(currentDoc, content)
}

async function renderMd(id, keepScroll = false) {
  if (mdEditing) return   // 편집 중엔 외부 갱신으로 덮지 않음
  const marked = await getMarked()
  const view = $('mdView')
  const scroll = keepScroll ? view.scrollTop : 0
  const md = await window.jarvis.docs.read(id)
  mdBlocks = splitBlocks(md)
  view.innerHTML = ''
  mdBlocks.forEach((blk, i) => view.appendChild(renderBlock(marked, blk, i)))
  const add = document.createElement('button')
  add.id = 'mdAdd'
  add.textContent = '＋ 블록 추가'
  add.addEventListener('click', () => {
    mdBlocks.push('')
    renderMdAndEdit(mdBlocks.length - 1)
  })
  view.appendChild(add)
  view.scrollTop = scroll
}

async function renderMdAndEdit(idx) {
  await renderMd(currentDoc, true)
  const el = $('mdView').querySelectorAll('.blk')[idx]
  if (el) el.dispatchEvent(new Event('jarvis-edit'))
}

function renderBlock(marked, blk, i) {
  const el = document.createElement('div')
  el.className = 'blk'
  const body = document.createElement('div')
  body.className = 'blk-body'
  body.innerHTML = marked.parse(blk)
  el.appendChild(body)
  const acts = document.createElement('div')
  acts.className = 'blk-acts'
  acts.innerHTML = `<button class="a-md" title="마크다운 원문으로 편집">‹›</button>` +
    `<button class="a-add" title="아래에 블록 추가">＋</button><button class="a-del" title="블록 삭제">✕</button>`
  el.appendChild(acts)

  // ── 노션식 블록 드래그 이동 (좌측 ⋮⋮ 핸들) ──
  const handle = document.createElement('div')
  handle.className = 'blk-handle'
  handle.title = '드래그해서 블록 이동'
  handle.textContent = '⋮⋮'
  handle.draggable = true
  el.prepend(handle)
  handle.addEventListener('dragstart', (e) => {
    if (mdEditing) { e.preventDefault(); return }
    blockDrag = { from: i }
    el.classList.add('dragging')
    e.dataTransfer.effectAllowed = 'move'
  })
  handle.addEventListener('dragend', () => {
    el.classList.remove('dragging')
    document.querySelectorAll('.blk').forEach((x) => x.classList.remove('drop-above', 'drop-below'))
    blockDrag = null
  })
  el.addEventListener('dragover', (e) => {
    if (!blockDrag || blockDrag.from === i) return
    e.preventDefault()
    const r = el.getBoundingClientRect()
    const above = e.clientY < r.top + r.height / 2
    el.classList.toggle('drop-above', above)
    el.classList.toggle('drop-below', !above)
  })
  el.addEventListener('dragleave', () => el.classList.remove('drop-above', 'drop-below'))
  el.addEventListener('drop', async (e) => {
    if (!blockDrag || blockDrag.from === i) return
    e.preventDefault()
    const r = el.getBoundingClientRect()
    const above = e.clientY < r.top + r.height / 2
    const from = blockDrag.from
    blockDrag = null
    const [moved] = mdBlocks.splice(from, 1)
    let at = i + (above ? 0 : 1)
    if (from < i) at -= 1
    mdBlocks.splice(at, 0, moved)
    await saveBlocks()
    renderMd(currentDoc, true)
  })

  let mode = null   // 'wysiwyg' | 'raw'

  // ── 노션식 그 자리 편집: 렌더된 모습 그대로 contenteditable ──
  const finishWysiwyg = async (save) => {
    if (mode !== 'wysiwyg') return
    mode = null
    mdEditing = false
    body.contentEditable = 'false'
    el.classList.remove('editing')
    if (save) {
      const td = await getTurndown()
      const md = td.turndown(body.innerHTML).replace(/\s+$/, '')
      if (md.trim() === '') mdBlocks.splice(i, 1)
      else mdBlocks[i] = md
      await saveBlocks()
    }
    renderMd(currentDoc, true)
    refreshDocs()
  }
  const startWysiwyg = () => {
    if (mdEditing) return
    mdEditing = true
    mode = 'wysiwyg'
    el.classList.add('editing')
    body.contentEditable = 'true'
    body.focus()
    body.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); finishWysiwyg(true) }
      if (e.key === 'Escape') { e.stopPropagation(); finishWysiwyg(false) }
    })
    body.addEventListener('blur', () => finishWysiwyg(true), { once: true })
  }

  // ── 마크다운 원문 편집 (‹› 버튼, 새 빈 블록) ──
  const startRaw = () => {
    if (mdEditing) return
    mdEditing = true
    mode = 'raw'
    const ta = document.createElement('textarea')
    ta.value = mdBlocks[i]
    ta.placeholder = '마크다운 입력…'
    el.innerHTML = ''
    el.appendChild(ta)
    const hint = document.createElement('div')
    hint.className = 'blk-hint'
    hint.textContent = '⌘Enter 저장 · ESC 취소 · 비우고 저장하면 삭제'
    el.appendChild(hint)
    ta.style.height = 'auto'
    ta.style.height = `${Math.max(ta.scrollHeight + 4, 44)}px`
    ta.focus()
    ta.setSelectionRange(ta.value.length, ta.value.length)
    ta.addEventListener('input', () => {
      ta.style.height = 'auto'
      ta.style.height = `${Math.max(ta.scrollHeight + 4, 44)}px`
    })
    const finish = async (save) => {
      if (mode !== 'raw') return
      mode = null
      mdEditing = false
      if (save) {
        const v = ta.value.replace(/\s+$/, '')
        if (v.trim() === '') mdBlocks.splice(i, 1)
        else mdBlocks[i] = v
        await saveBlocks()
      } else if (mdBlocks[i] === '') {
        mdBlocks.splice(i, 1)   // 새로 추가했다 취소한 빈 블록 정리
      }
      renderMd(currentDoc, true)
      refreshDocs()
    }
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); finish(true) }
      if (e.key === 'Escape') { e.stopPropagation(); finish(false) }
    })
    ta.addEventListener('blur', () => finish(true))
  }

  el.addEventListener('jarvis-edit', () => {
    if ((mdBlocks[i] || '').trim() === '') startRaw()
    else startWysiwyg()
  })
  el.addEventListener('click', (e) => {
    if (mdEditing) return   // 편집 중 클릭은 캐럿 이동
    const a = e.target.closest('a')
    if (a) {
      e.preventDefault()
      const href = a.getAttribute('href') || ''
      if (a.classList.contains('link-busy')) return   // 처리 중 재클릭 무시
      if (href.startsWith('jarvis-reco://')) {
        const m = /^jarvis-reco:\/\/(approve|reject)\/(.+)$/.exec(href)
        if (m) { linkBusy(a, true); resolveReco(decodeURIComponent(m[2]), m[1]).finally(() => linkBusy(a, false)) }
        return
      }
      if (href.startsWith('jarvis-bench://')) {
        const m = /^jarvis-bench:\/\/(accept|hold)\/(.+)$/.exec(href)
        if (!m) return
        const bid = decodeURIComponent(m[2])
        if (m[1] === 'accept') showAcceptDialog(bid, a)
        else { linkBusy(a, true); resolveBench(bid, 'hold').finally(() => linkBusy(a, false)) }
        return
      }
      if (href.startsWith('jarvis-')) {   // 미래 버전의 버튼 — 구버전 앱 안내
        showLaunchPopup({ icon: '🔄', title: '앱 업데이트 필요', lines: ['이 버튼은 현재 설치된 앱보다 새 기능입니다.', '앱을 최신 빌드로 교체한 뒤 다시 눌러주세요.'] })
        return
      }
      if (href.endsWith('.md') || href.endsWith('.html')) selectDoc(decodeURI(href))
      return
    }
    if (e.target.closest('.blk-acts')) return
    if (e.target.closest('summary')) return   // details 접기/펼치기는 그대로
    startWysiwyg()
  })
  acts.querySelector('.a-md').addEventListener('click', (e) => {
    e.stopPropagation()
    startRaw()
  })
  acts.querySelector('.a-add').addEventListener('click', (e) => {
    e.stopPropagation()
    if (mdEditing) return
    mdBlocks.splice(i + 1, 0, '')
    renderMdAndEdit(i + 1)
  })
  acts.querySelector('.a-del').addEventListener('click', async (e) => {
    e.stopPropagation()
    if (mdEditing) return
    mdBlocks.splice(i, 1)
    await saveBlocks()
    renderMd(currentDoc, true)
  })
  return el
}

// 블록 저장용 HTML→MD 변환기 (WYSIWYG 편집 결과를 마크다운 원본으로 역변환)
let turndownMod = null
async function getTurndown() {
  if (!turndownMod) {
    const [{ default: TurndownService }, gfmMod] = await Promise.all([
      import('./vendor/turndown.es.js'),
      import('./vendor/turndown-gfm.es.js'),
    ])
    turndownMod = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' })
    turndownMod.use(gfmMod.gfm)
    turndownMod.keep(['details', 'summary'])
  }
  return turndownMod
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
  procAppend('pl-req', `▶ ${esc(text)}`)   // 인식/입력된 요청을 먼저 텍스트로 확인
  const res = await window.jarvis.chat.send(currentDoc, text)
  setBusy(false)
  reloadFrame()
  refreshDocs()
  procNote(res.ok ? 'pl-done' : 'pl-err', esc(res.text || (res.ok ? '완료' : '실패')))
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
function procNote(cls, html) {
  $('procWrap').hidden = false
  $('procLog').classList.remove('collapsed')
  procAppend(cls, html)
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
  if (res.ok && res.text && sttIntent && sttIntent.type === 'branchTitle') {
    const parent = sttIntent.parentId
    sttIntent = null
    createBranchByVoice(parent, res.text)
  } else if (res.ok && res.text) {
    // 인식된 질문을 '요청:' 에코로 표시한 뒤 바로 실행
    sendMessage(res.text)
  } else if (!res.ok) {
    procNote('pl-err', esc(res.text))
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
  $('rootPath').textContent = cfg.workflowRoot || '—'
  $('selModel').value = cfg.model || ''
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

// ── 🗂 프로젝트 루트 관리 — 하위 폴더 추적 체크박스 ──
function renderRootManager(data) {
  const rows = data.items.map((it) => `
    <label class="root-item">
      <input type="checkbox" data-name="${esc(it.name)}" ${it.tracked ? 'checked' : ''}>
      <span class="root-name">${esc(it.name)}</span>
      <span class="root-state">${it.tracked ? (it.docId ? '📄 추적 중' : '⏳ 문서 생성 예정') : '제외됨'}</span>
    </label>`).join('')
  return `<div class="launch-card root-card">
    <p class="launch-title">🗂 프로젝트 루트 관리</p>
    <p class="launch-line root-path" id="rmRoot" title="클릭해서 루트 폴더 변경">${esc(data.root)}</p>
    <p class="launch-line">체크된 폴더만 프로젝트로 추적합니다 — 메인 문서 자동 생성 · 야간 아이디어 · 벤치마킹 대상</p>
    <div class="root-list">${rows || '<p class="launch-line">하위 폴더 없음</p>'}</div>
    <p class="launch-line root-hint">체크 해제해도 문서는 지워지지 않으며, 다시 체크하면 그대로 복원됩니다.</p>
    <div class="modal-actions"><button class="primary" id="rmClose">닫기</button></div>
  </div>`
}
async function openRootManager() {
  let data = await window.jarvis.projects.list()
  document.getElementById('rootPop')?.remove()
  const el = document.createElement('div')
  el.id = 'rootPop'
  const draw = () => {
    el.innerHTML = renderRootManager(data)
    $('rootPath').textContent = data.root
    el.querySelector('#rmClose').addEventListener('click', () => { el.remove(); refreshDocs() })
    el.querySelector('#rmRoot').addEventListener('click', async () => { data = await window.jarvis.projects.pickRoot(); draw() })
    for (const cb of el.querySelectorAll('input[type=checkbox]')) {
      cb.addEventListener('change', async () => {
        data = await window.jarvis.projects.toggle(cb.dataset.name, cb.checked)
        draw()
      })
    }
  }
  draw()
  el.addEventListener('click', (e) => { if (e.target === el) { el.remove(); refreshDocs() } })
  document.body.appendChild(el)
}
$('rootRow').addEventListener('click', openRootManager)

// ── ESC — 녹음 취소 또는 실행 중 작업 중단 ────────────────────────
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return
  if (!$('modal').hidden) { $('modal').hidden = true; return }
  if (!$('mapView').hidden) { closeMap(); return }
  if (document.body.classList.contains('doc-full')) { document.body.classList.remove('doc-full'); return }
  if (recording) { stopRecording(false); return }   // 녹음 취소 (전송 안 함)
  if (busy) {
    if (analysisQueue.length) {
      analysisQueue.length = 0   // 대기 중 자동 분석도 함께 취소 (좀비 큐 방지)
      $('activityText').textContent = '중단하는 중… (자동 분석 큐 비움)'
    } else {
      $('activityText').textContent = '중단하는 중…'
    }
    window.jarvis.chat.abort()
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
  if (docOrder[ni] === currentDoc) {
    showGestureToast(delta < 0 ? '☝' : '👇', delta < 0 ? '맨 위입니다' : '맨 아래입니다')
    return
  }
  showGestureToast(delta < 0 ? '☝' : '👇', delta < 0 ? '위로 이동' : '아래로 이동')
  tick()
  selectDoc(docOrder[ni])
}

// ── 제스처 인식 시각 피드백 ──────────────────────────────────────
let gestureToastTimer = null
function showGestureToast(icon, label) {
  const el = $('gestureToast')
  el.innerHTML = `<span class="gi">${icon}</span><span>${label}</span>`
  el.hidden = false
  el.classList.remove('pop')
  void el.offsetWidth   // 애니메이션 재시작
  el.classList.add('pop')
  clearTimeout(gestureToastTimer)
  gestureToastTimer = setTimeout(() => { el.hidden = true }, 950)
}

let branchOffer = null   // { parentId, until } — 👌 제스처로 갈래 생성 제안 활성
let sttIntent = null     // { type: 'branchTitle', parentId } — 다음 음성 인식의 용도

/** 전체 화면에서 ☝👇 — 문서를 블록 단위로 스크롤 */
function scrollDocByBlock(delta) {
  if (currentDoc && currentDoc.endsWith('.md')) {
    const view = $('mdView')
    const blocks = [...view.querySelectorAll('.blk')]
    if (!blocks.length) return
    const top = view.scrollTop
    if (delta > 0) {
      const next = blocks.find((b) => b.offsetTop > top + 8)
      if (!next) { showGestureToast('👇', '문서 끝'); return }
      view.scrollTo({ top: Math.max(next.offsetTop - 8, 0), behavior: 'smooth' })
      showGestureToast('👇', '한 블록 아래')
    } else {
      const prevs = blocks.filter((b) => b.offsetTop < top - 8)
      const prev = prevs[prevs.length - 1]
      if (!prev && top <= 8) { showGestureToast('☝', '문서 처음'); return }
      view.scrollTo({ top: prev ? Math.max(prev.offsetTop - 8, 0) : 0, behavior: 'smooth' })
      showGestureToast('☝', '한 블록 위')
    }
    tick()
  } else {
    // 레거시 HTML 문서 — iframe 내부를 화면 절반씩 스크롤
    try {
      $('docFrame').contentWindow.scrollBy({ top: delta * 400, behavior: 'smooth' })
      showGestureToast(delta > 0 ? '👇' : '☝', delta > 0 ? '아래로' : '위로')
      tick()
    } catch { /* noop */ }
  }
}

function navigateUp() {
  const parent = docParent[currentDoc]
  if (!parent) { showGestureToast('👈', '최상위 문서입니다'); return }
  showGestureToast('👈', '상위 문서로 이동')
  tick()
  selectDoc(parent)
}

function navigateInto() {
  const child = docFirstChild[currentDoc]
  if (!child) {
    branchOffer = { parentId: currentDoc, until: Date.now() + 10_000 }
    showGestureToast('👉', '갈래 없음 — 👌 하면 새 갈래를 만듭니다')
    return
  }
  showGestureToast('👉', '세부문서로 이동')
  tick()
  selectDoc(child)
}

/** 👌 (엄지+검지 맞닿음, 나머지 폄) 판정 */
function isOkSign(lm) {
  const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)
  if (d(lm[4], lm[8]) > 0.055) return null
  const w = lm[0]
  const ext = (tip, pip) => d(lm[tip], w) > d(lm[pip], w)
  return ext(12, 10) && ext(16, 14) && ext(20, 18) ? 'ok' : null
}

async function createBranchByVoice(parentId, title) {
  const t = (title || '').trim().replace(/[.。!?]+$/, '')
  if (t.length < 2) { showGestureToast('👌', '주제를 알아듣지 못했습니다 — 다시 시도'); return }
  const { id } = await window.jarvis.docs.createBranch(parentId, t)
  await refreshDocs(id)
  showGestureToast('🌱', `갈래 생성: ${t}`)
  sendMessage(`상위 문서의 맥락을 읽고, 갈래 주제 "${t}"를 시작한다. 이 갈래에서 발전시킬 내용을 정리해 문서를 채워줘.`)
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
let okHits = 0
let comboHits = 0
let comboLastFire = 0
let palmHits = 0
let navHits = 0
let navLastDir = null
let navLastFire = 0

/** 🖐 손바닥 — 프로젝트 맵 토글. 발동 시 true */
function handlePalm(isPalm) {
  if (!isPalm) { palmHits = 0; return false }
  palmHits += 1
  if (palmHits >= GESTURE_HITS && Date.now() - gestureLastFire > 2000) {
    gestureLastFire = Date.now()
    palmHits = 0
    if ($('mapView').hidden) {
      showGestureToast('🖐', '프로젝트 맵')
      openMap()
    } else {
      showGestureToast('🖐', '맵 닫기')
      closeMap()
    }
    return true
  }
  return false
}

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
      numHands: 2,   // 두 손 조합 제스처 지원
    })
  }

  gestureHits = 0
  let handSeen = false
  gestureTimer = setInterval(() => {
    // 녹음·작업 중에도 제스처 인식 유지 (음성 인식(STT) 처리 중에만 잠깐 정지)
    if (!gestureOn || wakeSttBusy) { gestureHits = 0; return }
    if (video.readyState < 2) return
    let result
    try { result = gestureRecognizer.recognizeForVideo(video, performance.now()) } catch { return }
    // ── 두 손 조합 제스처 — 왼손✊+오른손🖐: 전체화면 토글 · ✊✊: 전체화면 종료 ──
    const numHands = result && result.gestures ? result.gestures.length : 0
    if (numHands >= 2 && !recording) {
      const handed = result.handedness || result.handednesses || []
      const hands = {}
      for (let i = 0; i < numHands; i += 1) {
        const top = result.gestures[i] && result.gestures[i][0]
        const label = handed[i] && handed[i][0] ? handed[i][0].categoryName : ''
        // 실측 보정(2026-08-30): 이 환경에선 라벨이 사용자 기준과 일치 — 'Left' = 왼손
        const userHand = label === 'Left' ? 'left' : 'right'
        if (top && top.score >= GESTURE_SCORE) hands[userHand] = top.categoryName
      }
      const combo = hands.left && hands.right ? `${hands.left}+${hands.right}` : null
      if (combo === 'Closed_Fist+Open_Palm') {          // 왼손 ✊ + 오른손 🖐
        comboHits += 1
        if (comboHits >= GESTURE_HITS && Date.now() - comboLastFire > 2000) {
          comboLastFire = Date.now()
          comboHits = 0
          document.body.classList.toggle('doc-full')
          showGestureToast('✊🖐', document.body.classList.contains('doc-full') ? '문서 전체 화면' : '전체 화면 종료')
        }
      } else if (combo === 'Open_Palm+Open_Palm') {    // 🖐🖐 — 앱(창) 전체 화면 토글
        comboHits += 1
        if (comboHits >= GESTURE_HITS && Date.now() - comboLastFire > 2000) {
          comboLastFire = Date.now()
          comboHits = 0
          window.jarvis.app.toggleFullscreen().then((on) => {
            showGestureToast('🖐🖐', on ? '앱 전체 화면' : '앱 전체 화면 해제')
          })
        }
      } else if (combo === 'Closed_Fist+Closed_Fist') { // ✊✊ — 전체 화면 종료
        comboHits += 1
        if (comboHits >= GESTURE_HITS && Date.now() - comboLastFire > 2000) {
          comboLastFire = Date.now()
          comboHits = 0
          if (document.body.classList.contains('doc-full')) {
            document.body.classList.remove('doc-full')
            showGestureToast('✊✊', '전체 화면 종료')
          }
        }
      } else {
        comboHits = 0
      }
      // 두 손이 보이는 동안 한 손 제스처는 대기 (조합 도중 오발동 방지)
      gestureHits = 0; palmHits = 0; navHits = 0; okHits = 0
      return
    }
    comboHits = 0

    const seen = !!(result && result.landmarks && result.landmarks.length)
    if (seen !== handSeen) {
      handSeen = seen
      $('gestureStatus').textContent = seen
        ? '✋ 감지 중 — ✊ 듣기 · ☝👇 이동 · 👉 세부 · 👈 상위 · 🖐 맵 · 왼✊+오🖐 전체화면'
        : '대기 중 — ✊ 듣기 · ☝👇 이동 · 👉 세부 · 👈 상위 · 🖐 프로젝트 맵'
    }
    const g = result && result.gestures && result.gestures[0] && result.gestures[0][0]
    const lm = result && result.landmarks && result.landmarks[0]
    const isFist = g && g.categoryName === 'Closed_Fist' && g.score >= GESTURE_SCORE
    const isPalm = g && g.categoryName === 'Open_Palm' && g.score >= GESTURE_SCORE

    // 👌 — 갈래 생성 제안이 활성일 때: 확인 → 갈래 주제 음성 입력 시작 (작업 중 제외)
    if (!recording && !busy && branchOffer && Date.now() < branchOffer.until && lm && isOkSign(lm)) {
      okHits += 1
      if (okHits >= GESTURE_HITS && Date.now() - gestureLastFire > 1500) {
        gestureLastFire = Date.now()
        okHits = 0
        const parent = branchOffer.parentId
        branchOffer = null
        sttIntent = { type: 'branchTitle', parentId: parent }
        showGestureToast('👌🎙', '갈래 주제를 말하세요')
        ding()
        startRecording().catch(() => { sttIntent = null })
      }
      navHits = 0
      gestureHits = 0
      return
    }
    okHits = 0

    // ── 프로젝트 맵 열림 + ✊ — 첫 번째 프로젝트(루트 문서)로 이동하고 맵 닫기 ──
    if (!$('mapView').hidden && isFist) {
      gestureHits += 1
      navHits = 0
      if (gestureHits >= GESTURE_HITS && Date.now() - gestureLastFire > GESTURE_COOLDOWN_MS) {
        gestureLastFire = Date.now()
        gestureHits = 0
        mapSelectFirst()
      }
      return
    }

    // ── Claude 작업 중: 문서 탐색(☝👇👉)은 허용, 음성 시작(✊)은 안내만 ──
    if (busy) {
      if (handlePalm(isPalm)) { gestureHits = 0; navHits = 0; return }
      if (isFist) {
        gestureHits += 1
        if (gestureHits >= GESTURE_HITS && Date.now() - gestureLastFire > GESTURE_COOLDOWN_MS) {
          gestureLastFire = Date.now()
          gestureHits = 0
          showGestureToast('✊⏳', '작업 실행 중 — ESC로 중단 후 사용하세요')
        }
      } else {
        gestureHits = 0
        const dir = lm ? pointingDir(lm) : null
        if (dir && dir === navLastDir) navHits += 1
        else { navHits = dir ? 1 : 0; navLastDir = dir }
        if (dir && navHits >= 2 && Date.now() - navLastFire > NAV_COOLDOWN_MS) {
          navLastFire = Date.now()
          navHits = 0
          if (document.body.classList.contains('doc-full') && (dir === 'up' || dir === 'down')) scrollDocByBlock(dir === 'up' ? -1 : 1)
          else if (dir === 'up') navigateDoc(-1)
          else if (dir === 'down') navigateDoc(1)
          else if (dir === 'right') navigateInto()
          else if (dir === 'left') navigateUp()
        }
      }
      return
    }

    // ── 음성 대기(녹음) 중: 주먹 다시 쥐면 → 녹음 취소 + 텍스트 입력 대기 전환 ──
    if (recording) {
      if (isFist) {
        gestureHits += 1
        if (gestureHits >= GESTURE_HITS && Date.now() - gestureLastFire > GESTURE_COOLDOWN_MS) {
          gestureLastFire = Date.now()
          gestureHits = 0
          stopRecording(false)   // 전송하지 않고 취소
          showGestureToast('✊⌨', '텍스트 입력 대기')
          $('input').focus()
        }
      } else {
        gestureHits = 0
      }
      navHits = 0
      return
    }

    if (isFist) {
      gestureHits += 1
      navHits = 0
      if (gestureHits >= GESTURE_HITS && Date.now() - gestureLastFire > GESTURE_COOLDOWN_MS) {
        gestureLastFire = Date.now()
        gestureHits = 0
        showGestureToast('✊🎙', '음성 대기 — 다시 주먹 쥐면 텍스트 입력')
        ding()
        startRecording().catch(() => {})
      }
    } else {
      gestureHits = 0
      if (handlePalm(isPalm)) { navHits = 0; return }
      // ☝ 검지 위/아래 — 문서 목록 한 칸 이동
      const dir = lm ? pointingDir(lm) : null
      if (dir && dir === navLastDir) navHits += 1
      else { navHits = dir ? 1 : 0; navLastDir = dir }
      if (dir && navHits >= 2 && Date.now() - navLastFire > NAV_COOLDOWN_MS) {
        navLastFire = Date.now()
        navHits = 0
        if (document.body.classList.contains('doc-full') && (dir === 'up' || dir === 'down')) scrollDocByBlock(dir === 'up' ? -1 : 1)
        else if (dir === 'up') navigateDoc(-1)
        else if (dir === 'down') navigateDoc(1)
        else if (dir === 'right') navigateInto()   // 세부문서(첫 갈래)로 진입
        else if (dir === 'left') navigateUp()      // 👈 상위 문서로
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

$('selModel').addEventListener('change', (e) => {
  window.jarvis.config.set({ model: e.target.value })
})
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
// ── 신규 프로젝트 자동 분석 큐 — claude가 한가할 때 순차 실행 ──
const analysisQueue = []
async function drainAnalysisQueue() {
  if (busy || recording || !analysisQueue.length) return
  const job = analysisQueue.shift()
  setBusy(true, `자동 분석: ${job.name} (ESC로 중단)`)
  procReset()
  procAppend('', `<span class="pl-tool">▶</span> [자동] ${esc(job.name)} 프로젝트 분석`)
  const res = await window.jarvis.chat.send(job.id, job.prompt ||
    (`이 문서는 '${job.name}' 프로젝트의 메인 분석 문서다. 프로젝트 구조와 핵심 기능을 훑어보고 ` +
    `개요·주요 기능·구조를 정리해 문서를 채워줘. 완성/추가/개선 3섹션도 현재 코드 기준으로 정리해줘.`))
  setBusy(false)
  if (currentDoc === job.id) reloadFrame()
  refreshDocs()
  procNote(res.ok ? 'pl-done' : 'pl-err', `[자동 분석 완료] ${esc(job.name)} — ${esc(res.text || (res.ok ? '완료' : '실패'))}`)
  setTimeout(drainAnalysisQueue, 1500)
}
window.jarvis.events.onAutoCreated((list) => {
  refreshDocs()
  for (const it of list) analysisQueue.push(it)
  drainAnalysisQueue()
})
window.jarvis.events.onNotice((msg) => {
  procNote('pl-text', `ℹ ${esc(msg)}`)
})
setInterval(drainAnalysisQueue, 30_000)

// ── 🧩 도구 추천 승인/거부 (브리핑 문서의 버튼 링크) ──
async function resolveReco(id, action) {
  const res = await window.jarvis.reco.resolve(id, action)
  procNote(res.ok ? 'pl-done' : 'pl-err', `🧩 ${esc(res.msg || '')}`)
  if (res.ok && res.queue) {
    analysisQueue.push(res.queue)
    drainAnalysisQueue()
  }
  reloadFrame()   // 브리핑 라인 상태 갱신 반영
}

function linkBusy(a, on) {
  try { a.classList.toggle('link-busy', on) } catch { /* iframe 재로드로 사라졌으면 무시 */ }
}

/** 🚀 착수 등 반응 팝업 — 아이콘 발사 애니메이션 + 언제 실행되는지 안내 */
function showLaunchPopup({ icon, title, lines }) {
  document.getElementById('launchPop')?.remove()
  const el = document.createElement('div')
  el.id = 'launchPop'
  el.innerHTML = `<div class="launch-card"><div class="launch-icon">${esc(icon)}</div>` +
    `<p class="launch-title">${esc(title)}</p>` +
    lines.map((l) => `<p class="launch-line">${esc(l)}</p>`).join('') +
    `<div class="modal-actions"><button class="primary" id="launchOk">확인</button></div></div>`
  document.body.appendChild(el)
  const close = () => el.remove()
  el.addEventListener('click', (e) => { if (e.target === el) close() })
  el.querySelector('#launchOk').addEventListener('click', close)
  setTimeout(() => { if (document.getElementById('launchPop') === el) close() }, 12_000)
}

/** 착수 전 코멘트 입력 — 선택사항·수정 방향을 구현 작업에 최우선 반영 */
function showAcceptDialog(id, anchor) {
  document.getElementById('launchPop')?.remove()
  const el = document.createElement('div')
  el.id = 'launchPop'
  el.innerHTML = `<div class="launch-card"><div class="launch-icon">🚀</div>` +
    `<p class="launch-title">${esc(id)} 착수</p>` +
    `<p class="launch-line">추가 코멘트 <b>(선택)</b> — 선택사항이나 수정 방향을 적으면 구현 작업에 <b>최우선으로 반영</b>됩니다. 비워두면 제안 그대로 진행합니다.</p>` +
    `<textarea id="acceptComment" placeholder="예: 표 UI는 기존 스타일 재사용 · 신규 의존성 추가 금지 · 시각은 15:05 말고 14:55로"></textarea>` +
    `<div class="modal-actions"><button id="acceptCancel">취소</button><button class="primary" id="acceptGo">🚀 착수</button></div></div>`
  document.body.appendChild(el)
  const close = () => el.remove()
  el.addEventListener('click', (e) => { if (e.target === el) close() })
  el.querySelector('#acceptCancel').addEventListener('click', close)
  el.querySelector('#acceptGo').addEventListener('click', () => {
    const comment = el.querySelector('#acceptComment').value.trim()
    close()
    linkBusy(anchor, true)
    resolveBench(id, 'accept', comment).finally(() => linkBusy(anchor, false))
  })
  el.querySelector('#acceptComment').focus()
}

async function resolveBench(id, action, comment) {
  const res = await window.jarvis.bench.resolve(id, action, comment)
  procNote(res.ok ? 'pl-done' : 'pl-err', `🔭 ${esc(res.msg || '')}`)
  if (res.ok && action === 'accept') {
    if (res.queue) {
      const waiting = analysisQueue.length + (busy ? 1 : 0)
      analysisQueue.push(res.queue)
      showLaunchPopup({
        icon: '🚀', title: `${id} 착수!`,
        lines: [`"${res.title}"`, `메인 문서 '➕ 추가할 기능'에 등재했습니다.`,
          ...(comment ? [`💬 코멘트 반영: "${comment}"`] : []),
          waiting ? `개선 작업은 진행 중인 작업 ${waiting}건이 끝나는 대로 자동 시작됩니다.` : '개선 작업을 지금 바로 시작합니다 — 진행 상황은 하단 로그에 표시됩니다.',
          '완료되면 결과가 메인 문서 작업 로그에 기록됩니다.'],
      })
      drainAnalysisQueue()
    } else {
      showLaunchPopup({
        icon: '🔴', title: `${id} 등재됨 — 사용자 확정 필요`,
        lines: [`"${res.title}"`, `메인 문서 '➕ 추가할 기능'에 등재했습니다.`,
          ...(comment ? [`💬 코멘트도 함께 등재: "${comment}"`] : []),
          res.gate ? `확정 게이트: ${res.gate}` : '확정 게이트 대상입니다.',
          '자동으로 실행되지 않습니다 — 규칙 문서의 확정 절차(예: "확정 ' + id + '") 후 주간 작업으로 진행하세요.'],
      })
    }
  } else if (res.ok && action === 'hold') {
    showLaunchPopup({ icon: '⏸', title: `${id} 보류`, lines: [`"${res.title || ''}"`, '언제든 브리핑에서 다시 착수할 수 있습니다.'] })
  }
  reloadFrame()
}

// ── 🌙 아침 브리핑 — 야간 러너 결과 자동 표시 ──
window.jarvis.events.onNightBriefing(async ({ date }) => {
  await refreshDocs()
  const docs = await window.jarvis.docs.list()
  const brief = docs.find((d) => d.id === '야간-브리핑.md')
  if (brief) {
    await selectDoc(brief.id)
    showGestureToast('🌙', `${date} 밤사이 작업 브리핑입니다`)
    procNote('pl-text', `🌙 ${esc(date)} 야간 브리핑 — 개선 브랜치(night/${esc(date)})는 리뷰 후 머지하세요`)
  }
  window.jarvis.events.ackNightBriefing()
})


// ── 프로젝트 맵 — 전체 프로젝트·갈래 문서를 트리로 연결해 한눈에 ──────
const MAP_NODE_W = 200
const MAP_NODE_H = 46
const MAP_GAP_X = 80
const MAP_GAP_Y = 12
const MAP_TREE_GAP = 26

function escXml(t) {
  return String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
function trunc(t, n) { return t.length > n ? `${t.slice(0, n - 1)}…` : t }
function relTime(ms) {
  const d = Math.floor((Date.now() - ms) / 60000)
  if (d < 60) return `${Math.max(d, 0)}분 전`
  if (d < 60 * 24) return `${Math.floor(d / 60)}시간 전`
  return `${Math.floor(d / 1440)}일 전`
}

async function renderMap() {
  const [docs, order, projects] = await Promise.all([
    window.jarvis.docs.list(),
    window.jarvis.docs.getOrder(),
    window.jarvis.docs.projectsMap(),
  ])
  const sortGroup = (items, groupKey) => {
    const saved = order[groupKey] || []
    const idx = (id) => { const i = saved.indexOf(id); return i === -1 ? Infinity : i }
    return [...items].sort((a, b) => idx(a.id) - idx(b.id))
  }
  const children = new Map()
  for (const d of docs) {
    if (d.parentId) {
      if (!children.has(d.parentId)) children.set(d.parentId, [])
      children.get(d.parentId).push(d)
    }
  }
  for (const [k, v] of children) children.set(k, sortGroup(v, k))
  const roots = sortGroup(docs.filter((x) => !x.parentId), '')
  mapRoots = roots.map((r) => r.id)

  // 레이아웃: 깊이 = x, 리프 순서 = y (부모는 자식들 세로 중앙)
  const pos = new Map()
  let cursorY = 0
  let maxDepth = 0
  const place = (d, depth) => {
    maxDepth = Math.max(maxDepth, depth)
    const kids = children.get(d.id) || []
    let cy
    if (!kids.length) {
      cy = cursorY
      cursorY += MAP_NODE_H + MAP_GAP_Y
    } else {
      const ys = kids.map((k) => place(k, depth + 1))
      cy = (ys[0] + ys[ys.length - 1]) / 2
    }
    pos.set(d.id, { d, depth, y: cy })
    return cy
  }
  for (const r of roots) {
    place(r, 0)
    cursorY += MAP_TREE_GAP   // 프로젝트(트리) 사이 여백
  }

  const W = (maxDepth + 1) * (MAP_NODE_W + MAP_GAP_X) + 40
  const H = Math.max(cursorY + 20, 200)
  const x = (depth) => 20 + depth * (MAP_NODE_W + MAP_GAP_X)

  let linksSvg = ''
  let nodesSvg = ''
  for (const { d, depth, y } of pos.values()) {
    if (d.parentId && pos.has(d.parentId)) {
      const p = pos.get(d.parentId)
      const x1 = x(p.depth) + MAP_NODE_W
      const y1 = p.y + MAP_NODE_H / 2
      const x2 = x(depth)
      const y2 = y + MAP_NODE_H / 2
      const mx = (x1 + x2) / 2
      linksSvg += `<path d="M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}" fill="none" stroke="#8d877c" stroke-width="1.5" opacity="0.7"/>`
    }
    const isRoot = !d.parentId
    const proj = projects[d.id]
    const projName = proj ? proj.split('/').filter(Boolean).pop() : null
    const active = d.id === currentDoc
    const stroke = active ? '#e05a50' : isRoot ? '#d99a3d' : '#3a3733'
    const branchCount = (children.get(d.id) || []).length
    const meta = [
      isRoot && projName ? `📁 ${escXml(projName)}` : null,
      branchCount ? `갈래 ${branchCount}` : null,
      relTime(d.mtime),
    ].filter(Boolean).join(' · ')
    nodesSvg += `<g class="map-node" data-id="${escXml(d.id)}" transform="translate(${x(depth)}, ${y})">` +
      `<rect width="${MAP_NODE_W}" height="${MAP_NODE_H}" rx="9" fill="#232220" stroke="${stroke}" stroke-width="${isRoot || active ? 1.6 : 1}"/>` +
      `<text x="12" y="19" font-size="12.5" font-weight="700" fill="#ece9e3">${escXml(trunc(d.title, 15))}</text>` +
      `<text x="12" y="35" font-size="9.5" fill="#8d877c">${meta}</text>` +
      `</g>`
  }
  $('mapBody').innerHTML =
    `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg" font-family="Apple SD Gothic Neo, sans-serif">${linksSvg}${nodesSvg}</svg>`
}

let mapRoots = []   // 맵에 표시된 프로젝트(루트 문서) id — 정렬 순서
/** 맵에서 ✊ — 첫 번째 프로젝트의 메인 문서를 열고 맵을 닫는다 */
function mapSelectFirst() {
  const first = mapRoots[0]
  if (!first) { showGestureToast('✊', '프로젝트가 없습니다'); return }
  closeMap()
  showGestureToast('✊📁', '첫 번째 프로젝트로 이동')
  tick()
  if (first !== currentDoc) selectDoc(first)
}
function openMap() {
  $('mapView').hidden = false
  renderMap()
}
function closeMap() { $('mapView').hidden = true }
$('btnFull').addEventListener('click', () => {
  document.body.classList.toggle('doc-full')
})
$('btnMap').addEventListener('click', openMap)
$('mapClose').addEventListener('click', closeMap)
$('mapBody').addEventListener('click', (e) => {
  const node = e.target.closest('.map-node')
  if (!node) return
  closeMap()
  selectDoc(node.getAttribute('data-id'))
})

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
