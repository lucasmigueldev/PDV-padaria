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
