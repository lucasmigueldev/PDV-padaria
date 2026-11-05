import { getSupabaseClient } from '../lib/supabaseClient'

export interface CashShortfallAlert {
    closureId: string
    bakeryId: string
    bakeryName: string
    operatorName: string | null
    closedAt: string
    expectedAmount: number
    countedAmount: number
    shortageAmount: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getString(value: unknown, field: string): string {
    if (typeof value !== 'string' || value.length === 0) {
        throw new Error(`O alerta de falta no caixa retornou ${field} inválido.`)
    }
    return value
}

function getAmount(value: unknown, field: string): number {
    const amount = typeof value === 'number' || typeof value === 'string'
        ? Number(value)
        : Number.NaN
    if (!Number.isFinite(amount) || amount < 0) {
        throw new Error(`O alerta de falta no caixa retornou ${field} inválido.`)
    }
    return amount
}

export async function getPendingCashShortfallAlerts(): Promise<CashShortfallAlert[]> {
    const { data, error } = await getSupabaseClient()
        .rpc('get_pending_cash_shortfall_alerts')

    if (error) {
        console.error('Não foi possível consultar os alertas de falta no caixa.', error)
        throw new Error('Não foi possível consultar os alertas de falta no caixa.')
    }

    if (!Array.isArray(data)) {
        throw new Error('O sistema retornou uma lista inválida de alertas de falta no caixa.')
    }

    return data.map((value) => {
        if (!isRecord(value)) {
            throw new Error('O sistema retornou um alerta de falta no caixa inválido.')
        }
        const closedAt = getString(value.closed_at, 'horário do fechamento')
        if (!Number.isFinite(Date.parse(closedAt))) {
            throw new Error('O sistema retornou um horário de fechamento inválido.')
        }
        return {
            closureId: getString(value.closure_id, 'identificador do fechamento'),
            bakeryId: getString(value.bakery_id, 'identificador da padaria'),
            bakeryName: getString(value.bakery_name, 'nome da padaria'),
            operatorName: typeof value.operator_name === 'string' && value.operator_name.length > 0
                ? value.operator_name
                : null,
            closedAt,
            expectedAmount: getAmount(value.expected_amount, 'valor esperado'),
            countedAmount: getAmount(value.counted_amount, 'valor contado'),
            shortageAmount: getAmount(value.shortage_amount, 'valor da falta'),
        }
    })
}

export async function acknowledgeCashShortfallAlert(closureId: string): Promise<void> {
    const { data, error } = await getSupabaseClient()
        .rpc('acknowledge_cash_shortfall_alert', {
            p_closure_id: closureId,
        })

    if (error || data !== true) {
        console.error('Não foi possível confirmar a leitura do alerta de falta no caixa.', error ?? data)
        throw new Error('Não foi possível confirmar a leitura. O alerta continuará pendente; tente novamente.')
    }
}
