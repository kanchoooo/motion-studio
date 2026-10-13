declare module 'fontkit' {
  /** returns a Font, or a FontCollection with `.fonts` for .ttc/.otc files */
  export function openSync(path: string, postscriptName?: string): unknown
}
