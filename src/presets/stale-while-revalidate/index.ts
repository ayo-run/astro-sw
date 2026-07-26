/**
 * preset for stale-while-revalidate caching strategy
 */

import { AstroServiceWorkerPreset } from '../../types'
import install from './install'
import fetch from './fetch'

export const staleWhileRevalidate: () => AstroServiceWorkerPreset = () => ({
  install,
  fetch,
})

export default staleWhileRevalidate
