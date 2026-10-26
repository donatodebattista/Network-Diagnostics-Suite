const OUI_VENDOR_MAP: Readonly<Record<string, string>> = {
  // MikroTik / RouterBOARD
  '00:0C:42': 'MikroTik',
  '4C:5E:0C': 'MikroTik',
  '64:D1:54': 'MikroTik',
  'B8:69:F4': 'MikroTik',
  'C4:AD:34': 'MikroTik',
  'DC:2C:6E': 'MikroTik',
  'E4:8D:8C': 'MikroTik',
  // Ubiquiti Networks
  '00:15:6D': 'Ubiquiti Networks',
  '00:27:22': 'Ubiquiti Networks',
  '24:A4:3C': 'Ubiquiti Networks',
  '44:D9:E7': 'Ubiquiti Networks',
  '74:83:C2': 'Ubiquiti Networks',
  '80:2A:A8': 'Ubiquiti Networks',
  'F0:9F:C2': 'Ubiquiti Networks',
  // Cisco Systems
  '00:00:0C': 'Cisco Systems',
  '00:1B:D4': 'Cisco Systems',
  '00:25:45': 'Cisco Systems',
  '58:AC:78': 'Cisco Systems',
  'F4:CF:E2': 'Cisco Systems',
  // Huawei Technologies (ONTs / OLTs)
  '00:18:82': 'Huawei Technologies',
  '00:25:9E': 'Huawei Technologies',
  '00:46:4B': 'Huawei Technologies',
  '48:FD:8E': 'Huawei Technologies',
  '88:28:B3': 'Huawei Technologies',
  // ZTE Corporation (ONTs / GPON)
  '00:19:C6': 'ZTE Corporation',
  '00:26:ED': 'ZTE Corporation',
  '34:4B:50': 'ZTE Corporation',
  '74:A7:8E': 'ZTE Corporation',
  // TP-Link
  '14:CC:20': 'TP-Link',
  '50:C7:BF': 'TP-Link',
  'E8:DE:27': 'TP-Link',
  // Nokia / Alcatel-Lucent
  '00:19:C7': 'Nokia / Alcatel-Lucent',
  '68:54:FD': 'Nokia / Alcatel-Lucent',
};

/**
 * Normaliza una dirección MAC a formato hexadecimal en mayúsculas separado por dos puntos (`XX:XX:XX:XX:XX:XX`).
 */
export const normalizeMacAddress = (rawMac?: string | null): string | null => {
  if (!rawMac) {
    return null;
  }

  const hexClean = rawMac.replace(/[^0-9a-fA-F]/g, '').toUpperCase();
  if (hexClean.length !== 12) {
    return null;
  }

  const octets: string[] = [];
  for (let i = 0; i < 12; i += 2) {
    octets.push(hexClean.slice(i, i + 2));
  }
  return octets.join(':');
};

/**
 * Resuelve el fabricante del equipo a partir de los primeros 3 octetos (OUI) de su dirección MAC.
 */
export const resolveVendorByMac = (macAddress?: string | null): string | undefined => {
  const normalized = normalizeMacAddress(macAddress);
  if (!normalized) {
    return undefined;
  }

  const ouiPrefix = normalized.slice(0, 8);
  return OUI_VENDOR_MAP[ouiPrefix];
};

/**
 * Genera un identificador MAC administrado localmente (`02:00:C0:A8:XX:YY`) de forma determinística
 * cuando el kernel de Android (API 29+) restringe la lectura directa de `/proc/net/arp` y el nodo no anuncia MAC por mDNS.
 */
export const deriveFallbackLanMacFromIp = (ipAddress: string): string => {
  const octets = ipAddress.split('.').map((part) => Number(part));
  if (octets.length !== 4 || octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return '02:00:00:00:00:01';
  }
  const hexOctets = octets.map((n) => n.toString(16).toUpperCase().padStart(2, '0'));
  return `02:00:${hexOctets[0]}:${hexOctets[1]}:${hexOctets[2]}:${hexOctets[3]}`;
};
