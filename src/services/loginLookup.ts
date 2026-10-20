import { getSupabaseClient } from '../lib/supabaseClient'
import type { Bakery } from '../types/Bakery'

export type LoginLookupResult = {
    role: 'owner' | 'cashier' | null
    bakeries: Bakery[]
}

type LoginLookupResponse = {
    role?: string | null
    bakeries?: Array<{ id: string; name: string }> | null
}

/**
 * Verificação pré-login (disparada ao sair do campo de e-mail): retorna o
 * papel do usuário e, para operadores, as unidades ativas às quais ele tem
 * acesso. A resposta é neutra (role: null) quando o e-mail não existe.
 *
 * A chamada é um adiantamento de UX: se falhar, o fluxo normal de login
 * continua e a seleção de unidade acontece depois da autenticação.
 */
export async function lookupLoginAccess(email: string): Promise<LoginLookupResult> {
    const { data, error } = await getSupabaseClient().functions.invoke<LoginLookupResponse>('login-lookup', {
        body: { email },
    })

    if (error) throw error

    const role = data?.role === 'owner' || data?.role === 'cashier' ? data.role : null

    return {
        role,
        // A edge function só devolve unidades ativas, por isso `active: true`.
        bakeries: role === 'cashier'
            ? (data?.bakeries ?? []).map((bakery) => ({ id: bakery.id, name: bakery.name, active: true }))
            : [],
    }
}
