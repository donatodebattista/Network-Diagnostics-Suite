export type DiagnosticProtocol = 'SNMP' | 'SSH';

export type DiagnosticStatus = 'SUCCESS' | 'FAILED';

export type OutboxEntityType = 'INSTALLATION' | 'DIAGNOSTIC';

export type OutboxSyncEndpoint =
  | '/api/v1/sync/installations'
  | '/api/v1/sync/diagnostics';

export type OutboxStatus = 'PENDING' | 'SYNCING' | 'FAILED' | 'SYNCED';

export interface SnmpInterfaceTraffic {
  ifIndex: number;
  ifInOctets: number;
  ifOutOctets: number;
}

export interface ParsedDiagnosticMetrics {
  sysDescr?: string;
  sysUpTimeTicks?: number;
  sysUpTimeFormatted?: string;
  sysName?: string;
  interfaces?: SnmpInterfaceTraffic[];
  sshCommandsExecuted?: string[];
  rawSummary?: string;
}

export interface OutboxDiagnosticPayload {
  transactionId: string;
  diagnosticId: string;
  deviceId: string;
  ipAddress: string;
  macAddress: string;
  protocol: DiagnosticProtocol;
  rawOutput: string;
  parsedMetrics: ParsedDiagnosticMetrics;
  status: DiagnosticStatus;
  executedAt: number;
}

export interface OutboxInstallationPayload {
  transactionId: string;
  installationId: string;
  deviceId: string;
  serialNumber?: string;
  technicianNotes: string;
  latitude: number;
  longitude: number;
  photoUri: string;
  photoBase64?: string;
  pdfPath?: string;
  createdAt: number;
}

export type OutboxPayload = OutboxDiagnosticPayload | OutboxInstallationPayload;
