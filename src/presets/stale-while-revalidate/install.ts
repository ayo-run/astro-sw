import { AstroServiceWorkerPreset } from '../../types'

declare const self: ServiceWorkerGlobalScope

export const installFn: AstroServiceWorkerPreset['install'] = ({
  event,
  routes,
  cacheName,
}) => {
  console.info('installing service worker...')
  self.skipWaiting() // go straight to activate

  event.waitUntil(addResourcesToCache(routes ?? [], cacheName))
}

// @ts-expect-error TODO fix types
const addResourcesToCache = async (resources, cacheName: string) => {
  const cache = await caches.open(cacheName)
  console.info('adding resources to cache...', resources)
  try {
    await cache.addAll(resources)
  } catch (error) {
    console.error(
      'failed to add resources to cache; make sure requests exists and that there are no duplicates',
      {
        resources,
        error,
      }
    )
  }
}

export default installFn
