import { useCallback, useEffect, useState } from 'react'
import { AuthContext } from '../lib/auth'
import { supabase } from '../lib/supabase'

export default function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [ready, setReady] = useState(false)
  // perfil carregado e de qual usuário ele é (evita mostrar "sem perfil" enquanto carrega)
  const [loaded, setLoaded] = useState({ userId: null, profile: null })

  const loadProfile = useCallback(async (s) => {
    if (!s) return setLoaded({ userId: null, profile: null })
    const { data } = await supabase.from('profiles').select('*').eq('id', s.user.id).maybeSingle()
    setLoaded({ userId: s.user.id, profile: data })
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session)
      await loadProfile(data.session)
      setReady(true)
    })
    const { data } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s)
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') {
        // fora do callback para não travar o cliente do Supabase
        setTimeout(() => loadProfile(s), 0)
      }
    })
    return () => data.subscription.unsubscribe()
  }, [loadProfile])

  const refreshProfile = useCallback(() => loadProfile(session), [loadProfile, session])
  const userId = session?.user.id ?? null
  const loading = !ready || loaded.userId !== userId

  return (
    <AuthContext.Provider value={{ session, profile: loading ? null : loaded.profile, loading, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  )
}
