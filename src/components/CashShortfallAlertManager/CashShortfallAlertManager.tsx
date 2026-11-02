import { AlertTriangle, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import { useAuth } from '../../contexts/AuthContext'
import {
    acknowledgeCashShortfallAlert,
    getPendingCashShortfallAlerts,
    type CashShortfallAlert,
} from '../../services/cashShortfallAlerts'
import './CashShortfallAlertManager.css'

const currency = new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
})

const dateTime = new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
})

const ALERT_POLL_INTERVAL_MS = 60_000

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

export default function CashShortfallAlertManager() {
    const { authenticatedUser } = useAuth()
    const navigate = useNavigate()
    const location = useLocation()
    const [alerts, setAlerts] = useState<CashShortfallAlert[]>([])
    const [dismissedAlerts, setDismissedAlerts] = useState<Set<string>>(() => new Set())
    const [isConfirming, setIsConfirming] = useState(false)
    const [confirmationError, setConfirmationError] = useState('')
    const [isPaused, setIsPaused] = useState(false)
    const isLoadingRef = useRef(false)
    const shouldPauseUntilLeavingHistoryRef = useRef(false)
    const currentUserIdRef = useRef(authenticatedUser?.id)
    const visibleAlert = alerts.find((alert) => !dismissedAlerts.has(alert.closureId)) ?? null
    const isOwner = authenticatedUser?.role === 'owner'
    const userId = authenticatedUser?.id

    const refreshAlerts = useCallback(async () => {
        if (isLoadingRef.current || !isOwner) return
        isLoadingRef.current = true
        try {
            const pendingAlerts = await getPendingCashShortfallAlerts()
            if (currentUserIdRef.current !== userId) return
            setAlerts((current) => areAlertsEqual(current, pendingAlerts) ? current : pendingAlerts)
        } catch (error) {
            console.error('A consulta periódica de alertas de falta no caixa falhou.', error)
        } finally {
            isLoadingRef.current = false
        }
    }, [isOwner, userId])

    useEffect(() => {
        currentUserIdRef.current = userId
        if (!isOwner || !userId) {
            isLoadingRef.current = false
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
    }, [isOwner, refreshAlerts, userId])

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
        if (!visibleAlert) return
        const alertToDismiss = visibleAlert
        function handleKeyDown(event: KeyboardEvent) {
            if (event.key === 'Escape') {
                setDismissedAlerts((current) => new Set(current).add(alertToDismiss.closureId))
                setConfirmationError('')
            }
        }
        document.addEventListener('keydown', handleKeyDown)
        return () => document.removeEventListener('keydown', handleKeyDown)
    }, [visibleAlert])

    if (!isOwner || !visibleAlert || isPaused) return null
    const activeAlert = visibleAlert

    function dismissTemporarily() {
        setDismissedAlerts((current) => new Set(current).add(activeAlert.closureId))
        setConfirmationError('')
    }

    async function confirmAwareness() {
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
                    aria-label="Fechar alerta temporariamente"
                    onClick={dismissTemporarily}
                >
                    <X size={20} aria-hidden="true" />
                </button>
                <div className="cash-shortfall-icon">
                    <AlertTriangle size={24} aria-hidden="true" />
                </div>
                <h2 id="cash-shortfall-title">Falta identificada no caixa</h2>
                <p id="cash-shortfall-description" className="cash-shortfall-description">
                    Um fechamento apresentou uma diferença no valor informado.
                </p>
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
            </section>
        </div>
    )
}
