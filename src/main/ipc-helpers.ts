import { projectsDir } from './paths'
import { serveFolder } from './preview-server'

/** URL prefix (ending in "/") under which a folder is served to the renderer */
export const serveFolderUrl = (folder: string) => serveFolder(folder)
export { projectsDir }
