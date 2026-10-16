/**
 * Gera o payload BR Code (QR Code PIX) seguindo as especificações do Banco Central do Brasil.
 * Cada campo segue o formato TLV (Tag-Length-Value) e o payload termina com o CRC16.
 *
 * Referência: Manual de Padrões para Iniciação de Pix - Banco Central do Brasil
 */

// CRC16-CCITT (polinômio 0x1021, refinamento false, valor inicial 0xFFFF, xorOut 0xFFFF)
function crc16CCITT(data: string): string {
  let crc = 0xffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      if ((crc & 0x8000) !== 0) {
        crc = (crc << 1) ^ 0x1021;
      } else {
        crc = crc << 1;
      }
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

function padLeft(value: string, length: number): string {
  return value.padStart(length, '0');
}

function buildField(tag: string, value: string): string {
  return tag + padLeft(String(value.length), 2) + value;
}

/**
 * Monta o payload estático do QR Code PIX.
 * @param pixKey Chave PIX (e-mail, CPF, CNPJ, telefone ou chave aleatória)
 * @param merchantName Nome do recebedor (máx. 25 caracteres)
 * @param merchantCity Cidade do recebedor (máx. 15 caracteres)
 * @param amount Valor opcional em reais (ex: 10.50). Se omitido, o QR é de valor livre.
 */
export function generatePixPayload({
  pixKey,
  merchantName = 'PDV360',
  merchantCity = 'SAO PAULO',
  amount,
}: {
  pixKey: string;
  merchantName?: string;
  merchantCity?: string;
  amount?: number;
}): string {
  // Merchant Account Information (template 26)
  const gui = 'BR.GOV.BCB.PIX';
  const merchantAccount =
    buildField('00', gui) + buildField('01', pixKey);

  const payloadFormat = '000201';
  const merchantCategoryCode = buildField('52', '0000');
  const transactionCurrency = buildField('53', '986'); // BRL

  let transactionAmount = '';
  if (amount !== undefined && amount > 0) {
    transactionAmount = buildField('54', amount.toFixed(2));
  }

  const merchantNameField = buildField('59', merchantName.trim().substring(0, 25));
  const merchantCityField = buildField('60', merchantCity.trim().substring(0, 15));

  // Campo adicional (62) é opcional e fica vazio para pagamento estático simples
  const payloadWithoutCrc =
    payloadFormat +
    buildField('26', merchantAccount) +
    merchantCategoryCode +
    transactionCurrency +
    transactionAmount +
    merchantNameField +
    merchantCityField +
    '6304';

  const crc = crc16CCITT(payloadWithoutCrc);
  return payloadWithoutCrc + crc;
}
