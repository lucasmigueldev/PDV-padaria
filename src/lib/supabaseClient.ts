import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim()
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()

let supabaseClient: SupabaseClient | null = null

export function getSupabaseClient(): SupabaseClient {
    const missingVariables = [
        !supabaseUrl && 'VITE_SUPABASE_URL',
        !supabaseAnonKey && 'VITE_SUPABASE_ANON_KEY',
    ].filter(Boolean)

    if (missingVariables.length > 0) {
        console.error('Configuração de conexão incompleta.', { missingVariables })
        throw new Error('O acesso ao sistema está temporariamente indisponível. Tente novamente mais tarde ou solicite ajuda ao suporte.')
    }

    if (!supabaseClient) {
        supabaseClient = createClient(supabaseUrl!, supabaseAnonKey!, {
            auth: {
                storage: window.localStorage,
            },
        })
    }

    return supabaseClient
}