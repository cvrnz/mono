import { Button, Spinner } from '@heroui/react'
import { useCallback, useEffect, useState } from 'react'
import { errorText, invoke } from '../lib/bridge'
import { closeProject, connect, forget } from '../lib/connection'
import { basename } from '../lib/paths'
import { updateSettings } from '../lib/settings'
import * as S from '../lib/store'
import Icon from './Icon'

type Container = { id: string; name: string; image: string; status: string; running: boolean; project?: string; service?: string }

function describe(t: S.Target) {
  return t.kind === 'local' ? basename(t.folder) : t.container
}

function details(t: S.Target) {
  return t.kind === 'local' ? `this computer · ${t.folder}` : `container · ${t.folder || 'its working directory'}`
}

function containerMeta(c: Container) {
  const compose = c.project ? `${c.project}${c.service ? '/' + c.service : ''} · ` : ''
  return `${compose}${c.image} · ${c.status}`
}

export default function ConnectScreen() {
  const conn = S.useStore((s) => s.conn)
  const recents = S.useStore((s) => s.settings.recents)
  const dockerPath = S.useStore((s) => s.settings.dockerPath ?? '')
  const others = S.useStore((s) => s.projects.length > 1)

  const [containers, setContainers] = useState<Container[] | null>(null)
  const [container, setContainer] = useState('')
  const [folder, setFolder] = useState('')
  const [localFolder, setLocalFolder] = useState('')
  const [dockerError, setDockerError] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState('')
  const [dockerDraft, setDockerDraft] = useState(dockerPath)

  const busy = conn.state === 'connecting'
  const shownError = error || (conn.state === 'idle' ? (conn.error ?? '') : '')
  const noDocker = /couldn't find the docker command/.test(dockerError)

  const loadContainers = useCallback(async () => {
    setDockerError('')
    setContainers(null)
    try {
      const list = await invoke<Container[]>('docker_containers')
      setContainers(list)
      setContainer((current) => (list.some((c) => c.name === current) ? current : (list[0]?.name ?? '')))
    } catch (err) {
      setContainers([])
      setDockerError(errorText(err))
    }
  }, [])

  useEffect(() => {
    loadContainers()
  }, [loadContainers])

  const go = (name = container) => {
    if (!name || busy) return
    setError('')
    connect(S.dockerTarget(name, folder.trim()))
  }

  const openLocal = () => {
    if (busy) return
    setError('')
    connect(S.localTarget(localFolder.trim() || '~'))
  }

  const openRecent = async (t: S.Target) => {
    if (busy) return
    setError('')
    if (t.kind === 'docker') {
      setLoading(`Finding ${t.container}…`)
      try {
        const list = await invoke<Container[]>('docker_containers')
        if (!list.some((c) => c.name === t.container && c.running)) {
          setError(`The container ${t.container} isn't running. Start it, then try again.`)
          return
        }
      } catch (err) {
        setError(errorText(err))
        return
      } finally {
        setLoading('')
      }
    }
    connect(t)
  }

  const onEnter = (fn: () => void) => (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      fn()
    }
  }

  const saveDockerPath = () => updateSettings({ dockerPath: dockerDraft.trim() || undefined })

  return (
    <div className="connect">
      <div className="connect-inner">
        <h1>Mono</h1>
        <div className="sub">Edit files on this computer, or inside a Docker container running on it.</div>
        {others && (
          <div className="row-fields">
            <Button size="sm" variant="tertiary" onPress={() => closeProject(S.get().project)}>
              Cancel
            </Button>
          </div>
        )}

        {busy && (
          <div className="status">
            <Spinner size="sm" /> {conn.status}
          </div>
        )}
        {!busy && loading && (
          <div className="status">
            <Spinner size="sm" /> {loading}
          </div>
        )}
        {shownError && <div className="error">{shownError}</div>}

        {recents.length > 0 && (
          <>
            <h2>Recent</h2>
            <div className="pick-list">
              {recents.map((t) => (
                <div key={`${t.kind}/${describe(t)}/${t.folder}`} className="pick" onClick={() => openRecent(t)}>
                  <span className="name">{describe(t)}</span>
                  <span className="meta">{details(t)}</span>
                  <span
                    className="x icon-btn"
                    title="Forget"
                    onClick={(e) => {
                      e.stopPropagation()
                      forget(t)
                    }}
                  >
                    <Icon name="close" />
                  </span>
                </div>
              ))}
            </div>
          </>
        )}

        <h2>This computer</h2>
        <div className="label">Folder</div>
        <div className="row-fields">
          <div className="field">
            <input
              className="text-input"
              placeholder="Default: your home folder (~)"
              value={localFolder}
              spellCheck={false}
              onChange={(e) => setLocalFolder(e.target.value)}
              onKeyDown={onEnter(openLocal)}
            />
          </div>
          <Button variant="primary" isDisabled={busy} onPress={openLocal}>
            Connect
          </Button>
        </div>

        <h2>Docker</h2>
        {containers === null ? (
          <div className="status">
            <Spinner size="sm" /> Loading containers…
          </div>
        ) : noDocker ? (
          <div className="help">
            To edit files in a container, install Docker (Docker Desktop, OrbStack or Colima), or set the path to <code>docker</code> below.
          </div>
        ) : dockerError ? (
          <div className="error">{dockerError}</div>
        ) : containers.length === 0 ? (
          <div className="help">No running containers. Start one, then refresh.</div>
        ) : (
          <>
            <div className="label">Container</div>
            <div className="pick-list">
              {containers.map((c) => (
                <div key={c.id} className={`pick ${c.name === container ? 'on' : ''}`} onClick={() => setContainer(c.name)} onDoubleClick={() => go(c.name)}>
                  <span className="name">{c.name}</span>
                  <span className="meta">{containerMeta(c)}</span>
                </div>
              ))}
            </div>
            <div className="label">Folder</div>
            <div className="row-fields">
              <div className="field">
                <input
                  className="text-input"
                  placeholder="Default: the container's working directory"
                  value={folder}
                  spellCheck={false}
                  onChange={(e) => setFolder(e.target.value)}
                  onKeyDown={onEnter(() => go())}
                />
              </div>
              <Button variant="primary" isDisabled={busy || !container} onPress={() => go()}>
                Connect
              </Button>
            </div>
          </>
        )}

        <h2>Settings</h2>
        <div className="row-fields">
          <div className="field">
            <label>Path to docker</label>
            <input
              className="text-input"
              placeholder="Found on your PATH"
              value={dockerDraft}
              spellCheck={false}
              onChange={(e) => setDockerDraft(e.target.value)}
              onBlur={saveDockerPath}
              onKeyDown={onEnter(() => saveDockerPath().then(loadContainers))}
            />
          </div>
          <Button
            variant="secondary"
            onPress={() => {
              saveDockerPath().then(loadContainers)
            }}
          >
            Refresh
          </Button>
        </div>
      </div>
    </div>
  )
}
