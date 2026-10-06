import { createContext, useContext } from 'react'

export const AuthContext = createContext({
  session: null,
  profile: null,
  loading: true,
  refreshProfile: async () => {},
})

export const useAuth = () => useContext(AuthContext)

export const isAdminRole = (profile) => profile?.role === 'dono' || profile?.role === 'admin'
