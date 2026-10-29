    import {
        BarChart3,
        Clock,
        Filter,
        History,
        LayoutDashboard,
        LogOut,
        Minus,
        Settings,
        ShoppingCart,
        X,
    } from 'lucide-react'
    import { useEffect, useState, useMemo } from 'react'
    import { useNavigate, Link } from 'react-router-dom'

    import { UserProfileMenu } from '../../components/UserProfileMenu/UserProfileMenu'
    import { useAuth } from '../../contexts/AuthContext'
    import { useOfflinePeriods } from '../../hooks/useOfflinePeriods'
    import { clearOfflinePeriods } from '../../services/offlinePeriods'
    import { logoutAndRedirect } from '../../utils/auth'
    import '../Dashboard/Dashborad.css'
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

    function handleClear() {
        setConfirmClearOpen(true)
    }

    function confirmClear() {
        setConfirmClearOpen(false)
    }

    function handleLogout() {
        void logoutAndRedirect(navigate)
    }

    return (
        <div className="dashboard-layout relatorio-offline-layout">
            <aside className="sidebar">
                <div className="sidebar-logo">
                    <div className="logo-icon">
                        <ShoppingCart size={22} aria-hidden="true" />
                    </div>
                    <div>
                        <strong>PDV360</strong>
                        <span>Sistema de vendas</span>
                    </div>
                </div>

                <nav className="sidebar-menu" aria-label="Navegação administrativa">
                    <Link to="/dashboard" className="sidebar-link">
                        <LayoutDashboard size={19} aria-hidden="true" />
                        <span>Painel</span>
                    </Link>
                    <Link to="/historico-fechamentos" className="sidebar-link">
                        <History size={19} aria-hidden="true" />
                        <span>Histórico de Fechamentos</span>
                    </Link>
                    <Link to="/relatorios" className="sidebar-link">
                        <BarChart3 size={19} aria-hidden="true" />
                        <span>Relatórios</span>
                    </Link>
                    <Link to="/relatorios-offline" className="sidebar-link active" aria-current="page">
                        <Clock size={19} aria-hidden="true" />
                        <span>Fora do ar</span>
                    </Link>
                </nav>

                <div className="sidebar-bottom">
                    <Link to="/configuracoes" className="sidebar-link">
                        <Settings size={19} aria-hidden="true" />
                        <span>Configurações</span>
                    </Link>
                    <button type="button" onClick={handleLogout} className="sidebar-link logout-button">
                        <LogOut size={19} aria-hidden="true" />
                        <span>Sair</span>
                    </button>
                </div>
            </aside>

            <main className="dashboard-main relatorio-offline-main">
                <header className="dashboard-header">
                    <div className="mobile-topbar">
                        <div className="mobile-header-brand" aria-label="PDV360">
                            <div className="logo-icon">
                                <ShoppingCart size={17} aria-hidden="true" />
                            </div>
                            <span>PDV360</span>
                        </div>
                        <UserProfileMenu user={authenticatedUser} />
                    </div>
                    <div className="dashboard-header-row">
                        <div className="mobile-page-heading">
                            <span className="header-overline">ANÁLISE OPERACIONAL</span>
                            <h1>Fora do ar — Relatório de conexão</h1>
                            <p>
                                Interrupções de conexão registradas no PDV. Útil para
                                entender quando a unidade ficou sem internet.
                            </p>
                        </div>
                        <div className="desktop-user-profile">
                            <UserProfileMenu user={authenticatedUser} />
                        </div>
                    </div>
                </header>

                <div className="dashboard-content relatorio-offline-content">
                    <section className="relatorio-offline-indicators">
                        <article className="relatorio-offline-card">
                            <div className="relatorio-offline-card-icon">
                                <Minus size={19} aria-hidden="true" />
                            </div>
                            <span>Interrupções</span>
                            <strong>{offlineCount}</strong>
                        </article>
                        <article className="relatorio-offline-card relatorio-offline-card--highlight">
                            <div className="relatorio-offline-card-icon">
                                <Clock size={19} aria-hidden="true" />
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
                        {filteredPeriods.length === 0 ? (
                            <div className="relatorio-offline-empty" role="status">
                                <History size={32} aria-hidden="true" />
                                <p>
                                    {dateFilter
                                        ? 'Nenhuma interrupção registrada nesta data.'
                                        : 'Nenhuma interrupção de conexão registrada ainda.'}
                                </p>
                            </div>
                        ) : (
                            <>
                                <div className="relatorio-offline-table-wrapper">
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
                                            {filteredPeriods.map((period) => (
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
                                            ))}
                                        </tbody>
                                    </table>
                                </div>

                                <div className="relatorio-offline-records--mobile">
                                    {filteredPeriods.map((period) => (
                                        <article className="relatorio-offline-record-card" key={period.id}>
                                            <div className="relatorio-offline-record-card-header">
                                                <strong>{formatDateBR(period.startedAt)}</strong>
                                                {period.endedAt ? (
                                                    <span className="relatorio-offline-badge relatorio-offline-badge--ended">
                                                        Concluído
                                                    </span>
                                                ) : (
                                                    <span className="relatorio-offline-badge relatorio-offline-badge--ongoing">
                                                        Em andamento
                                                    </span>
                                                )}
                                            </div>
                                            <dl className="relatorio-offline-record-fields">
                                                <div>
                                                    <dt>Início</dt>
                                                    <dd>{formatTimeBR(period.startedAt)}</dd>
                                                </div>
                                                <div>
                                                    <dt>Término</dt>
                                                    <dd>{period.endedAt ? formatTimeBR(period.endedAt) : '—'}</dd>
                                                </div>
                                                <div>
                                                    <dt>Duração</dt>
                                                    <dd>{formatDuration(period.durationMs)}</dd>
                                                </div>
                                                <div>
                                                    <dt>Status</dt>
                                                    <dd>{period.endedAt ? 'Concluído' : 'Em andamento'}</dd>
                                                </div>
                                            </dl>
                                        </article>
                                    ))}
                                </div>
                            </>
                        )}

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
                </div>
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
