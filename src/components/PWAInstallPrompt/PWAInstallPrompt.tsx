import { useState, useEffect } from 'react'
import { Download, X } from 'lucide-react'
import './PWAInstallPrompt.css'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

export function PWAInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [isVisible, setIsVisible] = useState(false)
  const [isDismissed, setIsDismissed] = useState(false)

  useEffect(() => {
    // Verificar se já está rodando standalone (PWA instalado)
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches 
      || (window.navigator as unknown as { standalone?: boolean }).standalone === true

    if (isStandalone) return

    // Verificar se usuário já dispensou nesta sessão
    if (sessionStorage.getItem('pwa_prompt_dismissed') === 'true') return

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault()
      setDeferredPrompt(e as BeforeInstallPromptEvent)
      setIsVisible(true)
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    }
  }, [])

  const handleInstallClick = async () => {
    if (!deferredPrompt) return

    await deferredPrompt.prompt()
    const { outcome } = await deferredPrompt.userChoice

    if (outcome === 'accepted') {
      setIsVisible(false)
      setDeferredPrompt(null)
    }
  }

  const handleDismiss = () => {
    setIsDismissed(true)
    setIsVisible(false)
    sessionStorage.setItem('pwa_prompt_dismissed', 'true')
  }

  if (!isVisible || isDismissed) return null

  return (
    <aside className="pwa-install-banner" aria-label="Instalar aplicativo">
      <div className="pwa-install-content">
        <div className="pwa-install-icon">
          <img src="/pwa-192x192.svg" alt="" width="36" height="36" />
        </div>
        <div className="pwa-install-copy">
          <strong>Instalar PDV360</strong>
          <span>Acesso rápido e tela cheia no seu celular ou computador</span>
        </div>
      </div>
      <div className="pwa-install-actions">
        <button type="button" onClick={handleInstallClick} className="pwa-install-btn">
          <Download size={15} aria-hidden="true" />
          <span>Instalar</span>
        </button>
        <button type="button" onClick={handleDismiss} className="pwa-dismiss-btn" aria-label="Fechar banner">
          <X size={17} aria-hidden="true" />
        </button>
      </div>
    </aside>
  )
}
