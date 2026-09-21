export type PaymentMethod = 'cash' | 'pix' | 'card'

export interface SaleItemSnapshot {
    productId: string
    name: string
    barcode: string
    price: number
    quantity: number
    subtotal: number
}

export interface Sale {
    id: string
    date: string
    items: SaleItemSnapshot[]
    total: number
    paymentMethod: PaymentMethod
    bakeryId: string
    receivedAmount?: number
    change?: number
}
