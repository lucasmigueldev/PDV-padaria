import type { AuthChangeEvent, Session, User as AuthUser } from '@supabase/supabase-js'

import { getSupabaseClient } from '../lib/supabaseClient'
import type { User, UserRole } from '../types/User'
import {
    getActiveBakeriesByIds,
    getPersistedActiveBakeryId,
    persistActiveBakeryId,
} from './userBakeries'

export type AuthenticatedUser = Omit<User, 'password'> & {
    createdAt?: string
    bakeryIds: string[]
    activeBakeryId: string | null
}

export class UserProfileNotFoundError extends Error {
    constructor() {
        super('Perfil do usuário não encontrado.')
        this.name = 'UserProfileNotFoundError'
    }
}

export class UnavailableBakeryError extends Error {
    constructor() {
        super('A unidade vinculada ao seu usuário está indisponível.')
        this.name = 'UnavailableBakeryError'
    }
}

type UserProfileRecord = {
    id: string
    name: string
    email: string
    role: string
    bakery_id: string | null
    bakery_ids?: string[] | null
}

export function mapUserProfile(profile: UserProfileRecord): AuthenticatedUser {
    if (profile.role !== 'owner' && profile.role !== 'cashier') {
        throw new Error('Perfil de usuário com função inválida.')
    }

    const bakeryIds = profile.role === 'owner'
        ? []
        : profile.bakery_ids?.length
            ? profile.bakery_ids
            : (profile.bakery_id ? [profile.bakery_id] : [])

    return {
        id: profile.id,
        name: profile.name,
        email: profile.email,
        role: profile.role as UserRole,
        bakeryIds,
        activeBakeryId: profile.role === 'owner' ? null : profile.bakery_id,
    }
}

const PROFILE_SELECT_WITH_MULTIPLE_UNITS = 'id, name, email, role, bakery_id, bakery_ids'
const PROFILE_SELECT_FALLBACK = 'id, name, email, role, bakery_id'

async function fetchUserProfileRecord(userId: string): Promise<UserProfileRecord> {
    const { data, error } = await getSupabaseClient()
        .from('users')
        .select(PROFILE_SELECT_WITH_MULTIPLE_UNITS)
        .eq('id', userId)
        .maybeSingle()

    if (!error) {
        if (!data) throw new UserProfileNotFoundError()
        return data as UserProfileRecord
    }

    // A migration de múltiplas unidades pode ainda não ter sido aplicada:
    // nesse caso a coluna `bakery_ids` não existe e voltamos para `bakery_id`.
    const isMissingColumn = error.code === '42703'
        || (typeof error.message === 'string' && error.message.includes('bakery_ids'))

    if (!isMissingColumn) throw error

    const { data: fallbackData, error: fallbackError } = await getSupabaseClient()
        .from('users')
        .select(PROFILE_SELECT_FALLBACK)
        .eq('id', userId)
        .maybeSingle()

    if (fallbackError) throw fallbackError
    if (!fallbackData) throw new UserProfileNotFoundError()
    return fallbackData as UserProfileRecord
}

export async function isCashierBakeryActive(bakeryId: string): Promise<boolean> {
    const { data, error } = await getSupabaseClient()
        .from('bakeries')
        .select('id')
        .eq('id', bakeryId)
        .eq('active', true)
        .maybeSingle()

    if (error) throw error

    return data !== null
}

async function resolveActiveBakeryId(
    user: AuthenticatedUser,
    overrideBakeryId?: string | null,
): Promise<string> {
    const activeBakeries = await getActiveBakeriesByIds(user.bakeryIds)
    const activeBakeryIds = activeBakeries.map((bakery) => bakery.id)

    const persistedBakeryId = getPersistedActiveBakeryId(user.id)
    const resolvedBakeryId = overrideBakeryId && activeBakeryIds.includes(overrideBakeryId)
        ? overrideBakeryId
        : persistedBakeryId && activeBakeryIds.includes(persistedBakeryId)
            ? persistedBakeryId
            : activeBakeryIds[0]

    if (!resolvedBakeryId) {
        throw new UnavailableBakeryError()
    }

    persistActiveBakeryId(user.id, resolvedBakeryId)
    return resolvedBakeryId
}

export async function getUserProfile(
    userId: string,
    createdAt?: string,
    activeBakeryIdOverride?: string | null,
): Promise<AuthenticatedUser> {
    const user = mapUserProfile(await fetchUserProfileRecord(userId))

    if (user.role === 'cashier') {
        user.activeBakeryId = await resolveActiveBakeryId(user, activeBakeryIdOverride)
    }

    return {
        ...user,
        ...(createdAt ? { createdAt } : {}),
    }
}

export async function signInWithEmailPassword(
    email: string,
    password: string,
): Promise<{ session: Session; authUser: AuthUser }> {
    const { data, error } = await getSupabaseClient().auth.signInWithPassword({ email, password })

    if (error) throw error
    if (!data.session || !data.user) throw new Error('Não foi possível iniciar a sessão. Tente novamente.')

    return { session: data.session, authUser: data.user }
}

export async function signOut(): Promise<void> {
    const { error } = await getSupabaseClient().auth.signOut()
    if (error) throw error
}

export async function signOutLocalSession(): Promise<void> {
    const { error } = await getSupabaseClient().auth.signOut({ scope: 'local' })
    if (error) throw error
}

export async function getCurrentSession(): Promise<Session | null> {
    const { data, error } = await getSupabaseClient().auth.getSession()
    if (error) throw error
    return data.session
}

export async function getAuthenticatedUser(activeBakeryIdOverride?: string | null): Promise<AuthenticatedUser | null> {
    const session = await getCurrentSession()
    if (!session) return null

    return getUserProfile(session.user.id, session.user.created_at, activeBakeryIdOverride)
}

export function onAuthStateChange(
    callback: (event: AuthChangeEvent, session: Session | null) => void,
) {
    return getSupabaseClient().auth.onAuthStateChange(callback).data.subscription
}