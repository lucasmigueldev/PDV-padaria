export interface Product {
    id: string
    barcode: string
    name: string
    price: number
}

export interface ProductStock {
    productId: string
    bakeryId: string
    quantity: number
}

export interface ProductWithStock extends Product {
    stock: number
}

export interface SaleItem extends ProductWithStock {
    quantity: number
}
