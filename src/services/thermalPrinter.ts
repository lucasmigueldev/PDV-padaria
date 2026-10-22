/**
 * Serviço de impressão térmica via Web Bluetooth API.
 *
 * Protocolo: ESC/POS (compatível com impressoras térmicas genéricas de 58 mm).
 * Testado com impressoras mini térmicas sem fio vendidas no AliExpress/Mercado Livre.
 *
 * Referência ESC/POS:
 *   https://reference.epson-biz.com/modules/ref_escpos/
 *
 * A Web Bluetooth API requer:
 *   - Chrome 56+ ou Edge 79+ (desktop ou Android)
 *   - Contexto seguro (HTTPS ou localhost)
 *   - Permissão concedida pelo usuário
 *
 * Tipos: instale @types/web-bluetooth para suporte completo ao TypeScript.
 *   npm install --save-dev @types/web-bluetooth
 */


// UUIDs padrão dos serviços GATT usados por impressoras térmicas genéricas.
// A maioria das mini térmicas chinesas usa estes UUIDs do serviço de impressão serial.
const PRINTER_SERVICE_UUIDS = [
    '000018f0-0000-1000-8000-00805f9b34fb', // Serviço de impressão serial genérico (mais comum)
    '00001101-0000-1000-8000-00805f9b34fb', // SPP - Serial Port Profile
    'e7810a71-73ae-499d-8c15-faa9aef0c3f2', // Peripage / algumas genéricas
    '49535343-fe7d-4ae5-8fa9-9fafd205e455', // Outro padrão comum
]

const PRINTER_CHARACTERISTIC_UUIDS = [
    '00002af1-0000-1000-8000-00805f9b34fb', // Write characteristic (serviço 18f0)
    '49535343-8841-43f4-a8d4-ecbe34729bb3', // Outro padrão comum
    '00002a4d-0000-1000-8000-00805f9b34fb',
]

// Encoder de texto para Latin-1 / ISO-8859-1 (suportado pela maioria das térmicas)
function encodeText(text: string): Uint8Array {
    const bytes: number[] = []
    for (const char of text) {
        const code = char.charCodeAt(0)
        // Substitui caracteres fora do Latin-1 por aproximações ASCII
        if (code < 256) {
            bytes.push(code)
        } else {
            bytes.push(63) // '?'
        }
    }
    return new Uint8Array(bytes)
}

/**
 * Normaliza texto para remover caracteres não suportados pela maioria das
 * impressoras térmicas genéricas (que usam codificação CP437 ou Latin-1).
 */
function normalizeForPrinter(text: string): string {
    return text
        .replace(/ã/g, 'a').replace(/Ã/g, 'A')
        .replace(/â/g, 'a').replace(/Â/g, 'A')
        .replace(/á/g, 'a').replace(/Á/g, 'A')
        .replace(/à/g, 'a').replace(/À/g, 'A')
        .replace(/é/g, 'e').replace(/É/g, 'E')
        .replace(/ê/g, 'e').replace(/Ê/g, 'E')
        .replace(/è/g, 'e').replace(/È/g, 'E')
        .replace(/í/g, 'i').replace(/Í/g, 'I')
        .replace(/ì/g, 'i').replace(/Ì/g, 'I')
        .replace(/î/g, 'i').replace(/Î/g, 'I')
        .replace(/ó/g, 'o').replace(/Ó/g, 'O')
        .replace(/ô/g, 'o').replace(/Ô/g, 'O')
        .replace(/õ/g, 'o').replace(/Õ/g, 'O')
        .replace(/ò/g, 'o').replace(/Ò/g, 'O')
        .replace(/ú/g, 'u').replace(/Ú/g, 'U')
        .replace(/ù/g, 'u').replace(/Ù/g, 'U')
        .replace(/û/g, 'u').replace(/Û/g, 'U')
        .replace(/ç/g, 'c').replace(/Ç/g, 'C')
        .replace(/ñ/g, 'n').replace(/Ñ/g, 'N')
}

// Largura em caracteres para papel de 58 mm com fonte normal (32 colunas)
const COLS = 32

/** Centraliza texto em `COLS` colunas */
function center(text: string): string {
    const norm = normalizeForPrinter(text)
    const len = norm.length
    if (len >= COLS) return norm.slice(0, COLS)
    const pad = Math.floor((COLS - len) / 2)
    return ' '.repeat(pad) + norm
}

/** Alinha dois textos nas extremidades (esquerda e direita) em `COLS` colunas */
function justify(left: string, right: string): string {
    const l = normalizeForPrinter(left)
    const r = normalizeForPrinter(right)
    const available = COLS - r.length
    const trimmedLeft = l.slice(0, Math.max(1, available - 1))
    const gap = COLS - trimmedLeft.length - r.length
    return trimmedLeft + ' '.repeat(Math.max(1, gap)) + r
}

/** Trunca texto para caber em `COLS` colunas */
function line(text: string): string {
    return normalizeForPrinter(text).slice(0, COLS)
}

/** Linha separadora de traços */
function separator(): string {
    return '-'.repeat(COLS)
}

/** Comandos ESC/POS */
const ESC = 0x1b
const GS = 0x1d

const CMD = {
    INIT: new Uint8Array([ESC, 0x40]),                    // Inicializar impressora
    ALIGN_CENTER: new Uint8Array([ESC, 0x61, 0x01]),      // Alinhar ao centro
    ALIGN_LEFT: new Uint8Array([ESC, 0x61, 0x00]),        // Alinhar à esquerda
    BOLD_ON: new Uint8Array([ESC, 0x45, 0x01]),           // Negrito ligado
    BOLD_OFF: new Uint8Array([ESC, 0x45, 0x00]),          // Negrito desligado
    DOUBLE_HEIGHT_ON: new Uint8Array([ESC, 0x21, 0x10]),  // Fonte dupla altura
    FONT_NORMAL: new Uint8Array([ESC, 0x21, 0x00]),       // Fonte normal
    FEED_LINES: (n: number) => new Uint8Array([ESC, 0x64, n]), // Avançar n linhas
    CUT: new Uint8Array([GS, 0x56, 0x41, 0x10]),         // Cortar papel (parcial)
    LF: new Uint8Array([0x0a]),                            // Line feed
}

/** Converte string em Uint8Array e adiciona LF */
function textLine(text: string): Uint8Array {
    const encoded = encodeText(text)
    const result = new Uint8Array(encoded.length + 1)
    result.set(encoded)
    result[encoded.length] = 0x0a
    return result
}

/** Concatena múltiplos Uint8Array em um único */
function concat(...arrays: Uint8Array[]): Uint8Array {
    const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0)
    const result = new Uint8Array(totalLength)
    let offset = 0
    for (const arr of arrays) {
        result.set(arr, offset)
        offset += arr.length
    }
    return result
}

/** Parâmetros necessários para montar o cupom */
export interface ReceiptData {
    establishmentName?: string
    bakeryName: string
    saleId: string
    date: string
    items: Array<{
        name: string
        quantity: number
        price: number
        subtotal: number
    }>
    total: number
    paymentMethod: 'cash' | 'pix' | 'card'
    receivedAmount?: number
    change?: number
}

const currencyFormatter = new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
})

const dateFormatter = new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
})

const paymentLabels: Record<string, string> = {
    cash: 'Dinheiro',
    pix: 'PIX',
    card: 'Cartao',
}

/**
 * Monta o buffer ESC/POS completo do cupom.
 * Retorna um Uint8Array pronto para ser enviado à impressora.
 */
export function buildReceiptBuffer(data: ReceiptData): Uint8Array {
    const shortId = data.saleId.slice(0, 8).toUpperCase()
    const dateStr = dateFormatter.format(new Date(data.date))

    const establishment = data.establishmentName?.trim() || data.bakeryName
    const showUnit = Boolean(data.establishmentName?.trim() && data.bakeryName && data.bakeryName !== data.establishmentName)

    const parts: Uint8Array[] = [
        CMD.INIT,

        // Cabeçalho — nome do estabelecimento
        CMD.ALIGN_CENTER,
        CMD.BOLD_ON,
        CMD.DOUBLE_HEIGHT_ON,
        textLine(center(establishment)),
        CMD.FONT_NORMAL,
        CMD.BOLD_OFF,
        ...(showUnit ? [textLine(center(`Unidade: ${data.bakeryName}`))] : []),
        CMD.LF,

        // Subtítulo
        textLine(center('COMPROVANTE NAO FISCAL')),
        CMD.LF,

        // Separador
        CMD.ALIGN_LEFT,
        textLine(separator()),

        // Identificação da venda
        textLine(line(`Venda: #${shortId}`)),
        textLine(line(`Data:  ${dateStr}`)),
        textLine(separator()),

        // Itens
    ]

    for (const item of data.items) {
        const qty = item.quantity
        const price = currencyFormatter.format(item.price)
        const subtotal = currencyFormatter.format(item.subtotal)
        const itemName = normalizeForPrinter(item.name).slice(0, COLS)

        parts.push(textLine(itemName))
        parts.push(textLine(justify(`  ${qty} x ${price}`, subtotal)))
    }

    parts.push(textLine(separator()))

    // Total
    parts.push(CMD.BOLD_ON)
    parts.push(textLine(justify('TOTAL', currencyFormatter.format(data.total))))
    parts.push(CMD.BOLD_OFF)

    // Forma de pagamento
    const payLabel = paymentLabels[data.paymentMethod] ?? data.paymentMethod
    parts.push(textLine(line(`Pagamento: ${payLabel}`)))

    if (data.paymentMethod === 'cash' && data.receivedAmount !== undefined && data.change !== undefined) {
        parts.push(textLine(line(`Recebido:  ${currencyFormatter.format(data.receivedAmount)}`)))
        parts.push(textLine(line(`Troco:     ${currencyFormatter.format(data.change)}`)))
    }

    parts.push(textLine(separator()))

    // Rodapé
    parts.push(CMD.ALIGN_CENTER)
    parts.push(CMD.BOLD_ON)
    parts.push(textLine(center('Obrigado pela preferencia!')))
    parts.push(CMD.BOLD_OFF)

    // Avançar e cortar
    parts.push(CMD.FEED_LINES(4))
    parts.push(CMD.CUT)

    return concat(...parts)
}

/** Envia dados em chunks para a characteristic Bluetooth (máximo 512 bytes por vez) */
async function writeInChunks(
    characteristic: BluetoothRemoteGATTCharacteristic,
    data: Uint8Array,
    chunkSize = 100,
): Promise<void> {
    for (let i = 0; i < data.length; i += chunkSize) {
        const chunk = data.slice(i, i + chunkSize)
        await characteristic.writeValue(chunk)
        // Pequena pausa entre chunks para não sobrecarregar o buffer da impressora
        await new Promise<void>((resolve) => setTimeout(resolve, 20))
    }
}

export type PrinterDevice = {
    device: BluetoothDevice
    server: BluetoothRemoteGATTServer
    characteristic: BluetoothRemoteGATTCharacteristic
}

/**
 * Abre o seletor de dispositivos Bluetooth do navegador e conecta à impressora.
 * Tenta os UUIDs de serviço conhecidos automaticamente.
 *
 * @throws Se o usuário cancelar, se a API não estiver disponível, ou se a
 *         conexão falhar.
 */
export async function connectBluetoothPrinter(): Promise<PrinterDevice> {
    if (!navigator.bluetooth) {
        throw new Error(
            'A conexão Bluetooth não está disponível neste navegador. Use Chrome ou Edge em um computador ou dispositivo Android.',
        )
    }

    // Solicita qualquer dispositivo que anuncie um dos serviços conhecidos.
    // O filtro opcional de serviços requer que pelo menos um UUID seja listado
    // em optionalServices para que o browser permita acesso.
    let device: BluetoothDevice
    try {
        device = await navigator.bluetooth.requestDevice({
            // acceptAllDevices: true permite selecionar qualquer impressora na lista,
            // mesmo que ela não anuncie um UUID de serviço reconhecido.
            acceptAllDevices: true,
            optionalServices: PRINTER_SERVICE_UUIDS,
        })
    } catch (error) {
        if (error instanceof DOMException && error.name === 'NotFoundError') {
            throw new Error('Seleção cancelada. Nenhuma impressora foi conectada.', { cause: error })
        }
        if (error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'SecurityError')) {
            console.error('A permissão para selecionar dispositivos Bluetooth foi negada.', error.name)
            throw new Error('A permissão para conectar à impressora não foi concedida. Permita o acesso ao Bluetooth e tente novamente.', { cause: error })
        }
        if (error instanceof TypeError) {
            console.error('Falha ao abrir a seleção de impressora Bluetooth.', error.name)
            throw new Error('Não foi possível iniciar a conexão Bluetooth. Verifique se o navegador permite esse recurso e tente novamente.', { cause: error })
        }
        console.error('Falha ao selecionar a impressora Bluetooth.', error instanceof Error ? error.name : 'UnknownError')
        throw new Error('Não foi possível selecionar a impressora. Verifique se o Bluetooth está ativado e tente novamente.', { cause: error })
    }

    let server: BluetoothRemoteGATTServer
    try {
        if (!device.gatt) throw new Error('GATT_NOT_AVAILABLE')
        server = await device.gatt.connect()
    } catch (error) {
        console.error('Falha ao conectar à impressora Bluetooth.', error instanceof Error ? error.name : 'UnknownError')
        throw new Error('Não foi possível conectar à impressora. Verifique se ela está ligada, próxima e com o Bluetooth ativado.', { cause: error })
    }

    // Tenta cada UUID de serviço até encontrar um compatível
    let characteristic: BluetoothRemoteGATTCharacteristic | null = null
    let lastError: unknown

    for (const serviceUuid of PRINTER_SERVICE_UUIDS) {
        try {
            const service = await server.getPrimaryService(serviceUuid)
            for (const charUuid of PRINTER_CHARACTERISTIC_UUIDS) {
                try {
                    const char = await service.getCharacteristic(charUuid)
                    if (char.properties.write || char.properties.writeWithoutResponse) {
                        characteristic = char
                        break
                    }
                } catch {
                    // Tentar próxima characteristic
                }
            }
            if (!characteristic) {
                // Tentar pegar a primeira characteristic com write disponível
                const chars = await service.getCharacteristics()
                for (const char of chars) {
                    if (char.properties.write || char.properties.writeWithoutResponse) {
                        characteristic = char
                        break
                    }
                }
            }
            if (characteristic) break
        } catch (error) {
            lastError = error
        }
    }

    if (!characteristic) {
        server.disconnect()
        console.error(
            'A impressora não disponibilizou um serviço de impressão compatível.',
            lastError instanceof Error ? lastError.name : 'UnknownError',
        )
        throw new Error(
            'Não foi possível localizar um serviço de impressão compatível. Verifique se a impressora está ligada e próxima.',
            { cause: lastError },
        )
    }

    return { device, server, characteristic }
}

/**
 * Dados do comprovante de operação de caixa (abertura ou fechamento).
 *
 * O sistema não possui entradas/saídas de caixa (saques/depositos)
 * registradas, portanto o comprovante de fechamento apresenta apenas
 * valor inicial, vendas em dinheiro, valor esperado, valor contado
 * e a diferença.
 */
export interface CashOperationReceiptData {
    establishmentName?: string
    bakeryName: string
    operation: 'opening' | 'closing'
    operatorName?: string
    date: string
    registerId: string
    initialAmount: number
    cashSalesAmount?: number
    expectedAmount?: number
    countedAmount?: number
    differenceAmount?: number
    closureId?: string
    contactValue?: number
}

/**
 * Monta o buffer ESC/POS do comprovante de operação de caixa.
 */
export function buildCashOperationReceiptBuffer(data: CashOperationReceiptData): Uint8Array {
    const shortRegisterId = data.registerId.slice(0, 8).toUpperCase()
    const dateStr = dateFormatter.format(new Date(data.date))
    const isClosing = data.operation === 'closing'

    const establishment = data.establishmentName?.trim() || data.bakeryName
    const showUnit = Boolean(data.establishmentName?.trim() && data.bakeryName && data.bakeryName !== data.establishmentName)

    const parts: Uint8Array[] = [
        CMD.INIT,

        // Cabeçalho — nome do estabelecimento
        CMD.ALIGN_CENTER,
        CMD.BOLD_ON,
        CMD.DOUBLE_HEIGHT_ON,
        textLine(center(establishment)),
        CMD.FONT_NORMAL,
        CMD.BOLD_OFF,
        ...(showUnit ? [textLine(center(`Unidade: ${data.bakeryName}`))] : []),
        CMD.LF,

        // Subtítulo
        CMD.BOLD_ON,
        textLine(center(isClosing ? 'COMPROVANTE DE FECHAMENTO' : 'COMPROVANTE DE ABERTURA')),
        CMD.BOLD_OFF,
        textLine(center('NAO FISCAL')),
        CMD.LF,

        CMD.ALIGN_LEFT,
        textLine(separator()),

        textLine(line(`Caixa:  #${shortRegisterId}`)),
        textLine(line(`Tipo:   ${isClosing ? 'Fechamento' : 'Abertura'}`)),
        textLine(line(`Data:   ${dateStr}`)),
        ...(data.operatorName?.trim() ? [textLine(line(`Operador: ${data.operatorName.trim()}`))] : []),
        textLine(separator()),

        textLine(justify('Valor inicial', currencyFormatter.format(data.initialAmount))),
    ]

    if (isClosing) {
        if (data.cashSalesAmount !== undefined) {
            parts.push(textLine(justify('Vendas em dinheiro', currencyFormatter.format(data.cashSalesAmount))))
        }
        if (data.expectedAmount !== undefined) {
            parts.push(textLine(justify('Valor esperado', currencyFormatter.format(data.expectedAmount))))
        }
        if (data.countedAmount !== undefined) {
            parts.push(textLine(justify('Valor contado', currencyFormatter.format(data.countedAmount))))
        }
        if (data.differenceAmount !== undefined) {
            parts.push(CMD.BOLD_ON)
            parts.push(textLine(justify('Diferenca', currencyFormatter.format(data.differenceAmount))))
            parts.push(CMD.BOLD_OFF)
        }
    }

    parts.push(textLine(separator()))

    parts.push(CMD.ALIGN_CENTER)
    parts.push(textLine(center(isClosing ? 'Caixa encerrado com sucesso' : 'Caixa aberto com sucesso')))

    if (data.closureId) {
        parts.push(textLine(center(`Fechamento: #${data.closureId.slice(0, 8).toUpperCase()}`)))
    }

    parts.push(CMD.FEED_LINES(4))
    parts.push(CMD.CUT)

    return concat(...parts)
}

/**
 * Envia o cupom para a impressora Bluetooth conectada.
 *
 * @param characteristic - Characteristic GATT obtida via `connectBluetoothPrinter`
 * @param data - Dados do cupom
 */
export async function printReceiptViaBluetooth(
    characteristic: BluetoothRemoteGATTCharacteristic,
    data: ReceiptData,
): Promise<void> {
    try {
        const buffer = buildReceiptBuffer(data)
        await writeInChunks(characteristic, buffer)
    } catch (error) {
        console.error('Falha ao enviar o comprovante à impressora Bluetooth.', error instanceof Error ? error.name : 'UnknownError')
        throw new Error('Não foi possível enviar o comprovante à impressora. Verifique a conexão e tente imprimir novamente.', { cause: error })
    }
}

/**
 * Envia um buffer ESC/POS já montado para a impressora Bluetooth conectada.
 * Usado pelos comprovantes de abertura e fechamento de caixa.
 */
export async function printBufferViaBluetooth(
    characteristic: BluetoothRemoteGATTCharacteristic,
    buffer: Uint8Array,
): Promise<void> {
    try {
        await writeInChunks(characteristic, buffer)
    } catch (error) {
        console.error('Falha ao enviar o comprovante à impressora Bluetooth.', error instanceof Error ? error.name : 'UnknownError')
        throw new Error('Não foi possível enviar o comprovante à impressora. Verifique a conexão e tente imprimir novamente.', { cause: error })
    }
}
