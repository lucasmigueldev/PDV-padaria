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
const alertProvider = readFileSync(
    new URL('../src/contexts/OverdueCashRegisterAlertProvider.tsx', import.meta.url),
    'utf8',
)
const pendingRegistersPage = readFileSync(
    new URL('../src/pages/CaixasPendentes/CaixasPendentes.tsx', import.meta.url),
    'utf8',
)
const pendingRegistersStyles = readFileSync(
    new URL('../src/pages/CaixasPendentes/CaixasPendentes.css', import.meta.url),
    'utf8',
)
const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
const mobileNav = readFileSync(
    new URL('../src/components/MobileBottomNav/MobileBottomNav.tsx', import.meta.url),
    'utf8',
)
const mobileNavStyles = readFileSync(
    new URL('../src/components/MobileBottomNav/MobileBottomNav.css', import.meta.url),
    'utf8',
)
const dashboardStyles = readFileSync(new URL('../src/pages/Dashboard/Dashborad.css', import.meta.url), 'utf8')
const pendingRegistersNav = readFileSync(
    new URL('../src/components/PendingRegistersNavigationLink/PendingRegistersNavigationLink.tsx', import.meta.url),
    'utf8',
)
const pendingRegistersNavStyles = readFileSync(
    new URL('../src/components/PendingRegistersNavigationLink/PendingRegistersNavigationLink.css', import.meta.url),
    'utf8',
)
const adminSidebar = readFileSync(
    new URL('../src/components/AdminSidebar/AdminSidebar.tsx', import.meta.url),
    'utf8',
)
const adminSidebarStyles = readFileSync(
    new URL('../src/components/AdminSidebar/AdminSidebar.css', import.meta.url),
    'utf8',
)
const adminPageHeader = readFileSync(
    new URL('../src/components/AdminPageHeader/AdminPageHeader.tsx', import.meta.url),
    'utf8',
)
const adminPageHeaderStyles = readFileSync(
    new URL('../src/components/AdminPageHeader/AdminPageHeader.css', import.meta.url),
    'utf8',
)
const products = readFileSync(new URL('../src/pages/Produtos/Produtos.tsx', import.meta.url), 'utf8')
const reports = readFileSync(new URL('../src/pages/Relatorios/Relatorios.tsx', import.meta.url), 'utf8')
const offlineReports = readFileSync(new URL('../src/pages/RelatorioOffline/RelatorioOffline.tsx', import.meta.url), 'utf8')
const closureHistory = readFileSync(
    new URL('../src/pages/HistoricoFechamentos/HistoricoFechamentos.tsx', import.meta.url),
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

test('alerts wait for an authorized admin session and dashboard notice has no navigation action', () => {
    assert.match(manager, /const canMonitorAlerts = !isAuthLoading && isOwner && Boolean\(userId\) && isAdminArea/)
    assert.match(manager, /ADMIN_ALERT_PATHS\.has\(location\.pathname\)/)
    assert.match(manager, /if \(isLoadingRef\.current \|\| !canMonitorAlerts\) return/)
    assert.match(manager, /dismissedAlerts: dismissedOverdueAlerts/)
    assert.match(dashboard, /overdueAlertCount > 0/)
    assert.match(dashboard, /overdueAlertCount === 1 \? 'caixa atrasado' : 'caixas atrasados'/)
    assert.doesNotMatch(dashboard, /Acessar Caixas Pendentes|dashboard-overdue-notice-link/)
    assert.doesNotMatch(dashboard.slice(dashboard.indexOf('dashboard-overdue-notice'), dashboard.indexOf('<div className="dashboard-filters">')),
        /openDetails|Ver detalhes|<Link/)
    assert.match(dashboardStyles, /dashboard-overdue-notice/)
})

test('pending registers page uses shared admin layout and reuses the shared alert list and modal', () => {
    assert.match(app, /path="\/caixas-pendentes"[\s\S]+?RoleRoute allowedRole="owner"/)
    assert.match(app, /RoleRoute allowedRole="owner" redirectTo="\/pdv" authenticatedUser=\{authenticatedUser\}/)
    assert.match(manager, /'\/caixas-pendentes'/)
    assert.match(adminSidebar, /PendingRegistersNavigationLink className="sidebar-link"/)
    assert.match(pendingRegistersPage, /useOverdueCashRegisterAlertContext\(\)/)
    assert.match(pendingRegistersPage, /alerts\.map\(\(alert\)/)
    assert.match(pendingRegistersPage, /openDetails\(alert\.cashRegisterId\)/)
    assert.match(pendingRegistersPage, /formatOverdueDuration\(alert\.overdueSeconds\)/)
    assert.match(pendingRegistersPage, /saoPauloDateTime\.format\(new Date\(alert\.openedAt\)\)/)
    assert.match(pendingRegistersPage, /saoPauloDateTime\.format\(new Date\(alert\.deadlineAt\)\)/)
    assert.match(alertProvider, /setRequestedAlertId\(cashRegisterId \?\? null\)/)
    assert.match(manager, /requestedOverdueAlert/)
    assert.match(manager, /setContextOverdueAlerts\(pendingOverdueAlerts\)/)
    assert.match(manager, /ALERT_POLL_INTERVAL_MS = 60_000/)
    assert.match(pendingRegistersPage, /<AdminSidebar user=\{authenticatedUser\} onLogout=\{handleLogout\} \/>/)
    assert.match(dashboard, /className="dashboard-main ml-64 min-h-screen flex-1"/)
    assert.match(dashboard, /className="dashboard-header flex items-center justify-between gap-6 bg-white px-10 py-7"/)
    assert.match(pendingRegistersPage, /<AdminPageHeader/)
    assert.match(adminSidebar, /location\.pathname === path/)
    assert.match(adminSidebar, /PendingRegistersNavigationLink className="sidebar-link"/)
    assert.match(adminSidebar, /to="\/configuracoes"/)
    assert.match(adminSidebarStyles, /\.admin-sidebar \{/)
    assert.doesNotMatch(adminSidebarStyles, /(^|\n)\.sidebar\s*\{/)
    assert.doesNotMatch(adminSidebarStyles, /(^|\n)\.(sidebar-logo|sidebar-menu|sidebar-link|logo-icon)\s*\{/)
    assert.doesNotMatch(adminSidebarStyles, /\.dashboard-layout|\.admin-layout|\.dashboard-main/)
    assert.match(adminSidebarStyles, /width: 250px/)
    assert.match(adminSidebarStyles, /@media \(max-width: 767px\)/)
    assert.match(adminPageHeader, /title: string/)
    assert.match(adminPageHeaderStyles, /\.admin-page-brand \.logo-icon \{/)
    assert.doesNotMatch(adminPageHeaderStyles, /(^|\n)\.logo-icon\s*\{/)
    assert.match(pendingRegistersPage, /className="pending-registers-layout"/)
    assert.match(pendingRegistersPage, /className="pending-registers-main"/)
    assert.doesNotMatch(pendingRegistersPage, /pending-registers-back|<Link/)
    assert.match(pendingRegistersPage, /isLoading && alerts\.length === 0/)
    assert.match(pendingRegistersPage, /!isLoading && !error && alerts\.length === 0/)
    assert.match(pendingRegistersPage, /role="alert"/)
    for (const width of [360, 767, 1200]) {
        assert.ok(pendingRegistersStyles.includes(`@media (max-width: ${width}px)`))
    }
    assert.match(pendingRegistersStyles, /overflow-wrap: anywhere/)
    assert.match(pendingRegistersStyles, /width: min\(calc\(100% - 56px\), 1560px\)/)
    assert.match(pendingRegistersStyles, /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/)
    assert.match(pendingRegistersStyles, /\.pending-register-card:only-child/)
    assert.match(pendingRegistersStyles, /width: min\(100%, 760px\)/)
    assert.match(pendingRegistersStyles, /padding: 16px 0 calc\(96px \+ var\(--sab\)\)/)
    assert.doesNotMatch(pendingRegistersPage, /encerrar|fechar caixa/i)
})

test('active mobile navigation exposes pending registers and its shared overdue count', () => {
    assert.match(app, /<MobileBottomNav \/>/)
    assert.match(mobileNav, /useOverdueCashRegisterAlertContext\(\)/)
    assert.match(mobileNav, /path: '\/caixas-pendentes'/)
    assert.match(mobileNav, /label: 'Caixas Pendentes'/)
    assert.match(mobileNav, /accessibleLabel: 'Caixas Pendentes'/)
    assert.match(mobileNav, /count: alertCount/)
    assert.match(mobileNav, /item\.count > 0/)
    assert.match(dashboard, /overdueAlertCount > 0/)
    assert.match(mobileNavStyles, /grid-template-columns: repeat\(7, minmax\(0, 1fr\)\)/)
    assert.match(mobileNavStyles, /white-space: normal/)
    assert.match(mobileNavStyles, /@media \(max-width: 360px\)/)
})

test('shared pending-register navigation link is present in administrative sidebars', () => {
    assert.match(pendingRegistersNav, /to="\/caixas-pendentes"/)
    assert.match(pendingRegistersNav, /location\.pathname === '\/caixas-pendentes'/)
    assert.match(pendingRegistersNav, /aria-current=\{isActive \? 'page' : undefined\}/)
    assert.match(pendingRegistersNav, /alertCount > 0/)
    assert.match(pendingRegistersNavStyles, /pending-register-link-count/)
    assert.match(dashboard, /<PendingRegistersNavigationLink className="sidebar-link"/)
    assert.match(reports, /<PendingRegistersNavigationLink className="sidebar-link"/)
    assert.match(offlineReports, /<PendingRegistersNavigationLink className="sidebar-link"/)
    assert.match(settings, /<PendingRegistersNavigationLink className="sidebar-link"/)
    assert.match(closureHistory, /<PendingRegistersNavigationLink className="sidebar-link"/)
    assert.match(products, /<PendingRegistersNavigationLink className="products-nav-link"/)
    assert.match(pendingRegistersNavStyles, /\.products-nav-link\.active/)
    assert.match(pendingRegistersNavStyles, /\.products-nav-link \.pending-register-link-count \{\s*flex: 0 0 auto;/)
})
