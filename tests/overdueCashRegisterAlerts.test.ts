import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
    formatOverdueDuration,
    selectVisibleOverdueCashRegisterAlert,
    type OverdueCashRegisterAlert,
} from '../src/services/overdueCashRegisterAlerts.ts'

const migration = readFileSync(
    new URL('../supabase/migrations/20261102210000_add_cash_register_deadline_monitoring.sql', import.meta.url),
    'utf8',
)
const bakeryService = readFileSync(new URL('../src/services/bakeries.ts', import.meta.url), 'utf8')
const settings = readFileSync(new URL('../src/pages/Configuracoes/Configuracoes.tsx', import.meta.url), 'utf8')
const manager = readFileSync(
    new URL('../src/components/CashShortfallAlertManager/CashShortfallAlertManager.tsx', import.meta.url),
    'utf8',
)
const dashboard = readFileSync(new URL('../src/pages/Dashboard/Dashboard.tsx', import.meta.url), 'utf8')
const dashboardStyles = readFileSync(new URL('../src/pages/Dashboard/Dashborad.css', import.meta.url), 'utf8')
const alertProvider = readFileSync(
    new URL('../src/contexts/OverdueCashRegisterAlertProvider.tsx', import.meta.url),
    'utf8',
)

const saoPauloFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
})

function getSaoPauloParts(timestamp: number): Record<string, number> {
    return Object.fromEntries(
        saoPauloFormatter.formatToParts(timestamp)
            .filter((part) => part.type !== 'literal')
            .map((part) => [part.type, Number(part.value)]),
    )
}

function instantForSaoPauloHour(year: number, month: number, day: number, hour: number): number {
    const localAsUtc = Date.UTC(year, month - 1, day, hour)
    let instant = localAsUtc
    for (let attempt = 0; attempt < 3; attempt++) {
        const parts = getSaoPauloParts(instant)
        const representedAsUtc = Date.UTC(
            parts.year,
            parts.month - 1,
            parts.day,
            parts.hour,
            parts.minute,
            parts.second,
        )
        instant = localAsUtc - (representedAsUtc - instant)
    }
    return instant
}

function expectedNextDeadline(openedAt: string, deadlineHour: number): string {
    const openedTimestamp = Date.parse(openedAt)
    const local = getSaoPauloParts(openedTimestamp)
    let deadline = instantForSaoPauloHour(local.year, local.month, local.day, deadlineHour)
    if (deadline <= openedTimestamp) {
        const nextDay = new Date(Date.UTC(local.year, local.month - 1, local.day + 1))
        deadline = instantForSaoPauloHour(
            nextDay.getUTCFullYear(),
            nextDay.getUTCMonth() + 1,
            nextDay.getUTCDate(),
            deadlineHour,
        )
    }
    return new Date(deadline).toISOString()
}

const overdueAlert: OverdueCashRegisterAlert = {
    cashRegisterId: 'register-1',
    bakeryId: 'bakery-1',
    bakeryName: 'Padaria Central',
    operatorName: 'Operador',
    openedAt: '2026-11-02T21:00:00.000Z',
    deadlineAt: '2026-11-03T21:00:00.000Z',
    overdueSeconds: 3660,
}

test('deadline is the first configured Sao Paulo hour strictly after opening', () => {
    assert.match(migration, /AT TIME ZONE 'America\/Sao_Paulo'/)
    assert.match(migration, /deadline_local <= local_deadline\.opened_local/)
    assert.match(migration, /deadline_local \+ interval '1 day'/)
    assert.match(migration, /register_deadlines\.deadline_at <= v_now/)

    assert.equal(
        expectedNextDeadline('2026-11-02T18:00:00-03:00', 18),
        '2026-11-03T21:00:00.000Z',
    )
    assert.equal(
        expectedNextDeadline('2026-11-02T23:40:00-03:00', 6),
        '2026-11-03T09:00:00.000Z',
    )
    assert.equal(
        expectedNextDeadline('2026-11-02T04:30:00.000Z', 2),
        '2026-11-02T05:00:00.000Z',
    )
})

test('monitoring is opt-in and configuration writes are bakery-scoped', () => {
    assert.match(migration, /cash_register_monitoring_enabled boolean NOT NULL DEFAULT false/)
    assert.match(migration, /cash_register_deadline_hour smallint/)
    assert.match(migration, /cash_register_deadline_hour BETWEEN 0 AND 23/)
    assert.match(migration, /cash_register_monitoring_enabled IS FALSE[\s\S]+?cash_register_deadline_hour IS NOT NULL/)
    assert.match(settings, /cashRegisterMonitoringEnabled: false/)
    assert.match(settings, /cashRegisterDeadlineHour: ''/)
    assert.match(bakeryService, /\.eq\('id', id\)/)
    assert.match(bakeryService, /cash_register_monitoring_enabled: bakery\.cashRegisterMonitoringEnabled/)
    assert.match(bakeryService, /cash_register_deadline_hour: bakery\.cashRegisterDeadlineHour/)
})

test('overdue RPC is owner-only and returns only authorized open bakery registers', () => {
    assert.match(migration, /auth\.uid\(\)[\s\S]+?private\.is_owner\(\)/)
    assert.match(migration, /cash_register\.status = 'open'/)
    assert.match(migration, /cash_register\.bakery_id = ANY \([\s\S]+?private\.current_user_bakery_ids\(\)/)
    assert.match(migration, /REVOKE ALL ON FUNCTION public\.get_overdue_cash_register_alerts\(\)[\s\S]+?FROM PUBLIC, anon, authenticated/)
    assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.get_overdue_cash_register_alerts\(\)[\s\S]+?TO authenticated/)
    assert.doesNotMatch(migration, /UPDATE public\.(cash_registers|cash_closures|sales)|close_cash_register/)
})

test('dismissed alerts stay hidden until closed, and delay text is readable', () => {
    assert.equal(
        selectVisibleOverdueCashRegisterAlert([overdueAlert], new Set(['register-1'])),
        null,
    )
    assert.equal(
        selectVisibleOverdueCashRegisterAlert([], new Set(['register-1'])),
        null,
    )
    assert.equal(selectVisibleOverdueCashRegisterAlert([overdueAlert], new Set()), overdueAlert)
    assert.equal(formatOverdueDuration(30), 'menos de 1 min')
    assert.equal(formatOverdueDuration(3660), '1 h 1 min')
    assert.equal(formatOverdueDuration(176400), '2 d 1 h')

    assert.match(manager, /ALERT_POLL_INTERVAL_MS = 60_000/)
    assert.match(manager, /document\.visibilityState === 'visible'/)
    assert.match(manager, /setDismissedOverdueAlerts\(\(current\) => new Set\(current\)\.add/)
    assert.match(manager, /getOverdueCashRegisterAlerts\(\)/)
    assert.match(manager, /setAlertCount\(pendingOverdueAlerts\.length\)/)
    assert.match(manager, /getPendingCashShortfallAlerts\(\)/)
    assert.match(manager, /Contate o operador para sincronizar eventuais vendas pendentes/)
    assert.match(manager, /Este aviso não fecha o caixa/)
})

test('alerts wait for a resolved authorized admin session and can be reopened from the dashboard', () => {
    assert.match(manager, /const canMonitorAlerts = !isAuthLoading && isOwner && Boolean\(userId\) && isAdminArea/)
    assert.match(manager, /ADMIN_ALERT_PATHS\.has\(location\.pathname\)/)
    assert.match(manager, /if \(isLoadingRef\.current \|\| !canMonitorAlerts\) return/)
    assert.match(manager, /dismissedAlerts: dismissedOverdueAlerts/)
    assert.match(alertProvider, /const openDetails = useCallback\(\(\) => setDismissedAlerts\(new Set\(\)\)/)
    assert.match(dashboard, /overdueAlertCount > 0/)
    assert.match(dashboard, /overdueAlertCount === 1 \? 'caixa atrasado' : 'caixas atrasados'/)
    assert.match(dashboard, /onClick=\{openOverdueAlertDetails\}/)
    assert.match(dashboardStyles, /@media \(max-width: 430px\)/)
})
