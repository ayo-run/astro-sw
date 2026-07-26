// originally forked from https://github.com/elk-zone/elk/blob/main/scripts/release.ts

import { simpleGit } from 'simple-git'

const git = simpleGit()

// `gh` is required: no tag there, no npm publish. The rest are best-effort.
const REQUIRED_REMOTE = 'gh'
const remotes = ['origin', 'gh', 'sh']

const branch = (await git.revparse(['--abbrev-ref', 'HEAD'])).trim()
if (branch !== 'main') {
  console.error(`Refusing to release from '${branch}' — release from main.`)
  process.exit(1)
}

const status = await git.status()
if (!status.isClean()) {
  console.error('Refusing to release with a dirty working tree:')
  console.error(status.files.map(({ path }) => `  ${path}`).join('\n'))
  process.exit(1)
}

const tag = (await git.raw(['describe', '--tags', '--abbrev=0'])).trim()
console.log(`Releasing ${tag} from main`)

const failed = []

for (const remote of remotes) {
  try {
    console.log(`Pushing main and tags to ${remote}`)
    await git.push(remote, 'main', ['--follow-tags'])
  } catch (error) {
    failed.push(remote)
    console.error(`Failed to push to ${remote}: ${error.message}`)
  }
}

if (failed.includes(REQUIRED_REMOTE)) {
  console.error(
    `\nCould not push ${tag} to '${REQUIRED_REMOTE}', so nothing will be published.`
  )
  process.exit(1)
}

if (failed.length) {
  console.warn(`\nMirrors still missing ${tag}: ${failed.join(', ')}`)
}

console.log(`
${tag} is on ${REQUIRED_REMOTE}. Publishing is now up to GitHub Actions:
  https://github.com/ayo-run/astro-sw/actions/workflows/release.yml`)
