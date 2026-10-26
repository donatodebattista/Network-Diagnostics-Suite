import Zeroconf, { Service as ZeroconfService } from 'react-native-zeroconf';
import { normalizeMacAddress, resolveVendorByMac } from './ouiVendorTable';

export interface MdnsDiscoveredHost {
  ipAddress: string;
  hostname?: string;
  macAddress?: string;
  vendor?: string;
  serviceType: string;
  port?: number;
}

export interface IMdnsDriver {
  scan(type?: string, protocol?: string, domain?: string): void;
  stop(): void;
  on(event: 'resolved', listener: (service: ZeroconfService) => void): void;
  on(event: 'error', listener: (err: Error) => void): void;
  removeDeviceListeners(): void;
}

const createDefaultMdnsDriver = (): IMdnsDriver => {
  const zeroconf = new Zeroconf();
  return {
    scan: (type = 'ssh', protocol = 'tcp', domain = 'local.') => {
      zeroconf.scan(type, protocol, domain);
    },
    stop: () => {
      zeroconf.stop();
    },
    on: (
      event: 'resolved' | 'error',
      listener: ((service: ZeroconfService) => void) | ((err: Error) => void),
    ) => {
      if (event === 'resolved') {
        zeroconf.on('resolved', listener as (service: ZeroconfService) => void);
      } else {
        zeroconf.on('error', listener as (err: Error) => void);
      }
    },
    removeDeviceListeners: () => {
      zeroconf.removeDeviceListeners();
    },
  };
};

const extractIpv4Address = (addresses?: string[]): string | null => {
  if (!Array.isArray(addresses)) {
    return null;
  }
  for (const addr of addresses) {
    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(addr)) {
      return addr;
    }
  }
  return null;
};

/**
 * Escáner mDNS / Bonjour no bloqueante (RF-01, RNF-04, RNF-05).
 */
export class MdnsScanner {
  private readonly driverFactory: () => IMdnsDriver;
  private activeDriver: IMdnsDriver | null = null;

  constructor(driverFactory: () => IMdnsDriver = createDefaultMdnsDriver) {
    this.driverFactory = driverFactory;
  }

  public async scanLanServices(
    durationMs = 1500,
    serviceType = 'ssh',
    protocol = 'tcp',
    onHostResolved?: (host: MdnsDiscoveredHost) => void,
  ): Promise<MdnsDiscoveredHost[]> {
    this.stop();

    return new Promise<MdnsDiscoveredHost[]>((resolve) => {
      const discoveredByIp = new Map<string, MdnsDiscoveredHost>();
      const driver = this.driverFactory();
      this.activeDriver = driver;

      let timer: ReturnType<typeof setTimeout> | null = null;

      const finishScan = (): void => {
        if (timer !== null) {
          clearTimeout(timer);
          timer = null;
        }
        try {
          driver.stop();
          driver.removeDeviceListeners();
        } catch {
          // Ignorar errores al detener listener nativo mDNS
        }
        if (this.activeDriver === driver) {
          this.activeDriver = null;
        }
        resolve(Array.from(discoveredByIp.values()));
      };

      driver.on('resolved', (service: ZeroconfService) => {
        const ipv4 = extractIpv4Address(service.addresses);
        if (!ipv4) {
          return;
        }

        const txtRecord = (service.txt ?? {}) as Record<string, unknown>;
        const rawMacFromTxt =
          typeof txtRecord.mac === 'string'
            ? txtRecord.mac
            : typeof txtRecord.hwaddr === 'string'
              ? txtRecord.hwaddr
              : undefined;

        const macAddress = normalizeMacAddress(rawMacFromTxt) ?? undefined;
        const txtVendor =
          typeof txtRecord.vendor === 'string'
            ? txtRecord.vendor
            : typeof txtRecord.model === 'string'
              ? txtRecord.model
              : undefined;

        const hostEntry: MdnsDiscoveredHost = {
          ipAddress: ipv4,
          hostname: service.host || service.name || undefined,
          macAddress,
          vendor: txtVendor ?? resolveVendorByMac(macAddress),
          serviceType: `_${serviceType}._${protocol}`,
          port: service.port,
        };

        discoveredByIp.set(ipv4, hostEntry);
        if (onHostResolved) {
          onHostResolved(hostEntry);
        }
      });

      driver.on('error', () => {
        // Si mDNS falla o no está soportado en la interfaz Wi-Fi actual, finalizamos limpiamente
        finishScan();
      });

      timer = setTimeout(() => {
        finishScan();
      }, durationMs);

      try {
        driver.scan(serviceType, protocol, 'local.');
      } catch {
        finishScan();
      }
    });
  }

  public stop(): void {
    if (this.activeDriver) {
      try {
        this.activeDriver.stop();
        this.activeDriver.removeDeviceListeners();
      } catch {
        // Ignorar errores al limpiar
      }
      this.activeDriver = null;
    }
  }
}
