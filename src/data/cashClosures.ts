import { getSupabaseClient } from '../lib/supabaseClient'
import type { CashClosure } from '../types/CashClosure'

type ClosureRow = {
    id: string
    bakery_id: string
    cash_register_id: string
    closed_at: string
    counted_amount: number | string
    expected_amount: number | string
    difference_amount: number | string
    cash_sales_amount: number | string
}

type RegisterRow = {
    id: string
    opened_at: string
    initial_amount: number | string
}

export async function getCashClosuresFromSupabase(): Promise<CashClosure[]> {
    const client = getSupabaseClient()
    const { data: closureRows, error: closuresError } = await client
        .from('cash_closures')
        .select('id, bakery_id, cash_register_id, closed_at, counted_amount, expected_amount, difference_amount, cash_sales_amount')
        .order('closed_at', { ascending: false })

    if (closuresError) {
        console.error('Erro ao carregar fechamentos do Supabase.', closuresError)
        throw new Error('Não foi possível carregar o histórico de fechamentos.')
    }

    const closures = (closureRows ?? []) as ClosureRow[]
    if (closures.length === 0) return []

    const registerIds = [...new Set(closures.map((closure) => closure.cash_register_id))]
    const { data: registerRows, error: registersError } = await client
        .from('cash_registers')
        .select('id, opened_at, initial_amount')
        .in('id', registerIds)

    if (registersError) {
        console.error('Erro ao carregar caixas dos fechamentos no Supabase.', registersError)
        throw new Error('Não foi possível carregar os dados dos caixas fechados.')
    }

    const registersById = new Map(
        ((registerRows ?? []) as RegisterRow[]).map((register) => [register.id, register]),
    )

    return closures.map((closure) => {
        const register = registersById.get(closure.cash_register_id)
        if (!register) {
            const error = new Error('Um fechamento retornado pelo Supabase não possui caixa correspondente.')
            console.error(error.message, {
                closureId: closure.id,
                cashRegisterId: closure.cash_register_id,
            })
            throw error
        }

        return {
            id: closure.id,
            bakeryId: closure.bakery_id,
            openedAt: register.opened_at,
            initialAmount: Number(register.initial_amount),
            closedAt: closure.closed_at,
            countedAmount: Number(closure.counted_amount),
            expectedAmount: Number(closure.expected_amount),
            differenceAmount: Number(closure.difference_amount),
            cashSalesAmount: Number(closure.cash_sales_amount),
        }
    })
}
