import { getSupabaseClient } from '../lib/supabaseClient'
import type { PaymentMethod, Sale } from '../types/Sale'

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
    const { data, error } = await getSupabaseClient()
        .from('sales')
        .select('id, date, bakery_id, total, payment_method, received_amount, change_amount, sale_items(id, product_id, name, barcode, price, quantity, subtotal)')
        .order('date', { ascending: false })

    if (error) {
        console.error('Erro ao carregar vendas do Supabase.', error)
        throw new Error('Não foi possível carregar o histórico de vendas.')
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
