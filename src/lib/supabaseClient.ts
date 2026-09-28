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
        throw new Error(`Supabase não configurado. Preencha no .env: ${missingVariables.join(', ')}.`)
    }

    if (!supabaseClient) {
        supabaseClient = createClient(supabaseUrl!, supabasePublishableKey!)
    }

    return supabaseClient
}