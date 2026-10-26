/**
 * Capa 2: Protocol Layer
 * Responsabilidad: Cliente SNMP v1/v2c con parser BER/ASN.1 sobre UDP/161 y Cliente SSH embebido.
 */
import type { ParsedDiagnosticMetrics } from '../../shared/types/domain';

export interface ISnmpClient {
  queryDeviceMetrics(
    ipAddress: string,
    community: string,
    timeoutMs?: number,
  ): Promise<ParsedDiagnosticMetrics>;
}

export interface ISshClient {
  executeDiagnosticBatch(
    host: string,
    port: number,
    commands: string[],
    timeoutMs?: number,
  ): Promise<string>;
}
