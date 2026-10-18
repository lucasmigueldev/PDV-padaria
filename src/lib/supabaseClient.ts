import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim()
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()

let supabaseClient: SupabaseClient | null = null

export function getSupabaseClient(): SupabaseClient {
    const missingVariables = [
        !supabaseUrl && 'VITE_SUPABASE_URL',
        !supabasePublishableKey && 'VITE_SUPABASE_PUBLISHABLE_KEY',
    ].filter(Boolean)

    if (missingVariables.length > 0) {
        console.error('Configuração de conexão incompleta.', { missingVariables })
        throw new Error('O acesso ao sistema está temporariamente indisponível. Tente novamente mais tarde ou solicite ajuda ao suporte.')
    }

    if (!supabaseClient) {
        supabaseClient = createClient(supabaseUrl!, supabasePublishableKey!, {
            auth: {
                storage: window.localStorage,
            },
        })
    }

    return supabaseClient
}