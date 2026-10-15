import { useCallback, useEffect, useRef, useState } from 'react'
import {
    connectBluetoothPrinter,
    printReceiptViaBluetooth,
    type PrinterDevice,
    type ReceiptData,
} from '../services/thermalPrinter'

export type BluetoothPrinterStatus =
    | 'disconnected'
    | 'connecting'
    | 'connected'
    | 'printing'
    | 'error'

export interface UseBluetoothPrinterResult {
    status: BluetoothPrinterStatus
    deviceName: string | null
    errorMessage: string | null
    isBluetoothAvailable: boolean
    connect: () => Promise<void>
    disconnect: () => void
    print: (data: ReceiptData) => Promise<void>
}

/**
 * Hook para gerenciar a conexão e impressão via Bluetooth.
 *
 * Mantém a conexão ativa entre impressões para evitar que o usuário precise
 * reconectar a cada cupom. Desconecta automaticamente quando o componente
 * que usa o hook é desmontado.
 */
export function useBluetoothPrinter(): UseBluetoothPrinterResult {
    const [status, setStatus] = useState<BluetoothPrinterStatus>('disconnected')
    const [deviceName, setDeviceName] = useState<string | null>(null)
    const [errorMessage, setErrorMessage] = useState<string | null>(null)
    const [isBluetoothAvailable, setIsBluetoothAvailable] = useState(false)

    const printerRef = useRef<PrinterDevice | null>(null)

    // Verifica disponibilidade da Web Bluetooth API uma vez na montagem
    useEffect(() => {
        setIsBluetoothAvailable(typeof navigator !== 'undefined' && 'bluetooth' in navigator)
    }, [])

    // Desconecta ao desmontar
    useEffect(() => {
        return () => {
            if (printerRef.current?.server.connected) {
                printerRef.current.server.disconnect()
            }
        }
    }, [])

    // Monitora desconexão inesperada do dispositivo
    const handleDisconnect = useCallback(() => {
        printerRef.current = null
        setStatus('disconnected')
        setDeviceName(null)
        setErrorMessage('A impressora foi desconectada.')
    }, [])

    const connect = useCallback(async () => {
        if (status === 'connecting' || status === 'printing') return

        // Desconecta sessão anterior se existir
        if (printerRef.current?.server.connected) {
            printerRef.current.device.removeEventListener('gattserverdisconnected', handleDisconnect)
            printerRef.current.server.disconnect()
            printerRef.current = null
        }

        setStatus('connecting')
        setErrorMessage(null)

        try {
            const printer = await connectBluetoothPrinter()
            printerRef.current = printer
            printer.device.addEventListener('gattserverdisconnected', handleDisconnect)
            setDeviceName(printer.device.name ?? 'Impressora sem nome')
            setStatus('connected')
            setErrorMessage(null)
        } catch (error) {
            printerRef.current = null
            setStatus('error')
            setDeviceName(null)
            setErrorMessage(
                error instanceof Error
                    ? error.message
                    : 'Não foi possível conectar à impressora.',
            )
        }
    }, [status, handleDisconnect])

    const disconnect = useCallback(() => {
        if (printerRef.current) {
            printerRef.current.device.removeEventListener('gattserverdisconnected', handleDisconnect)
            if (printerRef.current.server.connected) {
                printerRef.current.server.disconnect()
            }
            printerRef.current = null
        }
        setStatus('disconnected')
        setDeviceName(null)
        setErrorMessage(null)
    }, [handleDisconnect])

    const print = useCallback(async (data: ReceiptData) => {
        if (!printerRef.current) {
            setErrorMessage('Nenhuma impressora conectada. Conecte antes de imprimir.')
            return
        }

        if (!printerRef.current.server.connected) {
            setStatus('disconnected')
            setDeviceName(null)
            printerRef.current = null
            setErrorMessage('A impressora foi desconectada. Reconecte e tente novamente.')
            return
        }

        setStatus('printing')
        setErrorMessage(null)

        try {
            await printReceiptViaBluetooth(printerRef.current.characteristic, data)
            setStatus('connected')
        } catch (error) {
            setStatus('error')
            setErrorMessage(
                error instanceof Error
                    ? error.message
                    : 'Erro ao enviar dados para a impressora.',
            )
        }
    }, [])

    return {
        status,
        deviceName,
        errorMessage,
        isBluetoothAvailable,
        connect,
        disconnect,
        print,
    }
}
