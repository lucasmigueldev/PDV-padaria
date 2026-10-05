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

    if (error.code === '23505') throw new Error('Esta unidade já está cadastrada.')
    if (error.code === '42501') throw new Error('Você não tem permissão para alterar unidades.')

    throw new Error(operation === 'carregar'
        ? 'Não foi possível carregar as unidades.'
        : 'Não foi possível salvar a unidade.')
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
    if (!data) throw new Error('A unidade não foi encontrada ou você não tem permissão para alterá-la.')

    return mapBakery(data as BakeryRecord)
}