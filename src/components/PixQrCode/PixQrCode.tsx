import { QRCodeSVG } from 'qrcode.react'
import { generatePixPayload } from '../../utils/pixPayload'

interface PixQrCodeProps {
  pixKey: string
  size?: number
  value?: number
}

export default function PixQrCode({ pixKey, size = 256, value }: PixQrCodeProps) {
  // O conteúdo do QR Code PIX deve seguir o padrão EMVCO BR Code do Banco Central,
  // não apenas a chave em texto plano, para ser reconhecido pelos apps bancários.
  const qrContent = generatePixPayload({
    pixKey,
    merchantName: 'PDV360',
    merchantCity: 'SAO PAULO',
    amount: value,
  })

  if (!pixKey) {
    return null
  }

  return (
    <div className="flex flex-col items-center gap-4">
      <QRCodeSVG value={qrContent} size={size} />
      {value !== undefined && (
        <p className="text-xs text-slate-500 text-center">
          Chave PIX configurada pelo administrador
        </p>
      )}
    </div>
  )
}
