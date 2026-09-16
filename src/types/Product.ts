export interface Product {
    id: string
    barcode: string
    name: string
    price: number
    stock: number
}

export interface SaleItem extends Product {
    quantity: number
}
