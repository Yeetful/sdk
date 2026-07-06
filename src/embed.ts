/**
 * `yeetful/embed` — drop the Yeetful chat into any webpage as an iframe.
 *
 * Framework-agnostic, dependency-free, browser-only. Does NOT import viem or
 * any of the x402 payment stack — safe to load in host pages.
 *
 * Embed contract v1 (matches the website /embed route):
 *   - iframe URL: {origin}/embed?mcps=…&address=…&theme=…&host=…
 *   - all postMessage payloads: { source: 'yeetful-embed', v: 1, type, ... }
 *   - child→parent: ready | resize {height} | event {name, data?}
 *   - parent→child: address {address} | theme {theme}
 *   - parent only accepts messages where event.origin === embed origin AND
 *     payload.source === 'yeetful-embed'; parent→child posts always target
 *     the embed origin (never '*').
 */

export interface YeetfulChatOptions {
  /** Element (or selector) the chat fills. Required for mode 'inline'. */
  container?: HTMLElement | string
  /** Embed origin. Default 'https://www.yeetful.com'. */
  origin?: string
  /** MCP slugs to scope the chat to (max 4). */
  mcps?: string[]
  /** Initial wallet-address context (goes in the URL). */
  address?: string
  /** Default 'dark'. */
  theme?: 'dark' | 'light'
  /** 'inline' fills the container; 'bubble' floats a launcher. Default 'inline'. */
  mode?: 'inline' | 'bubble'
  /** Bubble mode stacking. Default 2147483000. */
  zIndex?: number
  /** Chat events forwarded from the iframe. */
  onEvent?: (name: string, data?: unknown) => void
  /** Fired once when the embed signals it is ready. */
  onReady?: () => void
}

export interface YeetfulChatHandle {
  iframe: HTMLIFrameElement
  /** Update the wallet-address context (queued until the embed is ready). */
  setAddress(address: string | null): void
  setTheme(theme: 'dark' | 'light'): void
  /** Bubble mode: open the panel (no-op inline). */
  open(): void
  /** Bubble mode: close the panel (no-op inline). */
  close(): void
  /** Remove all DOM nodes + listeners. */
  destroy(): void
}

const SOURCE = 'yeetful-embed'
const VERSION = 1

type ChildMessage =
  | { source: typeof SOURCE; v: number; type: 'ready' }
  | { source: typeof SOURCE; v: number; type: 'resize'; height: number }
  | { source: typeof SOURCE; v: number; type: 'event'; name: string; data?: object }

const CHAT_GLYPH =
  '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
  '<path d="M4 6a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H9l-4.2 3.4c-.5.4-1.3 0-1.3-.7V6Z" fill="#fff"/>' +
  '</svg>'

export function mountYeetfulChat(opts: YeetfulChatOptions = {}): YeetfulChatHandle {
  if (typeof window === 'undefined') {
    throw new Error('mountYeetfulChat is browser-only')
  }

  const mode = opts.mode ?? 'inline'
  const embedOrigin = new URL(opts.origin ?? 'https://www.yeetful.com').origin
  const zIndex = opts.zIndex ?? 2147483000

  // --- URL ---------------------------------------------------------------
  const url = new URL('/embed', embedOrigin)
  const params = new URLSearchParams()
  if (opts.mcps?.length) params.set('mcps', opts.mcps.slice(0, 4).join(','))
  if (opts.address) params.set('address', opts.address)
  params.set('theme', opts.theme ?? 'dark')
  params.set('host', window.location.origin)
  url.search = params.toString()

  // --- iframe ------------------------------------------------------------
  const iframe = document.createElement('iframe')
  iframe.src = url.toString()
  iframe.title = 'Yeetful chat'
  iframe.setAttribute('allow', 'clipboard-write; payment')
  iframe.style.border = '0'
  iframe.style.display = 'block'

  // --- DOM per mode --------------------------------------------------------
  let container: HTMLElement | null = null
  let launcher: HTMLButtonElement | null = null
  let panel: HTMLDivElement | null = null
  let isOpen = false

  if (mode === 'inline') {
    container =
      typeof opts.container === 'string'
        ? document.querySelector<HTMLElement>(opts.container)
        : opts.container ?? null
    if (!container) {
      throw new Error("mountYeetfulChat: 'container' (element or selector) is required for inline mode")
    }
    iframe.style.width = '100%'
    iframe.style.height = '100%'
    iframe.style.minHeight = '480px'
    container.appendChild(iframe)
  } else {
    panel = document.createElement('div')
    const p = panel.style
    p.position = 'fixed'
    p.bottom = '96px'
    p.right = '24px'
    p.width = 'min(400px, calc(100vw - 32px))'
    p.height = 'min(640px, calc(100vh - 140px))'
    p.borderRadius = '16px'
    p.overflow = 'hidden'
    p.boxShadow = '0 24px 64px rgba(0, 0, 0, 0.4)'
    p.zIndex = String(zIndex)
    p.opacity = '0'
    p.transform = 'translateY(12px)'
    p.visibility = 'hidden'
    p.pointerEvents = 'none'
    p.transition = 'opacity 160ms ease, transform 160ms ease'
    iframe.style.width = '100%'
    iframe.style.height = '100%'
    panel.appendChild(iframe)

    launcher = document.createElement('button')
    launcher.type = 'button'
    launcher.setAttribute('aria-label', 'Open Yeetful chat')
    const b = launcher.style
    b.position = 'fixed'
    b.bottom = '24px'
    b.right = '24px'
    b.width = '56px'
    b.height = '56px'
    b.borderRadius = '50%'
    b.background = '#0a0a0a'
    b.border = '1px solid rgba(255, 255, 255, 0.16)'
    b.display = 'flex'
    b.alignItems = 'center'
    b.justifyContent = 'center'
    b.cursor = 'pointer'
    b.padding = '0'
    b.zIndex = String(zIndex)
    b.transition = 'transform 120ms ease'
    launcher.innerHTML = CHAT_GLYPH
    launcher.addEventListener('mouseenter', onHoverIn)
    launcher.addEventListener('mouseleave', onHoverOut)
    launcher.addEventListener('click', onLauncherClick)

    document.body.appendChild(panel)
    document.body.appendChild(launcher)
    window.addEventListener('keydown', onKeydown)
  }

  // --- messaging -----------------------------------------------------------
  let ready = false
  let destroyed = false
  const queue: Array<Record<string, unknown>> = []

  function post(msg: Record<string, unknown>) {
    const payload = { source: SOURCE, v: VERSION, ...msg }
    if (!ready) {
      queue.push(payload)
      return
    }
    iframe.contentWindow?.postMessage(payload, embedOrigin)
  }

  function onMessage(event: MessageEvent) {
    if (event.origin !== embedOrigin) return
    const data = event.data as ChildMessage | undefined
    if (!data || typeof data !== 'object' || data.source !== SOURCE) return
    if (data.type === 'ready') {
      ready = true
      for (const msg of queue.splice(0)) iframe.contentWindow?.postMessage(msg, embedOrigin)
      opts.onReady?.()
    } else if (data.type === 'resize') {
      // Inline only, and only when the host hasn't sized the container itself.
      if (mode === 'inline' && container && container.style.height === '' && typeof data.height === 'number') {
        iframe.style.height = `${data.height}px`
      }
    } else if (data.type === 'event') {
      opts.onEvent?.(data.name, data.data)
    }
  }
  window.addEventListener('message', onMessage)

  // --- bubble handlers -------------------------------------------------------
  function onHoverIn() {
    if (launcher) launcher.style.transform = 'scale(1.06)'
  }
  function onHoverOut() {
    if (launcher) launcher.style.transform = 'scale(1)'
  }
  function onLauncherClick() {
    isOpen ? close() : open()
  }
  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && isOpen) close()
  }

  function open() {
    if (mode !== 'bubble' || !panel || destroyed) return
    isOpen = true
    panel.style.visibility = 'visible'
    panel.style.pointerEvents = 'auto'
    panel.style.opacity = '1'
    panel.style.transform = 'translateY(0)'
    launcher?.setAttribute('aria-label', 'Close Yeetful chat')
  }

  function close() {
    if (mode !== 'bubble' || !panel || destroyed) return
    isOpen = false
    panel.style.opacity = '0'
    panel.style.transform = 'translateY(12px)'
    panel.style.pointerEvents = 'none'
    panel.style.visibility = 'hidden'
    launcher?.setAttribute('aria-label', 'Open Yeetful chat')
  }

  function destroy() {
    if (destroyed) return
    destroyed = true
    window.removeEventListener('message', onMessage)
    if (mode === 'bubble') {
      window.removeEventListener('keydown', onKeydown)
      launcher?.removeEventListener('mouseenter', onHoverIn)
      launcher?.removeEventListener('mouseleave', onHoverOut)
      launcher?.removeEventListener('click', onLauncherClick)
      launcher?.remove()
      panel?.remove()
    } else {
      iframe.remove()
    }
  }

  return {
    iframe,
    setAddress: (address) => post({ type: 'address', address }),
    setTheme: (theme) => post({ type: 'theme', theme }),
    open,
    close,
    destroy,
  }
}
