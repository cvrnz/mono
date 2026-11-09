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

/** The font Mono used to start in, so settings saved with it move to the new default. */
export const oldDefaultFont = '"JetBrainsMono Nerd Font", "JetBrains Mono", "SF Mono", Menlo, Consolas, "DejaVu Sans Mono", monospace'
