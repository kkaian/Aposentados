import { supabase } from './supabase'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL

// URL pública de um arquivo; caminhos que começam com "/" são arquivos do próprio app
export function publicUrl(bucket, path) {
  if (!path) return null
  if (path.startsWith('/')) return path
  return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`
}

export const photoUrl = (path) => publicUrl('avatars', path)
export const shieldUrl = (path) => publicUrl('kits', path)

// Reduz a imagem no celular antes de enviar (alvo ~100 KB, JPEG quadrado)
export async function shrinkImage(file, { size = 512, maxBytes = 100_000 } = {}) {
  const bitmap = await createImageBitmap(file)
  const side = Math.min(bitmap.width, bitmap.height)
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = Math.min(size, side)
  canvas
    .getContext('2d')
    .drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, canvas.width, canvas.height)

  let quality = 0.85
  let blob
  do {
    blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
    quality -= 0.1
  } while (blob.size > maxBytes && quality > 0.3)
  return blob
}

// Trocar a foto substitui o arquivo antigo; ?v= força o navegador a buscar a nova
export async function uploadAvatar(userId, file) {
  const blob = await shrinkImage(file)
  const path = `${userId}/avatar.jpg`
  const { error } = await supabase.storage.from('avatars').upload(path, blob, { upsert: true, contentType: 'image/jpeg' })
  if (error) throw error
  return `${path}?v=${Date.now()}`
}
