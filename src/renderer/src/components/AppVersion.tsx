// Current app version (shown on Home and the environment check).
import { useEffect, useState } from 'react'
import { studio } from '../store'

let cached = ''

export function useAppVersion(): string {
  const [v, setV] = useState(cached)
  useEffect(() => {
    if (!cached) void studio.app.info().then((i) => setV((cached = i.version)))
  }, [])
  return v
}

export function AppVersion({ prefix = 'v' }: { prefix?: string }) {
  const v = useAppVersion()
  return v ? <span className="tiny faint" data-testid="app-version">{prefix}{v}</span> : null
}
