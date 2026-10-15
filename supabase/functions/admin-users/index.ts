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

function isUuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
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

        if (!isRecord(requestBody) || typeof requestBody.action !== 'string') {
            return jsonResponse({ error: 'Ação inválida.' }, 400, corsHeaders)
        }

        if (requestBody.action === 'check') {
            return jsonResponse({ ok: true, role: 'owner' }, 200, corsHeaders)
        }

        if (requestBody.action !== 'create') {
            return jsonResponse({ error: 'Ação inválida.' }, 400, corsHeaders)
        }

        const name = typeof requestBody.name === 'string' ? requestBody.name.trim() : ''
        const email = typeof requestBody.email === 'string' ? requestBody.email.trim().toLowerCase() : ''
        const password = typeof requestBody.password === 'string' ? requestBody.password : ''
        const role = requestBody.role
        const bakeryId = requestBody.bakery_id
        const cashierBakeryId = typeof bakeryId === 'string' ? bakeryId : null

        if (!name) return jsonResponse({ error: 'Informe o nome do usuário.' }, 400, corsHeaders)
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return jsonResponse({ error: 'Informe um e-mail válido.' }, 400, corsHeaders)
        }
        if (!password.trim()) return jsonResponse({ error: 'Informe a senha.' }, 400, corsHeaders)
        if (role !== 'owner' && role !== 'cashier') {
            return jsonResponse({ error: 'Perfil de usuário inválido.' }, 400, corsHeaders)
        }
        if (role === 'owner' && bakeryId !== null) {
            return jsonResponse({ error: 'Usuários owner não podem estar associados a uma unidade.' }, 400, corsHeaders)
        }
        if (
            role === 'cashier'
            && (!cashierBakeryId || !isUuid(cashierBakeryId))
        ) {
            return jsonResponse({ error: 'Selecione uma unidade válida.' }, 400, corsHeaders)
        }

        if (role === 'cashier') {
            const { data: bakery, error: bakeryError } = await adminClient
                .from('bakeries')
                .select('id')
                .eq('id', cashierBakeryId)
                .maybeSingle()

            if (bakeryError) {
                console.error('Falha ao validar a unidade do novo usuário.', bakeryError.code)
                return jsonResponse({ error: 'Não foi possível validar a unidade.' }, 500, corsHeaders)
            }
            if (!bakery) return jsonResponse({ error: 'A unidade selecionada não existe.' }, 400, corsHeaders)
        }

        const { data: createdAuthUser, error: createAuthError } = await adminClient.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
        })

        if (createAuthError) {
            if (createAuthError.code === 'email_exists' || createAuthError.code === 'user_already_exists') {
                return jsonResponse({ error: 'Já existe um usuário com este e-mail.' }, 409, corsHeaders)
            }
            console.error('Falha ao criar credenciais para o usuário.', createAuthError.code)
            return jsonResponse({ error: 'Não foi possível criar as credenciais do usuário.' }, 400, corsHeaders)
        }

        const authUserId = createdAuthUser.user?.id
        if (!authUserId) {
            console.error('Supabase Auth não retornou o ID do novo usuário.')
            return jsonResponse({ error: 'Não foi possível criar as credenciais do usuário.' }, 500, corsHeaders)
        }

        const { data: createdProfile, error: createProfileError } = await adminClient
            .from('users')
            .insert({
                id: authUserId,
                name,
                email,
                role,
                bakery_id: role === 'owner' ? null : cashierBakeryId,
            })
            .select('id, name, email, role, bakery_id')
            .single()

        if (createProfileError || !createdProfile) {
            let rollbackErrorCode: string | undefined
            try {
                const { error: rollbackError } = await adminClient.auth.admin.deleteUser(authUserId)
                rollbackErrorCode = rollbackError?.code
            } catch (rollbackError) {
                rollbackErrorCode = rollbackError instanceof Error ? rollbackError.name : 'UnknownError'
            }
            if (rollbackErrorCode) {
                console.error('Falha ao excluir credenciais após erro na criação do perfil.', rollbackErrorCode)
                return jsonResponse({ error: 'Não foi possível criar o perfil do usuário e limpar as credenciais.' }, 500, corsHeaders)
            }

            console.error('Falha ao criar o perfil do novo usuário.', createProfileError?.code)
            return jsonResponse({ error: 'Não foi possível criar o perfil do usuário.' }, 500, corsHeaders)
        }

        return jsonResponse({
            user: {
                id: createdProfile.id,
                name: createdProfile.name,
                email: createdProfile.email,
                role: createdProfile.role,
                bakery_id: createdProfile.bakery_id,
            },
        }, 201, corsHeaders)
    } catch (error) {
        console.error('Falha interna na Edge Function admin-users.', error instanceof Error ? error.name : 'UnknownError')
        return jsonResponse({ error: 'Erro interno do serviço.' }, 500, corsHeaders)
    }
})
