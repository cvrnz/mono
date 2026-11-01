import { useEffect, useState } from 'react'
import ConnectScreen from './components/ConnectScreen'
import Dialogs from './components/Dialogs'
import Workspace from './components/Workspace'
import { dirtyCount, quit } from './lib/actions'
import { invoke, on } from './lib/bridge'
import { installKeys } from './lib/keys'
import { restoreSession } from './lib/session'
import { applyTheme, loadSettings } from './lib/settings'
import { windowDrag, windowMenu } from './lib/window'
import * as S from './lib/store'

export default function App() {
  const [ready, setReady] = useState(false)
  const workspace = S.useStore((s) => S.isConnected(s.conn) || s.projects.length > 1)
  const fontFamily = S.useStore((s) => s.settings.fontFamily)

  useEffect(() => {
    let live = true
    let stopSession = () => {}
    loadSettings().then(() => {
      if (!live) return
      applyTheme()
      stopSession = restoreSession()
      setReady(true)
    })
    const unsubTheme = S.subscribe(applyTheme)
    const uninstallKeys = installKeys()
    let dirty = false
    const unsubDirty = S.subscribe(() => {
      const now = dirtyCount(true) > 0
      if (now !== dirty) {
        dirty = now
        invoke('set_dirty', { dirty: now }).catch(() => {})
      }
    })
    const offQuit = on('app:quit-requested', () => quit())
    return () => {
      live = false
      stopSession()
      unsubTheme()
      uninstallKeys()
      unsubDirty()
      offQuit()
    }
  }, [])

  useEffect(() => {
    document.documentElement.style.setProperty('--mono', fontFamily)
  }, [fontFamily])

  if (!ready) return null
  return (
    <>
      {workspace ? <Workspace /> : <ConnectScreen />}
      {!workspace && <div className="window-drag" onMouseDown={windowDrag} onContextMenu={windowMenu} />}
      <Dialogs />
    </>
  )
}
