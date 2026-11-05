import { LogOut, RefreshCw, Store, UserRound, QrCode } from 'lucide-react'
import PrinterStatusButton from '../PrinterStatusButton/PrinterStatusButton'
import { useEstablishmentName } from '../../services/establishment'
import ConnectionStatusBadge from '../../components/ConnectionStatusBadge/ConnectionStatusBadge'
import './AppTopbar.css'

interface AppTopbarProps {
    userName?: string | null
    bakeryName?: string | null
    userRole?: string | null
    onLogout: () => void
    showPrinter?: boolean
    onRefresh?: () => void
    isRefreshing?: boolean
    onPixKeyDisplay?: () => void
    onSidebarToggle?: () => void
}

export default function AppTopbar({
    userName,
    bakeryName,
    userRole,
    onLogout,
    showPrinter = true,
    onRefresh,
    isRefreshing = false,
}: AppTopbarProps) {
    const establishmentName = useEstablishmentName()

    return (
        <header className="app-topbar">
            <strong className="app-topbar-title">{establishmentName}</strong>
            <div className="app-topbar-right">
                <div className="app-session-divider" aria-hidden="true" />
                <button
                    type="button"
                    className="app-topbar-pixkey"
                    onClick={() => window.location.href='/pix-key'}
                    aria-label="Exibir chave PIX"
                >
                    <QrCode size={15} aria-hidden="true" />
                    <span>Chave PIX</span>
                </button>
                <div className="app-topbar-session">
                    <div className="app-session-field">
                        <UserRound size={15} aria-hidden="true" />
                        <span>{userRole ?? 'Usuário'}</span>
                        <strong>{userName}</strong>
                    </div>
                    {bakeryName && (
                        <>
                            <div className="app-session-divider" aria-hidden="true" />
                            <div className="app-session-field">
                                <Store size={15} aria-hidden="true" />
                                <span>Unidade</span>
                                <strong>{bakeryName}</strong>
                            </div>
                        </>
                    )}
                </div>
                <ConnectionStatusBadge />
                {userRole !== 'Operador' && (
                    <button
                        type="button"
                        className="app-topbar-refresh"
                        onClick={onRefresh ?? (() => window.location.reload())}
                        disabled={isRefreshing}
                        aria-label="Atualizar dados"
                        title="Atualizar dados"
                    >
                        <RefreshCw size={15} className={isRefreshing ? 'app-topbar-refresh-spin' : undefined} aria-hidden="true" />
                        <span>{isRefreshing ? 'Atualizando...' : 'Atualizar'}</span>
                    </button>
                )}
                {showPrinter && (
                    <>
                        <div className="app-session-divider" aria-hidden="true" />
                        <PrinterStatusButton />
                    </>
                )}
                <button type="button" onClick={onLogout} className="app-topbar-logout">
                    <LogOut size={16} />
                    <span>Sair</span>
                </button>
            </div>
        </header>
    )
}
