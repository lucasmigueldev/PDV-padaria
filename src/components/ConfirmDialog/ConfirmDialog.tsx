import { useEffect } from 'react'
import './ConfirmDialog.css'

interface ConfirmDialogProps {
  isOpen: boolean
  title: string
  message: string
  onConfirm: () => void
  onCancel: () => void
  confirmText?: string
  cancelText?: string
}

export function ConfirmDialog({
  isOpen,
  title,
  message,
  onConfirm,
  onCancel,
  confirmText = 'Confirmar',
  cancelText = 'Cancelar',
}: ConfirmDialogProps) {
  useEffect(() => {
    if (!isOpen) return

    function handleKeydown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onCancel()
      }
    }

    document.addEventListener('keydown', handleKeydown)
    return () => document.removeEventListener('keydown', handleKeydown)
  }, [isOpen, onCancel])

  if (!isOpen) return null

  return (
    <>
      <div className="confirm-overlay" onClick={onCancel} />
      <div className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
        <div className="confirm-header">
          <h2 id="confirm-title" className="confirm-title">{title}</h2>
          <button type="button" className="confirm-close" onClick={onCancel} aria-label="Fechar">
            ✕
          </button>
        </div>
        <p className="confirm-message">{message}</p>
        <div className="confirm-actions">
          <button type="button" className="confirm-btn cancel" onClick={onCancel}>
            {cancelText}
          </button>
          <button type="button" className="confirm-btn confirm" onClick={onConfirm}>
            {confirmText}
          </button>
        </div>
      </div>
    </>
  )
}
