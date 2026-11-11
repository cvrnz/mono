import { useEffect, useRef, useState } from 'react'
import { confirm, toast } from '../lib/dialogs'
import { register } from '../lib/panes'
import * as R from '../lib/runs'
import * as S from '../lib/store'
import { useHints } from './Hints'
import Icon from './Icon'

type Props = { tab: S.RunTab; active: boolean }
type Form = { at: number | null; name: string; command: string; cwd: string }
type Row = { kind: 'config'; config: S.RunConfig; at: number } | { kind: 'add' } | { kind: 'run'; run: S.Run }

const liveStates: S.RunState[] = ['starting', 'running']

function since(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
}

function Status({ run }: { run: S.Run }) {
  if (liveStates.includes(run.state)) return <span className="run-dot running" title="Running" />
  const title = run.state === 'stopped' ? 'Stopped' : `Exited ${run.code ?? ''}`
  return <span className={`run-dot ${run.state}`} title={title} />
}

function Play() {
  return (
    <svg className="run-play" viewBox="0 0 16 16" aria-hidden>
      <path d="M5 3.5v9l7-4.5z" fill="currentColor" />
    </svg>
  )
}

export default function RunPane({ tab, active }: Props) {
  const project = S.useProjectId()
  const list = S.useStore((s) => R.configs(s))
  const runs = S.useStore((s) => s.runs).filter((r) => r.project === project)
  const viewing = S.useStore((s) => s.runView)
  const [form, setForm] = useState<Form | null>(null)
  const [cursor, setCursor] = useState(0)
  const [, tick] = useState(0)
  const side = useRef<HTMLDivElement>(null)

  const anyLive = runs.some((r) => liveStates.includes(r.state))
  useEffect(() => {
    if (!anyLive || !active) return
    const t = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [anyLive, active])

  useEffect(() => register(tab.id, { focus: () => side.current?.focus() }), [tab.id])

  const rows: Row[] = [...list.map((config, at): Row => ({ kind: 'config', config, at })), { kind: 'add' }, ...runs.map((run): Row => ({ kind: 'run', run }))]
  const at = Math.min(cursor, rows.length - 1)
  const row = rows[at]

  const run = async (config: S.RunConfig) => {
    const id = await R.start(config, project)
    if (id) R.show(id)
  }

  const edit = (r: Row | undefined) => {
    if (r?.kind === 'config') setForm({ at: r.at, name: r.config.name, command: r.config.command, cwd: r.config.cwd ?? '' })
    else setForm({ at: null, name: '', command: '', cwd: '' })
  }

  const remove = async (i: number) => {
    const c = list[i]
    if (!c || !(await confirm(`Delete the run configuration ${c.name}?`, undefined, 'Delete', true))) return
    R.saveConfigs(list.filter((_, j) => j !== i))
    side.current?.focus()
  }

  const save = (f: Form, andRun = false) => {
    const config: S.RunConfig = { name: f.name.trim() || f.command.trim(), command: f.command.trim(), cwd: f.cwd.trim() || undefined }
    if (!config.command) {
      toast('Type a command to run', 'error')
      return
    }
    if (list.some((c, i) => c.name === config.name && i !== f.at)) {
      toast(`There's already a configuration called ${config.name}`, 'error')
      return
    }
    R.saveConfigs(f.at === null ? [...list, config] : list.map((c, i) => (i === f.at ? config : c)))
    setForm(null)
    side.current?.focus()
    if (andRun) run(config)
  }

  const choose = (r: Row | undefined) => {
    if (r?.kind === 'config') run(r.config)
    else if (r?.kind === 'add') edit(undefined)
    else if (r?.kind === 'run') R.show(r.run.id)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (form || e.metaKey || e.ctrlKey || e.altKey) return
    const k = e.key
    const move = (n: number) => setCursor(Math.max(0, Math.min(rows.length - 1, n)))
    if (k === 'j' || k === 'ArrowDown') move(at + 1)
    else if (k === 'k' || k === 'ArrowUp') move(at - 1)
    else if (k === 'g' || k === 'Home') move(0)
    else if (k === 'G' || k === 'End') move(rows.length - 1)
    else if (k === 'Enter' || k === 'o') choose(row)
    else if (k === 'a') edit(undefined)
    else if (k === 'e' && row?.kind === 'config') edit(row)
    else if (k === 'd' && row?.kind === 'config') remove(row.at)
    else if (k === 's' && row?.kind === 'run') R.stop(row.run.id)
    else if (k === 'r' && row?.kind === 'run') R.rerun(row.run.id)
    else if ((k === 'x' || k === 'd') && row?.kind === 'run') R.dismiss(row.run.id)
    else if (k === 'Escape' && viewing) R.show(null)
    else return
    e.preventDefault()
    e.stopPropagation()
  }

  useEffect(() => {
    side.current?.querySelector('.row.selected')?.scrollIntoView({ block: 'nearest' })
  }, [at])

  useHints(
    tab.id,
    form
      ? ['Enter save', '⌘Enter save and run', 'Tab next field', 'Esc cancel']
      : row?.kind === 'run'
        ? ['j/k move', 'Enter show output', 's stop', 'r run again', 'x dismiss', 'a add']
        : ['j/k move', 'Enter run', 'a add', 'e edit', 'd delete'],
  )

  const formView = (f: Form) => (
    <div
      className="run-form"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          setForm(null)
          side.current?.focus()
        } else if (e.key === 'Enter') save(f, e.metaKey || e.ctrlKey)
        else return
        e.preventDefault()
        e.stopPropagation()
      }}
    >
      <input autoFocus placeholder="Name" value={f.name} spellCheck={false} onChange={(e) => setForm({ ...f, name: e.target.value })} />
      <input placeholder="Command, like bun run dev" value={f.command} spellCheck={false} onChange={(e) => setForm({ ...f, command: e.target.value })} />
      <input placeholder="Folder (optional, from the project root)" value={f.cwd} spellCheck={false} onChange={(e) => setForm({ ...f, cwd: e.target.value })} />
      <div className="run-form-buttons">
        <span className="run-btn primary" onMouseDown={(e) => (e.preventDefault(), save(f, true))}>
          Save and run
        </span>
        <span className="run-btn" onMouseDown={(e) => (e.preventDefault(), save(f))}>
          Save
        </span>
        <span className="run-btn" onMouseDown={(e) => (e.preventDefault(), setForm(null))}>
          Cancel
        </span>
      </div>
    </div>
  )

  const select = (i: number) => () => setCursor(i)

  return (
    <div className="run-side" ref={side} tabIndex={0} onKeyDown={onKeyDown}>
      <div className="run-section run-configs">
        <div className="scm-title run-title">
          Configurations
          <span className="icon-btn run-title-add" title="Add a configuration (a)" onMouseDown={(e) => (e.preventDefault(), edit(undefined))}>
            <Icon name="plus" />
          </span>
        </div>
        <div className="scm-rows">
          {rows.map((r, i) => {
            if (r.kind === 'run') return null
            if (r.kind === 'add') {
              if (form?.at === null) return <div key="form">{formView(form)}</div>
              return (
                <div key="add" className={`row run-row dim ${i === at ? 'selected' : ''}`} onMouseDown={select(i)} onClick={() => edit(undefined)}>
                  <Icon name="plus" className="run-play run-add" />
                  {list.length ? 'Add configuration' : 'Add a configuration, like bun run dev'}
                </div>
              )
            }
            if (form?.at === r.at) return <div key={`f${r.at}`}>{formView(form)}</div>
            return (
              <div
                key={`c${r.at}`}
                className={`row run-row ${i === at ? 'selected' : ''}`}
                title={`${r.config.command}${r.config.cwd ? `\nin ${r.config.cwd}` : ''}\nClick to run`}
                onMouseDown={select(i)}
                onClick={() => run(r.config)}
              >
                <Play />
                <span className="name">{r.config.name}</span>
                {r.config.name !== r.config.command && <span className="desc">{r.config.command}</span>}
                <span className="run-actions">
                  <span className="icon-btn" title="Edit (e)" onClick={(e) => (e.stopPropagation(), edit(r))}>
                    <Icon name="edit" />
                  </span>
                  <span className="icon-btn" title="Delete (d)" onClick={(e) => (e.stopPropagation(), remove(r.at))}>
                    <Icon name="close" />
                  </span>
                </span>
              </div>
            )
          })}
        </div>
      </div>
      <div className="run-section run-list">
        <div className="scm-title run-title">Running</div>
        <div className="scm-rows">
          {runs.length === 0 && <div className="row dim run-empty">Nothing has run yet</div>}
          {rows.map((r, i) => {
            if (r.kind !== 'run') return null
            const x = r.run
            const going = liveStates.includes(x.state)
            return (
              <div
                key={x.id}
                className={`row run-row ${i === at ? 'selected' : ''} ${viewing === x.id ? 'viewing' : ''}`}
                title={`${x.command}\n${x.cwd}`}
                onMouseDown={select(i)}
                onClick={() => R.show(x.id)}
              >
                <Status run={x} />
                <span className="name">{x.name}</span>
                <span className="desc">
                  {going ? since(Date.now() - x.started) : x.state === 'stopped' ? 'stopped' : x.state === 'failed' ? `exit ${x.code ?? '?'}` : 'done'}
                </span>
                <span className="run-actions">
                  {going ? (
                    <span className="icon-btn" title="Stop (s)" onClick={(e) => (e.stopPropagation(), R.stop(x.id))}>
                      <Icon name="stop" />
                    </span>
                  ) : (
                    <span className="icon-btn" title="Run again (r)" onClick={(e) => (e.stopPropagation(), R.rerun(x.id))}>
                      <Icon name="again" />
                    </span>
                  )}
                  <span className="icon-btn" title="Dismiss (x)" onClick={(e) => (e.stopPropagation(), R.dismiss(x.id))}>
                    <Icon name="close" />
                  </span>
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
