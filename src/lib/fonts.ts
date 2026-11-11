/** Where letters go that a font lacks: Nerd Font icons in prompts, then the computer's own monospace. */
const FALLBACK = '"JetBrainsMono Nerd Font", "Symbols Nerd Font Mono", "SF Mono", Menlo, Consolas, monospace'

/**
 * The fonts files and terminals can be set in (the Fonts command). Geist Mono ships with the app
 * (index.css), JetBrains Mono comes with the computer if it's installed, and the rest load from
 * Google Fonts (index.html), where Recursive and Sono are fixed to their monospaced cuts.
 */
export const fonts: { name: string; family: string }[] = [
  { name: 'Fragment Mono', family: `'Fragment Mono', ${FALLBACK}` },
  { name: 'DM Mono', family: `'DM Mono', ${FALLBACK}` },
  { name: 'Recursive Mono Casual', family: `'Recursive', ${FALLBACK}` },
  { name: 'Sono', family: `'Sono', ${FALLBACK}` },
  { name: 'IBM Plex Mono', family: `'IBM Plex Mono', ${FALLBACK}` },
  { name: 'Space Mono', family: `'Space Mono', ${FALLBACK}` },
  { name: 'Spline Sans Mono', family: `'Spline Sans Mono', ${FALLBACK}` },
  { name: 'Geist Mono', family: `'Geist Mono', ${FALLBACK}` },
  { name: 'JetBrains Mono', family: `"JetBrainsMono Nerd Font", "JetBrains Mono", ${FALLBACK}` },
]

export const defaultFont = fonts[0].family

const SANS_FALLBACK = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"

/** The fonts everything else can be set in (the InterfaceFonts command): the computer's own, or one from Google Fonts (index.html). */
export const uiFonts: { name: string; family: string }[] = [
  { name: 'System', family: SANS_FALLBACK },
  { name: 'Inter', family: `'Inter', ${SANS_FALLBACK}` },
  { name: 'Geist', family: `'Geist', ${SANS_FALLBACK}` },
  { name: 'IBM Plex Sans', family: `'IBM Plex Sans', ${SANS_FALLBACK}` },
  { name: 'DM Sans', family: `'DM Sans', ${SANS_FALLBACK}` },
  { name: 'Figtree', family: `'Figtree', ${SANS_FALLBACK}` },
  { name: 'Manrope', family: `'Manrope', ${SANS_FALLBACK}` },
  { name: 'Source Sans 3', family: `'Source Sans 3', ${SANS_FALLBACK}` },
  { name: 'Work Sans', family: `'Work Sans', ${SANS_FALLBACK}` },
  { name: 'Outfit', family: `'Outfit', ${SANS_FALLBACK}` },
]

export const defaultUiFont = uiFonts[0].family

/** The font Mono used to start in, so settings saved with it move to the new default. */
export const oldDefaultFont = '"JetBrainsMono Nerd Font", "JetBrains Mono", "SF Mono", Menlo, Consolas, "DejaVu Sans Mono", monospace'
