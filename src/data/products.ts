import { createProductWithInitialStock, updateProductWithStock } from '../services/operations'
import { getSupabaseClient } from '../lib/supabaseClient'
import type { ProductWithStock } from '../types/Product'

type ProductRow = {
    id: string
    bakery_id: string
    name: string
    barcode: string
    price: number | string
}

export function normalizeBarcode(value: string): string {
    return value.trim().replace(/\s/g, '')
}

export async function getProductsFromSupabase(bakeryId: string | null): Promise<ProductWithStock[]> {
    const client = getSupabaseClient()
    let productQuery = client
        .from('products')
        .select('id, bakery_id, name, barcode, price')
        .order('name')

    if (bakeryId) productQuery = productQuery.eq('bakery_id', bakeryId)

    const [{ data: productRows, error: productError }, { data: stockRows, error: stockError }] =
        await Promise.all([
            productQuery,
            client.from('product_stock').select('product_id, bakery_id, quantity'),
        ])

    if (productError) {
        console.error('Erro ao carregar produtos do Supabase.', productError)
        throw new Error('Não foi possível carregar os produtos.')
    }
    if (stockError) {
        console.error('Erro ao carregar estoque do Supabase.', stockError)
        throw new Error('Não foi possível carregar o estoque.')
    }

    const stockByProduct = new Map<string, number>()
    for (const stock of stockRows ?? []) {
        if (!bakeryId || stock.bakery_id === bakeryId) {
            stockByProduct.set(stock.product_id, Number(stock.quantity))
        }
    }

    return ((productRows ?? []) as ProductRow[]).map((product) => ({
        id: product.id,
        bakeryId: product.bakery_id,
        name: product.name,
        barcode: product.barcode,
        price: Number(product.price),
        stock: stockByProduct.get(product.id) ?? 0,
    }))
}

export async function addProduct(input: {
    name: string
    barcode: string
    price: number
    stock: number
}): Promise<ProductWithStock> {
    const id = await createProductWithInitialStock({
        name: input.name,
        barcode: input.barcode,
        price: input.price,
        initialQuantity: input.stock,
    })

    return loadProduct(id)
}

export async function updateProduct(
    productId: string,
    input: { name: string; barcode: string; price: number; stock: number },
): Promise<ProductWithStock> {
    const id = await updateProductWithStock({
        productId,
        name: input.name,
        barcode: input.barcode,
        price: input.price,
        quantity: input.stock,
    })

    return loadProduct(id)
}

export async function deleteProduct(productId: string): Promise<void> {
    const { error } = await getSupabaseClient().from('products').delete().eq('id', productId)
    if (error) {
        console.error('Erro ao excluir produto do Supabase.', error)
        throw new Error('Não foi possível excluir o produto.')
    }
}

async function loadProduct(productId: string): Promise<ProductWithStock> {
    const client = getSupabaseClient()
    const [{ data: product, error: productError }, { data: stock, error: stockError }] = await Promise.all([
        client
            .from('products')
            .select('id, bakery_id, name, barcode, price')
            .eq('id', productId)
            .single(),
        client
            .from('product_stock')
            .select('quantity')
            .eq('product_id', productId)
            .maybeSingle(),
    ])

    if (productError) {
        console.error('Erro ao carregar o produto salvo no Supabase.', productError)
        throw new Error('O produto foi salvo, mas não foi possível recarregá-lo.')
    }
    if (stockError) {
        console.error('Erro ao carregar o estoque salvo no Supabase.', stockError)
        throw new Error('O produto foi salvo, mas não foi possível recarregar seu estoque.')
    }

    return {
        id: product.id,
        bakeryId: product.bakery_id,
        name: product.name,
        barcode: product.barcode,
        price: Number(product.price),
        stock: Number(stock?.quantity ?? 0),
    }
}
