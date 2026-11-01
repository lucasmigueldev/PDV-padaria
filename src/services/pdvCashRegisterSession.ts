import { getSupabaseClient } from '../lib/supabaseClient'
import { getEnv } from '../lib/env'

export type PdvCashRegisterSessionEndingReason = 'pagehide' | 'logout'

export async function endPdvCashRegisterSession(
    cashRegisterId: string,
    reason: PdvCashRegisterSessionEndingReason,
): Promise<void> {
    const { error } = await getSupabaseClient().rpc('end_pdv_cash_register_session', {
        p_cash_register_id: cashRegisterId,
        p_reason: reason,
    })
    if (error) throw error
}

export async function endPdvCashRegisterSessionOnPageHide(
    cashRegisterId: string,
    accessToken: string,
): Promise<void> {
    const env = getEnv()
    const supabaseUrl = env.VITE_SUPABASE_URL
    const apiKey = env.VITE_SUPABASE_PUBLISHABLE_KEY
    if (!supabaseUrl || !apiKey) {
        throw new Error('Configuração Supabase ausente ao encerrar a sessão do PDV.')
    }

    const response = await fetch(
        new URL('/rest/v1/rpc/end_pdv_cash_register_session', supabaseUrl),
        {
            method: 'POST',
            headers: {
                apikey: apiKey,
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                p_cash_register_id: cashRegisterId,
                p_reason: 'pagehide',
            }),
            keepalive: true,
        },
    )
    if (!response.ok) {
        throw new Error(`O Supabase recusou o encerramento da sessão do PDV (${response.status}).`)
    }
}

export async function resumePdvCashRegisterSession(cashRegisterId: string): Promise<void> {
    const { error } = await getSupabaseClient().rpc('resume_pdv_cash_register_session', {
        p_cash_register_id: cashRegisterId,
    })
    if (error) throw error
}
