/**
 * Note: @ayco/astro-sw integration injects variables `__prefix`, `__version`, & `__assets`
 * -- find usage in `astro.config.mjs` integrations
 * @see https://ayco.io/n/@ayco/astro-sw
 */
const cacheName = `${__prefix ?? 'app'}-v${__version ?? '000'}`
const forceLogging = true

/**
 * Cleans up old service worker caches by deleting any cache that doesn't match the current cache name.
 * This ensures only the current version of the application's cache is retained.
 * @async
 * @function cleanOldCaches
 * @returns {Promise<void>} A promise that resolves when old caches have been deleted
 */
const cleanOldCaches = async () => {
  const allowCacheNames = [cacheName]
  const allCaches = await caches.keys()
  allCaches.forEach((key) => {
    if (!allowCacheNames.includes(key)) {
      console.info('Deleting old cache', key)
      caches
        .delete(key)
        .then(() => {
          console.info('Successfully deleted cache:', key)
        })
        .catch((error) => {
          console.warn('Failed to delete old cache:', key, error)
        })
    }
  })
}

/**
 * Adds specified resources to the service worker cache.
 * This function is used to cache static assets for offline access.
 * @async
 * @function addResourcesToCache
 * @param {Array<string>} resources - An array of URLs representing the resources to be cached.
 * @returns {Promise<void>} A promise that resolves when all resources have been successfully added to the cache.
 */
const addResourcesToCache = async (resources) => {
  const cache = await caches.open(cacheName)
  console.info('adding resources to cache...', {
    force: !!forceLogging,
    context: 'ayco-sw',
    data: resources,
  })
  try {
    await cache.addAll(resources)
  } catch (error) {
    console.error(
      'failed to add resources to cache; make sure requests exists and that there are no duplicates',
      error
    )
  }
}

/**
 * Puts a response in the cache.
 * @async
 * @function putInCache
 * @param {Request} request - The request to be cached.
 * @param {Response} response - The response to be cached.
 * @returns {Promise<void>} A promise that resolves when the response has been added to the cache.
 */
const putInCache = async (request, response) => {
  const cache = await caches.open(cacheName)

  if (response.ok) {
    console.info('adding one response to cache...', request.url)
    cache.put(request, response)
  }
}

const networkFirst = async ({ request, fallbackUrl }) => {
  const cache = await caches.open(cacheName)

  try {
    // Try to get the resource from the network for 5 seconds
    const responseFromNetwork = await fetch(request.clone())
    putInCache(request, responseFromNetwork.clone())
    console.info('using network response', responseFromNetwork.url)
    return responseFromNetwork
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (error) {
    // Try get the resource from the cache
    const responseFromCache = await cache.match(request)
    if (responseFromCache) {
      console.info('using cached response...', responseFromCache.url)
      return responseFromCache
    }

    // If fallback is provided, try to use it, otherwise return error
    if (fallbackUrl) {
      const fallbackResponse = await cache.match(fallbackUrl)
      if (fallbackResponse) {
        console.info('using fallback cached response...', fallbackResponse.url)
        return fallbackResponse
      }
    }

    // when even the fallback response is not available,
    // there is nothing we can do, but we must always
    // return a Response object
    return new Response('Network error happened', {
      status: 408,
      headers: { 'Content-Type': 'text/plain' },
    })
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
self.addEventListener('activate', (event) => {
  console.info('activating service worker...')
  cleanOldCaches()
})

self.addEventListener('install', (event) => {
  console.info('installing service worker...')
  self.skipWaiting() // go straight to activate

  event.waitUntil(addResourcesToCache(__assets ?? []))
})

self.addEventListener('fetch', (event) => {
  console.info('fetch happened', { data: event })

  event.respondWith(
    networkFirst({
      request: event.request,
      fallbackUrl: './',
    })
  )
})
