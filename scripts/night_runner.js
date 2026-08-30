#!/usr/bin/env node
/** Jarvis 야간 자율 개선 러너 — launchd(23:00)가 실행, 앱과 독립.
 *
 * 원칙:
 *  - 프로젝트당 최대 1건, 그러나 "꼭 필요하지 않으면 안 한다" — 평가 후 가치 없으면 무변경 SKIP
 *  - git 없는 프로젝트·미커밋 변경(추적 파일) 있는 프로젝트는 건드리지 않음
 *  - night/<날짜> 브랜치에만 커밋, push 없음, 끝나면 원래 브랜치로 복귀
 *  - 타임박스: 프로젝트당 25분, 03:30 이후 신규 시작 금지
 *  - 결과는 docs/야간-브리핑.md(최신이 위) + ~/JarvisHub/night/<날짜>.json
 */
const { spawn, execSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const HOME = os.homedir()
const HUB = path.join(HOME, 'JarvisHub')
const NIGHT_DIR = path.join(HUB, 'night')
const JARVIS_DOCS = path.join(HOME, 'workflow', 'jarvis', 'docs')
const BRIEF_DOC = path.join(JARVIS_DOCS, '야간-브리핑.md')
const LOCK = path.join(NIGHT_DIR, 'runner.lock')
const PER_PROJECT_MS = 25 * 60 * 1000
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
const BRANCH = `night/${DATE}`

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

function nightPrompt(projName, mainDocPath, ruleDocPath) {
  return [
    `너는 '${projName}' 프로젝트의 야간 자율 개선 에이전트다. 지금은 무인 실행이며 사용자는 자고 있다.`,
    ruleDocPath ? `⚖️ 개선 규칙 문서: ${ruleDocPath} — 반드시 먼저 읽어라. 문서의 "🎨/🎯 개선 목표" 한 줄을 개선 우선순위 판단 기준으로 삼되, 금지 구역·검증·근거 원칙은 목표보다 항상 우선한다.` : '',
    '기본 개선사항(공통 점검 순서): ① 불필요한 중복 기능 제거 ② 에러 발생 요인 제거 ③ 좀비 프로세스 생성 요인 개선.',
    mainDocPath ? `프로젝트 메인 문서: ${mainDocPath} — '🔧 개선할 기능' 섹션도 참고하라.` : '',
    '',
    '절차 (반드시 이 순서):',
    '1) 먼저 평가만 하라: 프로젝트를 훑고 "지금 실제로 가치 있는 개선 1건"이 있는지 판단한다.',
    '   ⚠️ 핵심 원칙: 꼭 필요하지 않으면 하지 않는다. 과잉 리팩토링·스타일 변경·사소한 정리·',
    '   추측성 기능 추가는 가치 없음으로 판정하라. 확신이 없으면 SKIP이 정답이다.',
    '2) 가치 있는 개선이 없다면: 아무 파일도 수정하지 말고, 마지막 줄에 정확히',
    '   [BRIEF] SKIP: <한 줄 이유> 를 출력하고 끝내라.',
    '3) 가치 있는 개선이 있다면 딱 1건만:',
    '   - 구현 전에 반드시 "근거"를 확정하라: 어떤 문제/불편/위험이 실제로 있고, 왜 이 개선이',
    '     지금 가치가 있는지. 근거가 한 문장으로 명확히 서술되지 않으면 그 작업은 SKIP 대상이다.',
    '   - 범위 작게 (수정 파일 5개 이내), 기존 동작 보존, 파괴적 작업 금지(삭제·마이그레이션·의존성 대량 변경 금지)',
    '   - 구현 후 검증(문법 체크·빌드·가능하면 테스트)까지 통과시켜라. 검증 실패 상태로 남기지 마라.',
    '   - 현재 브랜치(이미 야간 브랜치다)에 커밋하라. 커밋 메시지는 "night: <내용>" 제목 +',
    '     본문에 "근거: <왜 필요한가>"를 반드시 포함하라.',
    mainDocPath ? '   - 메인 문서의 작업 로그에 오늘 날짜로 기록하라 — 한 일 + 근거를 함께.' : '',
    '   - 마지막에 다음 두 줄을 정확한 형식으로 출력하라:',
    '     [WHY] <이 개선을 한 근거 한두 문장>',
    '     [BRIEF] DONE: <무엇을 개선했는지 한 줄>',
    '4) push는 절대 하지 마라. 서버 재시작·배포도 하지 마라.',
  ].filter(Boolean).join('\n')
}

function runClaude(projPath, prompt, model) {
  return new Promise((resolve) => {
    const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--dangerously-skip-permissions']
    if (model) args.push('--model', model)
    args.push('--add-dir', JARVIS_DOCS)
    const proc = spawn(findClaude(), args, { cwd: projPath, env: process.env })
    let buf = ''
    let result = ''
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
          if (ev.type === 'result') result = ev.result || ''
        } catch {}
      }
    })
    proc.on('close', (code) => { clearTimeout(killer); resolve({ code, result }) })
    proc.on('error', (e) => { clearTimeout(killer); resolve({ code: -1, result: `실행 실패: ${e.message}` }) })
  })
}

async function processProject(name, projPath, mainDocPath, ruleDocPath, model) {
  // git 필수
  if (!trySh('git rev-parse --is-inside-work-tree', projPath)) {
    return { name, status: 'skip', reason: 'git 저장소 아님 — 자율 수정 대상 제외' }
  }
  // 추적 파일에 미커밋 변경 있으면 스킵 (untracked만 있는 건 허용)
  const porcelain = trySh('git status --porcelain', projPath) || ''
  const dirty = porcelain.split('\n').filter((l) => l.trim() && !l.startsWith('??'))
  if (dirty.length) {
    return { name, status: 'skip', reason: `미커밋 변경 ${dirty.length}건 — 작업 보호를 위해 건너뜀` }
  }
  let origBranch = trySh('git rev-parse --abbrev-ref HEAD', projPath) || 'main'
  // 자가 복구: 이전 실행이 중단돼 night 브랜치에 남아 있으면 기본 브랜치로 복귀
  if (origBranch.startsWith('night/')) {
    const def = trySh('git rev-parse --verify main', projPath) ? 'main'
      : trySh('git rev-parse --verify master', projPath) ? 'master' : null
    if (def) { trySh('git reset --hard', projPath); trySh(`git checkout ${def}`, projPath); origBranch = def }
  }
  const baseHead = trySh('git rev-parse HEAD', projPath)

  // 야간 브랜치 (있으면 재사용)
  if (trySh(`git rev-parse --verify ${BRANCH}`, projPath)) trySh(`git checkout ${BRANCH}`, projPath)
  else trySh(`git checkout -b ${BRANCH}`, projPath)

  log(`▶ ${name} 시작 (브랜치 ${BRANCH}, 원복귀 ${origBranch})`)
  let out
  try {
    out = await runClaude(projPath, nightPrompt(name, mainDocPath, ruleDocPath), model)
  } finally {
    // 미커밋 잔여물은 폐기하고 원래 브랜치로 복귀 (untracked는 그대로 둠)
    trySh('git reset --hard', projPath)
    trySh(`git checkout ${origBranch}`, projPath)
  }
  const commits = parseInt(trySh(`git rev-list --count ${baseHead}..${BRANCH}`, projPath) || '0', 10)
  const briefMatch = /\[BRIEF\]\s*(SKIP|DONE):\s*(.+)/i.exec(out.result || '')
  const brief = briefMatch ? briefMatch[2].trim() : (out.result || '').slice(-200).replace(/\s+/g, ' ')
  const whyMatch = /\[WHY\]\s*(.+)/i.exec(out.result || '')
  const why = whyMatch ? whyMatch[1].trim() : null

  if (briefMatch && briefMatch[1].toUpperCase() === 'SKIP') {
    // 무변경 SKIP인데 커밋이 생겼으면 이상 — 기록만
    return { name, status: 'none', reason: brief, commits }
  }
  if (out.code === 0 && commits > 0) {
    return { name, status: 'done', reason: brief, why, commits, branch: BRANCH }
  }
  return { name, status: 'fail', reason: `종료코드 ${out.code}, 커밋 ${commits} — ${brief}`, commits }
}

function writeBriefing(results) {
  const icons = { done: '✅', none: '💤', skip: '⏭', fail: '❌' }
  const lines = results.map((r) => {
    const extra = r.status === 'done' ? ` _(브랜치 \`${r.branch}\`, 커밋 ${r.commits} — 리뷰 후 머지)_` : ''
    const why = r.status === 'done' && r.why ? `\n  - **근거**: ${r.why}` : ''
    return `- ${icons[r.status]} **${r.name}** — ${r.reason}${extra}${why}`
  })
  const doneCnt = results.filter((r) => r.status === 'done').length
  const section = [
    `## 🌙 ${DATE} 야간 브리핑`,
    '',
    `개선 ${doneCnt}건 · 불필요 판정 ${results.filter((r) => r.status === 'none').length}건 · 스킵 ${results.filter((r) => r.status === 'skip').length}건`,
    '',
    ...lines,
    '',
  ].join('\n')

  let doc = ''
  if (fs.existsSync(BRIEF_DOC)) doc = fs.readFileSync(BRIEF_DOC, 'utf8')
  else doc = `# 야간 브리핑\n\n> 매일 밤 23:00~04:00 자율 개선 결과 — 필요 없으면 하지 않는 것이 원칙입니다\n\n`
  // H1 헤더 바로 뒤(첫 빈 줄 다음)에 최신 섹션 prepend
  const idx = doc.indexOf('\n## ')
  doc = idx === -1 ? doc.replace(/\s*$/, '\n\n') + section : doc.slice(0, idx + 1) + section + doc.slice(idx + 1)
  fs.writeFileSync(BRIEF_DOC, doc)

  // 사이드바 상단 고정 (jarvis.md 다음)
  const orderPath = path.join(JARVIS_DOCS, '.docorder.json')
  const order = readJson(orderPath, {})
  const root = order[''] || []
  if (!root.includes('야간-브리핑.md')) {
    const at = root.indexOf('jarvis.md')
    root.splice(at === -1 ? 0 : at + 1, 0, '야간-브리핑.md')
    order[''] = root
    fs.writeFileSync(orderPath, JSON.stringify(order, null, 2))
  }
  // 아침 미확인 플래그
  fs.writeFileSync(path.join(NIGHT_DIR, 'unread'), DATE)
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
    try { require('./update_toolkit.js') } catch (e) { log(`toolkit 갱신 실패: ${e.message}`) }
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
      targets.push({ name, proj, mainDoc: fs.existsSync(mainDoc) ? mainDoc : null, ruleDoc })
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
        results.push(await processProject(t.name, t.proj, t.mainDoc, t.ruleDoc, model))
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

main()
