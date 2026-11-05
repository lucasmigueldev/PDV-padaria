import { AlertTriangle, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import { useAuth } from '../../contexts/AuthContext'
import { useOverdueCashRegisterAlertContext } from '../../contexts/OverdueCashRegisterAlertContext'
import {
    acknowledgeCashShortfallAlert,
    getPendingCashShortfallAlerts,
    type CashShortfallAlert,
} from '../../services/cashShortfallAlerts'
import {
    formatOverdueDuration,
    getOverdueCashRegisterAlerts,
    selectVisibleOverdueCashRegisterAlert,
    type OverdueCashRegisterAlert,
} from '../../services/overdueCashRegisterAlerts'
import {
    administrativelyCloseOverdueCashRegister,
    isAdminCashRegisterClosureEnabled,
} from '../../services/adminCashRegisterClosure'
import './CashShortfallAlertManager.css'

const currency = new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
})

const dateTime = new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
})

const saoPauloDateTime = new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo',
})

const ALERT_POLL_INTERVAL_MS = 60_000
const ADMIN_ALERT_PATHS = new Set([
    '/dashboard',
    '/historico-fechamentos',
    '/produtos',
    '/caixas-pendentes',
    '/relatorios',
    '/relatorios-offline',
    '/configuracoes',
])

function areAlertsEqual(
    first: readonly CashShortfallAlert[],
    second: readonly CashShortfallAlert[],
): boolean {
    return first.length === second.length
        && first.every((alert, index) => {
            const next = second[index]
            return next !== undefined
                && alert.closureId === next.closureId
                && alert.bakeryId === next.bakeryId
                && alert.bakeryName === next.bakeryName
                && alert.operatorName === next.operatorName
                && alert.closedAt === next.closedAt
                && alert.expectedAmount === next.expectedAmount
                && alert.countedAmount === next.countedAmount
                && alert.shortageAmount === next.shortageAmount
        })
}

function areOverdueAlertsEqual(
    first: readonly OverdueCashRegisterAlert[],
    second: readonly OverdueCashRegisterAlert[],
): boolean {
    return first.length === second.length
        && first.every((alert, index) => {
            const next = second[index]
            return next !== undefined
                && alert.cashRegisterId === next.cashRegisterId
                && alert.bakeryId === next.bakeryId
                && alert.bakeryName === next.bakeryName
                && alert.operatorName === next.operatorName
                && alert.openedAt === next.openedAt
                && alert.deadlineAt === next.deadlineAt
                && alert.overdueSeconds === next.overdueSeconds
        })
}

export default function CashShortfallAlertManager() {
    const { authenticatedUser, isAuthLoading } = useAuth()
    const {
        setAlertCount,
        setAlerts: setContextOverdueAlerts,
        setIsLoading: setOverdueLoading,
        setError: setOverdueError,
        dismissedAlerts: dismissedOverdueAlerts,
        setDismissedAlerts: setDismissedOverdueAlerts,
        requestedAlertId,
        setRequestedAlertId,
    } = useOverdueCashRegisterAlertContext()
    const navigate = useNavigate()
    const location = useLocation()
    const [alerts, setAlerts] = useState<CashShortfallAlert[]>([])
    const [dismissedAlerts, setDismissedAlerts] = useState<Set<string>>(() => new Set())
    const [overdueAlerts, setOverdueAlerts] = useState<OverdueCashRegisterAlert[]>([])
    const [isConfirming, setIsConfirming] = useState(false)
    const [confirmationError, setConfirmationError] = useState('')
    const [isAdminCloseFormOpen, setIsAdminCloseFormOpen] = useState(false)
    const [adminCloseReason, setAdminCloseReason] = useState('')
    const [isAdminClosing, setIsAdminClosing] = useState(false)
    const [adminCloseError, setAdminCloseError] = useState('')
    const [adminCloseSuccess, setAdminCloseSuccess] = useState('')
    const [isPaused, setIsPaused] = useState(false)
    const adminCloseInFlightRef = useRef(false)
    const isLoadingRef = useRef(false)
    const shouldPauseUntilLeavingHistoryRef = useRef(false)
    const currentUserIdRef = useRef(authenticatedUser?.id)
    const canMonitorAlertsRef = useRef(false)
    const visibleAlert = alerts.find((alert) => !dismissedAlerts.has(alert.closureId)) ?? null
    const requestedOverdueAlert = requestedAlertId
        ? overdueAlerts.find((alert) => alert.cashRegisterId === requestedAlertId
            && !dismissedOverdueAlerts.has(alert.cashRegisterId)) ?? null
        : null
    const visibleOverdueAlert = visibleAlert
        ? null
        : requestedOverdueAlert
            ?? selectVisibleOverdueCashRegisterAlert(overdueAlerts, dismissedOverdueAlerts)
    const isOwner = authenticatedUser?.role === 'owner'
    const canAdministrativelyClose = isOwner && isAdminCashRegisterClosureEnabled()
    const userId = authenticatedUser?.id
    const isAdminArea = ADMIN_ALERT_PATHS.has(location.pathname)
    const canMonitorAlerts = !isAuthLoading && isOwner && Boolean(userId) && isAdminArea

    useEffect(() => {
        canMonitorAlertsRef.current = canMonitorAlerts
    }, [canMonitorAlerts])

    const refreshAlerts = useCallback(async () => {
        if (isLoadingRef.current || !canMonitorAlerts) return
        isLoadingRef.current = true
        setOverdueLoading(true)
        setOverdueError(null)
        try {
            const pendingAlerts = await getPendingCashShortfallAlerts()
            if (currentUserIdRef.current === userId && canMonitorAlertsRef.current) {
                setAlerts((current) => areAlertsEqual(current, pendingAlerts) ? current : pendingAlerts)
            }
        } catch (error) {
            console.error('A consulta periódica de alertas de falta no caixa falhou.', error)
        }
        try {
            const pendingOverdueAlerts = await getOverdueCashRegisterAlerts()
            if (currentUserIdRef.current === userId && canMonitorAlertsRef.current) {
                setAlertCount(pendingOverdueAlerts.length)
                setContextOverdueAlerts(pendingOverdueAlerts)
                setOverdueAlerts((current) => areOverdueAlertsEqual(current, pendingOverdueAlerts)
                    ? current
                    : pendingOverdueAlerts)
            }
        } catch (error) {
            console.error('A consulta periódica de caixas atrasados falhou.', error)
            if (currentUserIdRef.current === userId && canMonitorAlertsRef.current) {
                setOverdueError(error instanceof Error
                    ? error.message
                    : 'Não foi possível carregar os caixas atrasados. Tente novamente.')
            }
        } finally {
            isLoadingRef.current = false
            setOverdueLoading(false)
        }
    }, [
        canMonitorAlerts,
        setAlertCount,
        setContextOverdueAlerts,
        setOverdueError,
        setOverdueLoading,
        userId,
    ])

    useEffect(() => {
        currentUserIdRef.current = userId
        if (!canMonitorAlerts) {
            isLoadingRef.current = false
            setAlertCount(0)
            setContextOverdueAlerts([])
            setOverdueError(null)
            setOverdueLoading(false)
            setRequestedAlertId(null)
            return
        }

        isLoadingRef.current = false
        const initialRequestId = window.setTimeout(() => {
            void refreshAlerts()
        }, 0)
        const intervalId = window.setInterval(() => {
            void refreshAlerts()
        }, ALERT_POLL_INTERVAL_MS)
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') void refreshAlerts()
        }
        document.addEventListener('visibilitychange', handleVisibilityChange)

        return () => {
            window.clearTimeout(initialRequestId)
            window.clearInterval(intervalId)
            document.removeEventListener('visibilitychange', handleVisibilityChange)
        }
    }, [
        canMonitorAlerts,
        refreshAlerts,
        setAlertCount,
        setContextOverdueAlerts,
        setOverdueError,
        setOverdueLoading,
        setRequestedAlertId,
        userId,
    ])

    useEffect(() => {
        const frameId = window.requestAnimationFrame(() => {
            setConfirmationError('')
            if (location.pathname === '/historico-fechamentos') {
                if (!shouldPauseUntilLeavingHistoryRef.current) {
                    setDismissedAlerts(new Set())
                }
                return
            }

            setIsPaused(false)
            if (shouldPauseUntilLeavingHistoryRef.current) {
                shouldPauseUntilLeavingHistoryRef.current = false
                setDismissedAlerts(new Set())
            }
        })
        return () => window.cancelAnimationFrame(frameId)
    }, [location.pathname])

    useEffect(() => {
        if (!visibleAlert && !visibleOverdueAlert) return
        const alertToDismiss = visibleAlert
        const overdueAlertToDismiss = visibleOverdueAlert
        function handleKeyDown(event: KeyboardEvent) {
            if (adminCloseInFlightRef.current) return
            if (event.key === 'Escape') {
                if (alertToDismiss) {
                    setDismissedAlerts((current) => new Set(current).add(alertToDismiss.closureId))
                } else if (overdueAlertToDismiss) {
                    setDismissedOverdueAlerts((current) => new Set(current).add(overdueAlertToDismiss.cashRegisterId))
                    setRequestedAlertId(null)
                }
                setConfirmationError('')
            }
        }
        document.addEventListener('keydown', handleKeyDown)
        return () => document.removeEventListener('keydown', handleKeyDown)
    }, [setDismissedOverdueAlerts, setRequestedAlertId, visibleAlert, visibleOverdueAlert])

    if (!canMonitorAlerts || (!visibleAlert && !visibleOverdueAlert && !adminCloseSuccess) || isPaused) return null
    const activeAlert = visibleAlert
    const activeOverdueAlert = visibleOverdueAlert

    function dismissTemporarily() {
        if (!activeAlert) return
        setDismissedAlerts((current) => new Set(current).add(activeAlert.closureId))
        setConfirmationError('')
    }

    function dismissOverdueTemporarily() {
        if (!activeOverdueAlert || adminCloseInFlightRef.current) return
        setDismissedOverdueAlerts((current) => new Set(current).add(activeOverdueAlert.cashRegisterId))
        setRequestedAlertId(null)
    }

    function openAdminCloseForm() {
        if (!activeOverdueAlert || !canAdministrativelyClose) return
        setAdminCloseError('')
        setAdminCloseSuccess('')
        setAdminCloseReason('')
        setIsAdminCloseFormOpen(true)
    }

    function cancelAdminCloseForm() {
        if (adminCloseInFlightRef.current) return
        setIsAdminCloseFormOpen(false)
        setAdminCloseReason('')
        setAdminCloseError('')
    }

    async function confirmAdministrativeClose() {
        if (!activeOverdueAlert || !canAdministrativelyClose || adminCloseInFlightRef.current) return
        const reason = adminCloseReason.trim()
        if (!reason) {
            setAdminCloseError('Informe o motivo do encerramento.')
            return
        }

        adminCloseInFlightRef.current = true
        setIsAdminClosing(true)
        setAdminCloseError('')
        try {
            await administrativelyCloseOverdueCashRegister(activeOverdueAlert.cashRegisterId, reason)
            const closedRegisterId = activeOverdueAlert.cashRegisterId
            setAdminCloseSuccess('O caixa foi encerrado operacionalmente. A conferência financeira continua pendente; o dinheiro físico não foi conferido. Podem existir vendas offline ainda desconhecidas pelo servidor.')
            setIsAdminCloseFormOpen(false)
            setAdminCloseReason('')
            setRequestedAlertId(null)
            setDismissedOverdueAlerts((current) => new Set(current).add(closedRegisterId))
            const remainingOverdueAlerts = overdueAlerts.filter(
                (alert) => alert.cashRegisterId !== closedRegisterId,
            )
            setOverdueAlerts(remainingOverdueAlerts)
            setContextOverdueAlerts(remainingOverdueAlerts)
            setAlertCount(remainingOverdueAlerts.length)
            await refreshAlerts()
        } catch (error) {
            setAdminCloseError(error instanceof Error
                ? error.message
                : 'Não foi possível confirmar o encerramento. Atualize os dados e tente novamente.')
        } finally {
            adminCloseInFlightRef.current = false
            setIsAdminClosing(false)
        }
    }

    async function confirmAwareness() {
        if (!activeAlert) return
        setIsConfirming(true)
        setConfirmationError('')
        try {
            await acknowledgeCashShortfallAlert(activeAlert.closureId)
            setAlerts((current) => current.filter((alert) => alert.closureId !== activeAlert.closureId))
            setDismissedAlerts((current) => {
                const next = new Set(current)
                next.delete(activeAlert.closureId)
                return next
            })
        } catch (error) {
            setConfirmationError(error instanceof Error
                ? error.message
                : 'Não foi possível confirmar a leitura. O alerta continuará pendente; tente novamente.')
        } finally {
            setIsConfirming(false)
        }
    }

    function openClosure() {
        if (!activeAlert) return
        setDismissedAlerts((current) => new Set(current).add(activeAlert.closureId))
        shouldPauseUntilLeavingHistoryRef.current = true
        setIsPaused(true)
        navigate('/historico-fechamentos', {
            state: { focusClosureId: activeAlert.closureId },
        })
    }

    return (
        <div className="cash-shortfall-overlay">
            <section
                className="cash-shortfall-dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby="cash-shortfall-title"
                aria-describedby="cash-shortfall-description"
            >
                <button
                    className="cash-shortfall-close"
                    type="button"
                    aria-label={adminCloseSuccess
                        ? 'Concluir'
                        : isAdminCloseFormOpen
                            ? 'Cancelar encerramento administrativo'
                            : 'Dispensar alerta temporariamente'}
                    onClick={adminCloseSuccess
                        ? () => setAdminCloseSuccess('')
                        : isAdminCloseFormOpen
                            ? cancelAdminCloseForm
                            : activeAlert
                                ? dismissTemporarily
                                : dismissOverdueTemporarily}
                    disabled={isAdminClosing}
                >
                    <X size={20} aria-hidden="true" />
                </button>
                <div className="cash-shortfall-icon">
                    <AlertTriangle size={24} aria-hidden="true" />
                </div>
                <h2 id="cash-shortfall-title">
                    {adminCloseSuccess
                        ? 'Encerramento operacional registrado'
                        : activeAlert
                            ? 'Falta identificada no caixa'
                            : 'Caixa aberto após o horário limite'}
                </h2>
                <p id="cash-shortfall-description" className="cash-shortfall-description">
                    {adminCloseSuccess
                        ? adminCloseSuccess
                        : activeAlert
                        ? 'Um fechamento apresentou uma diferença no valor informado.'
                        : 'O operador pode fechar o caixa pelo fluxo normal. Se você for um owner autorizado e o prazo já tiver vencido, também pode solicitar o encerramento administrativo; a conferência financeira continuará pendente.'}
                </p>
                {adminCloseSuccess ? null : activeAlert ? (
                    <>
                        <div className="cash-shortfall-amount">
                            <span>Valor da falta</span>
                            <strong>{currency.format(activeAlert.shortageAmount)}</strong>
                        </div>
                        <dl className="cash-shortfall-values">
                            <div>
                                <dt>Valor esperado</dt>
                                <dd>{currency.format(activeAlert.expectedAmount)}</dd>
                            </div>
                            <div>
                                <dt>Valor contado</dt>
                                <dd>{currency.format(activeAlert.countedAmount)}</dd>
                            </div>
                        </dl>
                        <dl className="cash-shortfall-context">
                            <div>
                                <dt>Padaria</dt>
                                <dd>{activeAlert.bakeryName}</dd>
                            </div>
                            {activeAlert.operatorName && (
                                <div>
                                    <dt>Operador</dt>
                                    <dd>{activeAlert.operatorName}</dd>
                                </div>
                            )}
                            <div>
                                <dt>Fechamento</dt>
                                <dd>{dateTime.format(new Date(activeAlert.closedAt))}</dd>
                            </div>
                        </dl>
                        <p className="cash-shortfall-disclaimer">
                            A confirmação apenas registra que você tomou conhecimento e não altera os valores financeiros.
                        </p>
                    </>
                ) : activeOverdueAlert ? (
                    <>
                        <dl className="cash-shortfall-context cash-overdue-context">
                            <div>
                                <dt>Padaria</dt>
                                <dd>{activeOverdueAlert.bakeryName}</dd>
                            </div>
                            <div>
                                <dt>Operador</dt>
                                <dd>{activeOverdueAlert.operatorName ?? 'Não identificado'}</dd>
                            </div>
                            <div>
                                <dt>Abertura</dt>
                                <dd>{saoPauloDateTime.format(new Date(activeOverdueAlert.openedAt))}</dd>
                            </div>
                            <div>
                                <dt>Horário limite ultrapassado</dt>
                                <dd>{saoPauloDateTime.format(new Date(activeOverdueAlert.deadlineAt))}</dd>
                            </div>
                            <div>
                                <dt>Tempo de atraso</dt>
                                <dd>{formatOverdueDuration(activeOverdueAlert.overdueSeconds)}</dd>
                            </div>
                        </dl>
                        <p className="cash-shortfall-disclaimer cash-overdue-disclaimer">
                            Prefira o fechamento normal pelo operador para sincronizar vendas offline. Se isso não for possível, um owner autorizado pode solicitar o encerramento administrativo; vendas offline ainda podem chegar depois e a conferência financeira continuará pendente.
                        </p>
                    </>
                ) : null}
                {adminCloseSuccess && (
                    <div className="cash-shortfall-actions">
                        <button
                            className="cash-shortfall-confirm"
                            type="button"
                            onClick={() => setAdminCloseSuccess('')}
                        >
                            Concluir
                        </button>
                    </div>
                )}
                {activeAlert && !adminCloseSuccess && (
                    <>
                        {confirmationError && (
                            <p className="cash-shortfall-error" role="alert">{confirmationError}</p>
                        )}
                        <div className="cash-shortfall-actions">
                            <button
                                className="cash-shortfall-view"
                                type="button"
                                onClick={openClosure}
                            >
                                Ver fechamento
                            </button>
                            <button
                                className="cash-shortfall-confirm"
                                type="button"
                                onClick={() => void confirmAwareness()}
                                disabled={isConfirming}
                            >
                                {isConfirming ? 'Salvando...' : 'Estou ciente'}
                            </button>
                        </div>
                    </>
                )}
                {activeOverdueAlert && !adminCloseSuccess && (
                    <>
                        {!isAdminCloseFormOpen && (
                            <div className="cash-shortfall-actions">
                                {canAdministrativelyClose && (
                                    <button
                                        className="cash-shortfall-admin-close"
                                        type="button"
                                        onClick={openAdminCloseForm}
                                    >
                                        Encerrar caixa
                                    </button>
                                )}
                                <button
                                    className="cash-shortfall-confirm"
                                    type="button"
                                    onClick={dismissOverdueTemporarily}
                                >
                                    Entendi
                                </button>
                            </div>
                        )}
                        {isAdminCloseFormOpen && (
                            <div className="cash-shortfall-admin-close-form">
                                <p className="cash-shortfall-disclaimer cash-overdue-disclaimer">
                                    Este encerramento é apenas operacional: o dinheiro físico não será conferido e a conferência financeira ficará pendente. Podem existir vendas offline no dispositivo do operador que ainda não chegaram ao servidor.
                                </p>
                                <label htmlFor="admin-cash-register-close-reason">Motivo do encerramento</label>
                                <textarea
                                    id="admin-cash-register-close-reason"
                                    value={adminCloseReason}
                                    onChange={(event) => setAdminCloseReason(event.target.value.slice(0, 500))}
                                    maxLength={500}
                                    rows={3}
                                    required
                                    disabled={isAdminClosing}
                                />
                                {adminCloseError && (
                                    <p className="cash-shortfall-error" role="alert">{adminCloseError}</p>
                                )}
                                <div className="cash-shortfall-actions">
                                    <button
                                        className="cash-shortfall-view"
                                        type="button"
                                        onClick={cancelAdminCloseForm}
                                        disabled={isAdminClosing}
                                    >
                                        Cancelar
                                    </button>
                                    <button
                                        className="cash-shortfall-admin-close"
                                        type="button"
                                        onClick={() => void confirmAdministrativeClose()}
                                        disabled={isAdminClosing || !adminCloseReason.trim()}
                                    >
                                        {isAdminClosing ? 'Encerrando...' : 'Confirmar encerramento administrativo'}
                                    </button>
                                </div>
                            </div>
                        )}
                        {adminCloseError && !isAdminCloseFormOpen && (
                            <p className="cash-shortfall-error" role="alert">{adminCloseError}</p>
                        )}
                    </>
                )}
            </section>
        </div>
    )
}
