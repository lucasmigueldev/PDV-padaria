import type { User } from '../types/User'
import type { NavigateFunction } from 'react-router-dom'
import { signOut } from '../services/auth'

export const AUTHENTICATED_USER_STORAGE_KEY = 'authenticatedUser'

type AuthenticatedUser = Omit<User, 'password'>

export function getAuthenticatedUser(): AuthenticatedUser | null {
    const storedUser = sessionStorage.getItem(AUTHENTICATED_USER_STORAGE_KEY)

    if (!storedUser) return null

    try {
        const parsedUser = JSON.parse(storedUser) as Partial<AuthenticatedUser>

        if (!parsedUser.id || !parsedUser.name || !parsedUser.email || !parsedUser.role) return null
        if (parsedUser.role !== 'owner' && parsedUser.role !== 'cashier') return null
        if (parsedUser.bakeryId !== null && typeof parsedUser.bakeryId !== 'string') return null

        return parsedUser as AuthenticatedUser
    } catch {
        return null
    }
}

export function setAuthenticatedUser(user: AuthenticatedUser): void {
    sessionStorage.setItem(AUTHENTICATED_USER_STORAGE_KEY, JSON.stringify(user))
}

export function clearAuthenticatedUser(): void {
    sessionStorage.removeItem('isAuthenticated')
    sessionStorage.removeItem(AUTHENTICATED_USER_STORAGE_KEY)
}

export async function logoutAndRedirect(navigate: NavigateFunction): Promise<void> {
    try {
        await signOut()
    } catch (error) {
        console.error('Não foi possível encerrar a sessão Supabase.', error)
    } finally {
        clearAuthenticatedUser()
        navigate('/login', { replace: true })
    }
}

export function isOwnerAuthenticated(): boolean {
    return getAuthenticatedUser()?.role === 'owner'
}
