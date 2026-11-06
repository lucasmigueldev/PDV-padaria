import { AlertTriangle, CheckCircle2, Clock3, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { AdminPageHeader } from '../../components/AdminPageHeader/AdminPageHeader'
import { AdminSidebar } from '../../components/AdminSidebar/AdminSidebar'
import { useAuth } from '../../contexts/AuthContext'
import { useOverdueCashRegisterAlertContext } from '../../contexts/OverdueCashRegisterAlertContext'
import { useEstablishmentName } from '../../services/establishment'
import { formatOverdueDuration } from '../../services/overdueCashRegisterAlerts'
import {
    administrativelyCloseOverdueCashRegister,
    isAdminCashRegisterClosureEnabled,
} from '../../services/adminCashRegisterClosure'
import {
    getAdminCashRegisterReconciliationPreview,
    getPendingLateOfflineSaleDetails,
    listAdminClosedCashRegisters,
    listPendingLateOfflineSales,
    partitionAdminClosedCashRegisters,
    reconcileAdministrativelyClosedCashRegister,
    reviewLateOfflineSale,
    type AdminCashRegisterReconciliationPreview,
    type AdminClosedCashRegister,
    type PendingLateOfflineSale,
} from '../../services/adminCashRegisterReview'
import { logoutAndRedirect } from '../../utils/auth'
import './CaixasPendentes.css'

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const dateTime = new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo',
})

const saoPauloTime = new Intl.DateTimeFormat('pt-BR', {
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo',
})

export default function CaixasPendentes() {
    const navigate = useNavigate()
    const { authenticatedUser } = useAuth()
    const {
        alerts,
        alertCount,
        setAlertCount,
        setAlerts,
        setDismissedAlerts,
        setRequestedAlertId,
        isLoading,
        error,
        openDetails,
    } = useOverdueCashRegisterAlertContext()
    const establishmentName = useEstablishmentName()
    const isOwner = authenticatedUser?.role === 'owner'
    const canReviewAdminClosures = isOwner && isAdminCashRegisterClosureEnabled()
    const [adminRegisters, setAdminRegisters] = useState<AdminClosedCashRegister[]>([])
    const [adminLoading, setAdminLoading] = useState(false)
    const [adminError, setAdminError] = useState('')
    const [selectedRegisterId, setSelectedRegisterId] = useState<string | null>(null)
    const [pendingSales, setPendingSales] = useState<PendingLateOfflineSale[]>([])
    const [selectedSale, setSelectedSale] = useState<PendingLateOfflineSale | null>(null)
    const [preview, setPreview] = useState<AdminCashRegisterReconciliationPreview | null>(null)
    const [reviewDecision, setReviewDecision] = useState<'approved' | 'rejected' | null>(null)
    const [reviewReason, setReviewReason] = useState('')
    const [acceptHistoricalValues, setAcceptHistoricalValues] = useState(false)
    const [acceptPriceDivergence, setAcceptPriceDivergence] = useState(false)
    const [countedAmount, setCountedAmount] = useState('')
    const [reconciliationReason, setReconciliationReason] = useState('')
    const [acknowledgeUnknownOfflineSales, setAcknowledgeUnknownOfflineSales] = useState(false)
    const [adminActionError, setAdminActionError] = useState('')
    const [isActionPending, setIsActionPending] = useState(false)
    const [closeConfirmationRegisterId, setCloseConfirmationRegisterId] = useState<string | null>(null)
    const [closeReason, setCloseReason] = useState('')
    const [closingRegisterId, setClosingRegisterId] = useState<string | null>(null)
    const [closeError, setCloseError] = useState('')
    const [closeSuccess, setCloseSuccess] = useState('')
    const [completedReconciliation, setCompletedReconciliation] = useState<{
        expectedAmount: number
        countedAmount: number
        differenceAmount: number
    } | null>(null)
    const actionInFlight = useRef(false)
    const closeInFlight = useRef(false)

    function handleLogout() {
        void logoutAndRedirect(navigate)
    }

    function openCloseConfirmation(registerId: string) {
        if (!canReviewAdminClosures || closeInFlight.current) return
        setCloseConfirmationRegisterId(registerId)
        setCloseReason('')
        setCloseError('')
        setCloseSuccess('')
    }

    function cancelCloseConfirmation() {
        if (closeInFlight.current) return
        setCloseConfirmationRegisterId(null)
        setCloseReason('')
        setCloseError('')
    }

    async function confirmAdministrativeClose(registerId: string) {
        if (!canReviewAdminClosures || closeInFlight.current) return
        const reason = closeReason.trim()
        if (!reason) {
            setCloseError('Informe o motivo do encerramento.')
            return
        }

        closeInFlight.current = true
        setClosingRegisterId(registerId)
        setCloseError('')
        setCloseSuccess('')
        try {
            await administrativelyCloseOverdueCashRegister(registerId, reason)
            const remainingAlerts = alerts.filter((alert) => alert.cashRegisterId !== registerId)
            setAlerts(remainingAlerts)
            setAlertCount(remainingAlerts.length)
            setDismissedAlerts((current) => new Set(current).add(registerId))
            setRequestedAlertId(null)
            setCloseConfirmationRegisterId(null)
            setCloseReason('')
            setCloseSuccess('Encerramento operacional registrado. A conferência financeira permanece pendente; vendas offline ainda podem ser recebidas e revisadas posteriormente.')
        } catch (error) {
            setCloseError(error instanceof Error
                ? error.message
                : 'Não foi possível confirmar o encerramento. Atualize os dados e tente novamente.')
        } finally {
            closeInFlight.current = false
            setClosingRegisterId(null)
        }
    }

    const refreshAdminRegisters = useCallback(async () => {
        if (!canReviewAdminClosures) return
        setAdminLoading(true)
        setAdminError('')
        try {
            const registers = await listAdminClosedCashRegisters({ isOwner })
            setAdminRegisters(registers)
        } catch (error) {
            setAdminError(error instanceof Error
                ? error.message
                : 'Não foi possível carregar os caixas encerrados administrativamente.')
        } finally {
            setAdminLoading(false)
        }
    }, [canReviewAdminClosures, isOwner])

    useEffect(() => {
        if (canReviewAdminClosures) void Promise.resolve().then(refreshAdminRegisters)
    }, [canReviewAdminClosures, refreshAdminRegisters])

    async function openAdministrativeRegister(register: AdminClosedCashRegister) {
        if (!canReviewAdminClosures || actionInFlight.current) return
        if (selectedRegisterId === register.cashRegisterId) {
            setSelectedRegisterId(null)
            setSelectedSale(null)
            return
        }
        setSelectedRegisterId(register.cashRegisterId)
        setSelectedSale(null)
        setReviewDecision(null)
        setReviewReason('')
        setPreview(null)
        setCompletedReconciliation(null)
        setAdminActionError('')
        try {
            const requests: [
                Promise<PendingLateOfflineSale[]>,
                Promise<AdminCashRegisterReconciliationPreview | null>,
            ] = [
                listPendingLateOfflineSales(register.cashRegisterId, { isOwner, enabled: true }),
                register.reconciliation
                    ? Promise.resolve(null)
                    : getAdminCashRegisterReconciliationPreview(register, { isOwner, enabled: true }),
            ]
            const [sales, nextPreview] = await Promise.all(requests)
            setPendingSales(sales)
            setPreview(nextPreview)
        } catch (error) {
            setAdminActionError(error instanceof Error
                ? error.message
                : 'Não foi possível consultar os dados deste caixa.')
        }
    }

    async function openLateSale(sale: PendingLateOfflineSale) {
        if (!canReviewAdminClosures || actionInFlight.current) return
        setSelectedSale(null)
        setReviewDecision(null)
        setReviewReason('')
        setAcceptHistoricalValues(false)
        setAcceptPriceDivergence(false)
        setAdminActionError('')
        try {
            setSelectedSale(await getPendingLateOfflineSaleDetails(sale, {
                isOwner,
                enabled: true,
            }))
        } catch (error) {
            setAdminActionError(error instanceof Error
                ? error.message
                : 'Não foi possível consultar os detalhes da venda tardia.')
        }
    }

    async function submitLateSaleDecision() {
        if (!canReviewAdminClosures || !selectedSale || !reviewDecision || actionInFlight.current) return
        const hasMissingProduct = selectedSale.items.some((item) => item.currentPrice === null)
        if (reviewDecision === 'approved' && hasMissingProduct) {
            setAdminActionError('Um ou mais produtos não estão disponíveis nesta padaria. A venda continua pendente e não pode ser aprovada.')
            return
        }

        actionInFlight.current = true
        setIsActionPending(true)
        setAdminActionError('')
        try {
            await reviewLateOfflineSale({
                adminEventId: selectedSale.adminEventId,
                decision: reviewDecision,
                reason: reviewReason,
                acceptUnverifiedHistoricalValues: reviewDecision === 'approved' && acceptHistoricalValues,
                acceptPriceDivergence: reviewDecision === 'approved' && acceptPriceDivergence,
            }, { isOwner, enabled: true })
            const registerId = selectedRegisterId
            setSelectedSale(null)
            setReviewDecision(null)
            setReviewReason('')
            if (registerId) {
                const refreshedSales = await listPendingLateOfflineSales(registerId, { isOwner, enabled: true })
                setPendingSales(refreshedSales)
            }
            await refreshAdminRegisters()
        } catch (error) {
            setAdminActionError(error instanceof Error
                ? error.message
                : 'Não foi possível registrar a decisão. A venda permanece pendente.')
        } finally {
            actionInFlight.current = false
            setIsActionPending(false)
        }
    }

    async function submitReconciliation() {
        if (!canReviewAdminClosures || !selectedRegisterId || actionInFlight.current) return
        const parsedCount = Number(countedAmount)
        if (!Number.isFinite(parsedCount) || countedAmount.trim() === '') {
            setAdminActionError('Informe o valor físico contado.')
            return
        }

        actionInFlight.current = true
        setIsActionPending(true)
        setAdminActionError('')
        try {
            await reconcileAdministrativelyClosedCashRegister({
                cashRegisterId: selectedRegisterId,
                countedAmount: parsedCount,
                reason: reconciliationReason,
                acknowledgeUnverifiedOfflineCompleteness: acknowledgeUnknownOfflineSales,
            }, { isOwner, enabled: true })
            const updatedRegisters = await listAdminClosedCashRegisters({ isOwner })
            setAdminRegisters(updatedRegisters)
            const updatedRegister = updatedRegisters.find((register) =>
                register.cashRegisterId === selectedRegisterId)
            const snapshot = updatedRegister?.reconciliation
            if (!snapshot) {
                throw new Error('A conferência foi enviada, mas o snapshot salvo não pôde ser consultado. Atualize os dados antes de repetir.')
            }
            setCompletedReconciliation({
                expectedAmount: snapshot.expectedAmount,
                countedAmount: snapshot.countedAmount,
                differenceAmount: snapshot.differenceAmount,
            })
            setPreview(null)
        } catch (error) {
            setAdminActionError(error instanceof Error
                ? error.message
                : 'Não foi possível concluir a conferência. Atualize os dados antes de tentar novamente.')
        } finally {
            actionInFlight.current = false
            setIsActionPending(false)
        }
    }

    const {
        awaitingReconciliation,
        reconciled: reconciledRegisters,
        reconciledWithoutPendingPostSales,
        requiringPostReconciliationReview: postReconciliationRegisters,
    } = partitionAdminClosedCashRegisters(adminRegisters)

    function renderAdministrativeRegister(
        register: AdminClosedCashRegister,
        postReconciliation = false,
        requiresPostReview = false,
    ) {
        const isSelected = selectedRegisterId === register.cashRegisterId
        const summary = register.reconciliation
        const matchingAdminSection = postReconciliation
            ? reconciledRegisters.includes(register)
                && (requiresPostReview
                    ? register.postReconciliationPendingSaleCount > 0
                    : register.postReconciliationPendingSaleCount === 0)
            : awaitingReconciliation.includes(register)

        if (!matchingAdminSection) return null

        return (
            <article className="pending-register-card" key={register.cashRegisterId}>
                <header className="pending-register-card-header">
                    <h3>{register.bakeryName}</h3>
                    <strong className={postReconciliation && register.postReconciliationPendingSaleCount > 0
                        ? 'pending-register-delay'
                        : 'pending-admin-status'}>
                        {postReconciliation
                            ? register.postReconciliationPendingSaleCount > 0
                                ? `${register.postReconciliationPendingSaleCount} venda(s) posterior(es) pendente(s)`
                                : register.postReconciliationSaleCount > 0
                                    ? `${register.postReconciliationSaleCount} venda(s) posterior(es) analisada(s)`
                                    : 'Conferência registrada'
                            : `${register.pendingSaleCount} venda(s) para análise`}
                    </strong>
                </header>
                <p className="pending-register-card-meta">
                    <span>Operador: {register.operatorName}</span>
                    <span>· Aberto: {dateTime.format(new Date(register.openedAt))}</span>
                    <span>· Encerrado: {dateTime.format(new Date(register.closedAt))}</span>
                    <span>· Administrador: {register.administratorName}</span>
                </p>
                {postReconciliation && summary && (
                    <div className="pending-admin-snapshot">
                        <strong>Snapshot da conferência original</strong>
                        <span>Esperado: {currency.format(summary.expectedAmount)}</span>
                        <span>Contado: {currency.format(summary.countedAmount)}</span>
                        <span>Diferença: {currency.format(summary.differenceAmount)}</span>
                        <p>
                            A conferência de {dateTime.format(new Date(summary.reconciledAt))} não foi recalculada.
                            {register.postReconciliationPendingSaleCount > 0
                                ? ' Existem vendas tardias posteriores aguardando revisão.'
                                : ' As vendas recebidas depois foram analisadas separadamente.'}
                        </p>
                    </div>
                )}
                <div className="pending-register-card-divider" aria-hidden="true" />
                <footer className="pending-register-card-footer">
                    <span className="pending-register-status">
                        {postReconciliation
                            ? <AlertTriangle size={15} aria-hidden="true" />
                            : <Clock3 size={15} aria-hidden="true" />}
                        {postReconciliation
                            ? register.postReconciliationPendingSaleCount > 0
                                ? 'Revisão posterior à conferência'
                                : 'Conferência registrada'
                            : summary
                                ? 'Conferência registrada'
                                : 'Aguardando conferência excepcional'}
                    </span>
                    <button
                        type="button"
                        onClick={() => void openAdministrativeRegister(register)}
                        aria-expanded={isSelected}
                    >
                        {isSelected ? 'Fechar detalhes' : 'Consultar detalhes'}
                    </button>
                </footer>
                {isSelected && (
                    <div className="pending-admin-details">
                        <dl className="pending-admin-facts">
                            <div><dt>Padaria</dt><dd>{register.bakeryName}</dd></div>
                            <div><dt>Operador</dt><dd>{register.operatorName}</dd></div>
                            <div><dt>Abertura</dt><dd>{dateTime.format(new Date(register.openedAt))}</dd></div>
                            <div><dt>Encerramento administrativo</dt><dd>{dateTime.format(new Date(register.closedAt))}</dd></div>
                            <div><dt>Administrador</dt><dd>{register.administratorName}</dd></div>
                            <div><dt>Motivo</dt><dd>{register.closeReason}</dd></div>
                            <div><dt>Situação financeira</dt><dd>{summary ? 'Conferência registrada com ressalva' : 'Conferência pendente'}</dd></div>
                            <div><dt>Vendas tardias pendentes</dt><dd>{register.pendingSaleCount}</dd></div>
                        </dl>
                        {summary && (
                            <div className="pending-admin-snapshot">
                                <strong>Snapshot financeiro — não recalculado</strong>
                                <span>Esperado: {currency.format(summary.expectedAmount)}</span>
                                <span>Contado: {currency.format(summary.countedAmount)}</span>
                                <span>Diferença: {currency.format(summary.differenceAmount)}</span>
                                <span>Registrado por {summary.reconciledBy} em {dateTime.format(new Date(summary.reconciledAt))}</span>
                                <p>{summary.reason}</p>
                                <p>O snapshot não garante que todos os dispositivos sincronizaram.</p>
                            </div>
                        )}
                        {pendingSales.length > 0 && (
                            <div className="pending-admin-sales">
                                <h4>Vendas offline aguardando análise</h4>
                                {pendingSales.map((sale) => (
                                    <article className="pending-admin-sale" key={sale.adminEventId}>
                                        <div>
                                            <strong>{currency.format(sale.total)} · {sale.paymentMethod}</strong>
                                            <span>Dispositivo informa: {dateTime.format(new Date(sale.claimedOccurredAt))}</span>
                                            <span>Servidor recebeu: {dateTime.format(new Date(sale.serverReceivedAt))}</span>
                                        </div>
                                        <button type="button" onClick={() => void openLateSale(sale)}>
                                            Analisar venda
                                        </button>
                                    </article>
                                ))}
                            </div>
                        )}
                        {selectedSale && selectedSale.cashRegisterId === register.cashRegisterId && (
                            <section className="pending-admin-review" aria-label="Análise da venda tardia">
                                <h4>Venda de {selectedSale.operatorName}</h4>
                                <p className="pending-admin-honesty">
                                    O horário informado pelo dispositivo não comprova quando a venda ocorreu.
                                    Recebida pelo servidor em {dateTime.format(new Date(selectedSale.serverReceivedAt))}.
                                </p>
                                <p>Chave de idempotência: <code>{selectedSale.idempotencyKey}</code></p>
                                <p>Offline session: <code>{selectedSale.offlineSessionId ?? 'Não informado'}</code></p>
                                <ul className="pending-admin-items">
                                    {selectedSale.items.map((item) => (
                                        <li key={`${selectedSale.adminEventId}:${item.productId}`}>
                                            <span>{item.quantity} × {item.name}</span>
                                            <span>Histórico: {currency.format(item.price)}</span>
                                            <span>
                                                Catálogo atual: {item.currentPrice === null
                                                    ? 'produto indisponível'
                                                    : currency.format(item.currentPrice)}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                                {selectedSale.items.some((item) =>
                                    item.currentPrice !== null && item.currentPrice !== item.price) && (
                                    <label className="pending-admin-checkbox">
                                        <input
                                            type="checkbox"
                                            checked={acceptPriceDivergence}
                                            onChange={(event) => setAcceptPriceDivergence(event.target.checked)}
                                            disabled={isActionPending}
                                        />
                                        Reconheço a divergência entre os preços históricos enviados pelo dispositivo e o catálogo atual.
                                    </label>
                                )}
                                {reviewDecision && (
                                    <div className="pending-admin-form">
                                        <label htmlFor="late-sale-review-reason">
                                            {reviewDecision === 'rejected'
                                                ? 'Justificativa obrigatória para rejeição'
                                                : 'Justificativa da aprovação'}
                                        </label>
                                        <textarea
                                            id="late-sale-review-reason"
                                            value={reviewReason}
                                            onChange={(event) => setReviewReason(event.target.value.slice(0, 1000))}
                                            maxLength={1000}
                                            rows={3}
                                            disabled={isActionPending}
                                        />
                                        {reviewDecision === 'approved' && (
                                            <label className="pending-admin-checkbox">
                                                <input
                                                    type="checkbox"
                                                    checked={acceptHistoricalValues}
                                                    onChange={(event) => setAcceptHistoricalValues(event.target.checked)}
                                                    disabled={isActionPending}
                                                />
                                                Reconheço que o servidor não pode comprovar os valores históricos desta venda.
                                            </label>
                                        )}
                                        <div className="pending-admin-actions">
                                            <button
                                                type="button"
                                                className="pending-admin-cancel"
                                                onClick={() => setReviewDecision(null)}
                                                disabled={isActionPending}
                                            >
                                                Cancelar
                                            </button>
                                            <button
                                                type="button"
                                                className="pending-admin-submit"
                                                onClick={() => void submitLateSaleDecision()}
                                                disabled={isActionPending
                                                    || !reviewReason.trim()
                                                    || (reviewDecision === 'approved' && !acceptHistoricalValues)
                                                    || (reviewDecision === 'approved'
                                                        && selectedSale.items.some((item) => item.currentPrice === null))
                                                    || (reviewDecision === 'approved'
                                                        && selectedSale.items.some((item) =>
                                                            item.currentPrice !== null && item.currentPrice !== item.price)
                                                        && !acceptPriceDivergence)}
                                            >
                                                {isActionPending ? 'Salvando...' : `Confirmar ${reviewDecision === 'approved' ? 'aprovação' : 'rejeição'}`}
                                            </button>
                                        </div>
                                    </div>
                                )}
                                {!reviewDecision && (
                                    <div className="pending-admin-actions">
                                        <button
                                            type="button"
                                            className="pending-admin-reject"
                                            onClick={() => setReviewDecision('rejected')}
                                            disabled={isActionPending}
                                        >
                                            Rejeitar venda
                                        </button>
                                        <button
                                            type="button"
                                            className="pending-admin-submit"
                                            onClick={() => setReviewDecision('approved')}
                                            disabled={isActionPending
                                                || selectedSale.items.some((item) => item.currentPrice === null)}
                                        >
                                            Aprovar e contabilizar
                                        </button>
                                    </div>
                                )}
                            </section>
                        )}
                        {!summary && pendingSales.length === 0 && preview && (
                            <section className="pending-admin-reconciliation" aria-label="Conferência financeira excepcional">
                                <h4>Conferência financeira excepcional</h4>
                                <p className="pending-admin-honesty">
                                    Esta conferência tem ressalva: o servidor não consegue comprovar se todos os
                                    dispositivos sincronizaram. O valor esperado abaixo é uma prévia; o backend
                                    recalcula e valida o snapshot no momento da confirmação.
                                </p>
                                <div className="pending-admin-preview">
                                    <span>Valor inicial: {currency.format(preview.initialAmount)}</span>
                                    <span>Vendas em dinheiro reconhecidas: {currency.format(preview.recognizedCashSales)}</span>
                                    <strong>Prévia do valor esperado: {currency.format(preview.expectedAmount)}</strong>
                                    <strong>
                                        Diferença prevista:{' '}
                                        {countedAmount.trim() && Number.isFinite(Number(countedAmount))
                                            ? currency.format(Number(countedAmount) - preview.expectedAmount)
                                            : 'Informe o valor contado'}
                                    </strong>
                                </div>
                                <div className="pending-admin-form">
                                    <label htmlFor="admin-register-counted-amount">Valor físico contado (R$)</label>
                                    <input
                                        id="admin-register-counted-amount"
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        value={countedAmount}
                                        onChange={(event) => setCountedAmount(event.target.value)}
                                        disabled={isActionPending}
                                    />
                                    <label htmlFor="admin-register-reconciliation-reason">Justificativa</label>
                                    <textarea
                                        id="admin-register-reconciliation-reason"
                                        value={reconciliationReason}
                                        onChange={(event) => setReconciliationReason(event.target.value.slice(0, 1000))}
                                        maxLength={1000}
                                        rows={3}
                                        disabled={isActionPending}
                                    />
                                    <label className="pending-admin-checkbox">
                                        <input
                                            type="checkbox"
                                            checked={acknowledgeUnknownOfflineSales}
                                            onChange={(event) => setAcknowledgeUnknownOfflineSales(event.target.checked)}
                                            disabled={isActionPending}
                                        />
                                        Reconheço que vendas offline desconhecidas podem chegar depois e que a conferência não comprova sincronização completa.
                                    </label>
                                    <button
                                        type="button"
                                        className="pending-admin-submit"
                                        onClick={() => void submitReconciliation()}
                                        disabled={isActionPending
                                            || !countedAmount.trim()
                                            || !reconciliationReason.trim()
                                            || !acknowledgeUnknownOfflineSales}
                                    >
                                        {isActionPending ? 'Registrando...' : 'Confirmar conferência com ressalva'}
                                    </button>
                                </div>
                            </section>
                        )}
                        {completedReconciliation && (
                            <div className="pending-admin-success" role="status">
                                <CheckCircle2 size={18} aria-hidden="true" />
                                <div>
                                    <strong>Conferência registrada pelo backend</strong>
                                    <span>Esperado: {currency.format(completedReconciliation.expectedAmount)}</span>
                                    <span>Contado: {currency.format(completedReconciliation.countedAmount)}</span>
                                    <span>Diferença: {currency.format(completedReconciliation.differenceAmount)}</span>
                                </div>
                            </div>
                        )}
                        {summary && register.pendingSaleCount === 0 && !register.reconciliation?.lateSalesReceivedAfterReconciliation && (
                            <p className="pending-admin-honesty">
                                Não há vendas tardias conhecidas aguardando análise. Isso não comprova que todos os dispositivos sincronizaram.
                            </p>
                        )}
                        {adminActionError && (
                            <p className="pending-registers-error" role="alert">{adminActionError}</p>
                        )}
                    </div>
                )}
            </article>
        )
    }

    return (
        <div className="pending-registers-layout">
            <AdminSidebar user={authenticatedUser} onLogout={handleLogout} />
            <main className="pending-registers-main">
                <AdminPageHeader
                    title="Caixas Pendentes"
                    description="Acompanhamento de caixas abertos fora do horário"
                    overline="MONITORAMENTO"
                    establishmentName={establishmentName}
                    user={authenticatedUser}
                    onLogout={handleLogout}
                />

                <section className="pending-registers-content" aria-label="Lista de caixas atrasados">
                    <div className="pending-registers-content-heading">
                        <h2>Ocorrências</h2>
                        <span>
                            {alertCount} {alertCount === 1 ? 'caixa atrasado' : 'caixas atrasados'}
                        </span>
                    </div>

                    {error && (
                        <p className="pending-registers-error" role="alert">
                            {error}
                        </p>
                    )}

                    {closeSuccess && (
                        <p className="pending-registers-success" role="status">
                            {closeSuccess}
                        </p>
                    )}

                    {isLoading && alerts.length === 0 && (
                        <p className="pending-registers-state" role="status">
                            <RefreshCw size={18} aria-hidden="true" />
                            Carregando caixas atrasados...
                        </p>
                    )}

                    {!isLoading && !error && alerts.length === 0 && (
                        <div className="pending-registers-empty" role="status">
                            <Clock3 size={24} aria-hidden="true" />
                            <strong>Nenhum caixa atrasado</strong>
                            <span>Quando um caixa ultrapassar o horário limite, ele aparecerá aqui.</span>
                        </div>
                    )}

                    {alerts.length > 0 && (
                        <>
                            <aside className="pending-registers-notice" role="status" aria-live="polite">
                                <span className="pending-registers-notice-icon">
                                    <AlertTriangle size={19} aria-hidden="true" />
                                </span>
                                <div className="pending-registers-notice-copy">
                                    <strong>Atenção necessária</strong>
                                    <p>
                                        {alertCount === 1
                                            ? `Há ${alertCount} caixa aberto além do horário configurado.`
                                            : `Há ${alertCount} caixas abertos além do horário configurado.`}
                                    </p>
                                </div>
                            </aside>

                            <div className="pending-registers-list" aria-live="polite">
                                {alerts.map((alert) => (
                                    <article className="pending-register-card" key={alert.cashRegisterId}>
                                        <header className="pending-register-card-header">
                                            <h3>{alert.bakeryName}</h3>
                                            <strong className="pending-register-delay">
                                                {formatOverdueDuration(alert.overdueSeconds)}
                                            </strong>
                                        </header>
                                        <p className="pending-register-card-meta">
                                            <span>{alert.operatorName ?? 'Não identificado'}</span>
                                            <span>· Aberto às {saoPauloTime.format(new Date(alert.openedAt))}</span>
                                            <span>· Limite às {saoPauloTime.format(new Date(alert.deadlineAt))}</span>
                                        </p>
                                        <div className="pending-register-card-divider" aria-hidden="true" />
                                        <footer className="pending-register-card-footer">
                                            <span className="pending-register-status">
                                                <Clock3 size={15} aria-hidden="true" />
                                                Aguardando fechamento
                                            </span>
                                            <div className="pending-register-card-actions">
                                                {canReviewAdminClosures && (
                                                    <button
                                                        className="pending-register-admin-close-button"
                                                        type="button"
                                                        onClick={() => openCloseConfirmation(alert.cashRegisterId)}
                                                        disabled={closingRegisterId !== null}
                                                    >
                                                        Encerrar caixa
                                                    </button>
                                                )}
                                                <button
                                                    type="button"
                                                    onClick={() => openDetails(alert.cashRegisterId)}
                                                    disabled={closingRegisterId !== null}
                                                >
                                                    Consultar detalhes
                                                </button>
                                            </div>
                                        </footer>
                                        {closeConfirmationRegisterId === alert.cashRegisterId && (
                                            <div className="pending-register-close-confirmation">
                                                <strong>Confirmar encerramento administrativo?</strong>
                                                <p>
                                                    O encerramento é operacional, não confere o dinheiro físico e não impede o recebimento e a revisão posterior de vendas offline. A reconciliação financeira continuará pendente.
                                                </p>
                                                <label htmlFor={`admin-close-reason-${alert.cashRegisterId}`}>
                                                    Motivo do encerramento
                                                </label>
                                                <textarea
                                                    id={`admin-close-reason-${alert.cashRegisterId}`}
                                                    value={closeReason}
                                                    onChange={(event) => setCloseReason(event.target.value.slice(0, 500))}
                                                    maxLength={500}
                                                    rows={3}
                                                    required
                                                    disabled={closingRegisterId !== null}
                                                />
                                                {closeError && (
                                                    <p className="pending-register-close-error" role="alert">
                                                        {closeError}
                                                    </p>
                                                )}
                                                <div className="pending-register-close-actions">
                                                    <button
                                                        type="button"
                                                        onClick={cancelCloseConfirmation}
                                                        disabled={closingRegisterId !== null}
                                                    >
                                                        Cancelar
                                                    </button>
                                                    <button
                                                        className="pending-register-admin-close-button"
                                                        type="button"
                                                        onClick={() => void confirmAdministrativeClose(alert.cashRegisterId)}
                                                        disabled={closingRegisterId !== null || !closeReason.trim()}
                                                    >
                                                        {closingRegisterId === alert.cashRegisterId
                                                            ? 'Encerrando...'
                                                            : 'Confirmar encerramento administrativo'}
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                    </article>
                                ))}
                            </div>
                        </>
                    )}
                </section>

                {canReviewAdminClosures && (
                    <section className="pending-registers-content pending-admin-registers" aria-label="Revisão de caixas encerrados administrativamente">
                        <div className="pending-registers-content-heading">
                            <h2>Encerrados administrativamente — aguardando conferência</h2>
                            <span>{awaitingReconciliation.length}</span>
                            <button
                                type="button"
                                className="pending-admin-refresh"
                                onClick={() => void refreshAdminRegisters()}
                                disabled={adminLoading || isActionPending}
                            >
                                <RefreshCw size={15} aria-hidden="true" />
                                Atualizar
                            </button>
                        </div>
                        {adminError && <p className="pending-registers-error" role="alert">{adminError}</p>}
                        {adminLoading && adminRegisters.length === 0 && (
                            <p className="pending-registers-state" role="status">
                                <RefreshCw size={18} aria-hidden="true" />
                                Carregando conferências pendentes...
                            </p>
                        )}
                        {!adminLoading && awaitingReconciliation.length === 0 && (
                            <div className="pending-registers-empty" role="status">
                                <Clock3 size={24} aria-hidden="true" />
                                <strong>Nenhum caixa aguardando conferência</strong>
                                <span>Caixas encerrados administrativamente aparecerão aqui.</span>
                            </div>
                        )}
                        <div className="pending-registers-list">
                            {awaitingReconciliation.map((register) => renderAdministrativeRegister(register))}
                        </div>
                    </section>
                )}

                {canReviewAdminClosures && reconciledWithoutPendingPostSales.length > 0 && (
                    <section className="pending-registers-content pending-admin-registers" aria-label="Caixas com conferência excepcional registrada">
                        <div className="pending-registers-content-heading">
                            <h2>Conferência excepcional registrada</h2>
                            <span>{reconciledWithoutPendingPostSales.length}</span>
                        </div>
                        <div className="pending-registers-list">
                            {reconciledWithoutPendingPostSales.map((register) =>
                                renderAdministrativeRegister(register, true))}
                        </div>
                    </section>
                )}

                {canReviewAdminClosures && postReconciliationRegisters.length > 0 && (
                    <section className="pending-registers-content pending-admin-registers" aria-label="Vendas tardias posteriores à conferência aguardando análise">
                        <div className="pending-registers-content-heading">
                            <h2>Vendas tardias recebidas após a conferência</h2>
                            <span>{postReconciliationRegisters.length}</span>
                        </div>
                        <aside className="pending-registers-notice pending-admin-late-notice" role="alert">
                            <span className="pending-registers-notice-icon">
                                <AlertTriangle size={19} aria-hidden="true" />
                            </span>
                            <div className="pending-registers-notice-copy">
                                <strong>Nova análise necessária</strong>
                                <p>
                                    {postReconciliationRegisters.reduce(
                                        (total, register) => total + register.postReconciliationPendingSaleCount,
                                        0,
                                    )} venda(s) chegaram depois do snapshot financeiro original. A conferência não foi recalculada.
                                </p>
                            </div>
                        </aside>
                        <div className="pending-registers-list">
                            {postReconciliationRegisters.map((register) =>
                                renderAdministrativeRegister(register, true, true))}
                        </div>
                    </section>
                )}
            </main>
        </div>
    )
}
