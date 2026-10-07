// Recebe do banco (pg_net) quem avisar e a mensagem, e envia as notificações (Web Push).
// As chaves VAPID vêm no pedido, direto do banco: nada de segredo na Vercel nem no git.
import webpush from 'web-push'
import { PROJECT_URL, PUBLISHABLE_KEY } from '../src/lib/project.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  const { vapid, token, subscriptions, message } = req.body ?? {}
  if (!vapid?.privateKey || !Array.isArray(subscriptions) || !message?.title) return res.status(400).end()

  const options = {
    vapidDetails: { subject: vapid.subject, publicKey: vapid.publicKey, privateKey: vapid.privateKey },
    TTL: 60 * 60 * 12,
    urgency: 'high',
  }
  const payload = JSON.stringify(message)
  const gone = []
  let sent = 0
  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(sub, payload, options)
        sent++
      } catch (e) {
        if (e.statusCode === 404 || e.statusCode === 410) gone.push(sub.endpoint)
      }
    }),
  )

  // aparelhos que não existem mais saem da lista
  if (gone.length && token) {
    await fetch(`${PROJECT_URL}/rest/v1/rpc/push_gone`, {
      method: 'POST',
      headers: { apikey: PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_token: token, p_endpoints: gone }),
    }).catch(() => {})
  }
  res.status(200).json({ sent, gone: gone.length })
}
