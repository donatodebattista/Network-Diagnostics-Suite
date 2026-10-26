export interface SyncDiagnosticRequest {
  transactionId: string;
  diagnosticId: string;
  deviceId: string;
  ipAddress: string;
  macAddress: string;
  protocol: 'SNMP' | 'SSH';
  rawOutput: string;
  parsedMetrics: Record<string, unknown>;
  status: 'SUCCESS' | 'FAILED';
  executedAt: number;
}

export interface SyncInstallationRequest {
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

export interface SyncAckResponse {
  acknowledged: boolean;
  transactionId: string;
  entityId: string;
  duplicate: boolean;
  syncedAt: string;
}
