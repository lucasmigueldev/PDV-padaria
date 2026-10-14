import { getSupabaseClient } from '../lib/supabaseClient'

import type { CashRegister } from '../types/CashRegister'
import type { PaymentMethod, SaleItemSnapshot } from '../types/Sale'

type SupabaseError = {
    code?: string
    message: string
}

function throwOperationError(error: SupabaseError, operation: string): never {
    console.error(`Erro na operação ${operation} no Supabase.`, error)

    if (error.code === '42501') {
        throw new Error('Você não tem permissão para executar esta operação.')
    }
    if (error.code === '23505') {
        throw new Error('Esta operação conflita com um registro existente.')
    }
    if (error.code === '23514') {
        throw new Error('A operação não pode ser concluída com o estado atual do caixa ou do estoque.')
    }
    if (error.code === '22023') {
        throw new Error('Os dados informados não são válidos para esta operação.')
    }

    throw new Error(`Não foi possível concluir ${operation}. Verifique a conexão e tente novamente.`)
}

function requireRpcId(data: unknown, operation: string): string {
    if (typeof data !== 'string' || !data) {
        throw new Error(`O Supabase não retornou o identificador esperado para ${operation}.`)
    }
    return data
}

export async function getOpenCashRegister(bakeryId: string): Promise<CashRegister | null> {
    const { data, error } = await getSupabaseClient()
        .from('cash_registers')
        .select('id, bakery_id, opened_at, initial_amount')
        .eq('bakery_id', bakeryId)
        .eq('status', 'open')
        .maybeSingle()

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
    const { data, error } = await client.rpc('open_cash_register', {
        p_initial_amount: initialAmount,
    })

    if (error) throwOperationError(error, 'abrir o caixa')

    const id = requireRpcId(data, 'abertura do caixa')
    const { data: register, error: loadError } = await client
        .from('cash_registers')
        .select('id, bakery_id, opened_at, initial_amount')
        .eq('id', id)
        .single()

    if (loadError) throwOperationError(loadError, 'carregar o caixa recém-aberto')

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
}): Promise<string> {
    const { data, error } = await getSupabaseClient().rpc('create_sale_with_items', {
        p_cash_register_id: input.cashRegisterId,
        p_payment_method: input.paymentMethod,
        p_received_amount: input.receivedAmount,
        p_change_amount: input.changeAmount,
        p_items: input.items.map((item) => ({
            product_id: item.productId,
            quantity: item.quantity,
        })),
        p_idempotency_key: input.idempotencyKey,
    })

    if (error) throwOperationError(error, 'registrar a venda')
    return requireRpcId(data, 'registro da venda')
}

export async function closeCashRegister(cashRegisterId: string, countedAmount: number): Promise<string> {
    const { data, error } = await getSupabaseClient().rpc('close_cash_register', {
        p_cash_register_id: cashRegisterId,
        p_counted_amount: countedAmount,
    })

    if (error) throwOperationError(error, 'fechar o caixa')
    return requireRpcId(data, 'fechamento do caixa')
}

export async function setProductStock(
    productId: string,
    bakeryId: string,
    operation: 'initialize' | 'set',
    quantity: number,
): Promise<number> {
    const { data, error } = await getSupabaseClient().rpc('set_product_stock', {
        p_product_id: productId,
        p_bakery_id: bakeryId,
        p_operation: operation,
        p_quantity: quantity,
    })

    if (error) throwOperationError(error, 'atualizar o estoque')
    if (typeof data !== 'number') {
        throw new Error('O Supabase não retornou a quantidade de estoque atualizada.')
    }
    return data
}

export async function createProductWithInitialStock(input: {
    name: string
    barcode: string
    price: number
    initialQuantity: number
}): Promise<string> {
    const { data, error } = await getSupabaseClient().rpc('create_product_with_initial_stock', {
        p_name: input.name,
        p_barcode: input.barcode,
        p_price: input.price,
        p_initial_quantity: input.initialQuantity,
    })

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
    const { data, error } = await getSupabaseClient().rpc('update_product_with_stock', {
        p_product_id: input.productId,
        p_name: input.name,
        p_barcode: input.barcode,
        p_price: input.price,
        p_quantity: input.quantity,
    })

    if (error) throwOperationError(error, 'atualizar o produto e o estoque')
    return requireRpcId(data, 'atualização do produto')
}
