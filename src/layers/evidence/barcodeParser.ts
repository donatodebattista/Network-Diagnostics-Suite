import type { ScannedObjectType } from 'react-native-vision-camera';
import { normalizeMacAddress, resolveVendorByMac } from '../discovery/ouiVendorTable';

export type SupportedBarcodeFormat = Extract<
  ScannedObjectType,
  'qr' | 'code-128' | 'ean-13'
>;

/**
 * Formatos de código de barras y QR soportados por la suite (PRD §9.1).
 */
export const SUPPORTED_BARCODE_TYPES: readonly SupportedBarcodeFormat[] = [
  'qr',
  'code-128',
  'ean-13',
];

export interface ParsedChassisBarcode {
  rawValue: string;
  format: SupportedBarcodeFormat;
  serialNumber: string;
  macAddress?: string;
  vendor?: string;
  model?: string;
}

/**
 * Analiza el valor decodificado desde la etiqueta QR / Code-128 / EAN-13 adherida al chasis
 * del equipo (RF-04, PRD §9.1) y extrae el número de serie junto con metadatos opcionales (MAC, fabricante).
 */
export const parseEquipmentBarcode = (
  rawValue: string,
  format: SupportedBarcodeFormat = 'qr',
): ParsedChassisBarcode => {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    throw new Error('Scanned barcode payload cannot be empty');
  }

  // 1. Intento de parseo como JSON estructurado en etiquetas QR de equipos modernos
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      const serialCandidate =
        typeof parsed.serialNumber === 'string'
          ? parsed.serialNumber
          : typeof parsed.serial === 'string'
            ? parsed.serial
            : typeof parsed.sn === 'string'
              ? parsed.sn
              : undefined;

      if (serialCandidate && serialCandidate.trim().length > 0) {
        const rawMac =
          typeof parsed.macAddress === 'string'
            ? parsed.macAddress
            : typeof parsed.mac === 'string'
              ? parsed.mac
              : undefined;
        const normalizedMac = normalizeMacAddress(rawMac) ?? undefined;
        const vendor =
          typeof parsed.vendor === 'string'
            ? parsed.vendor
            : resolveVendorByMac(normalizedMac);
        const model = typeof parsed.model === 'string' ? parsed.model : undefined;

        return {
          rawValue: trimmed,
          format,
          serialNumber: serialCandidate.trim().toUpperCase(),
          macAddress: normalizedMac,
          vendor,
          model,
        };
      }
    } catch {
      // Continuar con heurística clave-valor o alfanumérica plana
    }
  }

  // 2. Intento de parseo formato clave-valor de telecomunicaciones (e.g. "SN:ZTEGC123456;MAC:00:19:C6:AA:BB:CC;VENDOR:ZTE")
  if (trimmed.includes(';') || /^(?:SN|S\/N|SERIAL)\s*[:=]/i.test(trimmed)) {
    const tokens = trimmed.split(/[;\r\n]+/);
    let serial: string | undefined;
    let mac: string | undefined;
    let vendor: string | undefined;
    let model: string | undefined;

    for (const token of tokens) {
      const [rawKey, ...restVal] = token.split(/[:=]/);
      if (!rawKey || restVal.length === 0) {
        continue;
      }
      const key = rawKey.trim().toUpperCase();
      const val = restVal.join(':').trim();

      if (key === 'SN' || key === 'S/N' || key === 'SERIAL') {
        serial = val.toUpperCase();
      } else if (key === 'MAC' || key === 'HWADDR') {
        mac = normalizeMacAddress(val) ?? undefined;
      } else if (key === 'VENDOR' || key === 'BRAND') {
        vendor = val;
      } else if (key === 'MODEL' || key === 'PRODUCT') {
        model = val;
      }
    }

    if (serial && serial.length > 0) {
      return {
        rawValue: trimmed,
        format,
        serialNumber: serial,
        macAddress: mac,
        vendor: vendor ?? resolveVendorByMac(mac),
        model,
      };
    }
  }

  // 3. Código lineal directo (Code-128 / EAN-13) o string alfanumérico de número de serie
  const sanitizedSerial = trimmed.replace(/[^a-zA-Z0-9._-]/g, '').toUpperCase();
  if (sanitizedSerial.length === 0) {
    throw new Error(`Invalid alphanumeric serial number in barcode: "${trimmed}"`);
  }

  return {
    rawValue: trimmed,
    format,
    serialNumber: sanitizedSerial,
  };
};
