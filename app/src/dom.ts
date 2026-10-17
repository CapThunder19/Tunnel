type Child = Node | string | number | null | undefined | false
type Attrs = Record<string, string | number | boolean | EventListener | undefined>

/** Tiny DOM builder. Strings become text nodes, so nothing from the chain is ever parsed as HTML. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener)
    else if (k === 'class') el.className = String(v)
    else if (v === true) el.setAttribute(k, '')
    else el.setAttribute(k, String(v))
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : String(c))
  return el
}

export const short = (s: string, n = 6) => (s.length > 2 * n + 2 ? `${s.slice(0, n + 2)}…${s.slice(-n)}` : s)

export function errorText(err: unknown): string {
  const e = err as { shortMessage?: string; details?: string; message?: string; cause?: unknown }
  let deepest = ''
  let cur: any = err
  for (let i = 0; cur && i < 8; i++) {
    if (typeof cur.details === 'string') deepest = cur.details
    cur = cur.cause
  }
  return [e?.shortMessage ?? e?.message ?? String(err), deepest].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(' — ')
}

export function store<T>(key: string, fallback: T): { get(): T; set(v: T): void } {
  return {
    get() {
      try {
        const raw = localStorage.getItem(key)
        return raw === null ? fallback : (JSON.parse(raw) as T)
      } catch {
        return fallback
      }
    },
    set(v: T) {
      try {
        localStorage.setItem(key, JSON.stringify(v))
      } catch {
        // storage unavailable: the value just will not persist
      }
    },
  }
}
