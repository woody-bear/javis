#!/usr/bin/env node
/** 🚀 착수 승인 · 🏁 착수 완료 현황을 야간 브리핑 문서 상단에 갱신.
 *
 * 소스: ~/JarvisHub/night/bench/bench.json (status: accepted → implemented)
 * 완료 판정: 해당 프로젝트 메인 문서 '## ✅ 완성된 기능' 섹션에 `[벤치 <ID>]` 가 나타나면
 *            implemented 로 승격하고 implementedAt 을 기록 (구현 작업 프롬프트가 완료 시 항목을 옮기도록 지시함).
 * 문서의 <!-- ACCEPT:START --> ~ <!-- ACCEPT:END --> 구간을 통째로 교체(멱등). 구간이 없으면 H1·인용문 바로 아래 삽입.
 * 호출 시점: 앱 시작 · 착수/보류 버튼 · 채팅 작업 완료 · 야간/벤치 러너 브리핑 작성 후.
 */
const fs = require('fs')
const os = require('os')
const path = require('path')

const HOME = os.homedir()
const NIGHT_DIR = path.join(HOME, 'JarvisHub', 'night')
const BENCH_PATH = path.join(NIGHT_DIR, 'bench', 'bench.json')
const DEFAULT_BRIEF = path.join(HOME, 'workflow', 'jarvis', 'docs', '야간-브리핑.md')
const START = '<!-- ACCEPT:START -->'
const END = '<!-- ACCEPT:END -->'

function readJson(p, fb) { try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return fb } }

/** 마크다운에서 특정 H2 섹션 본문만 추출 */
function sectionBody(doc, heading) {
  const h = doc.indexOf(heading)
  if (h === -1) return ''
  const s = doc.indexOf('\n', h) + 1
  const n = doc.indexOf('\n## ', s)
  return doc.slice(s, n === -1 ? doc.length : n)
}

function kst(iso) {
  if (!iso) return '-'
  const d = new Date(iso)
  if (isNaN(d)) return '-'
  return d.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).replace(/\. /g, '-').replace(/\.$/, '').replace(/-(\d\d):/, ' $1:')
}

/** accepted 항목이 메인 문서 '✅ 완성된 기능'에 옮겨졌으면 implemented 로 승격 — 변경 여부 반환 */
function promoteImplemented(all) {
  let changed = false
  for (const b of Object.values(all)) {
    if (b.status !== 'accepted' || !b.mainDoc || !fs.existsSync(b.mainDoc)) continue
    let doc = ''
    try { doc = fs.readFileSync(b.mainDoc, 'utf8') } catch { continue }
    if (sectionBody(doc, '## ✅ 완성된 기능').includes(`[벤치 ${b.id}]`)) {
      b.status = 'implemented'
      b.implementedAt = new Date().toISOString()
      changed = true
    }
  }
  return changed
}

function render(all) {
  const byTime = (k) => (a, b) => String(b[k] || '').localeCompare(String(a[k] || ''))
  const accepted = Object.values(all).filter((b) => b.status === 'accepted').sort(byTime('acceptedAt'))
  const done = Object.values(all).filter((b) => b.status === 'implemented').sort(byTime('implementedAt'))
  const link = (b) => b.docId ? `[${b.project}](${encodeURI(b.docId)})` : (b.project || '')
  const aLines = accepted.length ? accepted.map((b) => b.gate && !b.confirmedAt
    ? `- 🔴 **${b.id} · ${b.title}** — ${link(b)} · 착수 ${kst(b.acceptedAt)} · **확정 대기** — 채팅에 "확정 ${b.id}" 라고 입력하면 주간 작업으로 진행 _(${b.gate})_`
    : b.gate
      ? `- 🔓 **${b.id} · ${b.title}** — ${link(b)} · 착수 ${kst(b.acceptedAt)} · 확정 ${kst(b.confirmedAt)} · **확정됨 — 주간 구현 진행 중** (완료되면 아래 "착수 완료"로 이동)`
      : `- ⏳ **${b.id} · ${b.title}** — ${link(b)} · 착수 ${kst(b.acceptedAt)} · **구현 대기/진행 중** (앱 자동 작업 큐 — 완료되면 아래 "착수 완료"로 이동)`)
    : ['- _없음_']
  const dLines = done.length
    ? done.map((b) => `- ✅ **${b.id} · ${b.title}** — ${link(b)} · 착수 ${kst(b.acceptedAt)}${b.confirmedAt ? ` · 확정 ${kst(b.confirmedAt)}` : ''} → 완료 ${kst(b.implementedAt)}`)
    : ['- _없음_']
  return [
    START,
    '## 🚀 착수 승인',
    '',
    `_착수 버튼으로 승인됐지만 아직 완료되지 않은 항목 **${accepted.length}건** — bench.json 기준 자동 갱신 (앱 시작·착수/보류·작업 완료·야간 러너 실행 시)_`,
    '',
    ...aLines,
    '',
    '## 🏁 착수 완료',
    '',
    `_구현이 끝나 프로젝트 메인 문서 "✅ 완성된 기능"으로 옮겨진 항목 **${done.length}건**_`,
    '',
    ...dLines,
    END,
  ].join('\n')
}

// ── 매일 날짜 섹션 보장 ──────────────────────────────────────────────
// 야간 브리핑은 하루에 한 섹션(## 🌙 YYYY-MM-DD)이 있어야 한다. 빠진 날짜는
//  · 실행 기록(night/<날짜>.json)이 있으면 → 그 기록으로 섹션을 복원 (앱 편집기가 옛 내용으로 덮어쓴 경우 등)
//  · 없으면 → "💤 추천사항 없음 — 실행 기록 없음" 자리표시자
const kstToday = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })
function addDays(ymd, n) { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }

function ensureDailySections(briefDoc) {
  if (!fs.existsSync(briefDoc)) return []
  let doc = fs.readFileSync(briefDoc, 'utf8')
  const have = new Set([...doc.matchAll(/^## 🌙 (\d{4}-\d{2}-\d{2})/gm)].map((m) => m[1]))
  let jsonDates = []
  try { jsonDates = fs.readdirSync(NIGHT_DIR).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).map((f) => f.slice(0, 10)) } catch { /* noop */ }
  const all = [...have, ...jsonDates].sort()
  if (!all.length) return []
  const last = addDays(kstToday(), -1)   // 어제까지 — 오늘 밤 실행분은 오늘 날짜로 23시 이후 생성됨
  const added = []
  const nr = require('./night_runner.js')
  for (let d = all[0]; d <= last; d = addDays(d, 1)) {
    if (have.has(d)) continue
    let section = null
    const jp = path.join(NIGHT_DIR, `${d}.json`)
    if (fs.existsSync(jp)) {
      try {
        const results = JSON.parse(fs.readFileSync(jp, 'utf8'))
        section = nr.renderBriefingSection(results, d, { recosAll: readJson(path.join(NIGHT_DIR, 'recos.json'), {}), benchAll: readJson(BENCH_PATH, {}) })
          .replace(/\s*$/, '\n\n') + `_ℹ️ 이 섹션은 문서에서 사라져 ${kstToday()} 에 실행 기록(${d}.json)으로 복원됨_\n`
      } catch { section = null }
    }
    if (!section) section = `## 🌙 ${d} 야간 브리핑\n\n- 💤 **추천사항 없음** — 이날 밤 러너 실행 기록이 없습니다 (실행되지 않았거나 결과 파일 없음)\n`
    doc = nr.insertDatedSection(doc, section, d)
    added.push(d)
  }
  if (added.length) fs.writeFileSync(briefDoc, doc)
  return added
}

/** 브리핑 문서의 착수 현황 구간 갱신. 반환: { updated, promoted, restored } */
function refresh(briefDoc = DEFAULT_BRIEF) {
  let restored = []
  try { restored = ensureDailySections(briefDoc) } catch { /* noop */ }
  const all = readJson(BENCH_PATH, {})
  const promoted = promoteImplemented(all)
  if (promoted) fs.writeFileSync(BENCH_PATH, JSON.stringify(all, null, 2))
  if (!fs.existsSync(briefDoc)) return { updated: false, promoted, restored }
  let doc = fs.readFileSync(briefDoc, 'utf8')
  const text = render(all)
  // 기존 현황판을 모두 제거한 뒤 1개만 다시 넣는다 — 마커 구간뿐 아니라, 편집기(WYSIWYG) 저장으로
  // HTML 주석 마커가 사라진 채 남은 '## 🚀 착수 승인'/'## 🏁 착수 완료' 헤딩 섹션도 함께 정리(중복 방지)
  doc = doc.replace(/<!-- ACCEPT:START -->[\s\S]*?<!-- ACCEPT:END -->\n*/g, '')
  doc = doc.replace(/^## (?:🚀 착수 승인|🏁 착수 완료)\n[\s\S]*?(?=^## |(?![\s\S]))/gm, '')
  // H1·인용문 바로 아래(첫 '## ' 앞)에 삽입
  const idx = doc.indexOf('\n## ')
  doc = idx === -1
    ? doc.replace(/\s*$/, '\n\n') + text + '\n'
    : doc.slice(0, idx + 1) + text + '\n\n' + doc.slice(idx + 1)
  fs.writeFileSync(briefDoc, doc)
  return { updated: true, promoted, restored }
}

if (require.main === module) {
  const r = refresh()
  console.log(`착수 현황 갱신: ${r.updated ? '완료' : '브리핑 문서 없음'}${r.promoted ? ' (완료 승격 있음)' : ''}${r.restored && r.restored.length ? ` · 날짜 섹션 보강: ${r.restored.join(', ')}` : ''}`)
}
module.exports = { refresh, ensureDailySections }
