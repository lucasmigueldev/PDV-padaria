import type { User } from '../types/User'

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

export function isOwnerAuthenticated(): boolean {
    return getAuthenticatedUser()?.role === 'owner'
}
