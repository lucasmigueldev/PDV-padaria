export type UserRole = 'owner' | 'cashier'

export interface User {
    id: string
    name: string
    email: string
    password: string
    role: UserRole
    bakeryId: string | null
}