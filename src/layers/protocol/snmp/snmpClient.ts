import UdpSockets from 'react-native-udp';
import type {
  ParsedDiagnosticMetrics,
  SnmpInterfaceTraffic,
} from '../../../shared/types/domain';
import {
  buildInterfaceOids,
  MIB2_OIDS,
  SNMP_DEFAULT_PORT,
  SNMP_DEFAULT_TIMEOUT_MS,
  SnmpErrorStatus,
  SnmpVersion,
} from './constants';
import {
  decodeSnmpGetResponse,
  encodeSnmpGetRequest,
  formatRedactedSnmpSummary,
  formatSnmpTimeTicks,
  SnmpGetResponseMessage,
} from './pdu';

export interface ISnmpUdpSocket {
  bind(port?: number, callback?: () => void): void;
  send(
    msg: Uint8Array,
    offset?: number,
    length?: number,
    port?: number,
    address?: string,
    callback?: (error?: Error) => void,
  ): void;
  close(callback?: () => void): unknown;
  on(event: 'error', listener: (err: Error) => void): this;
  on(event: 'message', listener: (msg: Uint8Array) => void): this;
  removeAllListeners(event?: string): this;
}

export interface SnmpClientOptions {
  port?: number;
  timeoutMs?: number;
  version?: SnmpVersion;
  interfaceIndices?: readonly number[];
  socketFactory?: () => ISnmpUdpSocket;
}

export interface SnmpDiagnosticExecutionResult {
  metrics: ParsedDiagnosticMetrics;
  rawOutput: string;
  response: SnmpGetResponseMessage;
}

const DEFAULT_INTERFACE_INDICES: readonly number[] = [1, 2];

const generateRequestId = (): number => {
  return Math.floor(10000 + Math.random() * 2147400000);
};

export class SnmpClient {
  private readonly defaultPort: number;
  private readonly defaultTimeoutMs: number;
  private readonly defaultVersion: SnmpVersion;
  private readonly defaultInterfaceIndices: readonly number[];
  private readonly socketFactory: () => ISnmpUdpSocket;

  constructor(options: SnmpClientOptions = {}) {
    this.defaultPort = options.port ?? SNMP_DEFAULT_PORT;
    this.defaultTimeoutMs = options.timeoutMs ?? SNMP_DEFAULT_TIMEOUT_MS;
    this.defaultVersion = options.version ?? SnmpVersion.V2C;
    this.defaultInterfaceIndices = options.interfaceIndices ?? DEFAULT_INTERFACE_INDICES;
    this.socketFactory =
      options.socketFactory ??
      (() =>
        UdpSockets.createSocket({
          type: 'udp4',
          debug: false, // RNF-02: Deshabilitar logs internos del socket con tramas binarias
        }) as unknown as ISnmpUdpSocket);
  }

  /**
   * Envía un datagrama SNMP GetRequest (0xA0) por UDP/161 y espera de forma no bloqueante (RNF-04)
   * la trama GetResponse (0xA2) con un timeout determinístico (RNF-05: 2000 ms por defecto).
   */
  public async executeGetRequest(
    ipAddress: string,
    community: string,
    oids: readonly string[],
    timeoutMs: number = this.defaultTimeoutMs,
    port: number = this.defaultPort,
  ): Promise<SnmpGetResponseMessage> {
    if (!ipAddress || ipAddress.trim().length === 0) {
      throw new Error('Target IP address is required for SNMP GetRequest');
    }

    const requestId = generateRequestId();
    const requestPacket = encodeSnmpGetRequest({
      version: this.defaultVersion,
      community,
      requestId,
      oids,
    });

    return new Promise<SnmpGetResponseMessage>((resolve, reject) => {
      const socket = this.socketFactory();
      let isSettled = false;
      let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

      const cleanupSocket = (): void => {
        if (timeoutHandle !== null) {
          clearTimeout(timeoutHandle);
          timeoutHandle = null;
        }
        try {
          socket.removeAllListeners();
          socket.close();
        } catch {
          // Ignorar errores secundarios al cerrar un socket ya liberado
        }
      };

      const failWith = (error: Error): void => {
        if (isSettled) {
          return;
        }
        isSettled = true;
        cleanupSocket();
        reject(error);
      };

      const succeedWith = (message: SnmpGetResponseMessage): void => {
        if (isSettled) {
          return;
        }
        isSettled = true;
        cleanupSocket();
        resolve(message);
      };

      timeoutHandle = setTimeout(() => {
        failWith(
          new Error(
            `SNMP GetRequest timed out after ${timeoutMs}ms waiting for ${ipAddress}:${port}`,
          ),
        );
      }, timeoutMs);

      socket.on('error', (err: Error) => {
        failWith(new Error(`SNMP UDP socket error (${ipAddress}:${port}): ${err.message}`));
      });

      socket.on('message', (msg: Uint8Array) => {
        try {
          const datagram = msg instanceof Uint8Array ? msg : new Uint8Array(msg);
          const decoded = decodeSnmpGetResponse(datagram);

          if (decoded.requestId !== requestId) {
            return;
          }

          if (decoded.errorStatus !== SnmpErrorStatus.NO_ERROR) {
            failWith(
              new Error(
                `SNMP agent returned errorStatus=${decoded.errorStatus} at errorIndex=${decoded.errorIndex}`,
              ),
            );
            return;
          }

          succeedWith(decoded);
        } catch (decodeError) {
          const message =
            decodeError instanceof Error ? decodeError.message : 'Unknown BER decode error';
          failWith(new Error(`Failed to decode SNMP GetResponse from ${ipAddress}: ${message}`));
        }
      });

      socket.bind(0, () => {
        socket.send(
          requestPacket,
          0,
          requestPacket.length,
          port,
          ipAddress,
          (sendErr?: Error) => {
            if (sendErr) {
              failWith(
                new Error(
                  `Failed to send SNMP datagram to ${ipAddress}:${port}: ${sendErr.message}`,
                ),
              );
            }
          },
        );
      });
    });
  }

  /**
   * Ejecuta la consulta completa de OIDs MIB-II (`sysDescr`, `sysUpTime`, `sysName`,
   * `ifInOctets.x` e `ifOutOctets.x`) y retorna las métricas estructuradas junto con
   * el resumen sanitizado sin credenciales (RNF-02).
   */
  public async runDeviceDiagnostic(
    ipAddress: string,
    community: string,
    timeoutMs: number = this.defaultTimeoutMs,
    interfaceIndices: readonly number[] = this.defaultInterfaceIndices,
  ): Promise<SnmpDiagnosticExecutionResult> {
    const interfaceOidMappings = interfaceIndices.map((idx) => buildInterfaceOids(idx));
    const oidList: string[] = [
      MIB2_OIDS.SYS_DESCR,
      MIB2_OIDS.SYS_UP_TIME,
      MIB2_OIDS.SYS_NAME,
    ];

    for (const mapping of interfaceOidMappings) {
      oidList.push(mapping.ifInOctetsOid, mapping.ifOutOctetsOid);
    }

    const response = await this.executeGetRequest(ipAddress, community, oidList, timeoutMs);
    const metrics = this.extractMib2Metrics(response, interfaceIndices);
    const rawOutput = formatRedactedSnmpSummary(response);

    return {
      metrics,
      rawOutput,
      response,
    };
  }

  /**
   * Implementación de `ISnmpClient.queryDeviceMetrics`.
   */
  public async queryDeviceMetrics(
    ipAddress: string,
    community: string,
    timeoutMs: number = this.defaultTimeoutMs,
  ): Promise<ParsedDiagnosticMetrics> {
    const result = await this.runDeviceDiagnostic(ipAddress, community, timeoutMs);
    return result.metrics;
  }

  private extractMib2Metrics(
    response: SnmpGetResponseMessage,
    interfaceIndices: readonly number[],
  ): ParsedDiagnosticMetrics {
    const varBindMap = new Map<string, string | number | null>();
    for (const vb of response.varBinds) {
      varBindMap.set(vb.oid, vb.value);
    }

    const metrics: ParsedDiagnosticMetrics = {};

    const sysDescrVal = varBindMap.get(MIB2_OIDS.SYS_DESCR);
    if (typeof sysDescrVal === 'string') {
      metrics.sysDescr = sysDescrVal;
    }

    const sysUpTimeVal = varBindMap.get(MIB2_OIDS.SYS_UP_TIME);
    if (typeof sysUpTimeVal === 'number') {
      metrics.sysUpTimeTicks = sysUpTimeVal;
      metrics.sysUpTimeFormatted = formatSnmpTimeTicks(sysUpTimeVal);
    }

    const sysNameVal = varBindMap.get(MIB2_OIDS.SYS_NAME);
    if (typeof sysNameVal === 'string') {
      metrics.sysName = sysNameVal;
    }

    const interfaces: SnmpInterfaceTraffic[] = [];
    for (const ifIndex of interfaceIndices) {
      const { ifInOctetsOid, ifOutOctetsOid } = buildInterfaceOids(ifIndex);
      const inVal = varBindMap.get(ifInOctetsOid);
      const outVal = varBindMap.get(ifOutOctetsOid);

      if (typeof inVal === 'number' || typeof outVal === 'number') {
        interfaces.push({
          ifIndex,
          ifInOctets: typeof inVal === 'number' ? inVal : 0,
          ifOutOctets: typeof outVal === 'number' ? outVal : 0,
        });
      }
    }

    if (interfaces.length > 0) {
      metrics.interfaces = interfaces;
    }

    metrics.rawSummary = formatRedactedSnmpSummary(response);

    return metrics;
  }
}
