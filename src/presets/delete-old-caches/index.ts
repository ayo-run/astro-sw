import { AstroServiceWorkerPreset } from '../../types'
import activate from './activate'

export const deleteOldCaches: () => AstroServiceWorkerPreset = () => ({
  activate,
})

export default deleteOldCaches
