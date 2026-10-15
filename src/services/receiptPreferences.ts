import { getSupabaseClient } from '../lib/supabaseClient'

export type ReceiptPreference = 'automatic' | 'manual' | 'disabled'

type ReceiptPreferenceRecord = {
    receipt_print_mode: ReceiptPreference
}

function isReceiptPreference(value: unknown): value is ReceiptPreference {
    return value === 'automatic' || value === 'manual' || value === 'disabled'
}

export async function getReceiptPreference(userId: string): Promise<ReceiptPreference> {
    let result
    try {
        result = await getSupabaseClient()
            .from('user_preferences')
            .select('receipt_print_mode')
            .eq('user_id', userId)
            .maybeSingle()
    } catch (requestError) {
        console.error('Falha inesperada ao carregar a preferência de impressão.', requestError)
        if (requestError instanceof TypeError) {
            throw new Error('Não foi possível conectar ao sistema para carregar a preferência de impressão. Verifique sua conexão e tente novamente.', { cause: requestError })
        }
        throw new Error('Não foi possível carregar a preferência de impressão. Atualize a tela e tente novamente.', { cause: requestError })
    }

    const { data, error } = result
    if (error) {
        console.error('Erro ao carregar a preferência de impressão do Supabase.', error)
        if (error.code === '42501') {
            throw new Error('Seu acesso não permite consultar a preferência de impressão. Solicite ajuda ao proprietário.')
        }
        if (typeof error.code === 'string' && /^(5|PGRST5)/.test(error.code)) {
            throw new Error('As preferências de impressão estão temporariamente indisponíveis. Tente novamente mais tarde.')
        }
        throw new Error('Não foi possível carregar a preferência de impressão. Atualize a tela e tente novamente.')
    }

    if (!data) return 'automatic'

    const preference = (data as ReceiptPreferenceRecord).receipt_print_mode
    if (!isReceiptPreference(preference)) {
        throw new Error('A preferência de impressão recebida é inválida. Atualize a tela e tente novamente.')
    }

    return preference
}

export async function saveReceiptPreference(
    userId: string,
    preference: ReceiptPreference,
): Promise<ReceiptPreference> {
    let result
    try {
        result = await getSupabaseClient()
        .from('user_preferences')
        .upsert(
            { user_id: userId, receipt_print_mode: preference },
            { onConflict: 'user_id' },
        )
        .select('receipt_print_mode')
        .single()
    } catch (requestError) {
        console.error('Falha ao confirmar o salvamento da preferência de impressão.', requestError)
        throw new Error('Não foi possível confirmar se a preferência de impressão foi salva. Verifique a configuração antes de tentar novamente.', { cause: requestError })
    }

    const { data, error } = result
    if (error) {
        console.error('Erro ao salvar a preferência de impressão no Supabase.', error)
        if (error.code === '42501') {
            throw new Error('Seu acesso não permite alterar a preferência de impressão. Solicite ajuda ao proprietário.')
        }
        throw new Error('Não foi possível confirmar se a preferência de impressão foi salva. Verifique a configuração antes de tentar novamente.')
    }

    const savedPreference = (data as ReceiptPreferenceRecord).receipt_print_mode
    if (!isReceiptPreference(savedPreference)) {
        throw new Error('A preferência pode ter sido salva, mas não foi possível confirmar o resultado. Verifique a configuração antes de tentar novamente.')
    }

    return savedPreference
}
