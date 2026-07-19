// 모든 parent directories (performance, rag 등) 아래의 하위 폴더들을 동적으로 스캔하여 docs.js (window.DOCS) 로 굽는다.
// 문서를 수정한 뒤 실행: node tech-breakthrough/viewer/build.mjs
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..') // tech-breakthrough

// date 필드 확보 통계(최종 보고용): 어느 경로로 날짜를 얻었는지 집계한다.
const dateStats = { gitFirstCommit: 0, bodyRegex: 0, none: 0 }

// 주의: `--diff-filter=A --follow --reverse`를 함께 쓰면 git이 알려진 조합 한계로
// 조용히 빈 결과를 낸다(실측으로 확인, 다수 파일에서 재현됨). --follow만 쓰고
// (원래 순서대로: 최신 -> 과거) 마지막 줄을 취해 가장 오래된 "A"(추가) 이벤트를
// 얻는 방식으로 우회한다. 또한 diff-filter 없는 "가장 최근에 이 파일을 건드린 커밋"은
// 쓰지 않는다 — tech-breakthrough/는 오늘 git 추적에서 제외되며 대량 삭제(D) 커밋이
// 발생했고, 그 커밋이 "가장 최근"으로 잡혀 실제로는 훨씬 이전에 작성된 문서가
// 전부 오늘 날짜로 둔갑하는 문제를 실측으로 확인했기 때문이다.
function getCommitDate(absFilePath, repoRoot) {
  try {
    const out = execSync(
      `git log --format=%ad --date=short --diff-filter=A --follow -- "${absFilePath}"`,
      { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    ).trim()
    if (out) {
      const lines = out.split('\n')
      const oldest = lines[lines.length - 1]
      if (oldest) return { date: oldest, source: 'gitFirstCommit' }
    }
  } catch {}
  return null
}

// tech-breakthrough/는 .gitignore로 추적에서 빠져있어 대다수 문서가 git 이력이 없다.
// 이 경우 mtime은 오늘 세션의 대량 수정으로 거의 전부 "오늘"이 되어 의미가 없으므로
// 쓰지 않고, 대신 문서 본문의 "**일정**: YYYY-MM-DD" / "**작성일**: YYYY-MM-DD" 를
// 정규식으로 파싱해 날짜로 쓴다. 그것도 없으면 date 필드 자체를 생략한다.
function getDocDate(absFilePath, repoRoot, md) {
  const gitResult = getCommitDate(absFilePath, repoRoot)
  if (gitResult) {
    dateStats[gitResult.source]++
    return gitResult.date
  }
  const bodyMatch = md.match(/\*\*(?:일정|작성일)\*\*:\s*(\d{4}-\d{2}-\d{2})/)
  if (bodyMatch) {
    dateStats.bodyRegex++
    return bodyMatch[1]
  }
  dateStats.none++
  return null
}

function getCategoryPriority(cat) {
  if (cat === 'rag') return 1
  if (cat === 'backend-performance') return 2
  if (cat === 'backend-stability') return 3
  if (cat === 'frontend-performance') return 4
  if (cat === 'cicd') return 5
  return 6
}

// 트랙은 learning / setup / journal 셋 중 하나만 존재한다(A-2).
function getTrackPriority(track) {
  if (track === 'learning') return 1
  if (track === 'setup') return 2
  if (track === 'journal') return 3
  return 3
}

// 파일명에서 숫자/대시 프리픽스를 뗀 나머지에 'environment' 또는 'setup'이
// 포함되면(대소문자 무관) setup 트랙, 아니면 journal 트랙으로 판정한다(A-2).
function trackFromFileName(fileName) {
  const stripped = fileName.replace(/\.md$/, '').replace(/^[\d-]+/, '')
  if (/environment|setup/i.test(stripped)) return 'setup'
  return 'journal'
}

function orderFromFileName(fileName) {
  const datePrefix = fileName.match(/^(\d{4})-(\d{2})-(\d{2})-/)
  const order = datePrefix
    ? parseInt(datePrefix[1] + datePrefix[2] + datePrefix[3], 10)
    : parseInt(fileName, 10)
  return Number.isNaN(order) ? 999 : order
}

function titleFromMd(md, fallback) {
  const m = md.match(/^#\s+(.+)$/m)
  return (m ? m[1] : fallback).trim()
}

const docs = []

// viewer 및 숨김 폴더를 제외하고 상위 폴더 스캔
const parents = readdirSync(root).filter(name => {
  if (name === 'viewer' || name.startsWith('.')) return false
  try {
    return statSync(join(root, name)).isDirectory()
  } catch {
    return false
  }
})

for (const parentDir of parents) {
  const parentPath = join(root, parentDir)

  // A-1: parentDir 바로 아래 있는 .md 파일(하위 폴더 없이 직접 위치)도 스캔한다.
  // 예: performance/checklist.md, performance/00-optimization-summary.md
  let rootFiles = []
  try {
    rootFiles = readdirSync(parentPath).filter(f => {
      try {
        return f.endsWith('.md') && statSync(join(parentPath, f)).isFile()
      } catch {
        return false
      }
    })
  } catch {
    rootFiles = []
  }

  for (const f of rootFiles) {
    const filePath = join(parentPath, f)
    let md
    try {
      md = readFileSync(filePath, 'utf8')
    } catch {
      continue
    }
    const category = parentDir === 'performance' ? 'backend-performance' : parentDir
    const track = 'journal'

    // 이 둘은 구현기 트랙의 다른 모든 상세 항목보다 뒤에 오는 종합/체크리스트 문서라
    // 파일명 기반 order 계산과 무관하게 강제 고정한다.
    let order
    if (f === '00-optimization-summary.md') {
      order = 998
    } else if (f === 'checklist.md') {
      order = 999
    } else {
      order = orderFromFileName(f)
    }

    const date = getDocDate(filePath, root, md)
    docs.push({
      category,
      track,
      slug: f.replace(/\.md$/, ''),
      title: titleFromMd(md, f),
      order,
      md,
      ...(date ? { date } : {}),
    })
  }

  let subdirs = []
  try {
    subdirs = readdirSync(parentPath).filter(name => {
      try {
        return statSync(join(parentPath, name)).isDirectory()
      } catch {
        return false
      }
    })
  } catch {
    continue
  }

  for (const subDir of subdirs) {
    const subDirPath = join(parentPath, subDir)
    let files = []
    try {
      files = readdirSync(subDirPath).filter(f => f.endsWith('.md') && /^\d+/.test(f))
    } catch {
      continue
    }

    if (files.length === 0) continue

    // 카테고리 동적 추론 (기존 로직 그대로 유지)
    let category
    if (subDir.includes('cicd')) {
      category = 'cicd'
    } else if (parentDir === 'performance') {
      if (subDir.startsWith('frontend-')) {
        category = 'frontend-performance'
      } else if (subDir.includes('stability')) {
        category = 'backend-stability'
      } else {
        category = 'backend-performance'
      }
    } else if (parentDir === 'rag') {
      category = 'rag'
    } else {
      category = parentDir
    }

    // A-2: 트랙 판정은 폴더 단위가 아니라 파일 단위로 한다.
    // subDir 이름에 'learning'이 포함되면 그 폴더 전체가 learning 트랙,
    // 그 외에는 파일명에서 숫자/대시 프리픽스를 뗀 나머지로 setup/journal을 가른다.
    const isLearningDir = subDir.toLowerCase().includes('learning')

    for (const f of files) {
      const filePath = join(subDirPath, f)
      let md
      try {
        md = readFileSync(filePath, 'utf8')
      } catch {
        continue
      }

      const track = isLearningDir ? 'learning' : trackFromFileName(f)
      const order = orderFromFileName(f)
      const date = getDocDate(filePath, root, md)

      docs.push({
        category,
        track,
        slug: f.replace(/\.md$/, ''),
        title: titleFromMd(md, f),
        order,
        md,
        ...(date ? { date } : {}),
      })
    }
  }
}

// 정렬 규칙: 카테고리 우선순위 -> 트랙 우선순위 -> 파일 내 순서 프리픽스
docs.sort((a, b) => {
  const priorityA = getCategoryPriority(a.category)
  const priorityB = getCategoryPriority(b.category)
  if (priorityA !== priorityB) {
    return priorityA - priorityB
  }
  if (a.category !== b.category) {
    return a.category.localeCompare(b.category)
  }

  const tPriorityA = getTrackPriority(a.track)
  const tPriorityB = getTrackPriority(b.track)
  if (tPriorityA !== tPriorityB) {
    return tPriorityA - tPriorityB
  }
  if (a.track !== b.track) {
    return a.track.localeCompare(b.track)
  }

  return a.order - b.order
})

const out = 'window.DOCS = ' + JSON.stringify(docs) + ';\n'
writeFileSync(join(here, 'docs.js'), out)
const withDate = docs.filter((d) => d.date).length
console.log('wrote docs.js:', docs.length, 'docs (' +
  docs.map((d) => d.slug).join(', ') + ')')
console.log('date 필드 채워진 문서:', withDate, '/', docs.length)
console.log('date 소스 분포:', JSON.stringify(dateStats))
