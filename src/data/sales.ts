import { getSupabaseClient } from '../lib/supabaseClient'
import { isNetworkError, reportNetworkFailure } from '../services/connection'
import type { PaymentMethod, Sale } from '../types/Sale'

/**
 * Soma das vendas pagas em dinheiro de um caixa (sessão).
 *
 * O mesmo cálculo é feito pelo servidor em `close_cash_register`, mas aqui
 * precisamos do valor antes/depois do fechamento para compor o comprovante.
 * A política de leitura permite que o caixaier consulte as vendas da própria
 * unidade.
 */
export async function getCashSalesTotalForRegister(cashRegisterId: string): Promise<number> {
    try {
        const { data, error } = await getSupabaseClient()
            .from('sales')
            .select('total')
            .eq('cash_register_id', cashRegisterId)
            .eq('payment_method', 'cash')

        if (error) {
            console.error('Erro ao calcular as vendas em dinheiro do caixa.', error)
            return 0
        }

        return ((data ?? []) as Array<{ total: number | string }>).reduce(
            (sum, sale) => sum + Number(sale.total ?? 0),
            0,
        )
    } catch (error) {
        if (isNetworkError(error)) {
            reportNetworkFailure()
        }
        console.error('Falha ao calcular as vendas em dinheiro do caixa.', error)
        return 0
    }
}

type SaleRow = {
    id: string
    date: string
    bakery_id: string
    total: number | string
    payment_method: PaymentMethod
    received_amount: number | string | null
    change_amount: number | string | null
    sale_items: {
        id: string
        product_id: string | null
        name: string
        barcode: string
        price: number | string
        quantity: number
        subtotal: number | string
    }[]
}

export async function getSalesFromSupabase(): Promise<Sale[]> {
    let data
    try {
        const result = await getSupabaseClient()
            .from('sales')
            .select('id, date, bakery_id, total, payment_method, received_amount, change_amount, sale_items(id, product_id, name, barcode, price, quantity, subtotal)')
            .order('date', { ascending: false })
        data = result.data
        const { error } = result

        if (error) {
            console.error('Erro ao carregar o histórico de vendas.', error)
            if (error.code === '42501') {
                throw new Error('Seu acesso não permite consultar o histórico de vendas. Solicite ajuda ao proprietário.')
            }
            if (typeof error.code === 'string' && /^(5|PGRST5)/.test(error.code)) {
                throw new Error('O histórico de vendas está temporariamente indisponível. Tente novamente mais tarde.')
            }
            throw new Error('Não foi possível carregar o histórico de vendas. Atualize a tela e tente novamente.')
        }
    } catch (error) {
        if (isNetworkError(error)) {
            reportNetworkFailure()
        }
        if (error instanceof Error && error.message.startsWith('Seu acesso não permite')) throw error
        if (error instanceof Error && error.message.includes('temporariamente indisponível')) throw error
        if (error instanceof TypeError) {
            console.error('Falha de conexão ao carregar o histórico de vendas.', error)
            throw new Error('Não foi possível conectar ao sistema. Verifique sua conexão e tente novamente.', { cause: error })
        }
        if (error instanceof Error && error.message.startsWith('Não foi possível carregar o histórico')) throw error
        console.error('Falha inesperada ao carregar o histórico de vendas.', error)
        throw new Error('Não foi possível carregar o histórico de vendas. Atualize a tela e tente novamente.', { cause: error })
    }

    return ((data ?? []) as SaleRow[]).map((sale) => ({
        id: sale.id,
        date: sale.date,
        bakeryId: sale.bakery_id,
        total: Number(sale.total),
        paymentMethod: sale.payment_method,
        ...(sale.received_amount === null ? {} : { receivedAmount: Number(sale.received_amount) }),
        ...(sale.change_amount === null ? {} : { change: Number(sale.change_amount) }),
        items: sale.sale_items.map((item) => ({
            productId: item.product_id ?? '',
            name: item.name,
            barcode: item.barcode,
            price: Number(item.price),
            quantity: item.quantity,
            subtotal: Number(item.subtotal),
        })),
    }))
}
