import { getSupabaseClient } from '../lib/supabaseClient'
import type { Bakery } from '../types/Bakery'

const ACTIVE_BAKERY_STORAGE_PREFIX = 'pdv360:active-bakery:'

export function getPersistedActiveBakeryId(userId: string): string | null {
    try {
        return window.localStorage.getItem(ACTIVE_BAKERY_STORAGE_PREFIX + userId)
    } catch {
        return null
    }
}

export function persistActiveBakeryId(userId: string, bakeryId: string): void {
    try {
        window.localStorage.setItem(ACTIVE_BAKERY_STORAGE_PREFIX + userId, bakeryId)
    } catch {
        // Armazenamento indisponível (modo privado, cota): a unidade ativa
        // será resolvida novamente no próximo carregamento do perfil.
    }
}

export async function getActiveBakeriesByIds(bakeryIds: string[]): Promise<Bakery[]> {
    if (bakeryIds.length === 0) return []

    const { data, error } = await getSupabaseClient()
        .from('bakeries')
        .select('id, name, active')
        .in('id', bakeryIds)
        .order('name')

    if (error) throw error

    return (data ?? []).filter((bakery) => bakery.active)
}