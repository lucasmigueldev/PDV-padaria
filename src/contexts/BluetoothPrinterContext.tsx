import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useRef,
    useState,
    type ReactNode,
} from 'react'
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

export interface BluetoothPrinterContextValue {
    status: BluetoothPrinterStatus
    deviceName: string | null
    errorMessage: string | null
    isBluetoothAvailable: boolean
    connect: () => Promise<void>
    disconnect: () => void
    print: (data: ReceiptData) => Promise<void>
}

function getPrinterErrorMessage(error: unknown, fallback: string): string {
    console.error('Falha na operação da impressora Bluetooth.', error)
    if (!(error instanceof Error)) return fallback

    const knownMessages = [
        'Seleção cancelada.',
        'A conexão Bluetooth não está disponível neste navegador.',
        'A permissão para conectar à impressora não foi concedida.',
        'Não foi possível iniciar a conexão Bluetooth.',
        'Não foi possível selecionar a impressora.',
        'Não foi possível conectar à impressora.',
        'Não foi possível localizar um serviço de impressão compatível.',
        'Não foi possível enviar o comprovante à impressora.',
    ]
    return knownMessages.some((knownMessage) => error.message.startsWith(knownMessage))
        ? error.message
        : fallback
}

export const BluetoothPrinterContext = createContext<BluetoothPrinterContextValue | null>(null)

export function BluetoothPrinterProvider({ children }: { children: ReactNode }) {
    const [status, setStatus] = useState<BluetoothPrinterStatus>('disconnected')
    const [deviceName, setDeviceName] = useState<string | null>(null)
    const [errorMessage, setErrorMessage] = useState<string | null>(null)
    const [isBluetoothAvailable, setIsBluetoothAvailable] = useState(false)

    // A referência à conexão fica no nível do Provider (raiz do App).
    // Assim, mudar de rota NUNCA desconecta a impressora.
    const printerRef = useRef<PrinterDevice | null>(null)

    useEffect(() => {
        setIsBluetoothAvailable(typeof navigator !== 'undefined' && 'bluetooth' in navigator)
    }, [])

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
            setDeviceName(printer.device.name ?? 'Impressora Térmica')
            setStatus('connected')
            setErrorMessage(null)
        } catch (error) {
            printerRef.current = null
            const isSelectionCancelled = error instanceof Error && error.message.startsWith('Seleção cancelada.')
            setStatus(isSelectionCancelled ? 'disconnected' : 'error')
            setDeviceName(null)
            setErrorMessage(
                isSelectionCancelled
                    ? error.message
                    : getPrinterErrorMessage(error, 'Não foi possível conectar à impressora. Verifique se ela está ligada e tente novamente.'),
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
            setErrorMessage(getPrinterErrorMessage(
                error,
                'Não foi possível enviar o comprovante à impressora. Verifique a conexão e tente novamente.',
            ))
        }
    }, [])

    return (
        <BluetoothPrinterContext.Provider
            value={{
                status,
                deviceName,
                errorMessage,
                isBluetoothAvailable,
                connect,
                disconnect,
                print,
            }}
        >
            {children}
        </BluetoothPrinterContext.Provider>
    )
}

export function useBluetoothPrinterContext(): BluetoothPrinterContextValue {
    const context = useContext(BluetoothPrinterContext)
    if (!context) {
        throw new Error('useBluetoothPrinterContext deve ser usado dentro de BluetoothPrinterProvider.')
    }
    return context
}
