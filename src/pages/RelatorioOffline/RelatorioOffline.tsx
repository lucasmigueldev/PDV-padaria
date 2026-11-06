import {
    BarChart3,
    CalendarDays,
    Clock,
    Filter,
    History,
    LayoutDashboard,
    Package,
    RefreshCw,
    ShoppingCart,
    Wifi,
    WifiOff,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { UserProfileMenu } from '../../components/UserProfileMenu/UserProfileMenu'
import { PendingRegistersNavigationLink } from '../../components/PendingRegistersNavigationLink/PendingRegistersNavigationLink'
import { useAuth } from '../../contexts/AuthContext'
import { useBakeries } from '../../hooks/useBakeries'
import { PDV_OFFLINE_THRESHOLD_MS, usePdvHeartbeats } from '../../hooks/usePdvHeartbeats'
import { getAdminUsers } from '../../services/adminUsers'
import {
    getOpenRegisterMonitoringDecision,
    getOpenRegistersWithoutHeartbeat,
    getPossibleOfflineRegisters,
} from '../../services/offlineRegisterMonitoring'
import {
    getPdvOfflineEpisodeDurationSeconds,
} from '../../services/pdvOfflineEpisodePresentation'
import {
    getPdvOfflineEpisodes,
    syncPdvOfflineEpisodes,
    type PdvOfflineEpisode,
} from '../../services/pdvOfflineEpisodes'
import { logoutAndRedirect } from '../../utils/auth'
import type { User } from '../../types/User'
import '../Dashboard/Dashborad.css'
import './RelatorioOffline.css'

const HISTORY_PAGE_SIZE = 10
const offlineSalesCurrency = new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
})

function formatLastContact(value: string): string {
    const timestamp = Date.parse(value)
    if (!Number.isFinite(timestamp)) return 'Horário não disponível'

    return new Intl.DateTimeFormat('pt-BR', {
        dateStyle: 'short',
        timeStyle: 'medium',
        timeZone: 'America/Sao_Paulo',
    }).format(timestamp)
}

function formatOccurrenceDate(value: string): string {
    const timestamp = Date.parse(value)
    if (!Number.isFinite(timestamp)) return 'Data não disponível'

    return new Intl.DateTimeFormat('pt-BR', {
        dateStyle: 'medium',
        timeZone: 'America/Sao_Paulo',
    }).format(timestamp)
}

function formatElapsed(ms: number): string {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000))
    const days = Math.floor(totalSeconds / 86_400)
    const hours = Math.floor((totalSeconds % 86_400) / 3_600)
    const minutes = Math.floor((totalSeconds % 3_600) / 60)
    const seconds = totalSeconds % 60

    if (days > 0) return `${days}d ${hours}h`
    if (hours > 0) return `${hours}h ${minutes}min`
    if (minutes > 0) return `${minutes}min ${seconds}s`
    return `${seconds}s`
}

function getErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message
    return 'Não foi possível carregar os operadores. Tente novamente mais tarde.'
}

export default function RelatorioOffline() {
    const navigate = useNavigate()
    const { authenticatedUser } = useAuth()
    const isOwner = authenticatedUser?.role === 'owner'
    const {
        heartbeats,
        openCashRegisters,
        endedCashRegisterSessions,
        isLoading,
        error: monitoringError,
        lastUpdatedAt,
    } = usePdvHeartbeats(isOwner, true)
    const { bakeries, bakeriesLoadError } = useBakeries()
    const [operators, setOperators] = useState<User[]>([])
    const [operatorsLoadError, setOperatorsLoadError] = useState('')
    const [isLoadingOperators, setIsLoadingOperators] = useState(true)
    const [historyDateFilter, setHistoryDateFilter] = useState('')
    const [historyBakeryFilter, setHistoryBakeryFilter] = useState('all')
    const [historyPage, setHistoryPage] = useState(1)
    const [expandedOfflineSales, setExpandedOfflineSales] = useState<Set<string>>(() => new Set())
    const [historyRefreshRevision, setHistoryRefreshRevision] = useState(0)
    const [episodeSyncError, setEpisodeSyncError] = useState('')
    const [historyResult, setHistoryResult] = useState<{
        key: string
        episodes: PdvOfflineEpisode[]
        error: string
        loadedAt: number
    } | null>(null)
    const [clockNow, setClockNow] = useState<number | null>(null)
    const lastDiagnosticUpdateRef = useRef<number | null>(null)
    const lastDiagnosticClassificationRef = useRef('')

    useEffect(() => {
        if (!isOwner) {
            navigate('/pdv', { replace: true })
        }
    }, [isOwner, navigate])

    useEffect(() => {
        if (!isOwner) return

        let isActive = true
        void getAdminUsers().then((users) => {
            if (!isActive) return
            setOperators(users.filter((user) => user.role === 'cashier'))
            setOperatorsLoadError('')
        }).catch((error: unknown) => {
            if (!isActive) return
            console.error('Não foi possível carregar os nomes dos operadores do relatório offline.', error)
            setOperatorsLoadError(getErrorMessage(error))
        }).finally(() => {
            if (isActive) setIsLoadingOperators(false)
        })

        return () => {
            isActive = false
        }
    }, [isOwner])

    const historyQueryKey = `${historyDateFilter}|${historyBakeryFilter}`
    const visibleHistoryResult = historyResult?.key === historyQueryKey ? historyResult : null
    const historyEpisodes = visibleHistoryResult?.episodes ?? []
    const historyError = visibleHistoryResult?.error ?? ''
    const isLoadingHistory = isOwner && visibleHistoryResult === null
    const historyTotalPages = Math.max(1, Math.ceil(historyEpisodes.length / HISTORY_PAGE_SIZE))
    const currentHistoryPage = Math.min(historyPage, historyTotalPages)
    const paginatedHistoryEpisodes = historyEpisodes.slice(
        (currentHistoryPage - 1) * HISTORY_PAGE_SIZE,
        currentHistoryPage * HISTORY_PAGE_SIZE,
    )

    useEffect(() => {
        if (!isOwner) return

        let isActive = true
        const queryKey = historyQueryKey
        void getPdvOfflineEpisodes({
            date: historyDateFilter,
            bakeryId: historyBakeryFilter === 'all' ? undefined : historyBakeryFilter,
        }).then((episodes) => {
            if (isActive) {
                setHistoryResult({
                    key: queryKey,
                    episodes,
                    error: '',
                    loadedAt: Date.now(),
                })
            }
        }).catch((error: unknown) => {
            if (!isActive) return
            console.error('Não foi possível carregar o histórico de caixas fora do ar.', error)
            setHistoryResult({
                key: queryKey,
                episodes: [],
                error: getErrorMessage(error),
                loadedAt: Date.now(),
            })
        })

        return () => {
            isActive = false
        }
    }, [historyBakeryFilter, historyDateFilter, historyQueryKey, historyRefreshRevision, isOwner])

    useEffect(() => {
        const intervalId = window.setInterval(() => {
            setClockNow(Date.now())
        }, 10_000)
        return () => window.clearInterval(intervalId)
    }, [])

    const bakeryNames = useMemo(
        () => new Map(bakeries.map((bakery) => [bakery.id, bakery.name])),
        [bakeries],
    )
    const operatorNames = useMemo(
        () => new Map(operators.map((operator) => [operator.id, operator.name])),
        [operators],
    )
    const now = clockNow ?? visibleHistoryResult?.loadedAt ?? lastUpdatedAt ?? 0
    const possibleOfflineRegisters = useMemo(
        () => getPossibleOfflineRegisters(
            openCashRegisters,
            heartbeats,
            now,
            PDV_OFFLINE_THRESHOLD_MS,
            endedCashRegisterSessions,
        ),
        [endedCashRegisterSessions, heartbeats, now, openCashRegisters],
    )
    const openRegistersWithoutHeartbeat = useMemo(
        () => getOpenRegistersWithoutHeartbeat(
            openCashRegisters,
            heartbeats,
            endedCashRegisterSessions,
        ),
        [endedCashRegisterSessions, heartbeats, openCashRegisters],
    )

    useEffect(() => {
        if (!isOwner || lastUpdatedAt === null || monitoringError) return

        let isActive = true
        const offlineAtPoll = getPossibleOfflineRegisters(
            openCashRegisters,
            heartbeats,
            lastUpdatedAt,
            PDV_OFFLINE_THRESHOLD_MS,
            endedCashRegisterSessions,
        )
        const reconnectedCashRegisterIds = openCashRegisters.flatMap((register) => {
            const decision = getOpenRegisterMonitoringDecision(
                register,
                heartbeats,
                lastUpdatedAt,
                PDV_OFFLINE_THRESHOLD_MS,
            )
            const sessionEnded = endedCashRegisterSessions.some((session) =>
                session.cashRegisterId === register.id
                && session.bakeryId === register.bakeryId
                && session.operatorUserId === register.operatorUserId,
            )
            return decision.reason === 'recent_heartbeat' && !sessionEnded ? [register.id] : []
        })

        void syncPdvOfflineEpisodes(
            offlineAtPoll,
            openCashRegisters.map((register) => register.id),
            reconnectedCashRegisterIds,
            endedCashRegisterSessions.map((session) => session.cashRegisterId),
        ).then((changed) => {
            if (!isActive) return
            setEpisodeSyncError('')
            if (changed) setHistoryRefreshRevision((revision) => revision + 1)
        }).catch((error: unknown) => {
            if (!isActive) return
            console.error('Não foi possível registrar o histórico de caixas fora do ar.', error)
            setEpisodeSyncError(getErrorMessage(error))
        })

        return () => {
            isActive = false
        }
    }, [
        endedCashRegisterSessions,
        heartbeats,
        isOwner,
        lastUpdatedAt,
        monitoringError,
        openCashRegisters,
    ])

    useEffect(() => {
        if (!import.meta.env.DEV || lastUpdatedAt === null) {
            return
        }
        const isNewPoll = lastDiagnosticUpdateRef.current !== lastUpdatedAt
        const observedAt = Date.now()
        const decisions = openCashRegisters.map((register) => ({
            register,
            decision: getOpenRegisterMonitoringDecision(
                register,
                heartbeats,
                observedAt,
                PDV_OFFLINE_THRESHOLD_MS,
            ),
            sessionEnded: endedCashRegisterSessions.some((session) =>
                session.cashRegisterId === register.id
                && session.bakeryId === register.bakeryId
                && session.operatorUserId === register.operatorUserId,
            ),
        }))
        const signature = decisions
            .map(({ register, decision, sessionEnded }) =>
                `${register.bakeryId}:${register.operatorUserId}:${decision.reason}:${sessionEnded}`,
            )
            .join('|')
        if (!isNewPoll && signature === lastDiagnosticClassificationRef.current) {
            return
        }
        lastDiagnosticUpdateRef.current = lastUpdatedAt
        lastDiagnosticClassificationRef.current = signature
        for (const { register, decision, sessionEnded } of decisions) {
            console.debug('[PDV offline monitor] register_classification', {
                observedAt: new Date(observedAt).toISOString(),
                bakery: register.bakeryId.slice(0, 8),
                operator: register.operatorUserId.slice(0, 8),
                openedAt: register.openedAt,
                lastSeenAt: decision.heartbeat?.lastSeenAt ?? null,
                elapsedMs: decision.elapsedMs,
                thresholdMs: PDV_OFFLINE_THRESHOLD_MS,
                included: decision.reason === 'stale_heartbeat' && !sessionEnded,
                sessionEnded,
                reason: decision.reason,
            })
        }
        if (openCashRegisters.length === 0) {
            console.debug('[PDV offline monitor] no_open_registers', {
                observedAt: new Date(observedAt).toISOString(),
            })
        }
    }, [clockNow, endedCashRegisterSessions, heartbeats, lastUpdatedAt, openCashRegisters])

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
                    <PendingRegistersNavigationLink className="sidebar-link" />
                    <Link to="/relatorios" className="sidebar-link">
                        <BarChart3 size={19} aria-hidden="true" />
                        <span>Relatórios</span>
                    </Link>
                    <Link to="/relatorios-offline" className="sidebar-link active" aria-current="page">
                        <Clock size={19} aria-hidden="true" />
                        <span>Fora do ar</span>
                    </Link>
                </nav>

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
                        <UserProfileMenu user={authenticatedUser} onLogout={handleLogout} />
                    </div>
                    <div className="dashboard-header-row">
                        <div className="mobile-page-heading">
                            <span className="header-overline">ACOMPANHAMENTO OPERACIONAL</span>
                            <h1>Fora do ar</h1>
                            <p>Acompanhe caixas que estão sem comunicação.</p>
                        </div>
                        <div className="desktop-user-profile">
                            <UserProfileMenu user={authenticatedUser} onLogout={handleLogout} />
                        </div>
                    </div>
                </header>

                <div className="dashboard-content relatorio-offline-content">
                    <section className="offline-monitor-section" aria-labelledby="offline-now-title">
                        <div className="offline-monitor-heading">
                            <div>
                                <span className="header-overline">ACOMPANHAMENTO ATUAL</span>
                                <h2 id="offline-now-title">Caixas sem comunicação recente</h2>
                                <p>
                                    Estes caixas estão abertos, mas não enviam atualizações recentes. Isso não
                                    permite confirmar se o navegador foi fechado ou se a conexão foi interrompida.
                                </p>
                            </div>
                            <span className="offline-monitor-updated">
                                <RefreshCw size={14} aria-hidden="true" />
                                {lastUpdatedAt
                                    ? `Atualizado às ${new Intl.DateTimeFormat('pt-BR', {
                                        hour: '2-digit',
                                        minute: '2-digit',
                                        second: '2-digit',
                                    }).format(lastUpdatedAt)}`
                                    : 'Aguardando atualização'}
                            </span>
                        </div>

                        <div className="offline-monitor-context">
                            O monitor identifica a falta de comunicação, mas não confirma a causa. As ocorrências
                            só podem ser identificadas enquanto esta página administrativa estiver aberta.
                        </div>

                        {monitoringError && (
                            <div className="offline-monitor-alert" role="alert">
                                <strong>Não foi possível atualizar a situação dos caixas.</strong>
                                <span>Tente novamente em instantes. No momento, não é possível confirmar quais caixas estão sem comunicação.</span>
                            </div>
                        )}
                        {operatorsLoadError && (
                            <div className="offline-monitor-alert offline-monitor-alert--notice" role="status">
                                Os nomes dos operadores não estão disponíveis no momento; a identificação nos cartões pode ficar incompleta.
                            </div>
                        )}
                        {bakeriesLoadError && (
                            <div className="offline-monitor-alert offline-monitor-alert--notice" role="status">
                                Os nomes das padarias não estão disponíveis no momento; a identificação nos cartões pode ficar incompleta.
                            </div>
                        )}
                        {!monitoringError && openRegistersWithoutHeartbeat.length > 0 && (
                            <div className="offline-monitor-alert offline-monitor-alert--notice" role="status">
                                Há caixas abertos sem registro recente de comunicação. Não é possível estimar quando
                                ocorreu o último contato; por isso, eles não aparecem como possivelmente fora do ar.
                            </div>
                        )}
                        {isLoadingOperators && (
                            <p className="offline-monitor-refreshing" role="status">Carregando nomes dos operadores...</p>
                        )}

                        {monitoringError ? null : lastUpdatedAt === null ? (
                            <div className="relatorio-offline-empty" role="status">
                                <RefreshCw size={24} aria-hidden="true" />
                                <p>Verificando a comunicação dos caixas...</p>
                            </div>
                        ) : possibleOfflineRegisters.length === 0 ? (
                            <div className="relatorio-offline-empty" role="status">
                                <Clock size={30} aria-hidden="true" />
                                <p>Nenhum caixa aberto está sem comunicação recente.</p>
                            </div>
                        ) : (
                            <div className="offline-register-cards">
                                {possibleOfflineRegisters.map((register) => (
                                    <article
                                        className="offline-register-card"
                                        key={`${register.bakeryId}:${register.operatorUserId}`}
                                    >
                                        <div className="offline-register-card-heading">
                                            <div>
                                                <span className="offline-register-label">Padaria</span>
                                                <strong>
                                                    {bakeryNames.get(register.bakeryId)
                                                        ?? `Padaria (${register.bakeryId.slice(0, 8)})`}
                                                </strong>
                                            </div>
                                            <span className="offline-monitor-status offline-monitor-status--stale">
                                                Sem comunicação recente
                                            </span>
                                        </div>
                                        <dl className="offline-register-details">
                                            <div>
                                                <dt>Operador</dt>
                                                <dd>
                                                    {operatorNames.get(register.operatorUserId)
                                                        ?? `Operador (${register.operatorUserId.slice(0, 8)})`}
                                                </dd>
                                            </div>
                                            <div>
                                                <dt>Último contato</dt>
                                                <dd>{formatLastContact(register.lastSeenAt)}</dd>
                                            </div>
                                            <div>
                                                <dt>Tempo decorrido</dt>
                                                <dd>{formatElapsed(register.elapsedMs)}</dd>
                                            </div>
                                        </dl>
                                        <p className="offline-register-explanation">
                                            O caixa está aberto, mas não recebemos atualizações recentes.
                                            Vendas realizadas podem ainda não ter sido enviadas.
                                        </p>
                                    </article>
                                ))}
                            </div>
                        )}

                        {isLoading && lastUpdatedAt !== null && (
                            <p className="offline-monitor-refreshing" role="status">Atualizando a situação dos caixas...</p>
                        )}
                    </section>

                    <section className="offline-monitor-section offline-history-section" aria-labelledby="offline-history-title">
                        <div className="offline-monitor-heading">
                            <div>
                                <span className="header-overline">ACOMPANHAMENTO DE OCORRÊNCIAS</span>
                                <h2 id="offline-history-title">Histórico de caixas fora do ar</h2>
                                <p>
                                    Uma ocorrência é registrada após mais de 75 segundos sem comunicação. O registro
                                    aparece no dia em que começou; o filtro por data também considera períodos que
                                    atravessaram o dia selecionado.
                                </p>
                                <p className="offline-history-notice">
                                    As ocorrências só são identificadas enquanto esta página administrativa está aberta.
                                </p>
                            </div>
                        </div>

                        <div className="offline-history-filters">
                            <label className="offline-monitor-filter" htmlFor="offline-history-date">
                                <span><Filter size={16} aria-hidden="true" /> Data da ocorrência</span>
                                <input
                                    id="offline-history-date"
                                    type="date"
                                    value={historyDateFilter}
                                    onChange={(event) => {
                                        setHistoryDateFilter(event.target.value)
                                        setHistoryPage(1)
                                    }}
                                />
                            </label>
                            <label className="offline-monitor-filter" htmlFor="offline-history-bakery">
                                <span><Filter size={16} aria-hidden="true" /> Padaria</span>
                                <select
                                    id="offline-history-bakery"
                                    value={historyBakeryFilter}
                                    onChange={(event) => {
                                        setHistoryBakeryFilter(event.target.value)
                                        setHistoryPage(1)
                                    }}
                                >
                                    <option value="all">Todas as padarias</option>
                                    {bakeries.map((bakery) => (
                                        <option key={bakery.id} value={bakery.id}>
                                            {bakery.name}{bakery.active ? '' : ' (inativa)'}
                                        </option>
                                    ))}
                                </select>
                            </label>
                        </div>

                        {historyError && (
                            <div className="offline-monitor-alert" role="alert">
                                <strong>Não foi possível carregar o histórico agora.</strong>
                                <span>Tente atualizar a página. Se o problema continuar, procure o suporte.</span>
                            </div>
                        )}
                        {episodeSyncError && (
                            <div className="offline-monitor-alert" role="alert">
                                <strong>Não foi possível atualizar as ocorrências agora.</strong>
                                <span>Elas podem demorar a aparecer. Tente novamente em instantes.</span>
                            </div>
                        )}
                        {isLoadingHistory && (
                            <p className="offline-monitor-refreshing" role="status">Carregando ocorrências...</p>
                        )}
                        {!isLoadingHistory && !historyError && historyEpisodes.length === 0 && (
                            <div className="offline-history-placeholder" role="status">
                                <History size={24} aria-hidden="true" />
                                <p>Nenhuma ocorrência encerrada encontrada para estes filtros.</p>
                                <span>
                                    O histórico começa a ser formado quando o monitor está ativo. Períodos anteriores
                                    não podem ser recuperados.
                                </span>
                            </div>
                        )}
                        {historyEpisodes.length > 0 && (
                            <>
                                <div className="offline-register-cards">
                                {paginatedHistoryEpisodes.map((episode) => {
                                    const durationSeconds = getPdvOfflineEpisodeDurationSeconds(
                                        episode,
                                        now,
                                    )
                                    const completedDurationSeconds = episode.endedAt === null
                                        ? null
                                        : durationSeconds

                                    return (
                                        <article
                                            className="offline-history-card"
                                            key={episode.id}
                                        >
                                            <header className="offline-history-header">
                                                <div className="offline-history-identity">
                                                    <span className="offline-history-eyebrow">Padaria</span>
                                                    <strong>{episode.bakeryName}</strong>
                                                    <span className="offline-history-operator">
                                                        Operador: {episode.operatorName}
                                                    </span>
                                                </div>
                                                <div className="offline-history-date">
                                                    <CalendarDays size={15} aria-hidden="true" />
                                                    <span>{formatOccurrenceDate(episode.estimatedStartedAt)}</span>
                                                </div>
                                            </header>
                                            <div className="offline-history-timeline">
                                                <div className="offline-history-timeline-events">
                                                    <div className="offline-history-event offline-history-event--interrupted">
                                                        <span className="offline-history-event-icon">
                                                            <WifiOff size={16} aria-hidden="true" />
                                                        </span>
                                                        <div className="offline-history-event-copy">
                                                            <strong>Comunicação interrompida</strong>
                                                            <span>
                                                                Início estimado · {formatLastContact(episode.estimatedStartedAt)}
                                                            </span>
                                                        </div>
                                                    </div>
                                                    <div className="offline-history-event offline-history-event--restored">
                                                        <span className="offline-history-event-icon">
                                                            <Wifi size={16} aria-hidden="true" />
                                                        </span>
                                                        <div className="offline-history-event-copy">
                                                            <strong>Comunicação restabelecida</strong>
                                                            <span>
                                                                {episode.endedAt
                                                                    ? formatLastContact(episode.endedAt)
                                                                    : 'Horário não disponível'}
                                                            </span>
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="offline-history-duration">
                                                    <span>Duração da ocorrência</span>
                                                    <strong>
                                                        {completedDurationSeconds === null
                                                            ? 'Duração não disponível'
                                                            : formatElapsed(completedDurationSeconds * 1000)}
                                                    </strong>
                                                </div>
                                            </div>
                                            <section
                                                className="offline-history-sales"
                                                aria-label="Vendas realizadas offline"
                                            >
                                                <h3>Vendas realizadas offline</h3>
                                                {episode.offlineSales === null || episode.offlineSales.length === 0 ? (
                                                    <p className="offline-history-sales-pending" role="status">
                                                        Dados de vendas ainda não confirmados.
                                                        Eles serão exibidos quando a associação e a sincronização puderem ser comprovadas.
                                                    </p>
                                                ) : (
                                                    <>
                                                        <dl className="offline-history-sales-summary">
                                                            <div>
                                                                <dt>Quantidade de vendas</dt>
                                                                <dd>{episode.offlineSales.length}</dd>
                                                            </div>
                                                            <div>
                                                                <dt>Valor total</dt>
                                                                <dd>
                                                                    {offlineSalesCurrency.format(
                                                                        episode.offlineSales.reduce(
                                                                            (total, sale) => total + sale.total,
                                                                            0,
                                                                        ),
                                                                    )}
                                                                </dd>
                                                            </div>
                                                        </dl>
                                                        <button
                                                            className="offline-history-sales-toggle"
                                                            type="button"
                                                            aria-expanded={expandedOfflineSales.has(episode.id)}
                                                            aria-controls={`offline-sales-${episode.id}`}
                                                            onClick={() => {
                                                                setExpandedOfflineSales((current) => {
                                                                    const next = new Set(current)
                                                                    if (next.has(episode.id)) {
                                                                        next.delete(episode.id)
                                                                    } else {
                                                                        next.add(episode.id)
                                                                    }
                                                                    return next
                                                                })
                                                            }}
                                                        >
                                                            {expandedOfflineSales.has(episode.id)
                                                                ? 'Ocultar vendas'
                                                                : 'Ver vendas'}
                                                        </button>
                                                        <ul
                                                            className="offline-history-sales-list"
                                                            id={`offline-sales-${episode.id}`}
                                                            hidden={!expandedOfflineSales.has(episode.id)}
                                                        >
                                                            {episode.offlineSales.map((sale, index) => (
                                                                <li key={sale.id}>
                                                                    <div className="offline-history-sale-details">
                                                                        <strong>Venda {index + 1}</strong>
                                                                        {sale.items.length > 0 ? (
                                                                            <ul className="offline-history-sale-items">
                                                                                {sale.items.map((item, itemIndex) => (
                                                                                    <li key={`${sale.id}-${itemIndex}`}>
                                                                                        <span className="offline-history-sale-item-name">
                                                                                            <Package size={14} aria-hidden="true" />
                                                                                            <span>{item.name}</span>
                                                                                        </span>
                                                                                        <span className="offline-history-sale-item-quantity">
                                                                                            {item.quantity} {item.quantity === 1 ? 'unidade' : 'unidades'}
                                                                                        </span>
                                                                                    </li>
                                                                                ))}
                                                                            </ul>
                                                                        ) : (
                                                                            <span className="offline-history-sale-items-unavailable">
                                                                                Produtos não disponíveis.
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                    <strong className="offline-history-sale-total">
                                                                        {offlineSalesCurrency.format(sale.total)}
                                                                    </strong>
                                                                </li>
                                                            ))}
                                                        </ul>
                                                    </>
                                                )}
                                            </section>
                                        </article>
                                    )
                                })}
                                </div>
                                <nav className="offline-history-pagination" aria-label="Paginação do histórico">
                                    <button
                                        type="button"
                                        onClick={() => setHistoryPage(Math.max(1, currentHistoryPage - 1))}
                                        disabled={currentHistoryPage === 1}
                                    >
                                        Anterior
                                    </button>
                                    <span>Página {currentHistoryPage} de {historyTotalPages}</span>
                                    <button
                                        type="button"
                                        onClick={() => setHistoryPage(Math.min(historyTotalPages, currentHistoryPage + 1))}
                                        disabled={currentHistoryPage === historyTotalPages}
                                    >
                                        Próxima
                                    </button>
                                </nav>
                            </>
                        )}
                    </section>
                </div>
            </main>
        </div>
    )
}
