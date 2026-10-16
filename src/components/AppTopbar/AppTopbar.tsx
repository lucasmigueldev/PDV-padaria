import { LogOut, Store, UserRound } from 'lucide-react'
import PrinterStatusButton from '../PrinterStatusButton/PrinterStatusButton'
import { useEstablishmentName } from '../../services/establishment'
import './AppTopbar.css'

interface AppTopbarProps {
    userName?: string | null
    bakeryName?: string | null
    userRole?: string | null
    onLogout: () => void
    showPrinter?: boolean
}

export default function AppTopbar({ userName, bakeryName, userRole, onLogout, showPrinter = false }: AppTopbarProps) {
    const establishmentName = useEstablishmentName()

    return (
        <header className="app-topbar">
            <strong className="app-topbar-title">{establishmentName}</strong>
            <div className="app-topbar-right">
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
