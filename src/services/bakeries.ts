import { getSupabaseClient } from '../lib/supabaseClient'
import type { Bakery } from '../types/Bakery'

const bakeryFields = 'id, name, active'

type BakeryRecord = {
    id: string
    name: string
    active: boolean
}

function throwBakeryError(error: { code?: string; message: string }, operation: 'carregar' | 'salvar'): never {
    console.error(`Erro ao ${operation} unidades no Supabase.`, error)
    const message = error.message.toLowerCase()

    if (error.code === '23505') throw new Error('Esta unidade já está cadastrada.')
    if (error.code === '42501') {
        throw new Error('Seu acesso não permite alterar unidades. Solicite ajuda ao proprietário.')
    }
    if (error.code === '23514' && message.includes('cash register')) {
        throw new Error('Não é possível desativar esta unidade enquanto houver um caixa aberto. Feche o caixa primeiro.')
    }
    if (error.code === '23514' && /(stock|inventory)/i.test(message)) {
        throw new Error('Não é possível desativar esta unidade enquanto houver produtos com estoque. Zere os estoques primeiro.')
    }
    if (error.code === '23503') {
        throw new Error('A unidade selecionada não está mais disponível. Atualize a lista e tente novamente.')
    }

    throw new Error(operation === 'carregar'
        ? 'Não foi possível carregar as unidades. Atualize a tela e tente novamente.'
        : 'Não foi possível salvar as alterações da unidade. Confira os dados e tente novamente; se o problema continuar, solicite ajuda ao proprietário.')
}

function mapBakery(record: BakeryRecord): Bakery {
    return { id: record.id, name: record.name, active: record.active }
}

export async function getBakeries(): Promise<Bakery[]> {
    const { data, error } = await getSupabaseClient()
        .from('bakeries')
        .select(bakeryFields)
        .order('name')

    if (error) throwBakeryError(error, 'carregar')

    return (data as BakeryRecord[]).map(mapBakery)
}

export async function addBakery(bakery: Omit<Bakery, 'id'>): Promise<Bakery> {
    const name = bakery.name.trim()
    if (!name) throw new Error('Informe o nome da unidade.')

    const { data, error } = await getSupabaseClient()
        .from('bakeries')
        .insert({ name, active: bakery.active })
        .select(bakeryFields)
        .single()

    if (error) throwBakeryError(error, 'salvar')

    return mapBakery(data as BakeryRecord)
}

export async function updateBakery(id: string, bakery: Omit<Bakery, 'id'>): Promise<Bakery> {
    const name = bakery.name.trim()
    if (!name) throw new Error('Informe o nome da unidade.')

    const { data, error } = await getSupabaseClient()
        .from('bakeries')
        .update({ name, active: bakery.active })
        .eq('id', id)
        .select(bakeryFields)
        .maybeSingle()

    if (error) throwBakeryError(error, 'salvar')
    if (!data) {
        throw new Error('A unidade não está disponível para alteração. Atualize a lista e tente novamente.')
    }

    return mapBakery(data as BakeryRecord)
}