import { TIMEZONE } from './constants'

// Datas no fuso de São Paulo, como strings 'AAAA-MM-DD' (igual ao banco)
export function todayISO() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE }).format(new Date())
}

export const monthStart = (iso) => `${iso.slice(0, 7)}-01`

export function addMonths(monthIso, n) {
  const [y, m] = monthIso.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + n, 1))
  return d.toISOString().slice(0, 10)
}

// Último domingo do mês: depois dele o mês está fechado (igual a public.month_close_date)
export function lastSunday(monthIso) {
  const [y, m] = monthIso.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0))
  last.setUTCDate(last.getUTCDate() - last.getUTCDay())
  return last.toISOString().slice(0, 10)
}

export const monthClosed = (monthIso) => todayISO() > lastSunday(monthIso)

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
const WEEKDAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']

export const monthName = (monthIso) => MONTHS[Number(monthIso.slice(5, 7)) - 1]
export const monthLabel = (monthIso) => {
  const name = monthName(monthIso)
  return `${name[0].toUpperCase()}${name.slice(1)} ${monthIso.slice(0, 4)}`
}

// "Domingo · 11/10"
export function dayLabel(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
  return `${weekday} · ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`
}

export const timeLabel = (t) => t?.slice(0, 5).replace(':', 'h')
