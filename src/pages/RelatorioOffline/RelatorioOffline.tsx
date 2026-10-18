    import { History, Clock, Minus, LayoutList, Filter, X, LogOut } from 'lucide-react'
import { useEffect, useState, useMemo } from 'react'
import { useNavigate, Link } from 'react-router-dom'

import { UserProfileMenu } from '../../components/UserProfileMenu/UserProfileMenu'
import { useAuth } from '../../contexts/AuthContext'
import { useOfflinePeriods } from '../../hooks/useOfflinePeriods'
import { clearOfflinePeriods } from '../../services/offlinePeriods'
import { logoutAndRedirect } from '../../utils/auth'
import './RelatorioOffline.css'

function formatDateBR(timestamp: number): string {
    return new Date(timestamp).toLocaleDateString('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
    })
}

function formatTimeBR(timestamp: number): string {
    return new Date(timestamp).toLocaleTimeString('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        hour: '2-digit',
        minute: '2-digit',
    })
}

function formatDuration(ms: number | null): string {
    if (ms === null) return '—'
    const totalSeconds = Math.floor(ms / 1000)
    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = totalSeconds % 60
    const parts: string[] = []
    if (hours > 0) parts.push(`${hours}h`)
    if (minutes > 0 || hours > 0) parts.push(`${minutes}min`)
    parts.push(`${seconds}s`)
    return parts.join(' ')
}

export default function RelatorioOffline() {
    const navigate = useNavigate()
    const { authenticatedUser } = useAuth()
    const isOwner = authenticatedUser?.role === 'owner'
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
    const [dateFilter, setDateFilter] = useState<string>('')
    const [confirmClearOpen, setConfirmClearOpen] = useState(false)

    const { periods, totalOfflineTimeMs, offlineCount } = useOfflinePeriods()

    const filteredPeriods = useMemo(() => {
        if (!dateFilter) return periods
        return periods.filter((p) => formatDateBR(p.startedAt) === dateFilter)
    }, [periods, dateFilter])

    const today = new Date().toISOString().slice(0, 10)

    useEffect(() => {
        if (!isOwner) {
            navigate('/pdv', { replace: true })
        }
    }, [isOwner, navigate])

    function handleLogout() {
        logoutAndRedirect(navigate)
    }

    function handleClear() {
        setConfirmClearOpen(true)
    }

    function confirmClear() {
        setConfirmClearOpen(false)
    }
    return (
        <div className="relatorio-offline">
            <aside className="relatorio-offline-sidebar">
                <UserProfileMenu
                    user={authenticatedUser}
                    onLogout={handleLogout}
                    isOpen={isMobileMenuOpen}
                    setIsOpen={setIsMobileMenuOpen}
                />
                <nav className="relatorio-offline-nav">
                    <Link to="/dashboard" className="relatorio-offline-nav-link">
                        <LayoutList size={20} aria-hidden="true" />
                        Dashboard
                    </Link>
                    <Link to="/relatorios" className="relatorio-offline-nav-link">
                        <History size={20} aria-hidden="true" />
                        Relatórios
                    </Link>
                    <Link
                        to="/relatorios-offline"
                        className="relatorio-offline-nav-link relatorio-offline-nav-link--active"
                    >
                        <Clock size={20} aria-hidden="true" />
                        Fora do ar
                    </Link>
                    <Link to="/configuracoes" className="relatorio-offline-nav-link">
                        <LogOut size={20} aria-hidden="true" />
                        Configurações
                    </Link>
                </nav>
            </aside>

            <main className="relatorio-offline-main">
                <header className="relatorio-offline-header">
                    <h1>Fora do ar — Relatório de conexão</h1>
                    <p>
                        Interrupções de conexão registradas no PDV. Útil para
                        entender quando a unidade ficou sem internet.
                    </p>
                </header>

                <section className="relatorio-offline-indicators">
                    <article className="relatorio-offline-card">
                        <div className="relatorio-offline-card-icon">
                            <Minus size={22} aria-hidden="true" />
                        </div>
                        <span>Interrupções</span>
                        <strong>{offlineCount}</strong>
                    </article>
                    <article className="relatorio-offline-card relatorio-offline-card--highlight">
                        <div className="relatorio-offline-card-icon">
                            <Clock size={22} aria-hidden="true" />
                        </div>
                        <span>Tempo total fora do ar</span>
                        <strong>{formatDuration(totalOfflineTimeMs)}</strong>
                    </article>
                </section>

                <section className="relatorio-offline-filter">
                    <label htmlFor="offline-date-filter">
                        <Filter size={18} aria-hidden="true" />
                        Filtrar por data
                    </label>
                    <input
                        id="offline-date-filter"
                        type="date"
                        value={dateFilter}
                        onChange={(e) => setDateFilter(e.target.value)}
                        min={today}
                        max={today}
                    />
                </section>

                <section className="relatorio-offline-table-section">
                    <table className="relatorio-offline-table" aria-label="Períodos offline">
                        <thead>
                            <tr>
                                <th>Dia</th>
                                <th>Início</th>
                                <th>Término</th>
                                <th>Duração</th>
                                <th>Status</th>
                            </tr>
                        </thead>
                        <tbody>

                            {filteredPeriods.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="relatorio-offline-empty">
                                        <History size={32} aria-hidden="true" />
                                        <p>
                                            {dateFilter
                                                ? 'Nenhuma interrupção registrada nesta data.'
                                                : 'Nenhuma interrupção de conexão registrada ainda.'}
                                        </p>
                                    </td>
                                </tr>
                            ) : (
                                filteredPeriods.map((period) => (
                                    <tr key={period.id}>
                                        <td>{formatDateBR(period.startedAt)}</td>
                                        <td>{formatTimeBR(period.startedAt)}</td>
                                        <td>
                                            {period.endedAt
                                                ? formatTimeBR(period.endedAt)
                                                : '—'}
                                        </td>
                                        <td>{formatDuration(period.durationMs)}</td>
                                        <td>
                                            {period.endedAt ? (
                                                <span className="relatorio-offline-badge relatorio-offline-badge--ended">
                                                    Concluído
                                                </span>
                                            ) : (
                                                <span className="relatorio-offline-badge relatorio-offline-badge--ongoing">
                                                    Em andamento
                                                </span>
                                            )}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>

                    {filteredPeriods.length > 0 && (
                        <div className="relatorio-offline-actions">
                            <button
                                type="button"
                                className="relatorio-offline-button relatorio-offline-button--danger"
                                onClick={handleClear}
                            >
                                <X size={18} aria-hidden="true" />
                                Limpar histórico
                            </button>
                        </div>
                    )}
                </section>
            </main>

            {confirmClearOpen && (
                <div className="relatorio-offline-modal-overlay" onClick={confirmClear}>
                    <div className="relatorio-offline-modal" onClick={(e) => e.stopPropagation()}>
                        <h3>Limpar histórico de interrupções?</h3>
                        <p>
                            Isso apagará todos os registros de períodos fora do ar.
                            Não pode ser desfeito.
                        </p>
                        <div className="relatorio-offline-modal-actions">
                            <button
                                type="button"
                                className="relatorio-offline-button"
                                onClick={() => setConfirmClearOpen(false)}
                            >
                                Cancelar
                            </button>
                            <button
                                type="button"
                                className="relatorio-offline-button relatorio-offline-button--danger"
                                onClick={() => {
                                    setConfirmClearOpen(false)
                                    clearOfflinePeriods()
                                }}
                            >
                                Limpar tudo
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

