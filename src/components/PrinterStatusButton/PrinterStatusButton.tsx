import { Bluetooth, BluetoothOff } from 'lucide-react'
import { useBluetoothPrinterContext } from '../../contexts/BluetoothPrinterContext'
import './PrinterStatusButton.css'

export default function PrinterStatusButton() {
    const bluetooth = useBluetoothPrinterContext()

    if (!bluetooth.isBluetoothAvailable) return null

    const isConnected = bluetooth.status === 'connected'
    const isBusy = bluetooth.status === 'connecting' || bluetooth.status === 'printing'
    const isError = bluetooth.status === 'error'

    function getLabel() {
        if (bluetooth.status === 'connecting') return 'Conectando...'
        if (bluetooth.status === 'printing') return 'Imprimindo...'
        if (isConnected) return bluetooth.deviceName ?? 'Conectada'
        return 'Impressora'
    }

    return (
        <button
            type="button"
            className={`printer-status-btn${isConnected ? ' is-connected' : ''}${isError ? ' is-error' : ''}`}
            onClick={isConnected ? bluetooth.disconnect : bluetooth.connect}
            disabled={isBusy}
            title={isConnected ? `Conectada: ${bluetooth.deviceName ?? ''}. Clique para desconectar` : 'Clique para conectar a impressora Bluetooth'}
            aria-label={isConnected ? 'Impressora conectada. Clique para desconectar' : 'Impressora desconectada. Clique para conectar'}
        >
            {isConnected
                ? <Bluetooth size={14} aria-hidden="true" />
                : <BluetoothOff size={14} aria-hidden="true" />}
            <span className="printer-status-label">{getLabel()}</span>
        </button>
    )
}
