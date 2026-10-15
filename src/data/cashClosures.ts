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
    let closures: ClosureRow[]
    let registersById: Map<string, RegisterRow>

    try {
        const client = getSupabaseClient()
        const { data: closureRows, error: closuresError } = await client
            .from('cash_closures')
            .select('id, bakery_id, cash_register_id, closed_at, counted_amount, expected_amount, difference_amount, cash_sales_amount')
            .order('closed_at', { ascending: false })

        if (closuresError) {
            console.error('Erro ao carregar o histórico de fechamentos.', closuresError)
            if (closuresError.code === '42501') {
                throw new Error('Seu acesso não permite consultar o histórico de fechamentos. Solicite ajuda ao proprietário.')
            }
            if (typeof closuresError.code === 'string' && /^(5|PGRST5)/.test(closuresError.code)) {
                throw new Error('O histórico de fechamentos está temporariamente indisponível. Tente novamente mais tarde.')
            }
            throw new Error('Não foi possível carregar o histórico de fechamentos. Atualize a tela e tente novamente.')
        }

        closures = (closureRows ?? []) as ClosureRow[]
        if (closures.length === 0) return []

        const registerIds = [...new Set(closures.map((closure) => closure.cash_register_id))]
        const { data: registerRows, error: registersError } = await client
            .from('cash_registers')
            .select('id, opened_at, initial_amount')
            .in('id', registerIds)

        if (registersError) {
            console.error('Erro ao carregar os dados dos caixas fechados.', registersError)
            if (registersError.code === '42501') {
                throw new Error('Seu acesso não permite consultar os dados dos caixas. Solicite ajuda ao proprietário.')
            }
            throw new Error('Não foi possível carregar os dados dos caixas fechados. Atualize a tela e tente novamente.')
        }

        registersById = new Map(
            ((registerRows ?? []) as RegisterRow[]).map((register) => [register.id, register]),
        )
    } catch (error) {
        if (error instanceof Error && /^(Seu acesso|Não foi possível carregar|O histórico)/.test(error.message)) {
            throw error
        }
        if (error instanceof TypeError) {
            console.error('Falha de conexão ao carregar o histórico de fechamentos.', error)
            throw new Error('Não foi possível conectar ao sistema. Verifique sua conexão e tente novamente.', { cause: error })
        }
        console.error('Falha inesperada ao carregar o histórico de fechamentos.', error)
        throw new Error('Não foi possível carregar o histórico de fechamentos. Atualize a tela e tente novamente.', { cause: error })
    }

    return closures.map((closure) => {
        const register = registersById.get(closure.cash_register_id)
        if (!register) {
            const error = new Error('Não foi possível carregar todos os dados deste fechamento. Atualize o histórico e tente novamente.')
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
