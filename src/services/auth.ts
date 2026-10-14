import type { AuthChangeEvent, Session, User as AuthUser } from '@supabase/supabase-js'

import { getSupabaseClient } from '../lib/supabaseClient'
import type { User, UserRole } from '../types/User'

export type AuthenticatedUser = Omit<User, 'password'> & {
    createdAt?: string
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
}

export function mapUserProfile(profile: UserProfileRecord): AuthenticatedUser {
    if (profile.role !== 'owner' && profile.role !== 'cashier') {
        throw new Error('Perfil de usuário com função inválida.')
    }

    return {
        id: profile.id,
        name: profile.name,
        email: profile.email,
        role: profile.role as UserRole,
        bakeryId: profile.role === 'owner' ? null : profile.bakery_id,
    }
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

async function ensureOperationalBakeryIsActive(user: AuthenticatedUser): Promise<void> {
    if (user.role === 'owner') return
    if (!user.bakeryId || !await isCashierBakeryActive(user.bakeryId)) {
        throw new UnavailableBakeryError()
    }
}

export async function getUserProfile(userId: string, createdAt?: string): Promise<AuthenticatedUser> {
    const { data, error } = await getSupabaseClient()
        .from('users')
        .select('id, name, email, role, bakery_id')
        .eq('id', userId)
        .maybeSingle()

    if (error) throw error
    if (!data) throw new UserProfileNotFoundError()

    const user = {
        ...mapUserProfile(data as UserProfileRecord),
        ...(createdAt ? { createdAt } : {}),
    }
    await ensureOperationalBakeryIsActive(user)
    return user
}

export async function signInWithEmailPassword(
    email: string,
    password: string,
): Promise<{ session: Session; authUser: AuthUser }> {
    const { data, error } = await getSupabaseClient().auth.signInWithPassword({ email, password })

    if (error) throw error
    if (!data.session || !data.user) throw new Error('O Supabase Auth não retornou uma sessão válida.')

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

export async function getAuthenticatedUser(): Promise<AuthenticatedUser | null> {
    const session = await getCurrentSession()
    if (!session) return null

    return getUserProfile(session.user.id, session.user.created_at)
}

export function onAuthStateChange(
    callback: (event: AuthChangeEvent, session: Session | null) => void,
) {
    return getSupabaseClient().auth.onAuthStateChange(callback).data.subscription
}