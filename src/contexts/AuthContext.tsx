import { createContext, useContext } from 'react'

import type { AuthenticatedUser } from '../services/auth'

export type AuthContextValue = {
    authenticatedUser: AuthenticatedUser | null
    isAuthLoading: boolean
    authMessage: string | null
    clearAuthMessage: () => void
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
    const context = useContext(AuthContext)
    if (!context) throw new Error('useAuth deve ser usado dentro do contexto de autenticação.')
    return context
}