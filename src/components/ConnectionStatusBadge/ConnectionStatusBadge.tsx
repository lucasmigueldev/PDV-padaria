import { RefreshCw, Wifi, WifiOff } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { useConnectionStatus } from '../../hooks/useConnectionStatus'
import { useOfflineQueue, useOfflineQueueError } from '../../hooks/useOfflineQueue'
import { useSyncStatus } from '../../hooks/useSyncStatus'
import './ConnectionStatusBadge.css'

export default function ConnectionStatusBadge() {
    const { authenticatedUser } = useAuth()
    const connection = useConnectionStatus()
    const syncState = useSyncStatus()
    const queue = useOfflineQueue()
    const queueError = useOfflineQueueError()
    const pendingCount = queue.filter((sale) =>
        sale.operatorUserId === authenticatedUser?.id
        && sale.bakeryId === authenticatedUser?.activeBakeryId
        && sale.status === 'pending',
    ).length

    if (queueError) {
        return (
            <span
                className="connection-badge offline"
                role="alert"
                title={queueError.message}
            >
                <WifiOff size={14} aria-hidden="true" />
                <span>Falha ao carregar fila</span>
            </span>
        )
    }

    if (connection.status === 'offline') {
        return (
            <span
                className="connection-badge offline"
                role="status"
                title="Sem conexão com o sistema. As vendas serão sincronizadas quando a internet voltar."
            >
                <WifiOff size={14} aria-hidden="true" />
                <span>
                    Sem conexão
                    {pendingCount > 0 ? ` (${pendingCount})` : ''}
                </span>
            </span>
        )
    }

    if (syncState.isSyncing) {
        return (
            <span className="connection-badge syncing" role="status">
                <RefreshCw size={14} className="connection-badge-spin" aria-hidden="true" />
                <span>
                    Sincronizando
                    {pendingCount > 0 ? ` (${pendingCount})` : ''}
                </span>
            </span>
        )
    }

    if (pendingCount > 0) {
        return (
            <span className="connection-badge pending" role="status" title="Vendas aguardando sincronização.">
                <Wifi size={14} aria-hidden="true" />
                <span>{pendingCount} pendente(s)</span>
            </span>
        )
    }

    return (
        <span className="connection-badge online" role="status" title="Conectado ao sistema.">
            <Wifi size={14} aria-hidden="true" />
            <span>Online</span>
        </span>
    )
}
