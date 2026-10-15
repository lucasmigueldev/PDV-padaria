import { useBluetoothPrinterContext } from '../contexts/BluetoothPrinterContext'

export type {
    BluetoothPrinterStatus,
    BluetoothPrinterContextValue as UseBluetoothPrinterResult,
} from '../contexts/BluetoothPrinterContext'

/**
 * Hook para acessar o estado e ações da impressora Bluetooth conectada.
 *
 * Utiliza o BluetoothPrinterContext na raiz do app para que a conexão Bluetooth
 * permaneça ativa e conectada mesmo quando o operador navegar entre telas
 * (ex: PDV -> Produtos -> Fechamento -> PDV).
 */
export function useBluetoothPrinter() {
    return useBluetoothPrinterContext()
}
