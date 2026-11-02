import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const migration = readFileSync(
    new URL('../supabase/migrations/20261102185000_create_cash_shortfall_alerts.sql', import.meta.url),
    'utf8',
)
const alertService = readFileSync(new URL('../src/services/cashShortfallAlerts.ts', import.meta.url), 'utf8')
const alertManager = readFileSync(
    new URL('../src/components/CashShortfallAlertManager/CashShortfallAlertManager.tsx', import.meta.url),
    'utf8',
)
const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
const closureHistory = readFileSync(
    new URL('../src/pages/HistoricoFechamentos/HistoricoFechamentos.tsx', import.meta.url),
    'utf8',
)

test('only negative closure differences become pending alerts', () => {
    assert.match(migration, /WHERE closure\.difference_amount < 0/)
    assert.match(migration, /-closure\.difference_amount/)
    assert.doesNotMatch(migration, /WHERE closure\.difference_amount\s*<=\s*0/)
    assert.match(alertManager, /Valor esperado/)
    assert.match(alertManager, /Valor contado/)
    assert.match(alertManager, /Padaria/)
    assert.match(alertManager, /Operador/)
    assert.match(alertManager, /dateTime\.format\(new Date\(activeAlert\.closedAt\)\)/)
})

test('alert confirmation is persistent per owner while temporary dismissal does not confirm it', () => {
    assert.match(migration, /PRIMARY KEY \(closure_id, confirmed_by\)/)
    assert.match(migration, /confirmed_at timestamptz NOT NULL DEFAULT pg_catalog\.clock_timestamp\(\)/)
    assert.match(migration, /acknowledgement\.confirmed_by = \(SELECT auth\.uid\(\)\)/)
    assert.match(alertManager, /await acknowledgeCashShortfallAlert\(activeAlert\.closureId\)/)
    assert.match(
        alertManager,
        /await acknowledgeCashShortfallAlert\(activeAlert\.closureId\)[\s\S]+?setAlerts\(\(current\) => current\.filter/,
    )
    assert.match(alertManager, /function dismissTemporarily\(\)[\s\S]+?setDismissedAlerts/)
    assert.doesNotMatch(alertManager.slice(
        alertManager.indexOf('function dismissTemporarily'),
        alertManager.indexOf('async function confirmAwareness'),
    ), /acknowledgeCashShortfallAlert/)
    assert.match(alertManager, /catch \(error\) \{[\s\S]+?setConfirmationError/)
    assert.match(migration, /ON CONFLICT \(closure_id, confirmed_by\) DO NOTHING/)
    assert.match(alertService, /rpc\('acknowledge_cash_shortfall_alert'/)
    assert.match(alertService, /data !== true/)
})

test('pending alerts are owner-only, bakery-scoped, and ordered oldest first', () => {
    assert.match(migration, /NOT \(SELECT private\.is_owner\(\)\)/)
    assert.match(migration, /closure\.bakery_id = ANY \([\s\S]+?private\.current_user_bakery_ids\(\)/)
    assert.match(migration, /ORDER BY closure\.closed_at ASC, closure\.id ASC/)
    assert.match(migration, /closure\.bakery_id = ANY \([\s\S]+?private\.current_user_bakery_ids\(\)[\s\S]+?ON CONFLICT/)
    assert.match(migration, /REVOKE ALL ON FUNCTION public\.get_pending_cash_shortfall_alerts\(\)[\s\S]+?FROM PUBLIC, anon, authenticated/)
    assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.get_pending_cash_shortfall_alerts\(\)[\s\S]+?TO authenticated/)
    assert.match(migration, /REVOKE ALL ON FUNCTION public\.acknowledge_cash_shortfall_alert\(uuid\)[\s\S]+?FROM PUBLIC, anon, authenticated/)
    assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.acknowledge_cash_shortfall_alert\(uuid\)[\s\S]+?TO authenticated/)
    assert.match(migration, /ENABLE ROW LEVEL SECURITY/)
    assert.match(migration, /REVOKE ALL ON TABLE public\.cash_shortfall_alert_acknowledgements/)
    assert.doesNotMatch(migration, /UPDATE public\.cash_closures|UPDATE public\.cash_registers|UPDATE public\.sales/)
})

test('manager polls in the background, presents alerts sequentially, and keeps failures pending', () => {
    assert.match(alertManager, /ALERT_POLL_INTERVAL_MS = 60_000/)
    assert.match(alertManager, /getPendingCashShortfallAlerts\(\)/)
    assert.match(alertManager, /alerts\.find\(\(alert\) => !dismissedAlerts\.has\(alert\.closureId\)\)/)
    assert.match(alertManager, /Não foi possível confirmar a leitura/)
    assert.match(alertManager, /A confirmação apenas registra que você tomou conhecimento/)
    assert.match(app, /<CashShortfallAlertManager key=/)
})

test('view action opens and expands the selected closure without acknowledging it', () => {
    assert.match(alertManager, /navigate\('\/historico-fechamentos',\s*\{\s*state: \{ focusClosureId: activeAlert\.closureId \}/)
    assert.doesNotMatch(alertManager.slice(alertManager.indexOf('function openClosure'), alertManager.indexOf('return (')),
        /acknowledgeCashShortfallAlert/)
    assert.match(closureHistory, /state\?\.focusClosureId/)
    assert.match(closureHistory, /setExpandedClosureId\(focusClosureId\)/)
    assert.match(closureHistory, /fechamento-toggle-\$\{closure\.id\}/)
})
