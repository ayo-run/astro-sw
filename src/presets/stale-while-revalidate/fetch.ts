import { AstroServiceWorkerPreset } from '../../types'

export const fetchFn: AstroServiceWorkerPreset['fetch'] = ({
  event,
  cacheName,
}) => {
  console.info('fetch happened', { data: event })

  event.respondWith(
    cacheAndRevalidate(
      {
        request: event.request,
        fallbackUrl: './',
      },
      cacheName
    )
  )
}

export default fetchFn

// @ts-expect-error TODO fix types
const putInCache = async (request, response, cacheName) => {
  const cache = await caches.open(cacheName)

  if (response.ok) {
    console.info('adding one response to cache...', request.url)

    // if exists, replace
    cache.keys().then((keys) => {
      if (keys.includes(request)) {
        cache.delete(request)
      }
    })

    cache.put(request, response)
  }
}

const cacheAndRevalidate = async (
  // @ts-expect-error TODO fix types
  { request, fallbackUrl },
  cacheName: string
) => {
  const cache = await caches.open(cacheName)

  // Try get the resource from the cache
  const responseFromCache = await cache.match(request)
  if (responseFromCache) {
    console.info('using cached response...', responseFromCache.url)
    // get network response for revalidation of cached assets
    fetch(request.clone())
      .then((responseFromNetwork) => {
        if (responseFromNetwork) {
          console.info('fetched updated resource...', responseFromNetwork.url)
          putInCache(request, responseFromNetwork.clone(), cacheName)
        }
      })
      .catch((error) => {
        console.info('failed to fetch updated resource', error)
      })

    return responseFromCache
  }

  try {
    // Try to get the resource from the network for 5 seconds
    const responseFromNetwork = await fetch(request.clone())
    // response may be used only once
    // we need to save clone to put one copy in cache
    // and serve second one
    putInCache(request, responseFromNetwork.clone(), cacheName)
    console.info('using network response', responseFromNetwork.url)
    return responseFromNetwork

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (error) {
    // Try the fallback
    const fallbackResponse = await cache.match(fallbackUrl)
    if (fallbackResponse) {
      console.info('using fallback cached response...', fallbackResponse.url)
      return fallbackResponse
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
