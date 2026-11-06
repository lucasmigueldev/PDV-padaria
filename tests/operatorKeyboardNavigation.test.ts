import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
const produtos = readFileSync(new URL('../src/pages/Produtos/Produtos.tsx', import.meta.url), 'utf8')
const fechamento = readFileSync(new URL('../src/pages/Fechamento/Fechamento.tsx', import.meta.url), 'utf8')

test('cashier shortcuts are registered once by a shared layout component', () => {
  assert.match(app, /<CashierKeyboardShortcuts authenticatedUser=\{authenticatedUser\} \/>/)
  assert.equal((app.match(/document\.addEventListener\('keydown', handleCashierShortcut\)/g) ?? []).length, 1)
  const roleRoute = app.slice(app.indexOf('function RoleRoute'), app.indexOf('function CashierKeyboardShortcuts'))
  assert.doesNotMatch(roleRoute, /handleCashierShortcut/)
})

test('shared cashier shortcuts cover F2 F3 F4 and F6', () => {
  assert.match(app, /F2: '\/produtos'/)
  assert.match(app, /F3: '\/fechamento'/)
  assert.match(app, /F4: '\/pdv'/)
  assert.match(app, /F6: '\/historico-vendas'/)
})

test('products and fechamento show the F6 shortcut consistently', () => {
  assert.match(produtos, /to="\/historico-vendas"[\s\S]*?<kbd>F6<\/kbd>/)
  assert.match(fechamento, /to="\/historico-vendas"[\s\S]*?<kbd>F6<\/kbd>/)
})
