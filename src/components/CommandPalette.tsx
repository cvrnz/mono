import { useEffect, useMemo, useRef, useState } from 'react'
import { focusActive } from '../lib/actions'
import { comboOf, commands, hasModifier, isComplete, keyLabel, keysOf, resolve, runLine, setKeys } from '../lib/commands'
import { toast } from '../lib/dialogs'
import { setCapturing } from '../lib/keys'
import { iconPacks } from '../lib/fileIcons'
import { fonts } from '../lib/fonts'
import { fuzzy, highlight } from '../lib/fuzzy'
import { updateSettings } from '../lib/settings'
import * as S from '../lib/store'
import { themes } from '../lib/themes'
import FileIcon from './FileIcon'

type Mode = 'commands' | 'themes' | 'icons' | 'fonts' | 'keys'
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
  const changedKeys = S.useStore((s) => s.settings.keys)
  const [capture, setCapture] = useState<string | null>(null)
  // Fonts are tried on as they're highlighted; the one from before comes back unless one is picked.
  const [fontsFor, setFontsFor] = useState({ mode, saved: S.get().settings.fontFamily })
  if (fontsFor.mode !== mode) setFontsFor({ mode, saved: S.get().settings.fontFamily })
  const savedFont = fontsFor.saved
  const pickedFont = useRef(false)

  useEffect(() => {
    if (mode !== 'fonts') return
    pickedFont.current = false
    return () => {
      if (!pickedFont.current) S.set({ settings: { ...S.get().settings, fontFamily: savedFont } })
    }
  }, [mode, savedFont])

  useEffect(() => {
    setCapturing(capture !== null)
    return () => setCapturing(false)
  }, [capture])

  useEffect(() => {
    input.current?.focus()
  }, [mode])

  useEffect(() => {
    setCapture(null)
    if (mode === 'keys') {
      setText('')
      setCursor(0)
      setMoved(false)
    }
    if (mode === 'themes' || mode === 'icons' || mode === 'fonts') {
      setText('')
      const settings = S.get().settings
      setCursor(
        Math.max(
          0,
          mode === 'themes'
            ? themes.findIndex((t) => t.name === settings.theme)
            : mode === 'fonts'
              ? fonts.findIndex((f) => f.family === settings.fontFamily)
              : iconPacks.findIndex((p) => p.id === (settings.iconPack ?? 'material')),
        ),
      )
      setMoved(false)
    }
  }, [mode])

  const items = useMemo((): Item[] => {
    const word = text.trim().split(/\s+/)[0] ?? ''
    const source: Omit<Item, 'positions'>[] =
      mode === 'themes'
        ? themes.map((t) => ({ name: t.name, desc: t.name === savedTheme ? 'current' : '' }))
        : mode === 'fonts'
          ? fonts.map((f) => ({ name: f.name, desc: f.family === savedFont ? 'current' : '' }))
          : mode === 'icons'
          ? iconPacks.map((p) => ({ name: p.name, desc: p.id === savedPack ? `${p.desc}, current` : p.desc }))
          : mode === 'keys'
            ? commands.map((c) => ({ name: c.name, desc: changedKeys?.[c.name] !== undefined ? `${c.desc} (changed)` : c.desc, keys: keysOf(c) }))
            : commands.filter((c) => !c.hidden).map((c) => ({ name: c.name, desc: c.desc, keys: keysOf(c) }))
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
  }, [text, mode, savedTheme, savedPack, savedFont, changedKeys])

  const index = Math.min(cursor, Math.max(0, items.length - 1))
  const highlighted = items[index]

  useEffect(() => {
    if (mode === 'themes' && highlighted) S.set({ previewTheme: highlighted.name })
    const font = mode === 'fonts' && highlighted ? fonts.find((f) => f.name === highlighted.name) : undefined
    if (font) S.set({ settings: { ...S.get().settings, fontFamily: font.family } })
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
    if (mode === 'keys') {
      if (item) setCapture(item.name)
      input.current?.focus()
      return
    }
    if (mode === 'fonts') {
      const font = fonts.find((f) => f.name === item?.name)
      if (font) {
        pickedFont.current = true
        updateSettings({ fontFamily: font.family })
      }
      close()
      return
    }
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

  const pickKeys = (e: React.KeyboardEvent, name: string) => {
    e.preventDefault()
    e.stopPropagation()
    const combo = comboOf(e)
    if (!combo) return
    if (combo === 'Esc') setCapture(null)
    else if (combo === 'Backspace' || combo === 'Delete') {
      setKeys(name, '')
      setCapture(null)
    } else if (combo === 'Enter') {
      setKeys(name, null)
      setCapture(null)
    } else if (!hasModifier(combo)) toast(`Use ${keyLabel('Mod')}, ${keyLabel('Ctrl')} or ${keyLabel('Alt')} with a key`, 'error')
    else {
      const taken = setKeys(name, combo)
      setCapture(null)
      toast(`${name}: ${keyLabel(combo)}${taken.length ? ` (taken off ${taken.join(', ')})` : ''}`)
    }
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (capture) {
      pickKeys(e, capture)
      return
    }
    const ctrl = e.ctrlKey && !e.metaKey
    if (e.key === 'Escape') close()
    else if (e.key === 'Enter') run()
    else if (e.key === 'ArrowDown' || (ctrl && (e.key === 'n' || e.key === 'j'))) move(1)
    else if (e.key === 'ArrowUp' || (ctrl && (e.key === 'p' || e.key === 'k'))) move(-1)
    else if (e.key === 'PageDown') move(10)
    else if (e.key === 'PageUp') move(-10)
    else if ((e.key === 'Backspace' || e.key === 'Delete') && mode === 'keys' && !text && highlighted) setKeys(highlighted.name, null)
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
        <div className="floating-title"> {mode === 'themes' ? 'Themes' : mode === 'icons' ? 'Icon Packs' : mode === 'fonts' ? 'Fonts' : mode === 'keys' ? 'Keyboard Shortcuts' : 'Commands'}</div>
        <div className="prompt">
          <span className="caret">{'>'}</span>
          <input
            ref={input}
            value={capture ? '' : text}
            readOnly={capture !== null}
            placeholder={
              capture
                ? `Press the new shortcut for ${capture}  ·  Enter default (${keyLabel(commands.find((c) => c.name === capture)?.keys ?? '') || 'none'})  ·  Backspace none  ·  Esc cancel`
                : mode === 'keys'
                  ? 'Enter changes the shortcut  ·  Backspace puts it back to the default'
                  : undefined
            }
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
            {items.length} / {mode === 'themes' ? themes.length : mode === 'icons' ? iconPacks.length : mode === 'fonts' ? fonts.length : mode === 'keys' ? commands.length : commands.filter((c) => !c.hidden).length}
          </span>
        </div>
        <div className="results" ref={list}>
          {items.map((it, i) => (
            <div
              key={it.name}
              className={`row ${i === index ? 'selected' : ''} ${capture === it.name ? 'capturing' : ''}`}
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
              {(it.keys || mode === 'keys') && <span className="key">{capture === it.name ? '…' : keyLabel(it.keys ?? '') || (mode === 'keys' ? '—' : '')}</span>}
              <span style={mode === 'fonts' ? { fontFamily: fonts.find((f) => f.name === it.name)?.family } : undefined}>
                <Highlighted text={it.name} positions={it.positions} />
              </span>
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
