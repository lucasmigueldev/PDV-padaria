import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const badgePath = new URL('../src/components/ConnectionStatusBadge/ConnectionStatusBadge.tsx', import.meta.url)
const badgeCssPath = new URL('../src/components/ConnectionStatusBadge/ConnectionStatusBadge.css', import.meta.url)
const pdvPath = new URL('../src/pages/PDV/PDV.tsx', import.meta.url)
const topbarPath = new URL('../src/components/AppTopbar/AppTopbar.tsx', import.meta.url)

test('offline sync indicator is compact and rendered in the operator header', async () => {
    const [badge, badgeCss, pdv, topbar] = await Promise.all([
        readFile(badgePath, 'utf8'),
        readFile(badgeCssPath, 'utf8'),
        readFile(pdvPath, 'utf8'),
        readFile(topbarPath, 'utf8'),
    ])

    assert.match(topbar, /<ConnectionStatusBadge \/>/)
    assert.match(badge, /sale.status === 'failed'/)
    assert.match(badge, /Falha na sincronização/)
    assert.match(badge, /Sincronizando/)
    assert.match(badge, /venda.*pendente/)
    assert.match(badge, /return null/)
    assert.doesNotMatch(pdv, /Sincronizando vendas pendentes/)
    assert.match(badgeCss, /\.connection-badge\.failed/)
})
