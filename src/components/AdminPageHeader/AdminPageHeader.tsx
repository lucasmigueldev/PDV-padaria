import { ShoppingCart } from 'lucide-react'

import type { AuthenticatedUser } from '../../services/auth'
import { UserProfileMenu } from '../UserProfileMenu/UserProfileMenu'
import './AdminPageHeader.css'

interface AdminPageHeaderProps {
    title: string
    description: string
    overline: string
    establishmentName: string
    user: AuthenticatedUser | null
}

export function AdminPageHeader({
    title,
    description,
    overline,
    establishmentName,
    user,
}: AdminPageHeaderProps) {
    return (
        <header className="admin-page-header">
            <div className="admin-page-mobile-topbar">
                <div className="admin-page-brand" aria-label={establishmentName}>
                    <div className="logo-icon">
                        <ShoppingCart size={17} />
                    </div>
                    <span>{establishmentName}</span>
                </div>
                <UserProfileMenu user={user} />
            </div>

            <div className="admin-page-header-row">
                <div className="admin-page-heading">
                    <span className="admin-page-overline">{overline}</span>
                    <h1>{title}</h1>
                    <p>{description}</p>
                </div>
                <div className="admin-page-desktop-profile">
                    <UserProfileMenu user={user} />
                </div>
            </div>
        </header>
    )
}
