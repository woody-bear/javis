#!/usr/bin/env node
/** 🔭 벤치마킹 조사 러너 — 하루 1개 프로젝트 순환, 3단계 에이전트 파이프라인 (코드 수정 없음)
 *
 *  1단계 benchmark-scout : 프로젝트 목적에 비춰 더 잘 만든 외부 사례 조사 (웹)
 *  2단계 impl-analyst    : 어떻게 만들었는지 + 내 코드와의 차이 분석
 *  3단계 fit-judge       : 목적·개선 규칙 적합성 판정 → 브리핑용 쉬운 정리 (opus)
 *
 *  - 에이전트 정의: .claude/agents/<name>.md (frontmatter의 tools/model을 그대로 사용)
 *  - 단계 간 전달: ~/JarvisHub/night/bench/<날짜>/<프로젝트>/stage{1,2,3}.json (실패 시 다음 밤 재개 가능)
 *  - 결과: docs/야간-브리핑.md 에 "🔭 벤치마킹 제안" 섹션 + 착수/보류 버튼, 이력 bench.json
 *  - 순환: .docorder 루트 순서대로 하루 1개 (state.json), BENCH_ONLY=<프로젝트명> 로 지정 가능
 *  - config.json: benchEnabled(false면 종료), benchJudgeModel(3단계 모델 덮어쓰기)
 */
const { spawn } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const toolkit = require('./update_toolkit.js')

const HOME = os.homedir()
const HUB = path.join(HOME, 'JarvisHub')
const NIGHT_DIR = path.join(HUB, 'night')
const BENCH_DIR = path.join(NIGHT_DIR, 'bench')
const JARVIS_DOCS = path.join(HOME, 'workflow', 'jarvis', 'docs')
const AGENTS_DIR = path.join(__dirname, '..', '.claude', 'agents')
const BRIEF_DOC = path.join(JARVIS_DOCS, '야간-브리핑.md')
const COMMON_RULE_DOC = path.join(JARVIS_DOCS, '공통-개선-규칙.md')
const LOCK = path.join(BENCH_DIR, 'lock')
const DATE = new Date().toISOString().slice(0, 10)
const STAGE_MS = { 1: 10 * 60_000, 2: 10 * 60_000, 3: 8 * 60_000 }
const ONLY = process.env.BENCH_ONLY || null
const PRIOR_LIMIT = 20   // 프롬프트에 넣는 '이전 제안' 최대 건수
/** 이력 배열을 최근(acceptedAt → date) 순으로 정렬해 앞 limit건만 반환 (원본 배열 불변) */
function recentPrior(items, limit) {
  const key = (h) => String(h.acceptedAt || h.date || '')
  return [...items].sort((a, b) => key(b).localeCompare(key(a))).slice(0, limit)
}

function readJson(p, fb) { try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return fb } }
function writeJson(p, v) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(v, null, 2)) }
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`
  console.log(line)
  fs.mkdirSync(BENCH_DIR, { recursive: true })
  fs.appendFileSync(path.join(BENCH_DIR, `${DATE}.log`), line + '\n')
}
function findClaude() {
  for (const c of [path.join(HOME, '.local/bin/claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude']) {
    if (fs.existsSync(c)) return c
  }
  return 'claude'
}

/** .claude/agents/<name>.md → { tools:[], model, body } */
function loadAgent(name) {
  const raw = fs.readFileSync(path.join(AGENTS_DIR, `${name}.md`), 'utf8')
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(raw)
  if (!m) throw new Error(`에이전트 정의 형식 오류: ${name}`)
  const fm = {}
  for (const l of m[1].split('\n')) { const i = l.indexOf(':'); if (i > 0) fm[l.slice(0, i).trim()] = l.slice(i + 1).trim() }
  return { tools: (fm.tools || '').split(',').map((s) => s.trim()).filter(Boolean), model: fm.model || 'sonnet', body: m[2].trim() }
}

function runStage(agentName, prompt, cwd, ms, modelOverride) {
  const ag = loadAgent(agentName)
  const model = modelOverride || ag.model
  return new Promise((resolve) => {
    const args = ['-p', prompt, '--append-system-prompt', ag.body, '--model', model,
      '--output-format', 'stream-json', '--verbose', '--dangerously-skip-permissions', '--add-dir', JARVIS_DOCS]
    if (ag.tools.length) args.push('--allowedTools', ...ag.tools, '--disallowedTools', 'Edit', 'Write', 'NotebookEdit', 'Bash')
    const proc = spawn(findClaude(), args, { cwd, env: process.env })
    let buf = '', result = '', cost = 0
    const killer = setTimeout(() => {
      log(`  [${agentName}] 타임박스 초과 → SIGTERM`)
      try { proc.kill('SIGTERM') } catch {}
      setTimeout(() => { try { if (proc.exitCode === null) proc.kill('SIGKILL') } catch {} }, 5000)
    }, ms)
    proc.stdout.on('data', (c) => {
      buf += c.toString()
      let i
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1)
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
    proc.on('close', (code) => { clearTimeout(killer); resolve({ code, result, model, cost }) })
    proc.on('error', (e) => { clearTimeout(killer); resolve({ code: -1, result: `실행 실패: ${e.message}`, model, cost }) })
  })
}

/** 결과 텍스트의 마지막 ```json 펜스를 파싱 */
function parseJson(text) {
  const fences = [...(text || '').matchAll(/```json\s*([\s\S]*?)```/g)]
  for (let i = fences.length - 1; i >= 0; i--) { try { return JSON.parse(fences[i][1]) } catch {} }
  const m = /\{[\s\S]*\}/.exec(text || '')
  if (m) { try { return JSON.parse(m[0]) } catch {} }
  return null
}

function pickProject() {
  const projects = readJson(path.join(JARVIS_DOCS, '.docprojects.json'), {})
  const roots = readJson(path.join(JARVIS_DOCS, '.docroots.json'), {})
  const tree = readJson(path.join(JARVIS_DOCS, '.doctree.json'), {})
  const order = (readJson(path.join(JARVIS_DOCS, '.docorder.json'), {})[''] || [])
  const mains = [...new Set([...order, ...Object.keys(projects)])]
    .filter((d) => projects[d] && !tree[d] && fs.existsSync(projects[d]))
    .map((docId) => {
      const dir = roots[docId] && fs.existsSync(roots[docId]) ? roots[docId] : JARVIS_DOCS
      let ruleDoc = null
      for (const [child, parent] of Object.entries(tree)) {
        if (parent === docId && child.includes('개선-규칙')) {
          const cdir = roots[child] && fs.existsSync(roots[child]) ? roots[child] : JARVIS_DOCS
          const cp = path.join(cdir, child); if (fs.existsSync(cp)) { ruleDoc = cp; break }
        }
      }
      return { docId, name: path.basename(projects[docId]), proj: projects[docId], mainDoc: path.join(dir, docId), ruleDoc }
    })
  if (!mains.length) return null
  if (ONLY) return mains.find((m) => m.name === ONLY) || null
  const statePath = path.join(BENCH_DIR, 'state.json')
  const state = readJson(statePath, { last: null })
  const idx = mains.findIndex((m) => m.name === state.last)
  const pick = mains[(idx + 1) % mains.length]
  writeJson(statePath, { last: pick.name, date: DATE })
  return pick
}

function prependBriefing(section) {
  let doc = fs.existsSync(BRIEF_DOC) ? fs.readFileSync(BRIEF_DOC, 'utf8')
    : `# 야간 브리핑\n\n> 매일 밤 23:00~04:00 자율 개선 결과 — 필요 없으면 하지 않는 것이 원칙입니다\n\n`
  // 상단 고정 섹션(✅ 완성된 기능 · ➕ 추가할 기능 · 🔧 개선할 기능)은 건너뛰고, 첫 날짜 섹션(## 🌙 / ## 🔭) 앞에 최신 섹션 prepend
  const dated = /\n## (?:🌙|🔭) /.exec(doc)
  const idx = dated ? dated.index : -1
  doc = idx === -1 ? doc.replace(/\s*$/, '\n\n') + section : doc.slice(0, idx + 1) + section + doc.slice(idx + 1)
  fs.writeFileSync(BRIEF_DOC, doc)
  try { require('./bench_status.js').refresh(BRIEF_DOC) } catch { /* noop */ }
  fs.writeFileSync(path.join(NIGHT_DIR, 'unread'), DATE)
}

function renderSection(t, purpose, proposals, note, cost) {
  const costLine = cost > 0 ? ` · 💰 오늘 야간 실행 비용 $${cost.toFixed(2)}` : ''
  const head = [`## 🔭 ${DATE} 벤치마킹 제안 — ${t.name}`, '', `🧭 목적: _${purpose}_${costLine}`, '']
  if (note) return [...head, note, '', ''].join('\n')
  if (!proposals.length) return [...head, '- 💤 목적에 기여하는 새 벤치마킹 사례 없음 (근거 없는 제안은 하지 않습니다)', '', ''].join('\n')
  const icon = { recommend: '✅ 추천', hold: '⏸ 보류', gate: '🔴 확정 필요', reject: '❌ 부적합' }
  const lines = proposals.map((p) => {
    const btn = p.verdict === 'reject' ? '' :
      ` <!--BENCH:${p.id}--> [🚀 착수](jarvis-bench://accept/${encodeURIComponent(p.id)}) · [⏸ 보류](jarvis-bench://hold/${encodeURIComponent(p.id)})`
    return [
      `- **${p.id} · ${p.title}**${btn}`,
      `  - 🔍 **문제**: ${p.problem || p.plain}`,
      `  - 🛠 **해결**: ${p.solution || p.howBuilt} — [출처](${p.source})`,
      `  - 🎯 **효과**: ${p.effect || p.purposeFit}${p.fitLevel ? ` (${p.fitLevel})` : ''}`,
      `  - ⚖️ **판정**: ${icon[p.verdict] || p.verdict} · 난이도 ${p.effort}${p.gate ? ` · 🔴 ${p.gate}` : ''} — ${p.reason}`,
    ].join('\n')
  })
  return [...head, ...lines, '', '_🚀 착수 → "➕ 추가할 기능" 등재 후 개선 작업이 바로 시작됩니다. 🔴 확정 필요 항목은 등재만 되며, 확정 절차 후 주간 작업으로 진행됩니다._', '', ''].join('\n')
}

async function main() {
  fs.mkdirSync(BENCH_DIR, { recursive: true })
  if (fs.existsSync(LOCK) && Date.now() - fs.statSync(LOCK).mtimeMs < 4 * 3600_000) { log('이미 실행 중 (lock) — 종료'); return }
  fs.writeFileSync(LOCK, String(process.pid))
  try {
    const cfg = readJson(path.join(HUB, 'config.json'), {})
    if (cfg.benchEnabled === false) { log('benchEnabled=false — 종료'); return }
    try { toolkit.main() } catch (e) { log(`toolkit 갱신 실패: ${e.message}`) }
    const t = pickProject()
    if (!t) { log('대상 프로젝트 없음'); return }
    const purpose = toolkit.readPurpose(t.mainDoc)
    log(`벤치마킹 시작 — ${t.name} (목적: ${purpose || '미설정'})`)
    if (!purpose) {
      prependBriefing(renderSection(t, '미설정', [], `- 🧭 **프로젝트 목적 미설정** — [${t.docId.replace(/\.md$/, '')}](${t.docId}) 상단 "프로젝트 목적 (한 문장)"을 작성하면 다음 순번부터 그 목적으로 벤치마킹을 조사합니다.`))
      return
    }
    const outDir = path.join(BENCH_DIR, DATE, t.name)
    fs.mkdirSync(outDir, { recursive: true })
    const history = readJson(path.join(BENCH_DIR, 'bench.json'), {})
    let totalCost = 0
    // 프롬프트에는 최근 PRIOR_LIMIT건만 주입 (bench.json 이력 자체는 그대로 보존)
    const prior = recentPrior(Object.values(history).filter((h) => h.project === t.name), PRIOR_LIMIT).map((h) => `${h.title} (${h.source})`)

    // ── 1단계 조사 ──
    const s1Path = path.join(outDir, 'stage1.json')
    let s1 = readJson(s1Path, null)
    if (!s1) {
      const r = await runStage('benchmark-scout', [
        `프로젝트 '${t.name}' (경로 ${t.proj}) 의 벤치마킹 사례를 조사하라.`,
        `🧭 프로젝트 목적(한 문장): "${purpose}"`,
        `메인 문서: ${t.mainDoc} — '➕ 추가할 기능'·'🔧 개선할 기능'에서 구체 키워드를 뽑아라.`,
        prior.length ? `이미 제안된 사례(제외): ${prior.join('; ')}` : '',
      ].filter(Boolean).join('\n'), t.proj, STAGE_MS[1])
      totalCost += r.cost || 0
      s1 = parseJson(r.result)
      if (!s1 || !Array.isArray(s1.cases)) { log(`1단계 실패 (code ${r.code})`); prependBriefing(renderSection(t, purpose, [], `- ❌ 1단계(사례 조사) 실패 — 로그 ${path.join(BENCH_DIR, DATE + '.log')}`, totalCost)); return }
      s1.cases = s1.cases.filter((c) => c && c.title && /^https?:\/\//.test(c.source || ''))
      writeJson(s1Path, s1)
    }
    log(`1단계 완료 — 사례 ${s1.cases.length}건`)
    if (!s1.cases.length) { prependBriefing(renderSection(t, purpose, [], null, totalCost)); return }

    // ── 2단계 분석 ──
    const s2Path = path.join(outDir, 'stage2.json')
    let s2 = readJson(s2Path, null)
    if (!s2) {
      const r = await runStage('impl-analyst', [
        `프로젝트 '${t.name}' (경로 ${t.proj}) 에 대해 아래 사례들이 어떻게 구현됐는지 분석하고 내 코드와 대조하라.`,
        `🧭 프로젝트 목적(한 문장): "${purpose}"`,
        `1단계 사례:\n${JSON.stringify(s1.cases, null, 2)}`,
      ].join('\n'), t.proj, STAGE_MS[2])
      totalCost += r.cost || 0
      s2 = parseJson(r.result)
      if (!s2 || !Array.isArray(s2.analyses)) { log(`2단계 실패 (code ${r.code})`); prependBriefing(renderSection(t, purpose, [], `- ❌ 2단계(구현 분석) 실패 — 1단계 결과는 ${s1Path} 에 보존, 다음 실행 시 재개`, totalCost)); return }
      writeJson(s2Path, s2)
    }
    log(`2단계 완료 — 분석 ${s2.analyses.length}건`)

    // ── 3단계 판정 ──
    const s3Path = path.join(outDir, 'stage3.json')
    let s3 = readJson(s3Path, null)
    if (!s3) {
      const r = await runStage('fit-judge', [
        `프로젝트 '${t.name}' (경로 ${t.proj}) 의 벤치마킹 제안 적합성을 판정하라.`,
        `🧭 프로젝트 목적(한 문장): "${purpose}" — 판정의 최우선 기준.`,
        fs.existsSync(COMMON_RULE_DOC) ? `공통 개선 규칙: ${COMMON_RULE_DOC} (먼저 읽어라 — 특히 '📝 브리핑 문구 규칙': 제목 동작형, problem/solution/effect 세 문장 필수)` : '',
        t.ruleDoc ? `프로젝트 개선 규칙: ${t.ruleDoc} ('🚫 손대면 안 되는 것'·확정 게이트 확인)` : '',
        `2단계 분석:\n${JSON.stringify(s2.analyses, null, 2)}`,
      ].filter(Boolean).join('\n'), t.proj, STAGE_MS[3], cfg.benchJudgeModel || null)
      totalCost += r.cost || 0
      s3 = parseJson(r.result)
      if (!s3 || !Array.isArray(s3.proposals)) { log(`3단계 실패 (code ${r.code})`); prependBriefing(renderSection(t, purpose, [], `- ❌ 3단계(적합성 판정) 실패 — 1·2단계 결과는 ${outDir} 에 보존, 다음 실행 시 재개`, totalCost)); return }
      writeJson(s3Path, s3)
    }

    // 번호 부여(B-n 이어서) + 이력 저장
    let n = Object.keys(history).length
    const proposals = []
    for (const p of s3.proposals) {
      if (!p || !p.title) continue
      const id = `B-${++n}`
      const rec = { id, date: DATE, project: t.name, projPath: t.proj, docId: t.docId, mainDoc: t.mainDoc, ...p, status: p.verdict === 'reject' ? 'rejected' : 'pending' }
      history[id] = rec
      proposals.push(rec)
    }
    writeJson(path.join(BENCH_DIR, 'bench.json'), history)
    prependBriefing(renderSection(t, purpose, proposals, null, totalCost))
    log(`3단계 완료 — 제안 ${proposals.length}건, 브리핑 작성 (비용 $${totalCost.toFixed(2)})`)
  } finally {
    try { fs.unlinkSync(LOCK) } catch {}
  }
}

if (require.main === module) main().catch((e) => { log(`치명적 오류: ${e.stack || e}`); process.exitCode = 1 })
module.exports = { renderSection, prependBriefing }
module.exports = { loadAgent, parseJson, renderSection, pickProject }
