#!/usr/bin/env node
/** Jarvis 야간 개선 아이디어 러너 — launchd(23:00)가 실행, 앱과 독립.
 *
 * 원칙:
 *  - ⚠️ 소스코드를 수정하지 않는다. 프로젝트를 읽고 "개선 아이디어"만 제안해 아침 브리핑으로 전달한다.
 *  - 아이디어는 매일 달라야 한다 — ~/JarvisHub/night/bench/bench.json 이력과 중복되는 제안은 금지
 *  - 프로젝트당 최대 3건, 모두 🧭 프로젝트 목적(한 문장)에 기여해야 하며 근거가 있어야 한다
 *  - 브리핑의 🚀 착수 버튼 → 메인 문서 '➕ 추가할 기능'에 등재 (구현은 사용자가 주간에 지시)
 *  - 타임박스: 프로젝트당 12분, 03:30 이후 신규 시작 금지
 *  - 결과는 docs/야간-브리핑.md(최신이 위) + ~/JarvisHub/night/<날짜>.json
 *  - 개선 규칙: docs/공통-개선-규칙.md(전 프로젝트 공통) → <프로젝트>-개선-규칙.md(프로젝트 전용) 순으로 읽음
 */
const { spawn, execSync } = require('child_process')
const toolkit = require('./update_toolkit.js')
const fs = require('fs')
const os = require('os')
const path = require('path')

const HOME = os.homedir()
const HUB = path.join(HOME, 'JarvisHub')
const NIGHT_DIR = path.join(HUB, 'night')
const JARVIS_DOCS = path.join(HOME, 'workflow', 'jarvis', 'docs')
const BRIEF_DOC = path.join(JARVIS_DOCS, '야간-브리핑.md')
const COMMON_RULE_DOC = path.join(JARVIS_DOCS, '공통-개선-규칙.md') // 모든 프로젝트 공통 개선 규칙
const LOCK = path.join(NIGHT_DIR, 'runner.lock')
const PER_PROJECT_MS = 12 * 60 * 1000
const IDEAS_PATH = path.join(NIGHT_DIR, 'bench', 'bench.json')   // 벤치 제안과 같은 이력·착수 흐름 공유
const MAX_IDEAS = 3
const NO_NEW_AFTER_HOUR = 3.5   // 03:30 이후 신규 시작 금지 (테스트 모드 제외)
const TEST = process.env.NIGHT_TEST === '1'
const ONLY = process.env.NIGHT_ONLY || null   // 특정 프로젝트명만 (테스트용)

const dateStr = () => {
  const d = new Date()
  // 자정 이후 실행분도 "전날 밤" 브리핑으로 묶기 위해 05시 이전이면 하루 빼기
  if (d.getHours() < 5) d.setDate(d.getDate() - 1)
  return d.toISOString().slice(0, 10)
}
const DATE = dateStr()

function readJson(p, fb) { try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return fb } }
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`
  console.log(line)
  fs.appendFileSync(path.join(NIGHT_DIR, `${DATE}.log`), line + '\n')
}
function sh(cmd, cwd) { return execSync(cmd, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() }
function trySh(cmd, cwd) { try { return sh(cmd, cwd) } catch { return null } }

function findClaude() {
  for (const c of [path.join(HOME, '.local/bin/claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude']) {
    if (fs.existsSync(c)) return c
  }
  return 'claude'
}

const PRIOR_LIMIT = 20   // 프롬프트에 넣는 '이전 제안' 최대 건수 — 매일 최대 3건씩 늘어나는 목록의 무한 성장 방지
/** 이력 배열을 최근(acceptedAt → date) 순으로 정렬해 앞 limit건만 반환 (원본 배열 불변) */
function recentPrior(items, limit) {
  const key = (h) => String(h.acceptedAt || h.date || '')
  return [...items].sort((a, b) => key(b).localeCompare(key(a))).slice(0, limit)
}

function nightPrompt(projName, mainDocPath, ruleDocPath, commonRulePath, purpose, priorTitles) {
  const hasCommon = commonRulePath && fs.existsSync(commonRulePath)
  return [
    `너는 '${projName}' 프로젝트의 야간 개선 아이디어 에이전트다. 지금은 무인 실행이며 사용자는 자고 있다.`,
    '⚠️ 절대 규칙: 소스코드·문서를 한 글자도 수정하지 마라. 읽고 분석해서 "개선 아이디어"만 제안한다. 구현은 사용자가 아침에 아이디어를 보고 직접 지시한다.',
    `🧭 프로젝트 목적(한 문장): "${purpose}" — 모든 아이디어는 이 문장에 기여해야 한다. 기여를 한 문장으로 말할 수 없으면 제안하지 마라.`,
    hasCommon ? `⚖️ ① 공통 개선 규칙: ${commonRulePath} — 먼저 읽어라.` : '',
    ruleDocPath ? `⚖️ ${hasCommon ? '②' : '①'} 프로젝트 개선 규칙: ${ruleDocPath} — '🚫 손대면 안 되는 것'·확정 게이트에 해당하는 아이디어는 gate 필드에 이유를 적고 verdict=gate 로 표시하라(제안은 가능).` : '',
    mainDocPath ? `프로젝트 메인 문서: ${mainDocPath} — '➕ 추가할 기능'·'🔧 개선할 기능'·작업 로그를 참고하되, 이미 목록에 있는 항목을 그대로 되풀이하지 마라.` : '',
    priorTitles.length
      ? `🚫 이미 제안된 아이디어(오늘은 반드시 다른 것을 내라 — 같은 주제·같은 파일의 변형도 금지):\n${priorTitles.map((t) => `  - ${t}`).join('\n')}`
      : '',
    '',
    '절차:',
    '1) 코드·git 로그·문서를 훑어 실제 문제·불편·위험·기회를 찾는다. 오늘은 이전과 다른 각도(예: 성능/안정성/사용성/비용/테스트/운영/데이터 중 이전에 안 다룬 영역)에서 본다.',
    `2) 목적에 기여하고 근거가 분명한 아이디어를 최대 ${MAX_IDEAS}건 고른다. 없으면 0건 — 억지로 채우지 마라. 근거는 파일 경로·함수명·로그 등 확인 가능한 것이어야 한다.`,
    '3) 📝 문구 규칙 — 비개발자가 10초 안에 "무엇이 문제고, 무엇을 어떻게 바꾸며, 그러면 뭐가 좋아지는지"를 말할 수 있어야 한다:',
    '   - title: "[대상]을 [어떻게] 바꾸기" 형태의 동작형 제목, 40자 이내. 결과가 드러나야 한다 (나쁜 예: "…로직", "…없음" 같은 명사형 문제 제기만).',
    '   - problem: 지금 무엇이 어떻게 잘못/불편한가 — 파일:줄·화면·수치를 포함해 한 문장. "~일 수 있다"로 끝나는 추측만 있는 문장은 금지.',
    '   - solution: 무엇을 어디에서 어떻게 바꾸는가 — 구체 행동 한 문장. "검토한다·고려한다·개선한다·방안을 찾는다" 같은 모호 동사 금지. 해결책을 못 쓰면 그 아이디어는 내지 마라.',
    '   - effect: 바꾼 뒤 사용자가 체감하는 변화 한 문장.',
    '   - 출력 전에 각 항목을 다시 읽고 위 세 문장이 서로 따로 놀지 않는지(문제→해결→효과가 한 줄기인지) 확인하라.',
    '4) 마지막에 반드시 아래 JSON 하나를 ```json 펜스로 감싸 출력하라:',
    '```json',
    '{"ideas":[{"title":"[대상]을 [어떻게] 바꾸기 (40자 이내)","problem":"지금 무엇이 어떻게 잘못/불편한가 — 파일:줄·화면·수치 포함 한 문장","solution":"무엇을 어디서 어떻게 바꾸는가 — 구체 행동 한 문장","effect":"바꾼 뒤 사용자가 체감하는 변화 한 문장","purposeFit":"목적 문장에 …로 기여한다","evidence":"근거 — 파일/함수/로그","effort":"소|중|대","gate":null,"verdict":"recommend|gate","angle":"오늘 본 영역 (성능/안정성/사용성/비용/테스트/운영/데이터 등)"}]}',
    '```',
    '5) (별개) 이 프로젝트에 실질적으로 도움이 될 Claude Code용 skill/agent/MCP가 있으면 최대 2개까지 추천하라.',
    '   이미 설치된 것(메인 문서 상단 🧩 표)은 제외. 확신 없으면 추천하지 마라. 각 추천은 정확히 한 줄 JSON으로:',
    '   [RECO] {"type":"mcp","name":"이름","reason":"근거","install":{"command":"npx","args":["-y","패키지"]}}',
    '   [RECO] {"type":"skill"|"agent","name":"이름","reason":"근거","install":{"prompt":"설치 시 파일을 작성할 지시문"}}',
  ].filter(Boolean).join('\n')
}

function parseIdeas(text) {
  const fences = [...(text || '').matchAll(/```json\s*([\s\S]*?)```/g)]
  for (let i = fences.length - 1; i >= 0; i--) {
    try { const o = JSON.parse(fences[i][1]); if (o && Array.isArray(o.ideas)) return o.ideas } catch {}
  }
  return null
}

function runClaude(projPath, prompt, model) {
  return new Promise((resolve) => {
    const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--dangerously-skip-permissions',
      '--allowedTools', 'Read', 'Grep', 'Glob', 'Bash(git log:*)', 'Bash(git diff:*)', 'Bash(git show:*)',
      '--disallowedTools', 'Edit', 'Write', 'NotebookEdit', 'Bash(git commit:*)', 'Bash(git checkout:*)', 'Bash(git push:*)']
    if (model) args.push('--model', model)
    args.push('--add-dir', JARVIS_DOCS)
    const proc = spawn(findClaude(), args, { cwd: projPath, env: process.env })
    let buf = ''
    let result = ''
    let cost = 0
    const killer = setTimeout(() => {
      log(`  타임박스 초과 → SIGTERM`)
      try { proc.kill('SIGTERM') } catch {}
      setTimeout(() => { try { if (proc.exitCode === null) proc.kill('SIGKILL') } catch {} }, 5000)
    }, PER_PROJECT_MS)
    proc.stdout.on('data', (c) => {
      buf += c.toString()
      let i
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim()
        buf = buf.slice(i + 1)
        if (!line) continue
        try {
          const ev = JSON.parse(line)
          if (ev.type === 'result') {
            result = ev.result || ''
            if (typeof ev.total_cost_usd === 'number') cost = ev.total_cost_usd
          }
        } catch {}
      }
    })
    proc.on('close', (code) => { clearTimeout(killer); resolve({ code, result, cost }) })
    proc.on('error', (e) => { clearTimeout(killer); resolve({ code: -1, result: `실행 실패: ${e.message}`, cost }) })
  })
}

async function processProject(name, projPath, mainDocPath, ruleDocPath, model, docId) {
  // 🧭 프로젝트 목적 필수 — 없으면 보류, 브리핑에 작성 요청
  const purpose = mainDocPath ? toolkit.readPurpose(mainDocPath) : null
  if (!purpose) {
    return { name, projPath, status: 'skip', reason: '🧭 프로젝트 목적 미설정 — 메인 문서 상단 "프로젝트 목적 (한 문장)"을 작성하면 다음 밤부터 그 목적을 기준으로 아이디어를 제안합니다', noPurpose: true }
  }
  // 이력: 이 프로젝트에 이미 제안된 아이디어 제목 (매일 달라야 함)
  const history = readJson(IDEAS_PATH, {})
  // 프롬프트에는 최근 PRIOR_LIMIT건만 주입 (이력 자체는 보존 — 중복 검사(seen)는 전체 이력 기준)
  const priorTitles = recentPrior(Object.values(history).filter((h) => h.project === name), PRIOR_LIMIT)
    .map((h) => `${h.title}${h.angle ? ` [${h.angle}]` : ''}`)
  const headBefore = trySh('git rev-parse HEAD', projPath)
  const dirtyBefore = trySh('git status --porcelain', projPath)

  log(`▶ ${name} 시작 (이전 제안 ${priorTitles.length}건 제외, 목적: ${purpose})`)
  const out = await runClaude(projPath, nightPrompt(name, mainDocPath, ruleDocPath, COMMON_RULE_DOC, purpose, priorTitles), model)

  // 안전망: 읽기 전용이어야 하는데 뭔가 바뀌었으면 기록 (되돌리지는 않음 — 사용자 작업일 수 있음)
  const headAfter = trySh('git rev-parse HEAD', projPath)
  const dirtyAfter = trySh('git status --porcelain', projPath)
  const touched = headBefore && headAfter && (headBefore !== headAfter || (dirtyBefore || '') !== (dirtyAfter || ''))
  if (touched) log(`  ⚠️ ${name}: 실행 전후 작업트리 변화 감지 — 읽기 전용 위반 가능성, 확인 필요`)

  const recos = []
  for (const m of (out.result || '').matchAll(/\[RECO\]\s*(\{.*\})/g)) {
    try {
      const r = JSON.parse(m[1])
      if (r && r.type && r.name && r.reason) recos.push({ type: r.type, name: r.name, reason: r.reason, install: r.install || null })
    } catch {}
  }
  const raw = parseIdeas(out.result)
  if (!raw) return { name, projPath, status: 'fail', reason: `아이디어 JSON 파싱 실패 (종료코드 ${out.code})`, recos, touched, cost: out.cost || 0 }

  // 중복 제거(제목 정규화) + 이력 저장 — 벤치 제안과 같은 I/B 번호 체계·착수 버튼 공유
  const norm = (t) => String(t || '').toLowerCase().replace(/[^\w가-힣]/g, '')
  const seen = new Set(Object.values(history).filter((h) => h.project === name).map((h) => norm(h.title)))
  const ideas = []
  let n = Object.keys(history).filter((k) => k.startsWith('I-')).length
  for (const i of raw.slice(0, MAX_IDEAS)) {
    const problem = i && (i.problem || i.plain)
    const solution = i && (i.solution || i.howBuilt)
    if (!i || !i.title || !problem || !solution || seen.has(norm(i.title))) continue   // 문제·해결이 모두 있어야 채택
    seen.add(norm(i.title))
    const id = `I-${++n}`
    const rec = { id, date: DATE, project: name, projPath, docId, mainDoc: mainDocPath, source: null,
      title: i.title, problem, solution, effect: i.effect || '', plain: problem, purposeFit: i.purposeFit || '', howBuilt: solution, evidence: i.evidence || '',
      effort: i.effort || '?', gate: i.gate || null, verdict: i.gate ? 'gate' : 'recommend', angle: i.angle || '', status: 'pending' }
    history[id] = rec; ideas.push(rec)
  }
  fs.mkdirSync(path.dirname(IDEAS_PATH), { recursive: true })
  fs.writeFileSync(IDEAS_PATH, JSON.stringify(history, null, 2))
  return { name, projPath, status: ideas.length ? 'done' : 'none', reason: ideas.length ? `아이디어 ${ideas.length}건` : '오늘은 새 아이디어 없음 (근거 있는 제안만 냅니다)', purpose, ideas, recos, touched, cost: out.cost || 0 }
}

const recoId = (date, r, rec) => `${date}-${r.name}-${rec.type}-${rec.name}`.replace(/[^\w가-힣.-]/g, '_')
const recoStatusText = (st) => ({ installed: '✅ 설치됨', approved: '✅ 승인 — 설치 작업 실행', rejected: '❌ 거부됨' })[st] || st

/** 야간 브리핑 섹션 렌더 — 순수 함수(파일을 쓰지 않음). 사라진 날짜 섹션을 실행 기록(JSON)으로 복원할 때도 사용.
 *  bench.json / recos.json 상태가 pending 이 아니면 버튼 대신 상태 텍스트를 표시한다. */
function renderBriefingSection(results, date, { recosAll = {}, benchAll = {} } = {}) {
  const icons = { done: '💡', none: '💤', skip: '⏭', fail: '❌' }
  const benchTail = (p) => {
    const b = benchAll[p.id]
    const st = b && b.status
    if (st === 'implemented') return `<!--BENCH:${p.id}--> **🏁 착수 완료**`
    if (st === 'accepted') return `<!--BENCH:${p.id}--> **🚀 착수 — 등재됨${b.confirmedAt ? ' · 확정' : (b.gate ? ' (🔴 확정 게이트: 자동 실행 없음)' : ' + 구현 작업 시작됨')}**`
    if (st === 'held') return `<!--BENCH:${p.id}--> **⏸ 보류됨**`
    return `<!--BENCH:${p.id}--> [🚀 착수](jarvis-bench://accept/${encodeURIComponent(p.id)}) · [⏸ 보류](jarvis-bench://hold/${encodeURIComponent(p.id)})`
  }
  const lines = results.map((r) => {
    const warn = r.touched ? ' ⚠️ _실행 중 작업트리 변화 감지 — 확인 필요_' : ''
    const head = `- ${icons[r.status] || '•'} **${r.name}** — ${r.reason}${warn}${r.purpose ? `\n  🧭 _${r.purpose}_` : ''}`
    if (r.status !== 'done') return head
    const items = (r.ideas || []).map((p0) => {
      const p = { ...p0, ...(benchAll[p0.id] || {}) }   // bench.json 의 최신 문구(재작성 포함) 우선
      const problem = p.problem || p.plain
      const solution = p.solution || p.howBuilt
      return [
        `  - **${p.id} · ${p.title}** ${benchTail(p)}`,
        `    - 🔍 **문제**: ${problem}`,
        `    - 🛠 **해결**: ${solution}`,
        ...(p.effect ? [`    - 🎯 **효과**: ${p.effect}`] : []),
        `    - 📎 근거: ${p.evidence || '-'} · 🧭 ${p.purposeFit || '-'} · 난이도 ${p.effort}${p.angle ? ` · 관점 ${p.angle}` : ''}${p.gate ? ` · 🔴 확정 필요 — ${p.gate}` : ''}`,
      ].join('\n')
    })
    return [head, ...items].join('\n')
  })
  const recoLines = []
  for (const r of results) {
    for (const rec of (r.recos || [])) {
      const id = recoId(date, r, rec)
      const ex = recosAll[id]
      const tail = ex && ex.status && ex.status !== 'pending'
        ? `<!--RECO:${id}--> **${recoStatusText(ex.status)}**`
        : `<!--RECO:${id}--> [✅ 설치](jarvis-reco://approve/${encodeURIComponent(id)}) · [❌ 거부](jarvis-reco://reject/${encodeURIComponent(id)})`
      recoLines.push(`- 🧩 **[${String(rec.type).toUpperCase()}] ${rec.name}** → ${r.name} — ${rec.reason} ${tail}`)
    }
  }
  const ideaCnt = results.reduce((a, r) => a + (r.ideas ? r.ideas.length : 0), 0)
  const cnt = (st) => results.filter((r) => r.status === st).length
  const noReco = ideaCnt === 0 && recoLines.length === 0
  const costSum = results.reduce((a2, r) => a2 + (r.cost || 0), 0)
  const costText = costSum > 0 ? ` · 💰 오늘 야간 실행 비용 $${costSum.toFixed(2)}` : ''
  return [
    `## 🌙 ${date} 야간 브리핑 — 개선 아이디어`,
    '',
    `💡 아이디어 ${ideaCnt}건 · 없음 ${cnt('none')} · 스킵 ${cnt('skip')} · 실패 ${cnt('fail')}${noReco ? ' · **추천사항 없음**' : ''}${costText} — _코드는 수정하지 않았습니다. 🚀 착수를 누르면 등재 후 개선 작업이 바로 시작됩니다(🔴 게이트 항목은 등재만)._`,
    '',
    ...lines,
    ...(recoLines.length ? ['', '### 🧩 도구 추천 (검토 후 설치/거부)', '', ...recoLines] : []),
    '',
  ].join('\n')
}

/** 날짜 섹션(최신이 위)의 올바른 위치에 삽입 — 상단 고정 섹션(✅/➕/🔧/착수 현황)은 건너뛴다 */
function insertDatedSection(doc, section, date) {
  section = section.replace(/\s*$/, '\n\n')
  // 같은 날짜의 '추천사항 없음(실행 기록 없음)' 자리표시자가 있으면 제거 후 교체
  doc = doc.replace(new RegExp(`\\n## 🌙 ${date} 야간 브리핑\\n\\n- 💤 \\*\\*추천사항 없음\\*\\*[^\\n]*\\n+`), '\n')
  const re = /\n## (?:🌙|🔭) (\d{4}-\d{2}-\d{2})/g
  let m
  while ((m = re.exec(doc))) {
    if (m[1] <= date) return doc.slice(0, m.index + 1) + section + doc.slice(m.index + 1)
  }
  return doc.replace(/\s*$/, '\n\n') + section
}

function writeBriefing(results, date = DATE) {
  // 도구 추천 → recos.json 에 신규만 pending 등록
  const recosPath = path.join(NIGHT_DIR, 'recos.json')
  const recosAll = readJson(recosPath, {})
  for (const r of results) {
    for (const rec of (r.recos || [])) {
      const id = recoId(date, r, rec)
      if (!recosAll[id]) recosAll[id] = { id, date, project: r.name, projPath: r.projPath, ...rec, status: 'pending' }
    }
  }
  fs.writeFileSync(recosPath, JSON.stringify(recosAll, null, 2))

  const section = renderBriefingSection(results, date, { recosAll, benchAll: readJson(IDEAS_PATH, {}) })
  let doc = ''
  if (fs.existsSync(BRIEF_DOC)) doc = fs.readFileSync(BRIEF_DOC, 'utf8')
  else doc = `# 야간 브리핑\n\n> 매일 밤 프로젝트를 읽고 🧭 목적에 기여하는 개선 아이디어를 제안합니다 — 코드는 수정하지 않으며, 아이디어는 매일 달라집니다\n\n`
  fs.writeFileSync(BRIEF_DOC, insertDatedSection(doc, section, date))
  try { require('./bench_status.js').refresh(BRIEF_DOC) } catch (e) { log(`착수 현황 갱신 실패: ${e.message}`) }

  // 사이드바 상단 고정 (jarvis.md 다음)
  const orderPath = path.join(JARVIS_DOCS, '.docorder.json')
  const order = readJson(orderPath, {})
  const root = order[''] || []
  let changed = false
  if (!root.includes('야간-브리핑.md')) {
    const at = root.indexOf('jarvis.md')
    root.splice(at === -1 ? 0 : at + 1, 0, '야간-브리핑.md'); changed = true
  }
  // 공통 개선 규칙 문서는 브리핑 바로 아래 고정
  if (fs.existsSync(COMMON_RULE_DOC) && !root.includes('공통-개선-규칙.md')) {
    root.splice(root.indexOf('야간-브리핑.md') + 1, 0, '공통-개선-규칙.md'); changed = true
  }
  if (changed) {
    order[''] = root
    fs.writeFileSync(orderPath, JSON.stringify(order, null, 2))
  }
  // 아침 미확인 플래그
  fs.writeFileSync(path.join(NIGHT_DIR, 'unread'), date)
}

async function main() {
  fs.mkdirSync(NIGHT_DIR, { recursive: true })
  // 중복 실행 방지 (8시간 이상 지난 락은 무시)
  if (fs.existsSync(LOCK) && Date.now() - fs.statSync(LOCK).mtimeMs < 8 * 3600_000) {
    log('이미 실행 중 (lock) — 종료'); return
  }
  fs.writeFileSync(LOCK, String(process.pid))
  try {
    // 메인 문서 상단 Skill·Agent·MCP 현황 자동 갱신
    try { require('./update_toolkit.js').main() } catch (e) { log(`toolkit 갱신 실패: ${e.message}`) }
    const cfg = readJson(path.join(HUB, 'config.json'), {})
    if (cfg.nightEnabled === false) { log('nightEnabled=false — 종료'); return }
    const model = cfg.nightModel || 'sonnet'
    const projects = readJson(path.join(JARVIS_DOCS, '.docprojects.json'), {})
    const roots = readJson(path.join(JARVIS_DOCS, '.docroots.json'), {})

    // 프로젝트별 (메인 문서, 경로) 목록 — jarvis 문서 저장 폴더에서 메인 문서 경로 결정
    const tree = readJson(path.join(JARVIS_DOCS, '.doctree.json'), {})
    const targets = []
    const seen = new Set()
    for (const [docId, proj] of Object.entries(projects)) {
      if (seen.has(proj)) continue
      seen.add(proj)
      const name = path.basename(proj)
      if (ONLY && name !== ONLY) continue
      const docDir = roots[docId] && fs.existsSync(roots[docId]) ? roots[docId] : JARVIS_DOCS
      const mainDoc = path.join(docDir, docId)
      // '개선 규칙' 갈래 문서 — 메인 문서의 자식 중 파일명에 '개선-규칙' 포함
      let ruleDoc = null
      for (const [child, parent] of Object.entries(tree)) {
        if (parent === docId && child.includes('개선-규칙')) {
          const cdir = roots[child] && fs.existsSync(roots[child]) ? roots[child] : JARVIS_DOCS
          const cp = path.join(cdir, child)
          if (fs.existsSync(cp)) { ruleDoc = cp; break }
        }
      }
      targets.push({ name, proj, docId, mainDoc: fs.existsSync(mainDoc) ? mainDoc : null, ruleDoc })
    }
    log(`야간 러너 시작 — 대상 ${targets.length}개, 모델 ${model}${TEST ? ' [TEST]' : ''}`)

    const results = []
    for (const t of targets) {
      const h = new Date().getHours() + new Date().getMinutes() / 60
      if (!TEST && h >= NO_NEW_AFTER_HOUR && h < 22) { // 03:30~22:00 사이면 신규 시작 금지
        results.push({ name: t.name, status: 'skip', reason: '데드라인(03:30) 도달 — 다음 밤에 처리' })
        continue
      }
      try {
        results.push(await processProject(t.name, t.proj, t.mainDoc, t.ruleDoc, model, t.docId))
      } catch (e) {
        results.push({ name: t.name, status: 'fail', reason: String(e).slice(0, 200) })
      }
      log(`◀ ${t.name} 완료: ${results[results.length - 1].status}`)
    }
    fs.writeFileSync(path.join(NIGHT_DIR, `${DATE}.json`), JSON.stringify(results, null, 2))
    writeBriefing(results)
    log('브리핑 작성 완료')
  } finally {
    try { fs.unlinkSync(LOCK) } catch {}
  }
}

if (require.main === module) main()
module.exports = { renderBriefingSection, insertDatedSection, writeBriefing, recentPrior, PRIOR_LIMIT, NIGHT_DIR, BRIEF_DOC }
