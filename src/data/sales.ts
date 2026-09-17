import type { Sale } from '../types/Sale'

const STORAGE_KEY = 'padaria-pdv-sales'

export function getSales(): Sale[] {
    const storedSales = localStorage.getItem(STORAGE_KEY)

    if (!storedSales) return []

    try {
        const parsedSales = JSON.parse(storedSales) as Sale[]
        return Array.isArray(parsedSales) ? parsedSales : []
    } catch {
        return []
    }
}

export function saveSale(sale: Sale): Sale {
    const sales = getSales()
    sales.push(sale)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sales))
    return sale
}

export function deleteSale(id: string): void {
    const sales = getSales().filter((sale) => sale.id !== id)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sales))
}
