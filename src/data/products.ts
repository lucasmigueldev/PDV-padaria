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

type ProductDataError = {
    code?: string
    message: string
}

function getProductDataError(error: ProductDataError, action: string): Error {
    console.error(`Erro ao ${action} produtos ou estoque.`, error)

    if (error.code === '42501') {
        return new Error('Seu acesso não permite consultar ou alterar produtos nesta unidade. Solicite ajuda ao proprietário.')
    }
    if (error.code === '23505' && /barcode/i.test(error.message)) {
        return new Error('Já existe um produto cadastrado com este código de barras.')
    }
    if (action === 'excluir' && error.code === '23503') {
        return new Error('O produto possui registros associados e não pode ser excluído.')
    }

    return new Error(`Não foi possível ${action} produtos ou estoque. Atualize a tela e tente novamente.`)
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
        throw getProductDataError(productError, 'carregar')
    }
    if (stockError) {
        throw getProductDataError(stockError, 'carregar')
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
        throw getProductDataError(error, 'excluir')
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
        throw new Error('O produto foi salvo, mas não foi possível atualizar os dados exibidos. Atualize a lista antes de tentar novamente, para evitar duplicidades.')
    }
    if (stockError) {
        console.error('Erro ao carregar o estoque salvo no Supabase.', stockError)
        throw new Error('O produto foi salvo, mas não foi possível atualizar o estoque exibido. Atualize a lista antes de tentar novamente.')
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
