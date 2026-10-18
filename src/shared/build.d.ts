/**
 * true only in the 관제용 판 (the console build, `MS_CONSOLE=1`): its own code sits behind it, so
 * the regular Mac and Windows builds do not contain it (electron.vite.config.ts defines it).
 */
declare const __MS_CONSOLE__: boolean
