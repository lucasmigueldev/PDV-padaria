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

function getOperatorOperationError(error: { code?: string; message: string }): string {
    if (error.code === '42501') {
        if (/inactive operators cannot be changed/i.test(error.message)) {
            return 'O operador está inativo e não pode ser alterado.'
        }
        return 'Apenas o proprietário pode gerenciar operadores.'
    }
    if (error.code === '23514') {
        // A gestão de operadores pelo proprietário não é bloqueada por caixa
        // aberto nem por estoque; esta mensagem cobre apenas estados inválidos
        // de unidade.
        return 'A operação não pode ser concluída no estado atual. Confira as condições da unidade e tente novamente.'
    }
    if (error.code === '23503') return 'A unidade selecionada não existe.'
    if (error.code === '22023') return 'Informe um nome e uma unidade válidos.'
    if (error.code === 'P0002') return 'O operador não foi encontrado. Atualize a lista e tente novamente.'
    return 'Não foi possível concluir a operação. Atualize a lista e tente novamente. Se o problema continuar, solicite ajuda ao proprietário.'
}

function getAuthUpdateError(error: { code?: string }): string {
    if (error.code === 'email_exists' || error.code === 'user_already_exists') {
        return 'Este e-mail já está cadastrado em outra conta.'
    }
    return 'Não foi possível atualizar os dados de acesso do operador. Confira o e-mail e a senha informados e tente novamente.'
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
    if (!originIsAllowed) return jsonResponse({ error: 'Não foi possível concluir a solicitação. Atualize a tela e tente novamente.' }, 403)

    if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders })
    }

    if (request.method !== 'POST') {
        return jsonResponse({ error: 'Não foi possível concluir a solicitação. Atualize a tela e tente novamente.' }, 405, corsHeaders)
    }

    const authorizationHeader = request.headers.get('Authorization')
    const bearerMatch = authorizationHeader?.match(/^Bearer\s+([^\s]+)$/i)
    if (!bearerMatch) {
        return jsonResponse({ error: 'Sua sessão expirou. Entre novamente para continuar.' }, 401, corsHeaders)
    }

    const supabaseUrl = deno.env.get('SUPABASE_URL')
    const anonKey = deno.env.get('SUPABASE_ANON_KEY')
    const serviceRoleKey = deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
        console.error('Configuração Supabase ausente no ambiente da Edge Function.')
        return jsonResponse({ error: 'O serviço está temporariamente indisponível. Tente novamente mais tarde.' }, 500, corsHeaders)
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
            return jsonResponse({ error: 'Sua sessão expirou. Entre novamente para continuar.' }, 401, corsHeaders)
        }

        const { data: profile, error: profileError } = await adminClient
            .from('users')
            .select('role')
            .eq('id', authData.user.id)
            .maybeSingle()

        if (profileError) {
            console.error('Falha ao verificar o perfil administrativo.', profileError.code)
            return jsonResponse({ error: 'Não foi possível confirmar sua permissão. Atualize a tela e tente novamente.' }, 500, corsHeaders)
        }

        if (profile?.role !== 'owner') {
            return jsonResponse({ error: 'Somente o proprietário pode gerenciar usuários.' }, 403, corsHeaders)
        }

        let requestBody: unknown
        try {
            requestBody = await request.json()
        } catch {
            return jsonResponse({ error: 'Não foi possível processar os dados enviados. Atualize a tela e tente novamente.' }, 400, corsHeaders)
        }

        if (!isRecord(requestBody) || typeof requestBody.action !== 'string') {
            return jsonResponse({ error: 'Não foi possível identificar a operação solicitada. Atualize a tela e tente novamente.' }, 400, corsHeaders)
        }

        if (requestBody.action === 'check') {
            return jsonResponse({ ok: true, role: 'owner' }, 200, corsHeaders)
        }

        if (requestBody.action === 'update') {
            const userId = requestBody.user_id
            const name = typeof requestBody.name === 'string' ? requestBody.name.trim() : ''
            const bakeryId = requestBody.bakery_id
            const hasEmail = Object.hasOwn(requestBody, 'email')
            const hasPassword = Object.hasOwn(requestBody, 'password')
            const emailValue = requestBody.email
            const passwordValue = requestBody.password

            if (typeof userId !== 'string' || !isUuid(userId)) {
                return jsonResponse({ error: 'Não foi possível identificar o operador. Atualize a lista e tente novamente.' }, 400, corsHeaders)
            }
            if (!name) return jsonResponse({ error: 'Informe o nome do operador.' }, 400, corsHeaders)
            if (typeof bakeryId !== 'string' || !isUuid(bakeryId)) {
                return jsonResponse({ error: 'Selecione uma unidade válida.' }, 400, corsHeaders)
            }

            if (hasEmail && typeof emailValue !== 'string') {
                return jsonResponse({ error: 'Informe um e-mail válido.' }, 400, corsHeaders)
            }
            if (hasPassword && typeof passwordValue !== 'string') {
                return jsonResponse({ error: 'A nova senha é inválida.' }, 400, corsHeaders)
            }

            const requestedEmail = typeof emailValue === 'string'
                ? emailValue.trim().toLowerCase()
                : undefined
            if (
                requestedEmail !== undefined
                && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(requestedEmail)
            ) {
                return jsonResponse({ error: 'Informe um e-mail válido.' }, 400, corsHeaders)
            }

            const newPassword = typeof passwordValue === 'string' && passwordValue.trim()
                ? passwordValue
                : undefined
            if (newPassword !== undefined && newPassword.length < 6) {
                return jsonResponse({ error: 'A nova senha deve ter no mínimo 6 caracteres.' }, 400, corsHeaders)
            }

            const updatePublicProfile = async (email?: string) => {
                const { data: updatedUserId, error: updateError } = email === undefined
                    ? await authenticatedClient.rpc('update_operator_profile', {
                        p_user_id: userId,
                        p_name: name,
                        p_bakery_id: bakeryId,
                    })
                    : await authenticatedClient.rpc('update_operator_profile_with_email', {
                        p_user_id: userId,
                        p_name: name,
                        p_email: email,
                        p_bakery_id: bakeryId,
                    })

                return { updatedUserId, updateError }
            }

            if (requestedEmail === undefined && newPassword === undefined) {
                const { updatedUserId, updateError } = await updatePublicProfile()
                if (updateError) {
                    console.error('Falha ao atualizar o perfil do operador.', updateError.code)
                    return jsonResponse({ error: getOperatorOperationError(updateError) }, 400, corsHeaders)
                }
                if (updatedUserId !== userId) {
                    console.error('A RPC de atualização não retornou o ID do operador esperado.')
                    return jsonResponse({ error: 'Não foi possível confirmar a atualização do operador. Atualize a lista antes de tentar novamente.' }, 500, corsHeaders)
                }
                return jsonResponse({ user_id: updatedUserId }, 200, corsHeaders)
            }

            const { data: targetProfile, error: targetProfileError } = await adminClient
                .from('users')
                .select('role, active, email')
                .eq('id', userId)
                .maybeSingle()

            if (targetProfileError) {
                console.error('Falha ao verificar o perfil do operador para edição de credenciais.', targetProfileError.code)
                return jsonResponse({ error: 'Não foi possível localizar os dados do operador. Atualize a lista e tente novamente.' }, 500, corsHeaders)
            }
            if (!targetProfile) {
                return jsonResponse({ error: 'O operador não foi encontrado. Atualize a lista e tente novamente.' }, 404, corsHeaders)
            }
            if (targetProfile.role !== 'cashier' || targetProfile.active !== true) {
                return jsonResponse({ error: 'Somente operadores ativos podem ter os dados de acesso alterados.' }, 403, corsHeaders)
            }

            const { data: authTarget, error: authTargetError } = await adminClient.auth.admin.getUserById(userId)
            if (authTargetError || !authTarget.user?.email) {
                console.error('Falha ao verificar as credenciais atuais do operador.', authTargetError?.code)
                return jsonResponse({ error: 'Não foi possível confirmar os dados de acesso atuais do operador. Tente novamente mais tarde.' }, 500, corsHeaders)
            }

            const currentProfileEmail = targetProfile.email.trim()
            const currentAuthEmail = authTarget.user.email.trim()
            if (currentProfileEmail.toLowerCase() !== currentAuthEmail.toLowerCase()) {
                return jsonResponse({
                    error: 'Os e-mails cadastrados para este operador estão diferentes. Confira os dados da conta antes de alterar o acesso.',
                }, 409, corsHeaders)
            }

            const finalEmail = requestedEmail ?? currentProfileEmail.toLowerCase()
            const emailChanged = finalEmail !== currentAuthEmail
            const credentialsChanged = emailChanged || newPassword !== undefined

            if (!credentialsChanged) {
                const { updatedUserId, updateError } = await updatePublicProfile()
                if (updateError) {
                    console.error('Falha ao atualizar o perfil do operador.', updateError.code)
                    return jsonResponse({ error: getOperatorOperationError(updateError) }, 400, corsHeaders)
                }
                if (updatedUserId !== userId) {
                    console.error('A RPC de atualização não retornou o ID do operador esperado.')
                    return jsonResponse({ error: 'Não foi possível confirmar a atualização do operador. Atualize a lista antes de tentar novamente.' }, 500, corsHeaders)
                }
                return jsonResponse({ user_id: updatedUserId }, 200, corsHeaders)
            }

            const { data: validatedUserId, error: validationError } = await authenticatedClient.rpc(
                'validate_operator_profile_update',
                {
                    p_user_id: userId,
                    p_bakery_id: bakeryId,
                },
            )
            if (validationError) {
                console.error('Falha ao validar a edição de credenciais do operador.', validationError.code)
                return jsonResponse({ error: getOperatorOperationError(validationError) }, 400, corsHeaders)
            }
            if (validatedUserId !== userId) {
                console.error('A RPC de validação não confirmou o operador esperado.')
                return jsonResponse({ error: 'Não foi possível confirmar os dados do operador. Atualize a lista e tente novamente.' }, 500, corsHeaders)
            }

            const authChanges: { email?: string; email_confirm?: boolean; password?: string } = {}
            if (emailChanged) {
                authChanges.email = finalEmail
                authChanges.email_confirm = true
            }
            if (newPassword !== undefined) authChanges.password = newPassword

            let authUpdateResult: Awaited<ReturnType<typeof adminClient.auth.admin.updateUserById>>
            try {
                authUpdateResult = await adminClient.auth.admin.updateUserById(userId, authChanges)
            } catch (authUpdateFailure) {
                console.error(
                    'Resultado da alteração de credenciais no Supabase Auth não pôde ser confirmado.',
                    authUpdateFailure instanceof Error ? authUpdateFailure.name : 'UnknownError',
                )
                return jsonResponse({
                    error: 'Não foi possível confirmar a alteração dos dados de acesso. Confira o e-mail e a senha do operador antes de tentar novamente.',
                }, 500, corsHeaders)
            }

            if (authUpdateResult.error || authUpdateResult.data.user?.id !== userId) {
                console.error('Falha ao atualizar as credenciais do operador no Supabase Auth.', authUpdateResult.error?.code)
                if (!authUpdateResult.error) {
                    return jsonResponse({
                        error: 'Não foi possível confirmar a alteração dos dados de acesso. Confira o e-mail e a senha do operador antes de tentar novamente.',
                    }, 500, corsHeaders)
                }
                return jsonResponse({
                    error: getAuthUpdateError(authUpdateResult.error),
                }, authUpdateResult.error.code === 'email_exists' || authUpdateResult.error.code === 'user_already_exists'
                    ? 409
                    : 400, corsHeaders)
            }

            let sessionsRevoked = false
            try {
                const { data: revokedUserId, error: revokeError } = await authenticatedClient.rpc(
                    'revoke_operator_sessions',
                    {
                        p_user_id: userId,
                        p_bakery_id: bakeryId,
                    },
                )
                if (revokeError) {
                    console.error('Falha ao invalidar sessões anteriores do operador.', revokeError.code)
                } else {
                    sessionsRevoked = revokedUserId === userId
                    if (!sessionsRevoked) {
                        console.error('A RPC de revogação não confirmou o operador esperado.')
                    }
                }
            } catch (revokeFailure) {
                console.error(
                    'Resultado da invalidação de sessões do operador não pôde ser confirmado.',
                    revokeFailure instanceof Error ? revokeFailure.name : 'UnknownError',
                )
            }

            if (!sessionsRevoked) {
                let emailRollbackSucceeded = !emailChanged
                if (emailChanged) {
                    try {
                        const { data: rollbackData, error: rollbackError } = await adminClient.auth.admin.updateUserById(userId, {
                            email: authTarget.user.email,
                            email_confirm: true,
                        })
                        emailRollbackSucceeded = !rollbackError && rollbackData.user?.id === userId
                        if (!emailRollbackSucceeded) {
                            console.error('Falha ao confirmar a compensação do e-mail no Supabase Auth.', rollbackError?.code)
                        }
                    } catch (rollbackFailure) {
                        console.error(
                            'Falha ao confirmar a compensação do e-mail no Supabase Auth.',
                            rollbackFailure instanceof Error ? rollbackFailure.name : 'UnknownError',
                        )
                    }
                }

                const failureMessage = 'Não foi possível encerrar as sessões anteriores do operador.'
                if (!emailRollbackSucceeded) {
                    return jsonResponse({
                        error: `${failureMessage} Não foi possível confirmar a restauração do e-mail anterior. Confira imediatamente o e-mail e as sessões do operador${newPassword !== undefined ? '. A senha também foi alterada e não pode ser restaurada automaticamente; confira-a antes de permitir novo acesso.' : '.'}`,
                    }, 500, corsHeaders)
                }
                if (newPassword !== undefined) {
                    return jsonResponse({
                        error: `${failureMessage} ${emailChanged ? 'O e-mail foi restaurado ao endereço anterior. ' : 'O e-mail não foi alterado. '}A nova senha foi aplicada e a senha anterior não pode ser restaurada automaticamente. Confira os dados de acesso do operador.`,
                    }, 500, corsHeaders)
                }
                return jsonResponse({
                    error: `${failureMessage} O e-mail foi restaurado ao endereço anterior. A alteração não foi concluída.`,
                }, 500, corsHeaders)
            }

            let finalProfileResult: Awaited<ReturnType<typeof updatePublicProfile>>
            try {
                finalProfileResult = await updatePublicProfile(finalEmail)
            } catch (profileUpdateFailure) {
                console.error(
                    'Resultado da atualização do perfil após alteração no Auth não pôde ser confirmado.',
                    profileUpdateFailure instanceof Error ? profileUpdateFailure.name : 'UnknownError',
                )
                return jsonResponse({
                    error: 'Os dados de acesso foram alterados, mas não foi possível confirmar a atualização do cadastro. Confira imediatamente o e-mail e a senha do operador antes de permitir novo acesso.',
                }, 500, corsHeaders)
            }

            const { updatedUserId, updateError } = finalProfileResult
            if (updateError) {
                console.error('Falha ao sincronizar o perfil após alteração no Auth.', updateError.code)
                if (!updateError.code) {
                    return jsonResponse({
                        error: 'Os dados de acesso foram alterados, mas não foi possível confirmar se o cadastro foi atualizado. Confira imediatamente o e-mail e a senha do operador antes de permitir novo acesso.',
                    }, 500, corsHeaders)
                }

                let emailRollbackSucceeded = !emailChanged
                if (emailChanged) {
                    try {
                        const { data: rollbackData, error: rollbackError } = await adminClient.auth.admin.updateUserById(userId, {
                            email: authTarget.user.email,
                            email_confirm: true,
                        })
                        emailRollbackSucceeded = !rollbackError && rollbackData.user?.id === userId
                        if (!emailRollbackSucceeded) {
                            console.error('Falha ao confirmar a compensação do e-mail no Supabase Auth.', rollbackError?.code)
                        }
                    } catch (rollbackFailure) {
                        console.error(
                            'Falha ao confirmar a compensação do e-mail no Supabase Auth.',
                            rollbackFailure instanceof Error ? rollbackFailure.name : 'UnknownError',
                        )
                    }
                }

                const profileFailure = getOperatorOperationError(updateError)
                if (!emailRollbackSucceeded) {
                    return jsonResponse({
                        error: `${profileFailure} Não foi possível confirmar a restauração do e-mail anterior após a alteração dos dados de acesso. Confira imediatamente o e-mail e a senha do operador; a senha anterior não pode ser restaurada automaticamente.`,
                    }, 500, corsHeaders)
                }
                if (newPassword !== undefined) {
                    return jsonResponse({
                        error: `${profileFailure} ${emailChanged ? 'O e-mail foi restaurado ao endereço anterior. ' : 'O e-mail não foi alterado. '}A nova senha foi aplicada e a senha anterior não pode ser restaurada automaticamente. Confira os dados de acesso antes de tentar novamente.`,
                    }, 500, corsHeaders)
                }
                return jsonResponse({
                    error: `${profileFailure} O e-mail foi restaurado ao endereço anterior, mas o cadastro não foi atualizado.`,
                }, 400, corsHeaders)
            }

            if (updatedUserId !== userId) {
                console.error('A RPC final não confirmou o operador esperado após alterar o Auth.')
                return jsonResponse({
                    error: 'Os dados de acesso foram alterados, mas não foi possível confirmar a atualização do cadastro. Confira imediatamente o e-mail e a senha do operador antes de permitir novo acesso.',
                }, 500, corsHeaders)
            }

            return jsonResponse({ user_id: updatedUserId }, 200, corsHeaders)
        }

        if (requestBody.action === 'deactivate') {
            const userId = requestBody.user_id

            if (typeof userId !== 'string' || !isUuid(userId)) {
                return jsonResponse({ error: 'Não foi possível identificar o operador. Atualize a lista e tente novamente.' }, 400, corsHeaders)
            }

            const { data: deactivatedUserId, error: deactivateError } = await authenticatedClient.rpc(
                'deactivate_operator',
                { p_user_id: userId },
            )

            if (deactivateError) {
                console.error('Falha ao desativar o operador.', deactivateError.code)
                return jsonResponse({ error: getOperatorOperationError(deactivateError) }, 400, corsHeaders)
            }
            if (deactivatedUserId !== userId) {
                console.error('A RPC de desativação não retornou o ID do operador esperado.')
                return jsonResponse({ error: 'Não foi possível confirmar a desativação do operador. Atualize a lista antes de tentar novamente.' }, 500, corsHeaders)
            }

            return jsonResponse({ user_id: deactivatedUserId }, 200, corsHeaders)
        }

        if (requestBody.action !== 'create') {
            return jsonResponse({ error: 'Não foi possível identificar a operação solicitada. Atualize a tela e tente novamente.' }, 400, corsHeaders)
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
        if (password.length < 6) {
            return jsonResponse({ error: 'A senha deve ter no mínimo 6 caracteres.' }, 400, corsHeaders)
        }
        if (role !== 'owner' && role !== 'cashier') {
            return jsonResponse({ error: 'Selecione um tipo de usuário válido.' }, 400, corsHeaders)
        }
        if (role === 'owner' && bakeryId !== null) {
            return jsonResponse({ error: 'Contas de proprietário não podem ser vinculadas a uma unidade.' }, 400, corsHeaders)
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
                return jsonResponse({ error: 'Não foi possível confirmar a unidade selecionada. Atualize a tela e tente novamente.' }, 500, corsHeaders)
            }
            if (!bakery) return jsonResponse({ error: 'A unidade selecionada não foi encontrada. Atualize a lista e tente novamente.' }, 400, corsHeaders)
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
            return jsonResponse({ error: 'Não foi possível criar os dados de acesso do usuário. Confira os dados informados e tente novamente.' }, 400, corsHeaders)
        }

        const authUserId = createdAuthUser.user?.id
        if (!authUserId) {
            console.error('Supabase Auth não retornou o ID do novo usuário.')
            return jsonResponse({ error: 'Não foi possível confirmar a criação dos dados de acesso. Atualize a lista antes de tentar novamente.' }, 500, corsHeaders)
        }

        const { data: createdProfile, error: createProfileError } = await adminClient
            .from('users')
            .insert({
                id: authUserId,
                name,
                email,
                role,
                bakery_id: role === 'owner' ? null : cashierBakeryId,
                // A coluna bakery_ids alimenta as políticas RLS via user_bakeries;
                // gravar apenas o bakery_id legado deixa o operador sem unidades e
                // todo acesso RLS dele cai com 42501.
                bakery_ids: role === 'owner' || !cashierBakeryId ? null : [cashierBakeryId],
            })
            .select('id, name, email, role, bakery_id, bakery_ids')
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
                return jsonResponse({ error: 'Não foi possível concluir o cadastro nem confirmar a remoção dos dados de acesso criados. Solicite ajuda ao suporte antes de tentar novamente.' }, 500, corsHeaders)
            }

            console.error('Falha ao criar o perfil do novo usuário.', createProfileError?.code)
            return jsonResponse({ error: 'Não foi possível concluir o cadastro nem confirmar a remoção dos dados de acesso criados. Solicite ajuda ao suporte antes de tentar novamente.' }, 500, corsHeaders)
        }

        return jsonResponse({
            user: {
                id: createdProfile.id,
                name: createdProfile.name,
                email: createdProfile.email,
                role: createdProfile.role,
                bakery_id: createdProfile.bakery_id,
                bakery_ids: createdProfile.bakery_ids,
            },
        }, 201, corsHeaders)
    } catch (error) {
        console.error('Falha interna na Edge Function admin-users.', error instanceof Error ? error.name : 'UnknownError')
        return jsonResponse({ error: 'Ocorreu um problema inesperado. Tente novamente mais tarde ou solicite ajuda ao suporte.' }, 500, corsHeaders)
    }
})
