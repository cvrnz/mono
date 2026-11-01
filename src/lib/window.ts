import type { MouseEvent } from 'react'
import { Menu } from '@tauri-apps/api/menu'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { invoke } from './bridge'

export const noDrag = 'no-drag'

const onBackground = (e: MouseEvent) => !(e.target as Element).closest(`.${noDrag}`)

export function windowDrag(e: MouseEvent) {
  if (e.button !== 0 || e.ctrlKey || !onBackground(e)) return
  e.preventDefault()
  const w = getCurrentWindow()
  if (e.detail === 2) w.toggleMaximize().catch(() => {})
  else w.startDragging().catch(() => {})
}

export async function windowMenu(e: MouseEvent) {
  if (!onBackground(e)) return
  e.preventDefault()
  const w = getCurrentWindow()
  const full = await w.isFullscreen().catch(() => false)
  const menu = await Menu.new({
    items: [
      { text: 'Close', action: () => invoke('request_close').catch(() => {}) },
      { text: 'Minimize', action: () => w.minimize().catch(() => {}) },
      { text: full ? 'Exit Full Screen' : 'Enter Full Screen', action: () => w.setFullscreen(!full).catch(() => {}) },
    ],
  })
  await menu.popup()
}
