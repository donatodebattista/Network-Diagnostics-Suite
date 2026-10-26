import TcpSocket from 'react-native-tcp-socket';

export interface HostProbeResult {
  ipAddress: string;
  reachable: boolean;
  openPort?: number;
  respondedInMs: number;
}

export type TcpHostProber = (
  ipAddress: string,
  port: number,
  timeoutMs: number,
) => Promise<{ reachable: boolean; respondedInMs: number }>;

/**
 * Sonda TCP no bloqueante con timeout determinístico (RNF-04, RNF-05).
 * Considera un nodo activo en la LAN tanto si acepta la conexión TCP (`connect`)
 * como si responde inmediatamente con `ECONNREFUSED` (lo cual confirma presencia en capa IP/ARP).
 */
export const defaultTcpHostProber: TcpHostProber = (
  ipAddress: string,
  port: number,
  timeoutMs: number,
): Promise<{ reachable: boolean; respondedInMs: number }> => {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const socket = TcpSocket.createConnection({ host: ipAddress, port }, () => {
      if (settled) {
        return;
      }
      settled = true;
      const elapsed = Math.max(1, Date.now() - startedAt);
      cleanup();
      resolve({ reachable: true, respondedInMs: elapsed });
    });

    const cleanup = (): void => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      try {
        socket.removeAllListeners();
        socket.destroy();
      } catch {
        // Ignorar errores al cerrar descriptor
      }
    };

    timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        cleanup();
        resolve({ reachable: false, respondedInMs: timeoutMs });
      }
    }, timeoutMs);

    socket.on('error', (err: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      const elapsed = Math.max(1, Date.now() - startedAt);
      cleanup();

      const msg = (err.message || '').toUpperCase();
      // ECONNREFUSED indica que el stack TCP/IP del equipo en la LAN respondió con un paquete RST activo
      if (msg.includes('ECONNREFUSED') || msg.includes('CONNECTION REFUSED')) {
        resolve({ reachable: true, respondedInMs: elapsed });
        return;
      }

      resolve({ reachable: false, respondedInMs: elapsed });
    });
  });
};

export interface SubnetSweepOptions {
  ports?: readonly number[];
  perHostTimeoutMs?: number;
  concurrencyBatchSize?: number;
  hostRange?: { start: number; end: number };
  prober?: TcpHostProber;
  onHostActive?: (result: HostProbeResult) => void;
  shouldAbort?: () => boolean;
}

/**
 * Ejecuta un barrido asíncrono por lotes sobre una subred `/24` (e.g. `192.168.1`),
 * cediendo el hilo de eventos entre lotes para no bloquear el UI Thread (RNF-04).
 */
export const sweepSubnet = async (
  subnetPrefix: string,
  options: SubnetSweepOptions = {},
): Promise<HostProbeResult[]> => {
  const cleanPrefix = subnetPrefix.trim().replace(/\.$/, '');
  if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(cleanPrefix)) {
    throw new Error(
      `Invalid /24 subnet prefix "${subnetPrefix}". Expected format: "192.168.1"`,
    );
  }

  const ports = options.ports ?? [22, 80];
  const perHostTimeoutMs = options.perHostTimeoutMs ?? 350;
  const batchSize = Math.max(1, options.concurrencyBatchSize ?? 24);
  const startOctet = Math.max(1, options.hostRange?.start ?? 1);
  const endOctet = Math.min(254, options.hostRange?.end ?? 254);
  const prober = options.prober ?? defaultTcpHostProber;

  const targetIps: string[] = [];
  for (let host = startOctet; host <= endOctet; host++) {
    targetIps.push(`${cleanPrefix}.${host}`);
  }

  const activeHosts: HostProbeResult[] = [];

  const probeSingleIp = async (ipAddress: string): Promise<HostProbeResult | null> => {
    for (const port of ports) {
      if (options.shouldAbort?.()) {
        return null;
      }
      const { reachable, respondedInMs } = await prober(ipAddress, port, perHostTimeoutMs);
      if (reachable) {
        const hit: HostProbeResult = {
          ipAddress,
          reachable: true,
          openPort: port,
          respondedInMs,
        };
        if (options.onHostActive) {
          options.onHostActive(hit);
        }
        return hit;
      }
    }
    return null;
  };

  for (let i = 0; i < targetIps.length; i += batchSize) {
    if (options.shouldAbort?.()) {
      break;
    }

    const batch = targetIps.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map((ip) => probeSingleIp(ip)));

    for (const res of batchResults) {
      if (res !== null) {
        activeHosts.push(res);
      }
    }

    // Ceder el turno al Event Loop entre lotes (RNF-04)
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }

  return activeHosts;
};
