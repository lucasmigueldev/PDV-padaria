import { createClient } from 'npm:@supabase/supabase-js@2'

const deno = (globalThis as typeof globalThis & {
    Deno: {
        env: { get(name: string): string | undefined }
        serve(handler: (request: Request) => Response | Promise<Response>): void
    }
}).Deno

const localOrigins = new Set([
    'http://localhost:5173',
    'http://127.0.0.1:5173',
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
    if (!originIsAllowed) return jsonResponse({ error: 'Origem não permitida.' }, 403)

    if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders })
    }

    if (request.method !== 'POST') {
        return jsonResponse({ error: 'Método não permitido.' }, 405, corsHeaders)
    }

    const authorizationHeader = request.headers.get('Authorization')
    const bearerMatch = authorizationHeader?.match(/^Bearer\s+([^\s]+)$/i)
    if (!bearerMatch) {
        return jsonResponse({ error: 'Autenticação obrigatória.' }, 401, corsHeaders)
    }

    const supabaseUrl = deno.env.get('SUPABASE_URL')
    const anonKey = deno.env.get('SUPABASE_ANON_KEY')
    const serviceRoleKey = deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
        console.error('Configuração Supabase ausente no ambiente da Edge Function.')
        return jsonResponse({ error: 'Serviço não configurado.' }, 500, corsHeaders)
    }

    try {
        const authenticatedClient = createClient(supabaseUrl, anonKey, {
            global: { headers: { Authorization: authorizationHeader } },
            auth: { autoRefreshToken: false, persistSession: false },
        })
        const adminClient = createClient(supabaseUrl, serviceRoleKey, {
            auth: { autoRefreshToken: false, persistSession: false },
        })

        const { data: authData, error: authError } = await authenticatedClient.auth.getUser(bearerMatch[1])
        if (authError || !authData.user) {
            return jsonResponse({ error: 'Autenticação inválida ou expirada.' }, 401, corsHeaders)
        }

        const { data: profile, error: profileError } = await adminClient
            .from('users')
            .select('role')
            .eq('id', authData.user.id)
            .maybeSingle()

        if (profileError) {
            console.error('Falha ao verificar o perfil administrativo.', profileError.code)
            return jsonResponse({ error: 'Não foi possível verificar a autorização.' }, 500, corsHeaders)
        }

        if (profile?.role !== 'owner') {
            return jsonResponse({ error: 'Acesso restrito a owner.' }, 403, corsHeaders)
        }

        let requestBody: unknown
        try {
            requestBody = await request.json()
        } catch {
            return jsonResponse({ error: 'Corpo JSON inválido.' }, 400, corsHeaders)
        }

        if (
            !requestBody
            || typeof requestBody !== 'object'
            || Array.isArray(requestBody)
            || !('action' in requestBody)
            || requestBody.action !== 'check'
        ) {
            return jsonResponse({ error: 'Ação inválida.' }, 400, corsHeaders)
        }

        return jsonResponse({ ok: true, role: 'owner' }, 200, corsHeaders)
    } catch (error) {
        console.error('Falha interna na Edge Function admin-users.', error instanceof Error ? error.name : 'UnknownError')
        return jsonResponse({ error: 'Erro interno do serviço.' }, 500, corsHeaders)
    }
})
