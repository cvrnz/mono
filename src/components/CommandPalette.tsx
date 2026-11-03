import { useEffect, useMemo, useRef, useState } from 'react'
import { focusActive } from '../lib/actions'
import { commands, isComplete, keyLabel, resolve, runLine } from '../lib/commands'
import { iconPacks } from '../lib/fileIcons'
import { fuzzy, highlight } from '../lib/fuzzy'
import { updateSettings } from '../lib/settings'
import * as S from '../lib/store'
import { themes } from '../lib/themes'
import FileIcon from './FileIcon'

type Mode = 'commands' | 'themes' | 'icons'
const samples = ['src/', 'index.ts', 'App.tsx', 'package.json', 'README.md', 'main.rs', 'app.py', 'style.css', 'index.html', 'logo.png', 'Dockerfile', '.gitignore']

function IconSamples() {
  return (
    <span className="icon-samples">
      {samples.map((n) => {
        const dir = n.endsWith('/')
        const name = dir ? n.slice(0, -1) : n
        return <FileIcon key={n} n={{ name, path: '/sample/' + name, dir }} />
      })}
    </span>
  )
}

type Item = { name: string; desc: string; keys?: string; positions: number[] }

function Highlighted({ text, positions }: { text: string; positions: number[] }) {
  return (
    <>
      {highlight(text, positions).map((r, i) =>
        r.hit ? (
          <span key={i} className="hit">
            {r.text}
          </span>
        ) : (
          <span key={i}>{r.text}</span>
        ),
      )}
    </>
  )
}

export default function CommandPalette({ mode, initial }: { mode: Mode; initial: string }) {
  const [text, setText] = useState(initial)
  const [cursor, setCursor] = useState(0)
  const [moved, setMoved] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const savedTheme = S.useStore((s) => s.settings.theme)
  const savedPack = S.useStore((s) => s.settings.iconPack ?? 'material')

  useEffect(() => {
    input.current?.focus()
  }, [mode])

  useEffect(() => {
    if (mode === 'themes' || mode === 'icons') {
      setText('')
      setCursor(
        Math.max(0, mode === 'themes' ? themes.findIndex((t) => t.name === S.get().settings.theme) : iconPacks.findIndex((p) => p.id === (S.get().settings.iconPack ?? 'material'))),
      )
      setMoved(false)
    }
  }, [mode])

  const items = useMemo((): Item[] => {
    const word = text.trim().split(/\s+/)[0] ?? ''
    const source: Omit<Item, 'positions'>[] =
      mode === 'themes'
        ? themes.map((t) => ({ name: t.name, desc: t.name === savedTheme ? 'current' : '' }))
        : mode === 'icons'
          ? iconPacks.map((p) => ({ name: p.name, desc: p.id === savedPack ? `${p.desc}, current` : p.desc }))
          : commands.map((c) => ({ name: c.name, desc: c.desc, keys: c.keys }))
    if (!word) return source.map((s) => ({ ...s, positions: [] }))
    const resolved = mode === 'commands' ? resolve(text)?.command.name : undefined
    const scored: { item: Item; score: number }[] = []
    for (const s of source) {
      const m = fuzzy(word, s.name)
      if (!m && s.name !== resolved) continue
      scored.push({ item: { ...s, positions: m?.positions ?? [] }, score: s.name === resolved ? 1e6 : m!.score })
    }
    scored.sort((a, b) => b.score - a.score)
    return scored.map((x) => x.item)
  }, [text, mode, savedTheme, savedPack])

  const index = Math.min(cursor, Math.max(0, items.length - 1))
  const highlighted = items[index]

  useEffect(() => {
    if (mode === 'themes' && highlighted) S.set({ previewTheme: highlighted.name })
    if (mode === 'icons' && highlighted) S.set({ previewIcons: iconPacks.find((p) => p.name === highlighted.name)?.id ?? null })
  }, [mode, highlighted])

  useEffect(() => {
    list.current?.querySelector('.row.selected')?.scrollIntoView({ block: 'nearest' })
  }, [index])

  const close = () => {
    S.set({ palette: null, previewTheme: null, previewIcons: null })
    focusActive()
  }

  const run = (clicked?: number) => {
    const item = clicked === undefined ? highlighted : items[clicked]
    if (mode === 'themes' || mode === 'icons') {
      const pack = iconPacks.find((p) => p.name === item?.name)?.id
      if (item && mode === 'themes') updateSettings({ theme: item.name })
      if (pack) updateSettings({ iconPack: pack })
      close()
      return
    }
    const typed = text.trim()
    const line = clicked === undefined && ((isComplete(typed) && !moved) || !item) ? typed : item.name
    close()
    setTimeout(() => runLine(line), 0)
  }

  const move = (step: number) => {
    if (items.length === 0) return
    setCursor((index + step + items.length) % items.length)
    setMoved(true)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    const ctrl = e.ctrlKey && !e.metaKey
    if (e.key === 'Escape') close()
    else if (e.key === 'Enter') run()
    else if (e.key === 'ArrowDown' || (ctrl && (e.key === 'n' || e.key === 'j'))) move(1)
    else if (e.key === 'ArrowUp' || (ctrl && (e.key === 'p' || e.key === 'k'))) move(-1)
    else if (e.key === 'PageDown') move(10)
    else if (e.key === 'PageUp') move(-10)
    else if (e.key === 'Tab') {
      if (mode === 'commands' && highlighted) {
        setText(highlighted.name + ' ')
        setCursor(0)
        setMoved(false)
      }
    } else return
    e.preventDefault()
    e.stopPropagation()
  }

  return (
    <>
      <div className="floating-backdrop" onMouseDown={close} />
      <div className="floating" style={{ top: '8%', left: '50%', transform: 'translateX(-50%)', width: 'min(760px, 86vw)', height: 'max(min(60vh, 100vh - 16%), 300px)' }}>
        <div className="floating-title"> {mode === 'themes' ? 'Themes' : mode === 'icons' ? 'Icon Packs' : 'Commands'}</div>
        <div className="prompt">
          <span className="caret">{'>'}</span>
          <input
            ref={input}
            value={text}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => {
              setText(e.target.value)
              setCursor(0)
              setMoved(false)
            }}
            onKeyDown={onKeyDown}
          />
          <span className="count">
            {items.length} / {mode === 'themes' ? themes.length : mode === 'icons' ? iconPacks.length : commands.length}
          </span>
        </div>
        <div className="results" ref={list}>
          {items.map((it, i) => (
            <div
              key={it.name}
              className={`row ${i === index ? 'selected' : ''}`}
              onMouseMove={() => {
                if (i !== index) {
                  setCursor(i)
                  setMoved(true)
                }
              }}
              onMouseDown={(e) => {
                e.preventDefault()
                setCursor(i)
                setMoved(true)
              }}
              onClick={() => run(i)}
            >
              {it.keys && <span className="key">{keyLabel(it.keys)}</span>}
              <Highlighted text={it.name} positions={it.positions} />
              {it.desc && <span className="desc">{'  '}{it.desc}</span>}
              {mode === 'icons' && i === index && <IconSamples />}
            </div>
          ))}
          {items.length === 0 && <div className="empty">{text.trim() && isComplete(text) ? 'Enter runs this command line' : 'No matching commands'}</div>}
        </div>
      </div>
    </>
  )
}
