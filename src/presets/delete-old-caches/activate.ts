import { AstroServiceWorkerPreset } from '../../types'

export const activateFn: AstroServiceWorkerPreset['activate'] = async ({
  cacheName,
}) => {
  const allowCacheNames = [cacheName]
  const allCaches = await caches.keys()
  allCaches.forEach((key) => {
    if (!allowCacheNames.includes(key)) {
      console.info('Deleting old cache', key)
      caches.delete(key)
    }
  })
}

export default activateFn
