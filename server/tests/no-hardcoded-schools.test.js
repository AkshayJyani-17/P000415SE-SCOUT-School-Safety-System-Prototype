const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// Guards the "no hardcoded school data in the codebase" requirement.
//
// Asserting it once by hand is worthless the next person to add a dropdown
// can quietly reintroduce a literal school. This test fails the build instead.
//
// It scans **string literals only**, not comments: a comment explaining that a
// school used to be hardcoded here is documentation, whereas the same text in a
// literal is data that belongs in the database.

const SERVER_SRC = path.resolve(__dirname, '..', 'src')
const CLIENT_SRC = path.resolve(__dirname, '..', '..', 'client', 'src')

// Demo data lives here and is only ever read by the seed scripts.
const ALLOWED_DIRECTORIES = [path.join(SERVER_SRC, 'db', 'fixtures')]

const SCANNED_EXTENSIONS = ['.js', '.jsx']

const FORBIDDEN_PATTERNS = [
  {
    // Matches "Alpha School", "beta school", "GammaSchool", ...
    pattern: /(alpha|beta|gamma)\s*school/i,
    description: 'a demo school name',
  },
  {
    // The bare 'school_' prefix is fine (schoolService builds IDs from it);
    // a specific seeded school ID is not.
    pattern: /school_(alpha|beta|gamma)/i,
    description: 'a demo school ID',
  },
]

function collectSourceFiles(directory, collected = []) {
  if (!fs.existsSync(directory)) return collected

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name)

  if (entry.isDirectory()) {
    if (entry.name === 'node_modules') continue
    if (entry.name === 'tests' || entry.name === '__tests__') continue
    if (ALLOWED_DIRECTORIES.some(allowed => fullPath.startsWith(allowed))) continue
    collectSourceFiles(fullPath, collected)
    continue
}

    if (SCANNED_EXTENSIONS.includes(path.extname(entry.name))) {
      collected.push(fullPath)
    }
  }

  return collected
}

// Extracts string literals while skipping comments.
//
// A regex alone is not enough in either direction: comments regularly quote
// text ("used to be 'Alpha School'"), and strings regularly contain comment
// markers ('http://...'). Walking the source with a tiny state machine keeps
// both straight.
function extractStringLiterals(source) {
  const literals = []
  let index = 0

  while (index < source.length) {
    const char = source[index]
    const next = source[index + 1]

    if (char === '/' && next === '/') {
      while (index < source.length && source[index] !== '\n') index += 1
      continue
    }

    if (char === '/' && next === '*') {
      index += 2
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) index += 1
      index += 2
      continue
    }

    if (char === "'" || char === '"' || char === '`') {
      const quote = char
      const start = index
      index += 1

      while (index < source.length) {
        if (source[index] === '\\') {
          index += 2
          continue
        }
        if (source[index] === quote) break
        index += 1
      }

      literals.push(source.slice(start, index + 1))
      index += 1
      continue
    }

    index += 1
  }

  return literals
}

function findViolations(filePath) {
  const source = fs.readFileSync(filePath, 'utf8')
  const literals = extractStringLiterals(source)
  const violations = []

  for (const literal of literals) {
    for (const { pattern, description } of FORBIDDEN_PATTERNS) {
      if (pattern.test(literal)) {
        violations.push(`${filePath} contains ${description} in the literal ${literal}`)
      }
    }
  }

  return violations
}

test('server source contains no hardcoded school data', () => {
  const violations = collectSourceFiles(SERVER_SRC).flatMap(findViolations)

  assert.deepEqual(
    violations,
    [],
    `Schools must be read from the database.\n${violations.join('\n')}`
  )
})

test('client source contains no hardcoded school data', () => {
  const violations = collectSourceFiles(CLIENT_SRC).flatMap(findViolations)

  assert.deepEqual(
    violations,
    [],
    `Schools must come from SchoolsContext.\n${violations.join('\n')}`
  )
})

test('no application module imports the seed fixtures', () => {
  // The fixtures are demo data. Route, service and server-entry code reading
  // them would reintroduce hardcoded schools through the back door.
  const applicationFiles = collectSourceFiles(SERVER_SRC).filter(
    filePath => !filePath.includes(path.join('src', 'db'))
  )

  const offenders = applicationFiles.filter(filePath =>
    /require\(['"][^'"]*fixtures\//.test(fs.readFileSync(filePath, 'utf8'))
  )

  assert.deepEqual(offenders, [], 'Only seed scripts under src/db may import fixtures.')
})

test('the scanner actually works', () => {
  // Without this, a broken regex would make the guard silently pass forever.
  const selfPath = path.resolve(__dirname, 'fixture-scanner-check.tmp.js')

  fs.writeFileSync(selfPath, "const bad = 'Alpha School'\n")
  try {
    assert.equal(findViolations(selfPath).length, 1)
  } finally {
    fs.unlinkSync(selfPath)
  }
})

test('the scanner ignores school names inside comments', () => {
  const selfPath = path.resolve(__dirname, 'comment-scanner-check.tmp.js')

  // Includes the awkward cases: quotes inside comments, and comment markers
  // inside strings.
  const source = [
    "// this used to say 'Alpha School' and `school_alpha`",
    '/* block comment naming Beta School and school_beta */',
    "const url = 'http://example.com/not-a-comment'",
    'const ok = "Gamma"',
  ].join('\n')

  fs.writeFileSync(selfPath, source)
  try {
    assert.deepEqual(findViolations(selfPath), [])
  } finally {
    fs.unlinkSync(selfPath)
  }
})
