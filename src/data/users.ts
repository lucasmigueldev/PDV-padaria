import type { User } from '../types/User'
import { getBakeries } from './bakeries'

export const USERS_STORAGE_KEY = 'padaria-pdv-users'

const initialAdminUser: User = {
    id: 'admin',
    name: 'Administrador',
    email: 'admin@padariapdv.local',
    password: '12345',
    role: 'owner',
    bakeryId: null,
}

function isUser(value: unknown): value is User {
    if (!value || typeof value !== 'object') return false

    const user = value as Record<string, unknown>

    return typeof user.id === 'string'
        && typeof user.name === 'string'
        && typeof user.email === 'string'
        && typeof user.password === 'string'
        && (user.role === 'owner' || user.role === 'cashier')
        && (typeof user.bakeryId === 'string' || user.bakeryId === null)
}

function persistUsers(userList: User[]): void {
    localStorage.setItem(USERS_STORAGE_KEY, JSON.stringify(userList))
}

function normalizeUserData(user: Omit<User, 'id'>): Omit<User, 'id'> {
    if (user.role === 'owner') {
        return { ...user, bakeryId: null }
    }

    const bakery = user.bakeryId && getBakeries().find((currentBakery) => currentBakery.id === user.bakeryId)

    if (!bakery || !bakery.active) {
        throw new Error('Selecione uma unidade ativa válida para o operador de caixa.')
    }

    return user
}

function readStoredUsers(): User[] {
    const storedUsers = localStorage.getItem(USERS_STORAGE_KEY)

    if (!storedUsers) {
        const defaultUsers = [initialAdminUser]
        persistUsers(defaultUsers)
        return defaultUsers
    }

    try {
        const parsedUsers = JSON.parse(storedUsers) as unknown
        const validUsers = Array.isArray(parsedUsers) ? parsedUsers.filter(isUser) : []

        if (validUsers.length > 0) {
            const normalizedUsers = validUsers.map((user) => (
                user.role === 'owner' && user.bakeryId !== null
                    ? { ...user, bakeryId: null }
                    : user
            ))
            const hasNormalizedOwner = normalizedUsers.some((user, index) => user.bakeryId !== validUsers[index].bakeryId)

            if (hasNormalizedOwner) persistUsers(normalizedUsers)
            return normalizedUsers
        }

        const defaultUsers = [initialAdminUser]
        persistUsers(defaultUsers)
        return defaultUsers
    } catch {
        const defaultUsers = [initialAdminUser]
        persistUsers(defaultUsers)
        return defaultUsers
    }
}

export function getUsers(): User[] {
    return [...readStoredUsers()]
}

export function saveUsers(userList: User[]): void {
    persistUsers(userList)
}

export function addUser(user: Omit<User, 'id'>): User {
    const normalizedUser = normalizeUserData(user)
    const newUser: User = {
        ...normalizedUser,
        id: crypto.randomUUID(),
    }
    const users = getUsers()

    users.push(newUser)
    saveUsers(users)
    return newUser
}

export function updateUser(id: string, user: Omit<User, 'id'>): User | undefined {
    const users = getUsers()
    const userIndex = users.findIndex((currentUser) => currentUser.id === id)

    if (userIndex === -1) return undefined

    const updatedUser: User = { id, ...normalizeUserData(user) }
    users[userIndex] = updatedUser
    saveUsers(users)
    return updatedUser
}

export function removeUser(id: string): void {
    const users = getUsers().filter((user) => user.id !== id)
    saveUsers(users)
}