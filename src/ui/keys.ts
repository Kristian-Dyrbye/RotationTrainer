import { useCallback, useEffect, useState } from 'react'

// A keybind is stored as "Ctrl+Alt+Shift+<KeyboardEvent.code>", e.g. "Shift+Digit1".
// Codes are physical-key identifiers, so bindings survive layout switches; labels
// are resolved through the browser's keyboard layout map so they show what the
// key actually types on the user's layout (e.g. Danish).

const MODIFIER_CODES = new Set([
  'ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight',
  'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight',
])

/** null while only a modifier is held — keep listening */
export function comboFromEvent(e: KeyboardEvent): string | null {
  if (MODIFIER_CODES.has(e.code)) return null
  let s = ''
  if (e.ctrlKey) s += 'Ctrl+'
  if (e.altKey) s += 'Alt+'
  if (e.shiftKey) s += 'Shift+'
  return s + e.code
}

const STATIC_LABELS: Record<string, string> = {
  Minus: '-', Equal: '=', Space: 'Spc', Tab: 'Tab',
  BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'",
  Backquote: '`', Backslash: '\\', Comma: ',', Period: '.', Slash: '/',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
}

export function formatCombo(combo: string, layout: Map<string, string> | null): string {
  const parts = combo.split('+')
  const code = parts[parts.length - 1]
  const mods = parts.slice(0, -1)
    .map(m => (m === 'Ctrl' ? 'c' : m === 'Alt' ? 'a' : m === 'Shift' ? 's' : m))
    .join('')
  let base = layout?.get(code)
  if (!base || base.trim() === '') {
    if (code.startsWith('Digit')) base = code.slice(5)
    else if (code.startsWith('Key')) base = code.slice(3)
    else if (code.startsWith('Numpad')) base = 'N' + code.slice(6)
    else base = STATIC_LABELS[code] ?? code
  }
  return mods + base.toUpperCase()
}

/** returns a combo → display-label function, layout-aware where the browser allows */
export function useKeyLabels(): (combo: string) => string {
  const [layout, setLayout] = useState<Map<string, string> | null>(null)
  useEffect(() => {
    const kb = (navigator as unknown as { keyboard?: { getLayoutMap?: () => Promise<Iterable<[string, string]>> } }).keyboard
    kb?.getLayoutMap?.()
      .then(m => setLayout(new Map(m)))
      .catch(() => {})
  }, [])
  return useCallback((combo: string) => formatCombo(combo, layout), [layout])
}
