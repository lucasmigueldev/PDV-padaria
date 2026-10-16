import { useEffect, useRef, useState } from 'react'
import type { AuthenticatedUser } from '../../services/auth'
import './UserProfileMenu.css'

interface UserProfileMenuProps {
    user: AuthenticatedUser | null
    isLoading?: boolean
}

const roleLabels: Record<AuthenticatedUser['role'], string> = {
    owner: 'Proprietário',
    cashier: 'Operador de caixa',
}

const createdAtFormatter = new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'long',
})

export function UserProfileMenu({ user, isLoading = false }: UserProfileMenuProps) {
    const [isOpen, setIsOpen] = useState(false)
    const rootRef = useRef<HTMLDivElement>(null)
    const name = typeof user?.name === 'string' ? user.name.trim() : ''
    const email = typeof user?.email === 'string' ? user.email.trim() : ''
    const avatarInitial = email.charAt(0).toLocaleUpperCase() || '?'
    const displayName = name || (isLoading ? 'Carregando dados da conta...' : 'Conta indisponível')
    const roleLabel = user ? roleLabels[user.role] : (isLoading ? 'Carregando...' : 'Acesso indisponível')

    useEffect(() => {
        if (!isOpen) return

        function handlePointerDown(event: PointerEvent) {
            if (event.target instanceof Node && !rootRef.current?.contains(event.target)) {
                setIsOpen(false)
            }
        }

        function handleKeyDown(event: KeyboardEvent) {
            if (event.key === 'Escape') setIsOpen(false)
        }

        document.addEventListener('pointerdown', handlePointerDown)
        document.addEventListener('keydown', handleKeyDown)
        return () => {
            document.removeEventListener('pointerdown', handlePointerDown)
            document.removeEventListener('keydown', handleKeyDown)
        }
    }, [isOpen])

    return (
        <div className="header-user user-profile-menu flex items-center gap-3" ref={rootRef}>
            <button
                type="button"
                className="user-profile-trigger"
                aria-haspopup="dialog"
                aria-expanded={isOpen}
                onClick={() => setIsOpen((open) => !open)}
            >
                <span className="user-avatar" aria-hidden="true">
                    {avatarInitial}
                </span>
                <span className="user-profile-trigger-copy">
                    <strong>{displayName}</strong>
                    <span>{roleLabel}</span>
                </span>
            </button>

            {isOpen && (
                <section
                    className="user-profile-popover"
                    role="dialog"
                    aria-label="Detalhes da conta"
                    aria-busy={isLoading}
                >
                    <div className="user-profile-popover-heading">
                        <span>Perfil da conta</span>
                        {isLoading && <span role="status">Carregando...</span>}
                    </div>
                    {user ? (
                        <dl className="user-profile-details">
                            <div>
                                <dt>Nome completo</dt>
                                <dd>{name || 'Não informado'}</dd>
                            </div>
                            <div>
                                <dt>E-mail</dt>
                                <dd>{email || 'Não informado'}</dd>
                            </div>
                            <div>
                                <dt>Função / permissão</dt>
                                <dd>{roleLabels[user.role]}</dd>
                            </div>
                            <div>
                                <dt>Data de cadastro</dt>
                                <dd>
                                    {user.createdAt && Number.isFinite(new Date(user.createdAt).getTime())
                                        ? createdAtFormatter.format(new Date(user.createdAt))
                                        : 'Não disponível'}
                                </dd>
                            </div>
                        </dl>
                    ) : (
                        <p className="user-profile-unavailable" role="status">
                            {isLoading
                                ? 'Carregando as informações da conta.'
                                : 'Não foi possível carregar os dados da conta. Atualize a tela ou entre novamente.'}
                        </p>
                    )}
                </section>
            )}
        </div>
    )
}
