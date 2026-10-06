import { useEffect, useState } from 'react'

// Captura o aviso de instalação do Chrome (Android) para disparar pelo menu
let deferredPrompt = null
const listeners = new Set()
const notify = () => listeners.forEach((fn) => fn())

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault()
  deferredPrompt = e
  notify()
})
window.addEventListener('appinstalled', () => {
  deferredPrompt = null
  notify()
})

export const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true

export const isIOS = () => /iphone|ipad|ipod/i.test(window.navigator.userAgent)

export function useInstallPrompt() {
  const [, force] = useState(0)
  useEffect(() => {
    const fn = () => force((n) => n + 1)
    listeners.add(fn)
    return () => listeners.delete(fn)
  }, [])

  return {
    canPrompt: Boolean(deferredPrompt),
    installed: isStandalone(),
    async prompt() {
      if (!deferredPrompt) return
      deferredPrompt.prompt()
      await deferredPrompt.userChoice
      deferredPrompt = null
      notify()
    },
  }
}
