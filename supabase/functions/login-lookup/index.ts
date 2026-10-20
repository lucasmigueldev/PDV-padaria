import { createClient } from 'npm:@supabase/supabase-js@2'

const deno = (globalThis as typeof globalThis & {
    Deno: {
        env: { get(name: string): string | undefined }
        serve(handler: (request: Request) => Response | Promise<Response>): void
    }
}).Deno

const localOrigins = new Set([
    'http://localhost:5173',
    'http://localhost:5174',
    'http://localhost:5175',
    'http://127.0.0.1:5173',
    'http://127.0.0.1:5174',
    'http://127.0.0.1:5175',
])

function getAllowedOrigins(): Set<string> {
    const origins = new Set(localOrigins)
    const configuredOrigin = deno.env.get('FRONTEND_ORIGIN')

    if (configuredOrigin) {
        try {
            const parsedOrigin = new URL(configuredOrigin)
            if (parsedOrigin.protocol === 'https:' && parsedOrigin.origin === configuredOrigin) {
                origins.add(parsedOrigin.origin)
            }
        } catch {
            console.error('FRONTEND_ORIGIN deve ser uma origem HTTPS/HTTP exata.')
        }
    }

    return origins
}

function jsonResponse(
    body: Record<string, unknown>,
    status: number,
    headers: HeadersInit = {},
): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            ...headers,
            'Content-Type': 'application/json',
        },
    })
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// A tela de login ainda não tem sessão, então este lookup roda com a
// service role e devolve o mínimo possível (papel + unidades ativas do
// operador) para adiantar a escolha de unidade antes da senha. E-mails
// inexistentes ou inativos recebem a mesma resposta neutra (role: null)
// para não expor quais contas existem no sistema.
deno.serve(async (request: Request) => {
    const origin = request.headers.get('Origin')
    const allowedOrigins = getAllowedOrigins()
    const originIsAllowed = !origin || allowedOrigins.has(origin)
    const corsHeaders: Record<string, string> = {
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'authorization, apikey, x-client-info, content-type',
        'Vary': 'Origin',
    }

    if (origin && originIsAllowed) corsHeaders['Access-Control-Allow-Origin'] = origin
    if (!originIsAllowed) return jsonResponse({ error: 'Não foi possível concluir a solicitação. Atualize a tela e tente novamente.' }, 403)

    if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders })
    }

    if (request.method !== 'POST') {
        return jsonResponse({ error: 'Não foi possível concluir a solicitação. Atualize a tela e tente novamente.' }, 405, corsHeaders)
    }

    const supabaseUrl = deno.env.get('SUPABASE_URL')
    const serviceRoleKey = deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    if (!supabaseUrl || !serviceRoleKey) {
        console.error('Configuração Supabase ausente no ambiente da Edge Function.')
        return jsonResponse({ error: 'O serviço está temporariamente indisponível. Tente novamente mais tarde.' }, 500, corsHeaders)
    }

    try {
        const body = await request.json().catch(() => null)
        const email = isRecord(body) && typeof body.email === 'string'
            ? body.email.trim().toLowerCase()
            : ''

        if (!EMAIL_PATTERN.test(email)) {
            return jsonResponse({ role: null, bakeries: [] }, 200, corsHeaders)
        }

        const adminClient = createClient(supabaseUrl, serviceRoleKey, {
            auth: { autoRefreshToken: false, persistSession: false },
        })

        type ProfileRecord = {
            id: string
            role: string
            bakery_id: string | null
            bakery_ids: string[] | null
            active?: boolean | null
        }

        let profile: ProfileRecord | null = null

        const profileResult = await adminClient
            .from('users')
            .select('id, role, bakery_id, bakery_ids, active')
            .ilike('email', email)
            .maybeSingle()

        if (profileResult.error) {
            const isMissingActiveColumn = profileResult.error.code === '42703'
                || (typeof profileResult.error.message === 'string' && profileResult.error.message.includes('active'))

            if (!isMissingActiveColumn) {
                console.error('Falha ao consultar o perfil de acesso.', profileResult.error)
                return jsonResponse({ error: 'O serviço está temporariamente indisponível. Tente novamente mais tarde.' }, 500, corsHeaders)
            }

            // A coluna `active` ainda não existe: consulta sem o filtro de
            // conta ativa (o login real continua bloqueando depois).
            const fallbackResult = await adminClient
                .from('users')
                .select('id, role, bakery_id, bakery_ids')
                .ilike('email', email)
                .maybeSingle()

            if (fallbackResult.error) {
                console.error('Falha ao consultar o perfil de acesso.', fallbackResult.error)
                return jsonResponse({ error: 'O serviço está temporariamente indisponível. Tente novamente mais tarde.' }, 500, corsHeaders)
            }

            profile = fallbackResult.data as ProfileRecord | null
        } else {
            profile = profileResult.data as ProfileRecord | null
        }

        if (!profile || profile.active === false || profile.role !== 'cashier') {
            return jsonResponse({ role: null, bakeries: [] }, 200, corsHeaders)
        }

        const bakeryIds = Array.isArray(profile.bakery_ids) && profile.bakery_ids.length > 0
            ? profile.bakery_ids
            : profile.bakery_id
                ? [profile.bakery_id]
                : []

        if (bakeryIds.length === 0) {
            return jsonResponse({ role: 'cashier', bakeries: [] }, 200, corsHeaders)
        }

        const bakeriesResult = await adminClient
            .from('bakeries')
            .select('id, name')
            .in('id', bakeryIds)
            .eq('active', true)
            .order('name')

        if (bakeriesResult.error) {
            console.error('Falha ao consultar as unidades do operador.', bakeriesResult.error)
            return jsonResponse({ error: 'O serviço está temporariamente indisponível. Tente novamente mais tarde.' }, 500, corsHeaders)
        }

        return jsonResponse({
            role: 'cashier',
            bakeries: (bakeriesResult.data ?? []).map((bakery) => ({ id: bakery.id, name: bakery.name })),
        }, 200, corsHeaders)
    } catch (error) {
        console.error('Erro inesperado no login-lookup.', error)
        return jsonResponse({ error: 'O serviço está temporariamente indisponível. Tente novamente mais tarde.' }, 500, corsHeaders)
    }
})
