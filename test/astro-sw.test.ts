/**
 * Unit tests for the integration's hook behavior.
 *
 * `node:fs/promises` and `esbuild` are mocked, so the hooks can be driven
 * directly with fixture Astro build output and nothing touches the disk.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { dirname, resolve } from 'node:path'
import type { AstroIntegration } from 'astro'
import type { AstroServiceWorkerConfig } from '../src/types'

const fs = vi.hoisted(() => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  unlink: vi.fn(),
  readdir: vi.fn(),
}))

const esbuild = vi.hoisted(() => ({
  build: vi.fn(),
}))

vi.mock('node:fs/promises', () => fs)
vi.mock('esbuild', () => esbuild)

import serviceWorker from '../src/astro-sw'

/**
 * The integration resolves the service worker path against the cwd, and maps
 * public files relative to `<cwd>/dist/` — so fixtures have to agree with it.
 */
const CWD = resolve(dirname('.'))
const OUT_DIR = new URL(`file://${CWD}/dist/`)
const SW_PATH = './src/sw.ts'
const RESOLVED_SW_PATH = `${CWD}/src/sw.ts`
const TEMP_FILE = `${RESOLVED_SW_PATH}.tmp.ts`
const SW_SOURCE = `self.addEventListener('install', () => {})`

type Hooks = AstroIntegration['hooks']
type SetupOptions = Parameters<NonNullable<Hooks['astro:config:setup']>>[0]
type ConfigDoneOptions = Parameters<NonNullable<Hooks['astro:config:done']>>[0]
type SsrOptions = Parameters<NonNullable<Hooks['astro:build:ssr']>>[0]
type BuildDoneOptions = Parameters<NonNullable<Hooks['astro:build:done']>>[0]

function getHook<K extends keyof Hooks>(
  integration: AstroIntegration,
  name: K
): NonNullable<Hooks[K]> {
  const hook = integration.hooks[name]
  if (!hook) throw new Error(`integration is missing the ${name} hook`)
  return hook as NonNullable<Hooks[K]>
}

const createLogger = () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  label: 'test',
  fork: vi.fn(),
})

const runSetup = (
  options: AstroServiceWorkerConfig,
  { command = 'build', output = 'static' } = {}
) => {
  const integration = serviceWorker(options)
  const injectScript = vi.fn()
  const logger = createLogger()

  const setup = getHook(integration, 'astro:config:setup')
  setup({
    injectScript,
    command,
    logger,
    config: { output },
  } as unknown as SetupOptions)

  return { integration, injectScript, logger }
}

type BuildFixture = {
  output?: 'static' | 'server'
  /** `pathname`s as Astro reports them — always with a trailing slash */
  pages?: string[]
  /** keys of the build `assets` map, i.e. route patterns */
  buildAssets?: string[]
  /** when set, the `astro:build:ssr` hook runs with these manifest assets */
  ssrAssets?: string[]
  /** files the output dir walk finds, as `[parentPath, name]` pairs */
  publicFiles?: [string, string][]
}

/** Drives the full hook sequence and returns what the integration produced. */
const runBuild = async (
  options: AstroServiceWorkerConfig,
  fixture: BuildFixture = {}
) => {
  const {
    output = 'static',
    pages = [],
    buildAssets = [],
    ssrAssets,
    publicFiles = [],
  } = fixture

  const { integration, logger } = runSetup(options, { output })

  if (ssrAssets) {
    getHook(
      integration,
      'astro:build:ssr'
    )({ manifest: { assets: ssrAssets } } as unknown as SsrOptions)
  }

  fs.readdir.mockResolvedValue(
    publicFiles.map(([parentPath, name]) => ({
      name,
      parentPath,
      isFile: () => true,
    }))
  )

  await getHook(
    integration,
    'astro:build:done'
  )({
    dir: OUT_DIR,
    pages: pages.map((pathname) => ({ pathname })),
    assets: new Map(buildAssets.map((key) => [key, []])),
    logger,
  } as unknown as BuildDoneOptions)

  return { logger, written: writtenSource() }
}

/** The source the integration handed to esbuild, via the temp file. */
const writtenSource = () => {
  const call = fs.writeFile.mock.calls.at(-1)
  return call ? String(call[1]) : ''
}

/** Reads back one of the injected `const` declarations. */
const declared = (source: string, name: string) => {
  const match = new RegExp(`^const ${name} = (.*);$`, 'm').exec(source)
  if (!match) throw new Error(`no declaration for ${name} in:\n${source}`)
  return JSON.parse(match[1]) as unknown
}

const assetsOf = async (
  options: AstroServiceWorkerConfig,
  fixture: BuildFixture = {}
) => {
  const { written } = await runBuild(options, fixture)
  return declared(written, '__assets') as string[]
}

beforeEach(() => {
  vi.clearAllMocks()
  // mirrors node: an undefined path is a TypeError, not an empty read
  fs.readFile.mockImplementation((path: unknown) => {
    if (typeof path !== 'string') {
      return Promise.reject(new TypeError('path must be a string'))
    }
    return Promise.resolve(Buffer.from(SW_SOURCE))
  })
  fs.writeFile.mockResolvedValue(undefined)
  fs.unlink.mockResolvedValue(undefined)
  fs.readdir.mockResolvedValue([])
  esbuild.build.mockResolvedValue({})
})

describe('integration shape', () => {
  test('is named after the package and registers the four build hooks', () => {
    const integration = serviceWorker({ path: SW_PATH })

    expect(integration.name).toBe('@ayco/astro-sw')
    expect(Object.keys(integration.hooks)).toEqual([
      'astro:config:setup',
      'astro:config:done',
      'astro:build:ssr',
      'astro:build:done',
    ])
  })

  test('can be constructed without options', () => {
    expect(() => serviceWorker()).not.toThrow()
  })
})

describe('astro:config:setup', () => {
  test('reports a missing service worker path', () => {
    expect(runSetup({}).logger.error).toHaveBeenCalledWith(
      'Missing required path to service worker script'
    )
    expect(runSetup({ path: '' }).logger.error).toHaveBeenCalledWith(
      'Missing required path to service worker script'
    )
  })

  test('stays quiet when a path is configured', () => {
    expect(runSetup({ path: SW_PATH }).logger.error).not.toHaveBeenCalled()
  })

  test('injects the registration script as a page script during build', () => {
    const { injectScript } = runSetup({ path: SW_PATH })

    expect(injectScript).toHaveBeenCalledTimes(1)
    const [stage, script] = injectScript.mock.calls[0]
    expect(stage).toBe('page')
    expect(script).toContain(`navigator.serviceWorker.register("/sw.js"`)
    expect(script).toContain(`scope: "/"`)
  })

  test('does not inject the registration script outside of build', () => {
    const { injectScript } = runSetup({ path: SW_PATH }, { command: 'dev' })

    expect(injectScript).not.toHaveBeenCalled()
  })

  test('inlines the source of each registration hook', () => {
    const { injectScript } = runSetup({
      path: SW_PATH,
      registrationHooks: {
        installing: () => console.log('>>> installing'),
        waiting: () => console.log('>>> waiting'),
        active: () => console.log('>>> active'),
        error: () => console.log('>>> error'),
        unsupported: () => console.log('>>> unsupported'),
        afterRegistration: () => console.log('>>> registered'),
      },
    })

    const [, script] = injectScript.mock.calls[0]
    for (const marker of [
      'installing',
      'waiting',
      'active',
      'error',
      'unsupported',
      'registered',
    ]) {
      expect(script).toContain(`>>> ${marker}`)
    }
  })

  test('produces a syntactically valid script with and without hooks', () => {
    const bare = runSetup({ path: SW_PATH }).injectScript.mock.calls[0][1]
    const hooked = runSetup({
      path: SW_PATH,
      registrationHooks: { active: () => console.log('active') },
    }).injectScript.mock.calls[0][1]

    expect(() => new Function(bare)).not.toThrow()
    expect(() => new Function(hooked)).not.toThrow()
  })
})

describe('astro:config:done', () => {
  test('injects declarations for the variables it will define', () => {
    const integration = serviceWorker({ path: SW_PATH })
    const injectTypes = vi.fn()

    getHook(
      integration,
      'astro:config:done'
    )({ injectTypes } as unknown as ConfigDoneOptions)

    expect(injectTypes).toHaveBeenCalledTimes(1)
    const [{ filename, content }] = injectTypes.mock.calls[0]
    expect(filename).toBe('caching.d.ts')
    expect(content).toContain('declare const __assets: string[];')
    expect(content).toContain('declare const __version: string;')
    expect(content).toContain('declare const __prefix: string;')
  })
})

describe('the __assets list', () => {
  test('collects assets from the SSR manifest', async () => {
    const assets = await assetsOf(
      { path: SW_PATH },
      { output: 'server', ssrAssets: ['/_astro/page.js', '/_image'] }
    )

    expect(assets).toEqual(['/_astro/page.js', '/_image'])
  })

  test('adds user-provided include entries', async () => {
    const assets = await assetsOf(
      { path: SW_PATH, include: ['/offline.json'] },
      { output: 'server' }
    )

    expect(assets).toContain('/offline.json')
  })

  test('adds build asset keys but drops rest routes', async () => {
    const assets = await assetsOf(
      { path: SW_PATH },
      { output: 'server', buildAssets: ['/blog', '/[...slug]', '/_image'] }
    )

    expect(assets).toEqual(['/blog', '/_image'])
  })

  test('caches pages both with and without a trailing slash', async () => {
    const assets = await assetsOf(
      { path: SW_PATH },
      { output: 'server', pages: ['blog/', 'about/'] }
    )

    expect(assets).toEqual(['/blog/', '/about/', '/blog', '/about'])
  })

  test('skips the empty pathname Astro reports for the site root', async () => {
    const assets = await assetsOf(
      { path: SW_PATH },
      { output: 'server', pages: ['', 'blog/'] }
    )

    expect(assets).toEqual(['/blog/', '/blog'])
  })

  test('de-duplicates across every source', async () => {
    const assets = await assetsOf(
      { path: SW_PATH, include: ['/blog'] },
      {
        output: 'server',
        ssrAssets: ['/blog'],
        buildAssets: ['/blog'],
        pages: ['blog/'],
      }
    )

    expect(assets.filter((asset) => asset === '/blog')).toHaveLength(1)
  })

  test('drops 404 routes and index.html entries', async () => {
    const assets = await assetsOf(
      { path: SW_PATH },
      {
        output: 'server',
        ssrAssets: ['/index.html', '/blog/index.html', '/404', '/404.html'],
        pages: ['blog/'],
      }
    )

    expect(assets).toEqual(['/blog/', '/blog'])
  })

  test('drops excluded routes with and without a trailing slash', async () => {
    const assets = await assetsOf(
      { path: SW_PATH, exclude: ['/private'] },
      { output: 'server', pages: ['private/', 'blog/'] }
    )

    expect(assets).toEqual(['/blog/', '/blog'])
  })

  test('walks the output dir for public files on static builds', async () => {
    const assets = await assetsOf(
      { path: SW_PATH },
      {
        output: 'static',
        publicFiles: [
          [`${CWD}/dist/`, 'favicon.ico'],
          [`${CWD}/dist/components`, 'web-component.js'],
        ],
      }
    )

    expect(fs.readdir).toHaveBeenCalledWith(OUT_DIR, {
      withFileTypes: true,
      recursive: true,
    })
    expect(assets).toEqual(['/favicon.ico', '/components/web-component.js'])
  })

  test('does not walk the output dir on server builds', async () => {
    await assetsOf({ path: SW_PATH }, { output: 'server' })

    expect(fs.readdir).not.toHaveBeenCalled()
  })
})

describe('logging the asset list', () => {
  test('logs only a count by default', async () => {
    const { logger } = await runBuild(
      { path: SW_PATH },
      { output: 'server', ssrAssets: ['/a.js', '/b.js'] }
    )

    expect(logger.info).toHaveBeenCalledWith('2 assets for caching.')
  })

  test('lists every asset when logAssets is on', async () => {
    const { logger } = await runBuild(
      { path: SW_PATH, logAssets: true },
      { output: 'server', ssrAssets: ['/a.js', '/b.js'] }
    )

    const listed = logger.info.mock.calls
      .map(([message]: [string]) => message)
      .find((message: string) => message.includes('assets for caching:'))

    expect(listed).toContain('▶ /a.js')
    expect(listed).toContain('▶ /b.js')
  })
})

describe('compiling the service worker', () => {
  test('prepends the injected variables to the user source', async () => {
    const { written } = await runBuild(
      { path: SW_PATH, assetCachePrefix: 'my-app', assetCacheVersionID: '2.1' },
      { output: 'server', ssrAssets: ['/a.js'] }
    )

    expect(declared(written, '__assets')).toEqual(['/a.js'])
    expect(declared(written, '__version')).toBe('2.1')
    expect(declared(written, '__prefix')).toBe('my-app')
    expect(written.endsWith(SW_SOURCE)).toBe(true)
  })

  test('falls back to the package defaults for prefix and version', async () => {
    const { written } = await runBuild({ path: SW_PATH }, { output: 'server' })

    expect(declared(written, '__version')).toBe('0')
    expect(declared(written, '__prefix')).toBe('@ayco/astro-sw')
  })

  test('reads the service worker relative to the project root', async () => {
    await runBuild({ path: SW_PATH }, { output: 'server' })

    expect(fs.readFile).toHaveBeenCalledWith(RESOLVED_SW_PATH)
  })

  test('writes a temp entry next to the service worker', async () => {
    await runBuild({ path: SW_PATH }, { output: 'server' })

    expect(fs.writeFile).toHaveBeenCalledWith(
      TEMP_FILE,
      expect.any(String),
      expect.objectContaining({ flag: 'w+' })
    )
  })

  test('bundles the temp entry to sw.js in the output dir', async () => {
    await runBuild({ path: SW_PATH }, { output: 'server' })

    expect(esbuild.build).toHaveBeenCalledWith(
      expect.objectContaining({
        bundle: true,
        platform: 'browser',
        entryPoints: [TEMP_FILE],
        outfile: `${CWD}/dist/sw.js`,
      })
    )
  })

  test('merges user esbuild options without losing the required ones', async () => {
    await runBuild(
      {
        path: SW_PATH,
        esbuild: {
          minify: true,
          platform: 'node',
          outfile: '/somewhere/else.js',
        },
      },
      { output: 'server' }
    )

    const [options] = esbuild.build.mock.calls[0]
    expect(options.minify).toBe(true)
    expect(options.platform).toBe('browser')
    expect(options.outfile).toBe(`${CWD}/dist/sw.js`)
    expect(options.entryPoints).toEqual([TEMP_FILE])
  })

  test('removes the temp entry once bundling is done', async () => {
    await runBuild({ path: SW_PATH }, { output: 'server' })

    expect(fs.unlink).toHaveBeenCalledWith(TEMP_FILE)
  })

  test('still removes the temp entry when bundling fails', async () => {
    esbuild.build.mockRejectedValue(new Error('bundle failed'))

    const { logger } = await runBuild({ path: SW_PATH }, { output: 'server' })

    expect(logger.error).toHaveBeenCalled()
    expect(fs.unlink).toHaveBeenCalledWith(TEMP_FILE)
  })

  test('logs when the temp entry cannot be written', async () => {
    fs.writeFile.mockRejectedValue(new Error('EACCES'))

    const { logger } = await runBuild({ path: SW_PATH }, { output: 'server' })

    expect(logger.error).toHaveBeenCalled()
  })

  test('logs when the temp entry cannot be removed', async () => {
    fs.unlink.mockRejectedValue(new Error('EBUSY'))

    const { logger } = await runBuild({ path: SW_PATH }, { output: 'server' })

    expect(logger.error).toHaveBeenCalled()
  })

  test('logs and keeps going when the service worker cannot be read', async () => {
    fs.readFile.mockRejectedValue(new Error('ENOENT'))

    const { logger } = await runBuild({ path: SW_PATH }, { output: 'server' })

    expect(logger.error).toHaveBeenCalled()
    expect(esbuild.build).toHaveBeenCalled()
  })

  test('points at the docs when no path was configured at all', async () => {
    const { logger } = await runBuild({}, { output: 'server' })

    const messages = logger.error.mock.calls.map(([message]: [string]) =>
      String(message)
    )
    expect(
      messages.some((message) => message.includes("The 'path' option"))
    ).toBe(true)
  })
})
