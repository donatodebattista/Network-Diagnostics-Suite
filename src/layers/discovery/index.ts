/**
 * Capa 1: Discovery Layer
 * Responsabilidad: Escaneo LAN, mDNS/Bonjour y resolución IP/MAC.
 */
export interface DiscoveredNode {
  ipAddress: string;
  macAddress: string;
  hostname?: string;
  vendor?: string;
  respondedInMs: number;
}

export interface IDiscoveryService {
  scanLocalSubnet(
    subnetPrefix: string,
    timeoutMs?: number,
    onNodeDiscovered?: (node: DiscoveredNode) => void,
  ): Promise<DiscoveredNode[]>;
  stopScan(): void;
}

export * from './ouiVendorTable';
export * from './mdnsScanner';
export * from './subnetSweeper';
export * from './discoveryService';
