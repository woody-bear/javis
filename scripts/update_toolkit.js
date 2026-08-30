#!/usr/bin/env node
/** 프로젝트별 Skill·Agent·MCP 사용 현황을 각 메인 문서 상단에 갱신.
 *
 * 스캔 소스:
 *  - Skill: <proj>/.claude/skills/(dir|*.md) + <proj>/.claude/commands/*.md
 *  - Agent: <proj>/.claude/agents/*.md
 *  - MCP:   <proj>/.mcp.json mcpServers + ~/.claude.json projects[<proj>].mcpServers
 * 문서의 <!-- TOOLKIT:START --> ~ <!-- TOOLKIT:END --> 구간을 통째로 교체(멱등).
 * 야간 러너 시작 시에도 호출되어 매일 최신화된다.
 */
const fs = require('fs')
const os = require('os')
const path = require('path')

const HOME = os.homedir()
const JARVIS_DOCS = path.join(HOME, 'workflow', 'jarvis', 'docs')
const START = '<!-- TOOLKIT:START -->'
const END = '<!-- TOOLKIT:END -->'
const P_START = '<!-- PURPOSE:START -->'
const P_END = '<!-- PURPOSE:END -->'
const PURPOSE_UNSET = '(아직 미설정 — 이 문장을 클릭해 프로젝트의 목적을 한 문장으로 작성하세요)'

function readJson(p, fb) { try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return fb } }
function listDir(p) { try { return fs.readdirSync(p) } catch { return [] } }

function scanProject(proj) {
  const skills = new Set()
  for (const f of listDir(path.join(proj, '.claude', 'skills'))) skills.add(f.replace(/\.md$/, ''))
  for (const f of listDir(path.join(proj, '.claude', 'commands'))) {
    if (f.endsWith('.md')) skills.add(f.replace(/\.md$/, ''))
  }
  const agents = listDir(path.join(proj, '.claude', 'agents'))
    .filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, ''))
  const mcp = new Set(Object.keys(readJson(path.join(proj, '.mcp.json'), {}).mcpServers || {}))
  const cj = readJson(path.join(HOME, '.claude.json'), {})
  const pcfg = (cj.projects || {})[proj]
  if (pcfg && pcfg.mcpServers) for (const k of Object.keys(pcfg.mcpServers)) mcp.add(k)
  return { skills: [...skills].sort(), agents: agents.sort(), mcp: [...mcp].sort() }
}

function sectionFor(scan) {
  const fmt = (arr) => arr.length ? arr.map((x) => `\`${x}\``).join(' · ') : '— (전역 기본만 사용)'
  return [
    START,
    '## 🧩 사용 중인 Skill · Agent · MCP',
    '',
    `_자동 스캔 ${new Date().toISOString().slice(0, 10)} — .claude/skills·commands·agents, .mcp.json 기준. 야간 러너가 매일 갱신_`,
    '',
    '| 구분 | 사용 중 |',
    '|------|---------|',
    `| 🛠 Skill | ${fmt(scan.skills)} |`,
    `| 🤖 Agent | ${fmt(scan.agents)} |`,
    `| 🔌 MCP | ${fmt(scan.mcp)} |`,
    END,
  ].join('\n')
}

/** 🧭 프로젝트 목적(한 문장) 블록 — 없으면 H1 아래(TOOLKIT 앞)에 1회 삽입, 있으면 절대 건드리지 않음(사용자 소유). */
function purposeBlock() {
  return [
    P_START,
    '## 🧭 프로젝트 목적 (한 문장)',
    '',
    `> ${PURPOSE_UNSET}`,
    '',
    '_이 한 문장이 모든 개선의 최종 목표다. 야간 자율 개선과 벤치마킹 조사는 "이 문장에 더 가까워지는가"로 후보를 고른다. 이 블록을 클릭해 언제든 수정할 수 있다._',
    P_END,
  ].join('\n')
}
function ensurePurpose(docPath) {
  if (!fs.existsSync(docPath)) return false
  let doc = fs.readFileSync(docPath, 'utf8')
  if (doc.includes(P_START)) return false
  const anchor = doc.indexOf(START) !== -1 ? doc.indexOf(START) : doc.indexOf('\n## ') + 1
  doc = anchor > 0
    ? doc.slice(0, anchor) + purposeBlock() + '\n\n' + doc.slice(anchor)
    : doc.replace(/\s*$/, '\n\n') + purposeBlock() + '\n'
  fs.writeFileSync(docPath, doc)
  return true
}
/** 메인 문서에서 목적 문장 읽기 — 미설정이면 null */
function readPurpose(docPath) {
  try {
    const doc = fs.readFileSync(docPath, 'utf8')
    const si = doc.indexOf(P_START), ei = doc.indexOf(P_END)
    if (si === -1 || ei === -1) return null
    const m = /^>\s*(.+)$/m.exec(doc.slice(si, ei))
    if (!m) return null
    const t = m[1].trim()
    return !t || t.includes('아직 미설정') ? null : t
  } catch { return null }
}

function updateDoc(docPath, scan) {
  if (!fs.existsSync(docPath)) return false
  let doc = fs.readFileSync(docPath, 'utf8')
  const section = sectionFor(scan)
  const si = doc.indexOf(START)
  const ei = doc.indexOf(END)
  if (si !== -1 && ei !== -1) {
    doc = doc.slice(0, si) + section + doc.slice(ei + END.length)
  } else {
    // 첫 '## ' 헤딩 앞에 삽입 (H1·인용문 바로 아래)
    const idx = doc.indexOf('\n## ')
    doc = idx === -1
      ? doc.replace(/\s*$/, '\n\n') + section + '\n'
      : doc.slice(0, idx + 1) + section + '\n\n' + doc.slice(idx + 1)
  }
  fs.writeFileSync(docPath, doc)
  return true
}

function main() {
  const projects = readJson(path.join(JARVIS_DOCS, '.docprojects.json'), {})
  const roots = readJson(path.join(JARVIS_DOCS, '.docroots.json'), {})
  const tree = readJson(path.join(JARVIS_DOCS, '.doctree.json'), {})
  for (const [docId, proj] of Object.entries(projects)) {
    if (tree[docId]) continue                    // 메인(루트) 문서만
    if (!fs.existsSync(proj)) continue
    const dir = roots[docId] && fs.existsSync(roots[docId]) ? roots[docId] : JARVIS_DOCS
    const mainDoc = path.join(dir, docId)
    const ok = updateDoc(mainDoc, scanProject(proj))
    if (ensurePurpose(mainDoc)) console.log(`목적 블록 삽입: ${docId}`)
    console.log(`${ok ? '갱신' : '없음'}: ${docId} ← ${path.basename(proj)}`)
  }
}

if (require.main === module) main()
module.exports = { main, readPurpose, ensurePurpose, PURPOSE_UNSET }
