import { useState, useEffect } from 'react'
import { WifiOff, Wifi, RefreshCw } from 'lucide-react'

export function OfflineNotification() {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  )
  const [offlineCount, setOfflineCount] = useState(0)
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null)

  async function checkOfflineCount(): Promise<void> {
    if (typeof window === 'undefined') return

    try {
      const raw = window.localStorage.getItem('pdv_offline_sales_v1')
      const count = raw ? JSON.parse(raw).length : 0
      setOfflineCount(count)
      if (count > 0 && isOnline) {
        setNoticeMessage(`Verifique se há ${count} venda(s) pendente(s). O dashboard será atualizado em instantes.`)
      }
    } catch {
      setOfflineCount(0)
    }
  }

  useEffect(() => {
    // Monitora eventos de online/offline nativos
    const handleOnline = () => {
      setIsOnline(true)
      setNoticeMessage('PDV voltou online. Dados serão sincronizados em instantes.')
    }
    const handleOffline = () => {
      setIsOnline(false)
      setNoticeMessage('O PDV está offline. O dashboard será atualizado assim que a conexão for restabelecida.')
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    // eslint-disable-next-line react-hooks/set-state-in-effect
    void checkOfflineCount()

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [] /* eslint-disable-next-line react-hooks/exhaustive-deps */)

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    // Polling a cada 15s para verificar se há vendas offline no localStorage
    const interval = window.setInterval(() => {
      void checkOfflineCount()
    }, 15_000)

    return () => window.clearInterval(interval)
  }, [])

  // Monitora eventos de online/offline nativos
  // eslint-disable-next-line react-hooks/exhaustive-deps, react-hooks/set-state-in-effect
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true)
      setNoticeMessage('PDV voltou online. Dados serão sincronizados em instantes.')
    }
    const handleOffline = () => {
      setIsOnline(false)
      setNoticeMessage('O PDV está offline. O dashboard será atualizado assim que a conexão for restabelecida.')
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    // eslint-disable-next-line react-hooks/set-state-in-effect
    void checkOfflineCount()

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  if (offlineCount === 0 && isOnline) return null

  return (
    <div className="fixed top-0 left-0 right-0 z-50">
      <div className="bg-amber-50 border-b border-amber-200 rounded-b-2xl p-4 shadow-lg">
        <div className="flex items-center gap-3">
          {isOnline ? (
            <Wifi className="text-amber-500" size={20} />
          ) : (
            <WifiOff className="text-amber-500" size={20} />
          )}
          <div>
            <p className="text-sm font-semibold text-amber-800">
              {isOnline ? 'PDV offline detectado' : 'Conexão restabelecida'}
            </p>
            <p className="text-xs text-amber-600 mt-0.5">
              {noticeMessage}
            </p>
          </div>
          {offlineCount > 0 && (
            <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
              {offlineCount} venda(s) pendente(s)
            </span>
          )}
          <button
            onClick={() => window.location.reload()}
            className="ml-auto flex-shrink-0 text-xs text-amber-700 hover:text-amber-900 underline underline-offset-2"
          >
            <RefreshCw className="inline mr-1" size={14} />
            Atualizar agora
          </button>
        </div>
      </div>
    </div>
  )
}
