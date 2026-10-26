import type { Database } from '@nozbe/watermelondb';
import { Q } from '@nozbe/watermelondb';
import type {
  DiagnosticProtocol,
  DiagnosticStatus,
  OutboxDiagnosticPayload,
  OutboxInstallationPayload,
  ParsedDiagnosticMetrics,
} from '../../shared/types/domain';
import { generateUuidV4 } from '../../shared/utils/uuid';
import { DEFAULT_MAX_OUTBOX_ATTEMPTS } from '../sync/backoff';
import { getDatabase } from './database';
import { Device, Diagnostic, Installation, OutboxQueueItem } from './models';
import { TableName } from './schema';

export interface UpsertDeviceInput {
  ipAddress: string;
  macAddress: string;
  hostname?: string | null;
  vendor?: string | null;
  serialNumber?: string | null;
}

export interface RecordDiagnosticInput {
  deviceId: string;
  protocol: DiagnosticProtocol;
  rawOutput: string;
  parsedMetrics: ParsedDiagnosticMetrics;
  status: DiagnosticStatus;
  executedAt?: number;
}

export interface RecordInstallationInput {
  deviceId: string;
  serialNumber?: string | null;
  technicianNotes: string;
  latitude: number;
  longitude: number;
  photoUri: string;
  photoBase64?: string;
  pdfPath?: string | null;
}

export interface OfflineHistorySnapshot {
  devices: Device[];
  diagnostics: Diagnostic[];
  installations: Installation[];
  outboxStats: {
    pending: number;
    syncing: number;
    failed: number;
    synced: number;
  };
}

/**
 * Repositorio Transaccional Offline-First (RF-07, RF-08, RNF-06).
 * Garantiza que cada operación de diagnóstico o instalación persista la entidad de dominio
 * y su correspondiente mensaje en `outbox_queue` dentro de una única transacción SQLite atómica.
 */
export class FieldOperationsRepository {
  private readonly databaseGetter: () => Database;

  constructor(database?: Database) {
    this.databaseGetter = () => database ?? getDatabase();
  }

  /**
   * Crea o actualiza un nodo de red descubierto en la LAN dentro de la tabla `devices`.
   */
  public async upsertDiscoveredDevice(input: UpsertDeviceInput): Promise<Device> {
    const db = this.databaseGetter();
    const devicesCollection = db.get<Device>(TableName.DEVICES);

    const existingMatches = await devicesCollection
      .query(Q.where('ip_address', input.ipAddress))
      .fetch();

    let savedDevice!: Device;

    await db.write(async () => {
      if (existingMatches.length > 0) {
        const current = existingMatches[0];
        savedDevice = await current.update((record) => {
          record.ipAddress = input.ipAddress;
          record.macAddress = input.macAddress || record.macAddress;
          if (input.hostname !== undefined) {
            record.hostname = input.hostname;
          }
          if (input.vendor !== undefined) {
            record.vendor = input.vendor;
          }
          if (input.serialNumber !== undefined && input.serialNumber !== null) {
            record.serialNumber = input.serialNumber;
          }
        });
      } else {
        savedDevice = await devicesCollection.create((record) => {
          record.ipAddress = input.ipAddress;
          record.macAddress = input.macAddress;
          record.hostname = input.hostname ?? null;
          record.vendor = input.vendor ?? null;
          record.serialNumber = input.serialNumber ?? null;
        });
      }
    });

    return savedDevice;
  }

  /**
   * Registra atómicamente un diagnóstico (SNMP o SSH) y encola su transacción en `outbox_queue` (RF-07).
   */
  public async recordDiagnosticWithOutbox(
    input: RecordDiagnosticInput,
  ): Promise<{ diagnostic: Diagnostic; outboxItem: OutboxQueueItem }> {
    const db = this.databaseGetter();
    const device = await db.get<Device>(TableName.DEVICES).find(input.deviceId);
    const executedAtMs = input.executedAt ?? Date.now();
    const transactionId = generateUuidV4();

    let createdDiagnostic!: Diagnostic;
    let createdOutbox!: OutboxQueueItem;

    await db.write(async () => {
      createdDiagnostic = await db
        .get<Diagnostic>(TableName.DIAGNOSTICS)
        .create((diag) => {
          diag.deviceId = device.id;
          diag.protocol = input.protocol;
          diag.rawOutput = input.rawOutput;
          diag.parsedMetrics = input.parsedMetrics;
          diag.status = input.status;
          diag.executedAt = new Date(executedAtMs);
        });

      const outboxPayload: OutboxDiagnosticPayload = {
        transactionId,
        diagnosticId: createdDiagnostic.id,
        deviceId: device.id,
        ipAddress: device.ipAddress,
        macAddress: device.macAddress,
        protocol: input.protocol,
        rawOutput: input.rawOutput,
        parsedMetrics: input.parsedMetrics,
        status: input.status,
        executedAt: executedAtMs,
      };

      createdOutbox = await db
        .get<OutboxQueueItem>(TableName.OUTBOX_QUEUE)
        .create((item) => {
          item.entityType = 'DIAGNOSTIC';
          item.entityId = createdDiagnostic.id;
          item.endpoint = '/api/v1/sync/diagnostics';
          item.payload = JSON.stringify(outboxPayload);
          item.attempts = 0;
          item.maxAttempts = DEFAULT_MAX_OUTBOX_ATTEMPTS;
          item.nextRetryAt = null;
          item.lastError = null;
          item.status = 'PENDING';
        });
    });

    return {
      diagnostic: createdDiagnostic,
      outboxItem: createdOutbox,
    };
  }

  /**
   * Registra atómicamente una instalación georreferenciada, vincula el número de serie QR al equipo
   * y encola su transacción en `outbox_queue` (RF-04, RF-05, RF-07).
   */
  public async recordInstallationWithOutbox(
    input: RecordInstallationInput,
  ): Promise<{ installation: Installation; outboxItem: OutboxQueueItem }> {
    const db = this.databaseGetter();
    const device = await db.get<Device>(TableName.DEVICES).find(input.deviceId);
    const transactionId = generateUuidV4();

    let createdInstallation!: Installation;
    let createdOutbox!: OutboxQueueItem;

    await db.write(async () => {
      if (input.serialNumber && input.serialNumber.trim().length > 0) {
        await device.update((dev) => {
          dev.serialNumber = input.serialNumber!.trim();
        });
      }

      createdInstallation = await db
        .get<Installation>(TableName.INSTALLATIONS)
        .create((inst) => {
          inst.deviceId = device.id;
          inst.technicianNotes = input.technicianNotes;
          inst.latitude = input.latitude;
          inst.longitude = input.longitude;
          inst.photoUri = input.photoUri;
          inst.pdfPath = input.pdfPath ?? null;
        });

      const outboxPayload: OutboxInstallationPayload = {
        transactionId,
        installationId: createdInstallation.id,
        deviceId: device.id,
        serialNumber: input.serialNumber ?? device.serialNumber ?? undefined,
        technicianNotes: input.technicianNotes,
        latitude: input.latitude,
        longitude: input.longitude,
        photoUri: input.photoUri,
        photoBase64: input.photoBase64,
        pdfPath: input.pdfPath ?? undefined,
        createdAt: createdInstallation.createdAt.getTime(),
      };

      createdOutbox = await db
        .get<OutboxQueueItem>(TableName.OUTBOX_QUEUE)
        .create((item) => {
          item.entityType = 'INSTALLATION';
          item.entityId = createdInstallation.id;
          item.endpoint = '/api/v1/sync/installations';
          item.payload = JSON.stringify(outboxPayload);
          item.attempts = 0;
          item.maxAttempts = DEFAULT_MAX_OUTBOX_ATTEMPTS;
          item.nextRetryAt = null;
          item.lastError = null;
          item.status = 'PENDING';
        });
    });

    return {
      installation: createdInstallation,
      outboxItem: createdOutbox,
    };
  }

  /**
   * Recupera una instantánea completa del historial técnico almacenado localmente
   * junto con el estado de la cola de sincronización Outbox (RF-08).
   */
  public async getOfflineHistorySnapshot(): Promise<OfflineHistorySnapshot> {
    const db = this.databaseGetter();

    const [devices, diagnostics, installations, outboxItems] = await Promise.all([
      db.get<Device>(TableName.DEVICES).query(Q.sortBy('updated_at', Q.desc)).fetch(),
      db
        .get<Diagnostic>(TableName.DIAGNOSTICS)
        .query(Q.sortBy('executed_at', Q.desc))
        .fetch(),
      db
        .get<Installation>(TableName.INSTALLATIONS)
        .query(Q.sortBy('created_at', Q.desc))
        .fetch(),
      db.get<OutboxQueueItem>(TableName.OUTBOX_QUEUE).query().fetch(),
    ]);

    const outboxStats = {
      pending: 0,
      syncing: 0,
      failed: 0,
      synced: 0,
    };

    for (const item of outboxItems) {
      if (item.status === 'PENDING') {
        outboxStats.pending++;
      } else if (item.status === 'SYNCING') {
        outboxStats.syncing++;
      } else if (item.status === 'FAILED') {
        outboxStats.failed++;
      } else if (item.status === 'SYNCED') {
        outboxStats.synced++;
      }
    }

    return {
      devices,
      diagnostics,
      installations,
      outboxStats,
    };
  }
}
