// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mountYeetfulChat, type YeetfulChatHandle } from './embed.js'

const ORIGIN = 'https://www.yeetful.com'

function makeContainer(): HTMLElement {
  const el = document.createElement('div')
  document.body.appendChild(el)
  return el
}

/** Dispatch a window message as if it came from the embed iframe. */
function dispatch(origin: string, data: unknown) {
  window.dispatchEvent(new MessageEvent('message', { origin, data }))
}

const readyMsg = { source: 'yeetful-embed', v: 1, type: 'ready' }

const handles: YeetfulChatHandle[] = []
function mount(opts: Parameters<typeof mountYeetfulChat>[0]) {
  const h = mountYeetfulChat(opts)
  handles.push(h)
  return h
}

afterEach(() => {
  for (const h of handles.splice(0)) h.destroy()
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

describe('mountYeetfulChat', () => {
  it('throws a clear error outside the browser (SSR guard)', () => {
    vi.stubGlobal('window', undefined)
    expect(() => mountYeetfulChat({})).toThrow('mountYeetfulChat is browser-only')
  })

  it('builds the /embed URL with mcps, address, theme and host params', () => {
    const h = mount({
      container: makeContainer(),
      mcps: ['uniswap-free', 'snapshot-free'],
      address: '0x1111111111111111111111111111111111111111',
      theme: 'light',
    })
    const url = new URL(h.iframe.src)
    expect(url.origin).toBe(ORIGIN)
    expect(url.pathname).toBe('/embed')
    expect(url.searchParams.get('mcps')).toBe('uniswap-free,snapshot-free')
    expect(url.searchParams.get('address')).toBe('0x1111111111111111111111111111111111111111')
    expect(url.searchParams.get('theme')).toBe('light')
    expect(url.searchParams.get('host')).toBe(window.location.origin)
  })

  it('defaults theme to dark, omits mcps/address when unset, caps mcps at 4', () => {
    const h = mount({ container: makeContainer() })
    const url = new URL(h.iframe.src)
    expect(url.searchParams.get('theme')).toBe('dark')
    expect(url.searchParams.has('mcps')).toBe(false)
    expect(url.searchParams.has('address')).toBe(false)

    const h2 = mount({ container: makeContainer(), mcps: ['a', 'b', 'c', 'd', 'e'] })
    expect(new URL(h2.iframe.src).searchParams.get('mcps')).toBe('a,b,c,d')
  })

  it('respects a custom origin and requires a container inline', () => {
    const h = mount({ container: makeContainer(), origin: 'http://localhost:3000' })
    expect(new URL(h.iframe.src).origin).toBe('http://localhost:3000')
    expect(() => mountYeetfulChat({})).toThrow(/container/)
    expect(() => mountYeetfulChat({ container: '#nope' })).toThrow(/container/)
  })

  it('ignores messages from the wrong origin or wrong source', () => {
    const onReady = vi.fn()
    mount({ container: makeContainer(), onReady })

    dispatch('https://evil.example', readyMsg)
    expect(onReady).not.toHaveBeenCalled()

    dispatch(ORIGIN, { source: 'not-yeetful', v: 1, type: 'ready' })
    dispatch(ORIGIN, null)
    dispatch(ORIGIN, 'ready')
    expect(onReady).not.toHaveBeenCalled()

    dispatch(ORIGIN, readyMsg)
    expect(onReady).toHaveBeenCalledTimes(1)
  })

  it('queues setAddress/setTheme until ready, then flushes to the embed origin', () => {
    const h = mount({ container: makeContainer() })
    const postMessage = vi.spyOn(h.iframe.contentWindow!, 'postMessage')

    h.setAddress('0x2222222222222222222222222222222222222222')
    h.setTheme('light')
    expect(postMessage).not.toHaveBeenCalled()

    dispatch(ORIGIN, readyMsg)
    expect(postMessage).toHaveBeenCalledTimes(2)
    expect(postMessage).toHaveBeenNthCalledWith(
      1,
      { source: 'yeetful-embed', v: 1, type: 'address', address: '0x2222222222222222222222222222222222222222' },
      ORIGIN
    )
    expect(postMessage).toHaveBeenNthCalledWith(
      2,
      { source: 'yeetful-embed', v: 1, type: 'theme', theme: 'light' },
      ORIGIN
    )

    // After ready, calls post immediately (still to the embed origin, never '*').
    h.setAddress(null)
    expect(postMessage).toHaveBeenLastCalledWith(
      { source: 'yeetful-embed', v: 1, type: 'address', address: null },
      ORIGIN
    )
  })

  it('applies resize height inline only when the container has no explicit height', () => {
    const container = makeContainer()
    const h = mount({ container })
    dispatch(ORIGIN, { source: 'yeetful-embed', v: 1, type: 'resize', height: 720 })
    expect(h.iframe.style.height).toBe('720px')

    const sized = makeContainer()
    sized.style.height = '600px'
    const h2 = mount({ container: sized })
    dispatch(ORIGIN, { source: 'yeetful-embed', v: 1, type: 'resize', height: 720 })
    expect(h2.iframe.style.height).toBe('100%')
  })

  it('forwards chat events to onEvent', () => {
    const onEvent = vi.fn()
    mount({ container: makeContainer(), onEvent })
    dispatch(ORIGIN, { source: 'yeetful-embed', v: 1, type: 'event', name: 'swap_quoted', data: { pair: 'USDC/ETH' } })
    expect(onEvent).toHaveBeenCalledWith('swap_quoted', { pair: 'USDC/ETH' })
  })

  it('bubble mode mounts a launcher + hidden panel, toggles open/close, Escape closes', () => {
    const h = mount({ mode: 'bubble' })
    const launcher = document.querySelector<HTMLButtonElement>('button[aria-label="Open Yeetful chat"]')
    expect(launcher).toBeTruthy()
    const panel = h.iframe.parentElement as HTMLElement
    expect(panel.style.visibility).toBe('hidden')

    h.open()
    expect(panel.style.visibility).toBe('visible')
    expect(panel.style.opacity).toBe('1')

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(panel.style.visibility).toBe('hidden')

    launcher!.click()
    expect(panel.style.visibility).toBe('visible')
    launcher!.click()
    expect(panel.style.visibility).toBe('hidden')
  })

  it('open/close are no-ops inline', () => {
    const h = mount({ container: makeContainer() })
    expect(() => {
      h.open()
      h.close()
    }).not.toThrow()
  })

  it('destroy removes DOM nodes and stops listening', () => {
    const onReady = vi.fn()
    const container = makeContainer()
    const h = mount({ container, onReady })
    expect(container.contains(h.iframe)).toBe(true)

    h.destroy()
    expect(container.contains(h.iframe)).toBe(false)
    dispatch(ORIGIN, readyMsg)
    expect(onReady).not.toHaveBeenCalled()

    const hb = mount({ mode: 'bubble' })
    hb.destroy()
    expect(document.querySelector('button[aria-label="Open Yeetful chat"]')).toBeNull()
    expect(document.body.contains(hb.iframe)).toBe(false)
    hb.open()
    expect((hb.iframe.parentElement as HTMLElement).style.visibility).toBe('hidden')
  })
})
