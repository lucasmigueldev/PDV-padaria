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

type AdminUserActionResponse = {
    user_id: string
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

function isMissingActiveColumnError(error: { code?: string; message?: string }): boolean {
    return (error.code === '42703' && /\bactive\b.*does not exist/i.test(error.message ?? ''))
        || (error.code === 'PGRST204' && /\bactive\b.*schema cache/i.test(error.message ?? ''))
}

async function getFunctionErrorMessage(error: { context?: unknown }, fallback: string): Promise<string> {
    if (error.context instanceof Response) {
        const responseBody: unknown = await error.context.clone().json().catch(() => null)
        if (isErrorResponse(responseBody)) return responseBody.error
    }

    return fallback
}

function mapAdminUser(record: AdminUserRecord): User {
    if (record.role !== 'owner' && record.role !== 'cashier') {
        throw new Error('Não foi possível identificar o tipo de acesso deste usuário. Atualize a lista e tente novamente.')
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
    const client = getSupabaseClient()
    let result
    try {
        result = await client
            .from('users')
            .select('id, name, email, role, bakery_id')
            .eq('active', true)
            .order('name')
        if (result.error && isMissingActiveColumnError(result.error)) {
            result = await client
                .from('users')
                .select('id, name, email, role, bakery_id')
                .order('name')
        }
    } catch (requestError) {
        console.error('Falha inesperada ao carregar usuários.', requestError)
        throw new Error('Não foi possível carregar a lista de usuários. Atualize a tela e tente novamente.', { cause: requestError })
    }
    const { data, error } = result

    if (error) {
        console.error('Erro ao carregar usuários no Supabase.', error)

        if (error.code === '42501') {
            throw new Error('Seu acesso não permite consultar os usuários. Solicite ajuda ao proprietário.')
        }
        throw new Error('Não foi possível carregar a lista de usuários. Atualize a tela e tente novamente.')
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
        throw new Error(await getFunctionErrorMessage(error, 'Não foi possível cadastrar o usuário. Verifique os dados e tente novamente.'))
    }

    if (!data?.user) {
        throw new Error('Não foi possível confirmar o cadastro do usuário. Atualize a lista antes de tentar novamente.')
    }

    return {
        id: data.user.id,
        name: data.user.name,
        email: data.user.email,
        role: data.user.role,
        bakeryId: data.user.bakery_id,
    }
}

export async function updateAdminUser(user: {
    id: string
    name: string
    bakeryId: string
    email?: string
    password?: string
}): Promise<void> {
    const body: {
        action: 'update'
        user_id: string
        name: string
        bakery_id: string
        email?: string
        password?: string
    } = {
        action: 'update',
        user_id: user.id,
        name: user.name,
        bakery_id: user.bakeryId,
    }

    if (user.email !== undefined) body.email = user.email
    if (user.password) body.password = user.password

    const { data, error } = await getSupabaseClient().functions.invoke<AdminUserActionResponse>(
        'admin-users',
        { body },
    )

    if (error) {
        throw new Error(await getFunctionErrorMessage(
            error,
            'Não foi possível atualizar o operador. Verifique os dados e tente novamente; se o problema continuar, solicite ajuda ao proprietário.',
        ))
    }
    if (data?.user_id !== user.id) {
        throw new Error('Não foi possível confirmar a atualização do operador. Atualize a lista antes de tentar novamente.')
    }
}

export async function deactivateAdminUser(userId: string): Promise<void> {
    const { data, error } = await getSupabaseClient().functions.invoke<AdminUserActionResponse>(
        'admin-users',
        {
            body: {
                action: 'deactivate',
                user_id: userId,
            },
        },
    )

    if (error) {
        throw new Error(await getFunctionErrorMessage(
            error,
            'Não foi possível desativar o operador. Atualize a lista e tente novamente; se o problema continuar, solicite ajuda ao proprietário.',
        ))
    }
    if (data?.user_id !== userId) {
        throw new Error('Não foi possível confirmar a desativação do operador. Atualize a lista antes de tentar novamente.')
    }
}
