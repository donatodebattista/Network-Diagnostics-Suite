import { MdnsDiscoveredHost, MdnsScanner } from './mdnsScanner';
import {
  deriveFallbackLanMacFromIp,
  normalizeMacAddress,
  resolveVendorByMac,
} from './ouiVendorTable';
import { HostProbeResult, sweepSubnet, TcpHostProber } from './subnetSweeper';
import type { DiscoveredNode, IDiscoveryService } from './index';

export interface DiscoveryServiceOptions {
  mdnsScanner?: MdnsScanner;
  tcpProber?: TcpHostProber;
  arpTableReader?: () => Promise<ReadonlyMap<string, string>>;
  hostRange?: { start: number; end: number };
  concurrencyBatchSize?: number;
  mdnsDurationMs?: number;
}

/**
 * Capa 1: Servicio de Descubrimiento de Red Local (RF-01, RNF-04, RNF-05).
 * Combina consultas mDNS/Bonjour con barrido concurrente de subred por lotes y resolución OUI de MAC.
 */
export class DiscoveryService implements IDiscoveryService {
  private readonly mdnsScanner: MdnsScanner;
  private readonly tcpProber?: TcpHostProber;
  private readonly arpTableReader?: () => Promise<ReadonlyMap<string, string>>;
  private readonly hostRange?: { start: number; end: number };
  private readonly concurrencyBatchSize?: number;
  private readonly mdnsDurationMs: number;
  private abortRequested = false;

  constructor(options: DiscoveryServiceOptions = {}) {
    this.mdnsScanner = options.mdnsScanner ?? new MdnsScanner();
    this.tcpProber = options.tcpProber;
    this.arpTableReader = options.arpTableReader;
    this.hostRange = options.hostRange;
    this.concurrencyBatchSize = options.concurrencyBatchSize;
    this.mdnsDurationMs = options.mdnsDurationMs ?? 1200;
  }

  public async scanLocalSubnet(
    subnetPrefix: string,
    timeoutMs = 350,
    onNodeDiscovered?: (node: DiscoveredNode) => void,
  ): Promise<DiscoveredNode[]> {
    this.abortRequested = false;

    const nodesByIp = new Map<string, DiscoveredNode>();
    const arpMap = this.arpTableReader ? await this.arpTableReader() : new Map<string, string>();

    const upsertAndNotify = (partial: {
      ipAddress: string;
      macAddress?: string;
      hostname?: string;
      vendor?: string;
      respondedInMs?: number;
    }): void => {
      const existing = nodesByIp.get(partial.ipAddress);
      const rawMac =
        partial.macAddress ??
        existing?.macAddress ??
        arpMap.get(partial.ipAddress);

      const resolvedMac =
        normalizeMacAddress(rawMac) ?? deriveFallbackLanMacFromIp(partial.ipAddress);

      const resolvedVendor =
        partial.vendor ??
        existing?.vendor ??
        resolveVendorByMac(resolvedMac);

      const merged: DiscoveredNode = {
        ipAddress: partial.ipAddress,
        macAddress: resolvedMac,
        hostname: partial.hostname ?? existing?.hostname,
        vendor: resolvedVendor,
        respondedInMs: partial.respondedInMs ?? existing?.respondedInMs ?? 1,
      };

      nodesByIp.set(partial.ipAddress, merged);
      if (onNodeDiscovered) {
        onNodeDiscovered(merged);
      }
    };

    const mdnsPromise = this.mdnsScanner.scanLanServices(
      Math.min(this.mdnsDurationMs, timeoutMs * 4),
      'ssh',
      'tcp',
      (mdnsHost: MdnsDiscoveredHost) => {
        if (!this.abortRequested) {
          upsertAndNotify({
            ipAddress: mdnsHost.ipAddress,
            macAddress: mdnsHost.macAddress,
            hostname: mdnsHost.hostname,
            vendor: mdnsHost.vendor,
            respondedInMs: 10,
          });
        }
      },
    );

    const sweepPromise = sweepSubnet(subnetPrefix, {
      perHostTimeoutMs: timeoutMs,
      concurrencyBatchSize: this.concurrencyBatchSize,
      hostRange: this.hostRange,
      prober: this.tcpProber,
      shouldAbort: () => this.abortRequested,
      onHostActive: (probeHit: HostProbeResult) => {
        if (!this.abortRequested) {
          upsertAndNotify({
            ipAddress: probeHit.ipAddress,
            respondedInMs: probeHit.respondedInMs,
          });
        }
      },
    });

    await Promise.all([mdnsPromise, sweepPromise]);

    return Array.from(nodesByIp.values()).sort((a, b) =>
      a.ipAddress.localeCompare(b.ipAddress, undefined, { numeric: true }),
    );
  }

  public stopScan(): void {
    this.abortRequested = true;
    this.mdnsScanner.stop();
  }
}
