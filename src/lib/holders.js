import { useEffect, useState } from 'react'
import { supabase } from './supabase'

// Com qual admin/dono o dinheiro ficou
export function useHolders() {
  const [holders, setHolders] = useState([])
  useEffect(() => {
    supabase
      .from('profiles')
      .select('id, name, role')
      .eq('status', 'ativo')
      .in('role', ['dono', 'admin'])
      .order('name')
      .then(({ data }) => setHolders(data ?? []))
  }, [])
  return holders
}
