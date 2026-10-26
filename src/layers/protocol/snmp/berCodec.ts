import { BerTag } from './constants';

export interface BerTlvNode {
  tag: number;
  value: Uint8Array;
  headerLength: number;
  totalLength: number;
}

/**
 * Codifica la longitud ASN.1 BER en forma corta (<= 127) o forma larga (> 127).
 */
export const encodeBerLength = (length: number): Uint8Array => {
  if (!Number.isInteger(length) || length < 0) {
    throw new Error(`Invalid BER length: ${length}`);
  }

  if (length <= 0x7f) {
    return new Uint8Array([length]);
  }

  const bytes: number[] = [];
  let remaining = length;
  while (remaining > 0) {
    bytes.unshift(remaining & 0xff);
    remaining = Math.floor(remaining / 256);
  }

  if (bytes.length > 4) {
    throw new Error(`BER length overflow: ${length}`);
  }

  return new Uint8Array([0x80 | bytes.length, ...bytes]);
};

/**
 * Decodifica el campo de longitud ASN.1 BER a partir de un offset dado.
 */
export const decodeBerLength = (
  buffer: Uint8Array,
  offset: number,
): { length: number; bytesRead: number } => {
  if (offset >= buffer.length) {
    throw new Error('BER decode error: unexpected end of buffer while reading length');
  }

  const firstByte = buffer[offset];
  if ((firstByte & 0x80) === 0) {
    return { length: firstByte, bytesRead: 1 };
  }

  const numOctets = firstByte & 0x7f;
  if (numOctets === 0 || numOctets > 4) {
    throw new Error(`BER decode error: unsupported length octets count (${numOctets})`);
  }

  if (offset + 1 + numOctets > buffer.length) {
    throw new Error('BER decode error: truncated multi-byte length field');
  }

  let length = 0;
  for (let i = 0; i < numOctets; i++) {
    length = length * 256 + buffer[offset + 1 + i];
  }

  return { length, bytesRead: 1 + numOctets };
};

/**
 * Empaqueta un nodo TLV (Tag-Length-Value) en un Uint8Array contiguo.
 */
export const encodeBerTlv = (tag: number, value: Uint8Array): Uint8Array => {
  const lengthBytes = encodeBerLength(value.length);
  const result = new Uint8Array(1 + lengthBytes.length + value.length);
  result[0] = tag & 0xff;
  result.set(lengthBytes, 1);
  result.set(value, 1 + lengthBytes.length);
  return result;
};

/**
 * Lee un nodo TLV en el offset indicado y retorna el sub-array de valor junto con sus longitudes.
 */
export const readBerTlv = (buffer: Uint8Array, offset = 0): BerTlvNode => {
  if (offset >= buffer.length) {
    throw new Error('BER decode error: offset out of bounds when reading tag');
  }

  const tag = buffer[offset];
  const { length, bytesRead } = decodeBerLength(buffer, offset + 1);
  const headerLength = 1 + bytesRead;
  const totalLength = headerLength + length;

  if (offset + totalLength > buffer.length) {
    throw new Error(
      `BER decode error: value length (${length}) exceeds remaining buffer (${buffer.length - (offset + headerLength)})`,
    );
  }

  const value = buffer.subarray(offset + headerLength, offset + totalLength);
  return { tag, value, headerLength, totalLength };
};

/**
 * Concatena múltiples bloques Uint8Array en un único buffer.
 */
export const concatUint8Arrays = (arrays: readonly Uint8Array[]): Uint8Array => {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
};

/**
 * Codifica un entero con signo en complemento a 2 (Tag 0x02).
 */
export const encodeBerInteger = (value: number): Uint8Array => {
  if (!Number.isInteger(value)) {
    throw new Error(`BER Integer must be an integer, received: ${value}`);
  }

  if (value === 0) {
    return encodeBerTlv(BerTag.INTEGER, new Uint8Array([0x00]));
  }

  const bytes: number[] = [];
  let temp = value;

  if (temp > 0) {
    while (temp > 0) {
      bytes.unshift(temp & 0xff);
      temp = Math.floor(temp / 256);
    }
    if ((bytes[0] & 0x80) !== 0) {
      bytes.unshift(0x00);
    }
  } else {
    let byteCount = 1;
    while (temp < -(1 << (8 * byteCount - 1))) {
      byteCount++;
    }
    for (let i = byteCount - 1; i >= 0; i--) {
      bytes.push((temp >> (8 * i)) & 0xff);
    }
  }

  return encodeBerTlv(BerTag.INTEGER, new Uint8Array(bytes));
};

/**
 * Decodifica un entero con signo en complemento a 2 desde su contenido de bytes.
 */
export const decodeBerIntegerValue = (bytes: Uint8Array): number => {
  if (bytes.length === 0) {
    throw new Error('BER decode error: empty INTEGER value');
  }

  const isNegative = (bytes[0] & 0x80) !== 0;
  let result = 0;

  for (let i = 0; i < bytes.length; i++) {
    result = result * 256 + bytes[i];
  }

  if (isNegative) {
    result -= Math.pow(256, bytes.length);
  }

  return result;
};

/**
 * Decodifica un entero sin signo (Counter32, Gauge32, TimeTicks, Counter64).
 */
export const decodeBerUnsignedValue = (bytes: Uint8Array): number => {
  if (bytes.length === 0) {
    return 0;
  }

  let result = 0;
  for (let i = 0; i < bytes.length; i++) {
    result = result * 256 + bytes[i];
  }
  return result;
};

/**
 * Codifica un Octet String (Tag 0x04) a partir de un string UTF-8/ASCII.
 */
export const encodeBerOctetString = (str: string): Uint8Array => {
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) {
    bytes[i] = str.charCodeAt(i) & 0xff;
  }
  return encodeBerTlv(BerTag.OCTET_STRING, bytes);
};

/**
 * Decodifica un Octet String a texto legible (o representación hexadecimal si contiene bytes binarios no imprimibles).
 */
export const decodeBerOctetStringValue = (bytes: Uint8Array): string => {
  if (bytes.length === 0) {
    return '';
  }

  let isPrintable = true;
  for (let i = 0; i < bytes.length; i++) {
    const code = bytes[i];
    if (code < 0x09 || (code > 0x0d && code < 0x20) || code === 0x7f) {
      isPrintable = false;
      break;
    }
  }

  if (!isPrintable) {
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join(':');
  }

  let output = '';
  for (let i = 0; i < bytes.length; i++) {
    output += String.fromCharCode(bytes[i]);
  }
  return output;
};

/**
 * Codifica un valor ASN.1 NULL (0x05 0x00).
 */
export const encodeBerNull = (): Uint8Array => {
  return new Uint8Array([BerTag.NULL, 0x00]);
};

/**
 * Codifica un Object Identifier (OID, Tag 0x06) siguiendo la regla 40*X + Y y sub-identificadores en base 128.
 */
export const encodeBerOid = (oidString: string): Uint8Array => {
  const cleanOid = oidString.trim().replace(/^\./, '');
  const parts = cleanOid.split('.').map((segment) => {
    if (!/^\d+$/.test(segment)) {
      throw new Error(`Invalid OID segment "${segment}" in OID "${oidString}"`);
    }
    return Number(segment);
  });

  if (parts.length < 2) {
    throw new Error(`OID must contain at least 2 sub-identifiers: "${oidString}"`);
  }

  const [first, second, ...rest] = parts;
  if (first > 2 || (first < 2 && second >= 40)) {
    throw new Error(`Invalid root arcs (${first}.${second}) in OID "${oidString}"`);
  }

  const encodedBytes: number[] = [first * 40 + second];

  for (const subId of rest) {
    if (subId === 0) {
      encodedBytes.push(0x00);
      continue;
    }

    const subBytes: number[] = [];
    let value = subId;
    while (value > 0) {
      subBytes.unshift(value & 0x7f);
      value = Math.floor(value / 128);
    }

    for (let i = 0; i < subBytes.length - 1; i++) {
      subBytes[i] |= 0x80;
    }

    encodedBytes.push(...subBytes);
  }

  return encodeBerTlv(BerTag.OID, new Uint8Array(encodedBytes));
};

/**
 * Decodifica el contenido binario de un OID (Tag 0x06) a notación decimal con puntos.
 */
export const decodeBerOidValue = (bytes: Uint8Array): string => {
  if (bytes.length === 0) {
    throw new Error('BER decode error: empty OID value');
  }

  const firstByte = bytes[0];
  const firstArc = firstByte < 80 ? Math.floor(firstByte / 40) : 2;
  const secondArc = firstByte - firstArc * 40;
  const arcs: number[] = [firstArc, secondArc];

  let currentSubId = 0;
  let inMultiByte = false;

  for (let i = 1; i < bytes.length; i++) {
    const byte = bytes[i];
    currentSubId = currentSubId * 128 + (byte & 0x7f);
    if ((byte & 0x80) !== 0) {
      inMultiByte = true;
    } else {
      arcs.push(currentSubId);
      currentSubId = 0;
      inMultiByte = false;
    }
  }

  if (inMultiByte) {
    throw new Error('BER decode error: truncated sub-identifier in OID');
  }

  return arcs.join('.');
};

/**
 * Codifica una estructura SEQUENCE (Tag 0x30) o PDU compuesto concatenando sus elementos hijos.
 */
export const encodeBerSequence = (
  children: readonly Uint8Array[],
  tag: number = BerTag.SEQUENCE,
): Uint8Array => {
  const payload = concatUint8Arrays(children);
  return encodeBerTlv(tag, payload);
};
