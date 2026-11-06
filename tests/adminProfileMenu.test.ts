import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const profileMenu = readFileSync(
    new URL('../src/components/UserProfileMenu/UserProfileMenu.tsx', import.meta.url),
    'utf8',
)
const adminSidebar = readFileSync(
    new URL('../src/components/AdminSidebar/AdminSidebar.tsx', import.meta.url),
    'utf8',
)
const dashboard = readFileSync(
    new URL('../src/pages/Dashboard/Dashboard.tsx', import.meta.url),
    'utf8',
)
const pendingRegisters = readFileSync(
    new URL('../src/pages/CaixasPendentes/CaixasPendentes.tsx', import.meta.url),
    'utf8',
)

test('administrator profile menu exposes settings and logout actions', () => {
    assert.match(profileMenu, /owner: 'Administrador'/)
    assert.match(profileMenu, /aria-haspopup="menu"/)
    assert.match(profileMenu, /to="\/configuracoes"/)
    assert.match(profileMenu, /<Settings size=\{17\}/)
    assert.match(profileMenu, /onLogout\?\.\(\)/)
})

test('profile menu supports keyboard dismissal and accessible actions', () => {
    assert.match(profileMenu, /event\.key === 'Escape'/)
    assert.match(profileMenu, /role="menu"/)
    assert.match(profileMenu, /role="menuitem"/)
})

test('mobile administrator navigation keeps only primary routes', () => {
    const mobileNav = readFileSync(
        new URL('../src/components/MobileBottomNav/MobileBottomNav.tsx', import.meta.url),
        'utf8',
    )
    assert.doesNotMatch(mobileNav, /label: 'Ajustes'|mobile-bottom-nav-logout|handleLogout/)
    assert.doesNotMatch(mobileNav, /LogOut|Settings|logoutAndRedirect/)
})

test('administrator sidebars no longer duplicate settings and logout', () => {
    assert.doesNotMatch(adminSidebar, /sidebar-bottom|Configurações|<LogOut/)
    assert.doesNotMatch(dashboard, /mobile-drawer-bottom[\s\S]*?<aside className="dashboard-main/)
})

test('pending registers keep the shared count navigation and header logout integration', () => {
    assert.match(pendingRegisters, /onLogout=\{handleLogout\}/)
    assert.match(adminSidebar, /PendingRegistersNavigationLink/)
})
