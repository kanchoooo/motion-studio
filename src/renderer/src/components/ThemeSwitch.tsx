import { Moon, Sun } from 'lucide-react'
import { useStore } from '../store'

export function ThemeSwitch() {
  const { theme, setTheme } = useStore()
  return (
    <button className="icon-btn" title={theme === 'dark' ? '밝은 화면으로' : '어두운 화면으로'} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
      {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  )
}
