// Pushes the release tag, which is what triggers .github/workflows/release.yml
// and therefore the npm publish.
//
// This is deliberately not part of `bump`. Bumping the version and publishing
// it are two decisions here, because the release commit is not yet on `gh/main`
// at the moment bumpp makes it. So the tag goes out afterwards, once it is.
//
// The ancestry check below is load-bearing rather than defensive. A branch
// ruleset protects `refs/heads/*`; nothing protects `refs/tags/*`. A tag
// pointing at a commit `main` cannot reach would be accepted without complaint,
// and the release workflow would publish from it. This is the only place that
// is checked.

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

// Where releases publish from. No tag here, no npm publish.
const REMOTE = 'gh'
const BASE = 'main'
// Best-effort mirrors: they may lag or fail without stopping a release.
// Commits reach them from the post-commit hook; tags reach them here.
const MIRRORS = ['sh']

// stderr is piped rather than inherited so that git's own message lands on
// `error.stderr` — the messages below quote it — instead of printing itself
// ahead of the explanation and leaving `error.message` as the bare exit code.
const git = (...args) =>
  execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()

const fail = (message) => {
  console.error(message)
  process.exit(1)
}

// Derived from the file bumpp rewrites rather than from `git describe`, so the
// tag cannot drift from the version about to be published — which is also what
// the release workflow refuses to publish on a mismatch.
const { version } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8')
)
const tag = `v${version}`

try {
  git('rev-parse', '--verify', `refs/tags/${tag}`)
} catch {
  fail(`No local tag ${tag}.

package.json says ${version}, but nothing is tagged for it. Run \`pnpm bump\`
to check, bump and tag, then re-run this once the commit is on ${BASE}.`)
}

try {
  git('fetch', REMOTE, BASE)
} catch (error) {
  fail(
    `Could not fetch ${BASE} from '${REMOTE}':\n${error.stderr || error.message}`
  )
}

// `^{commit}` so an annotated tag is compared as the commit it points at.
let landed = true
try {
  git('merge-base', '--is-ancestor', `${tag}^{commit}`, `${REMOTE}/${BASE}`)
} catch {
  landed = false
}

if (!landed) {
  fail(`${tag} is not on ${REMOTE}/${BASE}.

The commit ${tag} points at has not landed yet, so publishing from it would
ship code that ${BASE} does not have. Land the release commit first, then
re-run.

If it looks like it did land, check that the pull request was merged with a
merge commit — squashing rewrites the commit, which leaves ${tag} pointing at
one that no longer exists on ${BASE}.`)
}

try {
  git('push', REMOTE, tag)
} catch (error) {
  fail(
    `Could not push ${tag} to '${REMOTE}':\n${error.stderr || error.message}`
  )
}

const missing = MIRRORS.filter((remote) => {
  try {
    git('push', remote, tag)
    return false
  } catch (error) {
    console.error(
      `Failed to push ${tag} to '${remote}': ${(error.stderr || error.message).trim()}`
    )
    return true
  }
})

if (missing.length) {
  console.warn(`\nMirrors still missing ${tag}: ${missing.join(', ')}`)
}

console.log(`
Pushed ${tag} to ${REMOTE}. Publishing is now up to GitHub Actions:
  https://github.com/ayo-run/astro-sw/actions/workflows/release.yml`)
