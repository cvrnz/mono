import type { CSSProperties } from 'react'
import { updateSettings } from './settings'
import * as S from './store'

export type Side = keyof NonNullable<S.Settings['sideWidths']>

export function useSideWidth(side: Side): number | undefined {
  return S.useStore((s) => s.settings.sideWidths?.[side])
}

export function sideStyle(width: number | undefined): CSSProperties | undefined {
  return width ? { width, minWidth: 0, maxWidth: 'none', flex: 'none' } : undefined
}

export const setSideWidth = (side: Side, width: number | undefined) => {
  const widths = { ...S.get().settings.sideWidths, [side]: width }
  if (width === undefined) delete widths[side]
  updateSettings({ sideWidths: widths })
}
