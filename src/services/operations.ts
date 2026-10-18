import { getSupabaseClient } from '../lib/supabaseClient'
import { isNetworkError, reportNetworkFailure } from './connection'

import type { CashRegister } from '../types/CashRegister'
import type { PaymentMethod, SaleItemSnapshot } from '../types/Sale'

type SupabaseError = {
    code?: string
    message: string
}

function getUnexpectedOperationError(error: unknown, operation: string): Error {
    console.error(`Falha inesperada ao ${operation}.`, error)
    return new Error(`Não foi possível ${operation}. Tente novamente. Se o problema continuar, solicite ajuda ao proprietário.`)
}

function throwOperationError(error: SupabaseError, operation: string): never {
    console.error(`Erro na operação ${operation} no Supabase.`, error)
    if (isNetworkError(error)) {
        reportNetworkFailure()
        throw new Error('Não foi possível conectar ao sistema. Verifique sua conexão e tente novamente.', { cause: error })
    }
    const message = error.message.toLowerCase()

    if (error.code === '42501') {
        if (operation.includes('produto')) {
            throw new Error(operation.includes('atualizar')
                ? 'Seu acesso não permite alterar produtos nesta unidade. Solicite ajuda ao proprietário.'
                : 'Seu acesso não permite cadastrar produtos nesta unidade. Solicite ajuda ao proprietário.')
        }
        throw new Error('Seu acesso não permite realizar esta operação. Se precisar de ajuda, solicite ao proprietário.')
    }
    if (error.code === '23505') {
        if (operation.includes('produto') && /barcode/i.test(message)) {
            throw new Error('Já existe um produto cadastrado com este código de barras.')
        }
        if (message.includes('already has an open cash register')) {
            throw new Error('Já existe um caixa aberto nesta unidade.')
        }
        if (message.includes('already has a closure')) {
            throw new Error('Este caixa já foi fechado. Atualize os dados antes de continuar.')
        }
        if (message.includes('stock is already initialized')) {
            throw new Error('O estoque deste produto já foi configurado com outra quantidade. Atualize os dados e tente novamente.')
        }
        throw new Error('Já existe um registro que impede concluir esta operação. Atualize os dados e tente novamente.')
    }
    if (error.code === '23514') {
        if (message.includes('insufficient stock')) {
            throw new Error('Estoque insuficiente para concluir a venda. Atualize o estoque ou ajuste as quantidades.')
        }
        if (message.includes('no open cash register')) {
            throw new Error('Não há caixa aberto nesta unidade. Abra o caixa para continuar.')
        }
        if (message.includes('stock row')) {
            throw new Error('O estoque de um dos produtos não está configurado. Atualize os dados ou solicite ajuda ao proprietário.')
        }
        throw new Error('Não foi possível concluir a operação com os dados atuais. Confira os valores informados e tente novamente.')
    }
    if (error.code === '22023') {
        if (operation.includes('produto')) {
            throw new Error('Confira o nome, o código de barras, o preço e o estoque informados.')
        }
        if (message.includes('initial amount') || message.includes('counted amount')) {
            throw new Error('Informe um valor de caixa válido, com até duas casas decimais e sem valor negativo.')
        }
        if (message.includes('cash received') || message.includes('change')) {
            throw new Error('Confira o valor recebido e o troco informado.')
        }
        if (message.includes('quantity')) {
            throw new Error('Informe uma quantidade inteira maior que zero.')
        }
        throw new Error('Confira os dados informados e tente novamente.')
    }
    if (error.code === '23503') {
        throw new Error('O produto ou a unidade não está disponível para esta operação. Atualize os dados e tente novamente.')
    }

    throw new Error(`Não foi possível ${operation}. Tente novamente. Se o problema continuar, solicite ajuda ao proprietário.`)
}

function requireRpcId(data: unknown, operation: string): string {
    if (typeof data !== 'string' || !data) {
        if (operation === 'registro da venda') {
            throw new Error('Não foi possível confirmar se a venda foi registrada. Consulte o histórico de vendas antes de tentar novamente, para evitar duplicidade.')
        }
        throw new Error(`Não foi possível confirmar ${operation}. Atualize os dados antes de tentar novamente.`)
    }
    return data
}

export async function getOpenCashRegister(bakeryId: string): Promise<CashRegister | null> {
    const client = getSupabaseClient()
    let result
    try {
        result = await client
            .from('cash_registers')
            .select('id, bakery_id, opened_at, initial_amount')
            .eq('bakery_id', bakeryId)
            .eq('status', 'open')
            .maybeSingle()
    } catch (error) {
        throw getUnexpectedOperationError(error, 'carregar o caixa aberto')
    }
    const { data, error } = result

    if (error) throwOperationError(error, 'carregar o caixa aberto')
    if (!data) return null

    return {
        id: data.id,
        bakeryId: data.bakery_id,
        openedAt: data.opened_at,
        initialAmount: Number(data.initial_amount),
    }
}

export async function openCashRegister(initialAmount: number): Promise<CashRegister> {
    const client = getSupabaseClient()
    let result
    try {
        result = await client.rpc('open_cash_register', {
            p_initial_amount: initialAmount,
        })
    } catch (requestError) {
        if (isNetworkError(requestError)) {
            reportNetworkFailure()
        }
        console.error('Não foi possível confirmar o resultado da abertura do caixa.', requestError)
        throw new Error('Não foi possível confirmar se o caixa foi aberto. Atualize os dados do caixa antes de tentar novamente.', { cause: requestError })
    }
    const { data, error } = result

    if (error) throwOperationError(error, 'abrir o caixa')

    const id = requireRpcId(data, 'abertura do caixa')
    let registerResult
    try {
        registerResult = await client
            .from('cash_registers')
            .select('id, bakery_id, opened_at, initial_amount')
            .eq('id', id)
            .single()
    } catch (loadError) {
        console.error('O caixa foi aberto, mas não foi possível carregar os dados do registro.', loadError)
        throw new Error('O caixa foi aberto, mas não foi possível carregar seus dados. Atualize a tela antes de tentar novamente.', { cause: loadError })
    }
    const { data: register, error: loadError } = registerResult

    if (loadError) {
        console.error('O caixa foi aberto, mas não foi possível carregar os dados do registro.', loadError)
        throw new Error('O caixa foi aberto, mas não foi possível carregar seus dados. Atualize a tela antes de tentar novamente.')
    }

    return {
        id: register.id,
        bakeryId: register.bakery_id,
        openedAt: register.opened_at,
        initialAmount: Number(register.initial_amount),
    }
}

export async function createSaleWithItems(input: {
    cashRegisterId: string
    paymentMethod: PaymentMethod
    receivedAmount: number | null
    changeAmount: number | null
    items: Pick<SaleItemSnapshot, 'productId' | 'quantity'>[]
    idempotencyKey: string
    occurredAt?: string | null
}): Promise<string> {
    let client: ReturnType<typeof getSupabaseClient>
    try {
        client = getSupabaseClient()
    } catch (error) {
        throw getUnexpectedOperationError(error, 'iniciar o registro da venda')
    }

    let data: unknown
    let error: SupabaseError | null

    try {
        ({ data, error } = await client.rpc('create_sale_with_items', {
            p_cash_register_id: input.cashRegisterId,
            p_payment_method: input.paymentMethod,
            p_received_amount: input.receivedAmount,
            p_change_amount: input.changeAmount,
            p_items: input.items.map((item) => ({
                product_id: item.productId,
                quantity: item.quantity,
            })),
            p_idempotency_key: input.idempotencyKey,
        }))
    } catch (requestError) {
        if (isNetworkError(requestError)) {
            reportNetworkFailure()
        }
        console.error('Não foi possível confirmar o resultado do registro da venda.', requestError)
        throw new Error(
            'Não foi possível confirmar se a venda foi registrada. Consulte o histórico de vendas antes de tentar novamente, para evitar duplicidade.',
            { cause: requestError },
        )
    }

    if (error) throwOperationError(error, 'registrar a venda')
    return requireRpcId(data, 'registro da venda')
}

export async function closeCashRegister(cashRegisterId: string, countedAmount: number): Promise<string> {
    const client = getSupabaseClient()
    let result
    try {
        result = await client.rpc('close_cash_register', {
            p_cash_register_id: cashRegisterId,
            p_counted_amount: countedAmount,
        })
    } catch (requestError) {
        if (isNetworkError(requestError)) {
            reportNetworkFailure()
        }
        console.error('Não foi possível confirmar o resultado do fechamento do caixa.', requestError)
        throw new Error('Não foi possível confirmar se o caixa foi fechado. Consulte o histórico de fechamentos antes de tentar novamente.', { cause: requestError })
    }
    const { data, error } = result

    if (error) throwOperationError(error, 'fechar o caixa')
    return requireRpcId(data, 'fechamento do caixa')
}

export async function setProductStock(
    productId: string,
    bakeryId: string,
    operation: 'initialize' | 'set',
    quantity: number,
): Promise<number> {
    const client = getSupabaseClient()
    let result
    try {
        result = await client.rpc('set_product_stock', {
            p_product_id: productId,
            p_bakery_id: bakeryId,
            p_operation: operation,
            p_quantity: quantity,
        })
    } catch (requestError) {
        if (isNetworkError(requestError)) {
            reportNetworkFailure()
        }
        console.error('Não foi possível confirmar o resultado da atualização do estoque.', requestError)
        throw new Error('Não foi possível confirmar se o estoque foi atualizado. Atualize os dados antes de tentar novamente.', { cause: requestError })
    }
    const { data, error } = result

    if (error) throwOperationError(error, 'atualizar o estoque')
    if (typeof data !== 'number') {
        throw new Error('Não foi possível confirmar a atualização do estoque. Atualize os dados antes de tentar novamente.')
    }
    return data
}

export async function createProductWithInitialStock(input: {
    name: string
    barcode: string
    price: number
    initialQuantity: number
}): Promise<string> {
    const client = getSupabaseClient()
    let result
    try {
        result = await client.rpc('create_product_with_initial_stock', {
            p_name: input.name,
            p_barcode: input.barcode,
            p_price: input.price,
            p_initial_quantity: input.initialQuantity,
        })
    } catch (requestError) {
        if (isNetworkError(requestError)) {
            reportNetworkFailure()
        }
        console.error('Não foi possível confirmar o resultado do cadastro do produto.', requestError)
        throw new Error('Não foi possível confirmar se o produto foi cadastrado. Atualize a lista antes de tentar novamente, para evitar duplicidades.', { cause: requestError })
    }
    const { data, error } = result

    if (error) throwOperationError(error, 'cadastrar o produto e o estoque inicial')
    return requireRpcId(data, 'cadastro do produto')
}

export async function updateProductWithStock(input: {
    productId: string
    name: string
    barcode: string
    price: number
    quantity: number
}): Promise<string> {
    const client = getSupabaseClient()
    let result
    try {
        result = await client.rpc('update_product_with_stock', {
            p_product_id: input.productId,
            p_name: input.name,
            p_barcode: input.barcode,
            p_price: input.price,
            p_quantity: input.quantity,
        })
    } catch (requestError) {
        if (isNetworkError(requestError)) {
            reportNetworkFailure()
        }
        console.error('Não foi possível confirmar o resultado da atualização do produto.', requestError)
        throw new Error('Não foi possível confirmar se o produto foi atualizado. Atualize a lista antes de tentar novamente.', { cause: requestError })
    }
    const { data, error } = result

    if (error) throwOperationError(error, 'atualizar o produto e o estoque')
    return requireRpcId(data, 'atualização do produto')
}
