import { useCallback, useEffect, useState } from 'react'
import { isIOS, isStandalone } from './install'
import { VAPID_PUBLIC_KEY } from './project'
import { supabase } from './supabase'

const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

function keyBytes(base64) {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4)
  const raw = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

async function currentSubscription() {
  const reg = await navigator.serviceWorker.ready
  return reg.pushManager.getSubscription()
}

async function save(sub) {
  const { endpoint, keys } = sub.toJSON()
  const { error } = await supabase.rpc('save_push_subscription', { p_endpoint: endpoint, p_p256dh: keys.p256dh, p_auth: keys.auth })
  if (error) throw error
}

// Garante que a inscrição deste aparelho está na conta logada (troca de conta no mesmo celular)
export async function syncPush() {
  if (!supported() || Notification.permission !== 'granted') return
  const sub = await currentSubscription()
  if (sub) await save(sub).catch(() => {})
}

// Ao sair: este aparelho para de receber os avisos desta conta
export async function forgetPush() {
  if (!supported()) return
  const sub = await currentSubscription().catch(() => null)
  if (sub) await supabase.rpc('remove_push_subscription', { p_endpoint: sub.endpoint })
}

// status: unsupported | install (iPhone fora do app instalado) | denied | off | on
export function usePush() {
  const [status, setStatus] = useState('loading')

  const refresh = useCallback(async () => {
    if (isIOS() && !isStandalone()) return setStatus('install')
    if (!supported()) return setStatus('unsupported')
    if (Notification.permission === 'denied') return setStatus('denied')
    const sub = Notification.permission === 'granted' ? await currentSubscription() : null
    setStatus(sub ? 'on' : 'off')
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  async function enable() {
    const permission = await Notification.requestPermission()
    if (permission !== 'granted') return refresh()
    const reg = await navigator.serviceWorker.ready
    const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC_KEY) }))
    await save(sub)
    await refresh()
  }

  async function disable() {
    const sub = await currentSubscription()
    if (sub) {
      await supabase.rpc('remove_push_subscription', { p_endpoint: sub.endpoint })
      await sub.unsubscribe()
    }
    await refresh()
  }

  return { status, enable, disable }
}
