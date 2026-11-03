import { AlertTriangle, Clock3, RefreshCw } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import { AdminPageHeader } from '../../components/AdminPageHeader/AdminPageHeader'
import { AdminSidebar } from '../../components/AdminSidebar/AdminSidebar'
import { useAuth } from '../../contexts/AuthContext'
import { useOverdueCashRegisterAlertContext } from '../../contexts/OverdueCashRegisterAlertContext'
import { useEstablishmentName } from '../../services/establishment'
import { formatOverdueDuration } from '../../services/overdueCashRegisterAlerts'
import { logoutAndRedirect } from '../../utils/auth'
import './CaixasPendentes.css'

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
        isLoading,
        error,
        openDetails,
    } = useOverdueCashRegisterAlertContext()
    const establishmentName = useEstablishmentName()

    function handleLogout() {
        void logoutAndRedirect(navigate)
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
                                            <button
                                                type="button"
                                                onClick={() => openDetails(alert.cashRegisterId)}
                                            >
                                                Consultar detalhes
                                            </button>
                                        </footer>
                                    </article>
                                ))}
                            </div>
                        </>
                    )}
                </section>
            </main>
        </div>
    )
}
