import { getSupabaseClient } from '../lib/supabaseClient.ts'

export interface OverdueCashRegisterAlert {
    cashRegisterId: string
    bakeryId: string
    bakeryName: string
    operatorName: string | null
    openedAt: string
    deadlineAt: string
    overdueSeconds: number
}

export function selectVisibleOverdueCashRegisterAlert(
    alerts: readonly OverdueCashRegisterAlert[],
    dismissedCashRegisterIds: ReadonlySet<string>,
): OverdueCashRegisterAlert | null {
    return alerts.find((alert) => !dismissedCashRegisterIds.has(alert.cashRegisterId)) ?? null
}

export function formatOverdueDuration(seconds: number): string {
    if (seconds < 60) return 'menos de 1 min'

    const totalMinutes = Math.floor(seconds / 60)
    const days = Math.floor(totalMinutes / 1440)
    const hours = Math.floor((totalMinutes % 1440) / 60)
    const minutes = totalMinutes % 60
    return [
        days > 0 ? `${days} d` : '',
        hours > 0 ? `${hours} h` : '',
        minutes > 0 ? `${minutes} min` : '',
    ].filter(Boolean).join(' ')
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getString(value: unknown, field: string): string {
    if (typeof value !== 'string' || value.length === 0) {
        throw new Error(`O alerta de caixa atrasado retornou ${field} inválido.`)
    }
    return value
}

function getTimestamp(value: unknown, field: string): string {
    const timestamp = getString(value, field)
    if (!Number.isFinite(Date.parse(timestamp))) {
        throw new Error(`O alerta de caixa atrasado retornou ${field} inválido.`)
    }
    return timestamp
}

export async function getOverdueCashRegisterAlerts(): Promise<OverdueCashRegisterAlert[]> {
    const { data, error } = await getSupabaseClient()
        .rpc('get_overdue_cash_register_alerts')

    if (error) {
        console.error('Não foi possível consultar os alertas de caixas atrasados.', error)
        throw new Error('Não foi possível consultar os alertas de caixas atrasados.')
    }

    if (!Array.isArray(data)) {
        throw new Error('O sistema retornou uma lista inválida de caixas atrasados.')
    }

    return data.map((value) => {
        if (!isRecord(value)) {
            throw new Error('O sistema retornou um alerta de caixa atrasado inválido.')
        }

        const overdueSeconds = typeof value.overdue_seconds === 'number' || typeof value.overdue_seconds === 'string'
            ? Number(value.overdue_seconds)
            : Number.NaN
        if (!Number.isSafeInteger(overdueSeconds) || overdueSeconds < 0) {
            throw new Error('O alerta de caixa atrasado retornou um tempo de atraso inválido.')
        }

        return {
            cashRegisterId: getString(value.cash_register_id, 'identificador do caixa'),
            bakeryId: getString(value.bakery_id, 'identificador da padaria'),
            bakeryName: getString(value.bakery_name, 'nome da padaria'),
            operatorName: typeof value.operator_name === 'string' && value.operator_name.length > 0
                ? value.operator_name
                : null,
            openedAt: getTimestamp(value.opened_at, 'horário de abertura'),
            deadlineAt: getTimestamp(value.deadline_at, 'horário limite'),
            overdueSeconds,
        }
    })
}
