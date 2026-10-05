import { getSupabaseClient } from '../lib/supabaseClient'
import type { User, UserRole } from '../types/User'

export type AdminUser = {
    id: string
    name: string
    email: string
    role: UserRole
    bakeryId: string | null
}

type CreateAdminUserResponse = {
    user: {
        id: string
        name: string
        email: string
        role: UserRole
        bakery_id: string | null
    }
}

type AdminUserRecord = {
    id: string
    name: string
    email: string
    role: string
    bakery_id: string | null
}

function isErrorResponse(value: unknown): value is { error: string } {
    return typeof value === 'object'
        && value !== null
        && 'error' in value
        && typeof value.error === 'string'
}

function mapAdminUser(record: AdminUserRecord): User {
    if (record.role !== 'owner' && record.role !== 'cashier') {
        throw new Error('O Supabase retornou um perfil de usuário inválido.')
    }

    return {
        id: record.id,
        name: record.name,
        email: record.email,
        password: '',
        role: record.role,
        bakeryId: record.bakery_id,
    }
}

export async function getAdminUsers(): Promise<User[]> {
    const { data, error } = await getSupabaseClient()
        .from('users')
        .select('id, name, email, role, bakery_id')
        .order('name')

    if (error) {
        console.error('Erro ao carregar usuários no Supabase.', error)

        if (error.code === '42501') {
            throw new Error('Você não tem permissão para consultar os usuários.')
        }
        throw new Error('Não foi possível carregar os usuários.')
    }

    return (data as AdminUserRecord[]).map(mapAdminUser)
}

export async function createAdminUser(user: {
    name: string
    email: string
    password: string
    role: UserRole
    bakeryId: string | null
}): Promise<AdminUser> {
    const { data, error } = await getSupabaseClient().functions.invoke<CreateAdminUserResponse>(
        'admin-users',
        {
            body: {
                action: 'create',
                name: user.name,
                email: user.email,
                password: user.password,
                role: user.role,
                bakery_id: user.bakeryId,
            },
        },
    )

    if (error) {
        if (error.context instanceof Response) {
            const responseBody: unknown = await error.context.clone().json().catch(() => null)
            if (isErrorResponse(responseBody)) throw new Error(responseBody.error)
        }
        throw new Error('Não foi possível criar o usuário no Supabase.')
    }

    if (!data?.user) throw new Error('O Supabase não retornou o perfil do usuário criado.')

    return {
        id: data.user.id,
        name: data.user.name,
        email: data.user.email,
        role: data.user.role,
        bakeryId: data.user.bakery_id,
    }
}
