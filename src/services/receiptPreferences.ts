import { getSupabaseClient } from '../lib/supabaseClient'

export type ReceiptPreference = 'automatic' | 'manual' | 'disabled'

type ReceiptPreferenceRecord = {
    receipt_print_mode: ReceiptPreference
}

function isReceiptPreference(value: unknown): value is ReceiptPreference {
    return value === 'automatic' || value === 'manual' || value === 'disabled'
}

export async function getReceiptPreference(userId: string): Promise<ReceiptPreference> {
    const { data, error } = await getSupabaseClient()
        .from('user_preferences')
        .select('receipt_print_mode')
        .eq('user_id', userId)
        .maybeSingle()

    if (error) {
        console.error('Erro ao carregar a preferência de impressão do Supabase.', error)
        throw new Error('Não foi possível carregar a preferência de impressão.')
    }

    if (!data) return 'automatic'

    const preference = (data as ReceiptPreferenceRecord).receipt_print_mode
    if (!isReceiptPreference(preference)) {
        throw new Error('O Supabase retornou uma preferência de impressão inválida.')
    }

    return preference
}

export async function saveReceiptPreference(
    userId: string,
    preference: ReceiptPreference,
): Promise<ReceiptPreference> {
    const { data, error } = await getSupabaseClient()
        .from('user_preferences')
        .upsert(
            { user_id: userId, receipt_print_mode: preference },
            { onConflict: 'user_id' },
        )
        .select('receipt_print_mode')
        .single()

    if (error) {
        console.error('Erro ao salvar a preferência de impressão no Supabase.', error)
        throw new Error('Não foi possível salvar a preferência de impressão.')
    }

    const savedPreference = (data as ReceiptPreferenceRecord).receipt_print_mode
    if (!isReceiptPreference(savedPreference)) {
        throw new Error('O Supabase retornou uma preferência de impressão inválida.')
    }

    return savedPreference
}
