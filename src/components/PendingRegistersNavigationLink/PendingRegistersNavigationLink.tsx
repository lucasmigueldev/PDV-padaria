import { ClipboardList } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'

import { useOverdueCashRegisterAlertContext } from '../../contexts/OverdueCashRegisterAlertContext'
import './PendingRegistersNavigationLink.css'

export const PENDING_REGISTERS_NAVIGATION_LABEL = 'Caixas Pendentes'

interface PendingRegistersNavigationLinkProps {
    className: string
    onClick?: () => void
}

export function PendingRegistersNavigationLink({
    className,
    onClick,
}: PendingRegistersNavigationLinkProps) {
    const location = useLocation()
    const { alertCount } = useOverdueCashRegisterAlertContext()
    const isActive = location.pathname === '/caixas-pendentes'

    return (
        <Link
            to="/caixas-pendentes"
            className={`${className}${isActive ? ' active' : ''}`}
            onClick={onClick}
            aria-current={isActive ? 'page' : undefined}
        >
            <ClipboardList size={19} aria-hidden="true" />
            <span>{PENDING_REGISTERS_NAVIGATION_LABEL}</span>
            {alertCount > 0 && (
                <span className="pending-register-link-count" aria-label={`${alertCount} caixas atrasados`}>
                    {alertCount > 99 ? '99+' : alertCount}
                </span>
            )}
        </Link>
    )
}
