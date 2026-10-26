jest.mock('@nozbe/watermelondb/adapters/sqlite', () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    fetch: jest.fn(),
    addEventListener: jest.fn(),
  },
}));

import { Database } from '@nozbe/watermelondb';
import LokiJSAdapter from '@nozbe/watermelondb/adapters/lokijs';
import {
  databaseMigrations,
  databaseSchema,
  FieldOperationsRepository,
  modelClasses,
  OutboxQueueItem,
  TableName,
} from '../src/layers/store';
import {
  calculateExponentialBackoffMs,
  IHttpSyncTransport,
  INetInfoDriver,
  isEligibleForRetry,
  OutboxSyncService,
} from '../src/layers/sync';

const createTestDatabase = (): Database => {
  const adapter = new LokiJSAdapter({
    schema: databaseSchema,
    migrations: databaseMigrations,
    useWebWorker: false,
    useIncrementalIndexedDB: false,
  });

  return new Database({
    adapter,
    modelClasses,
  });
};

describe('Fase 5: Sync Layer (Outbox Pattern, NetInfo, Exponential Backoff) & WatermelonDB Repositories', () => {
  test('calculateExponentialBackoffMs and isEligibleForRetry implement RNF-07 accurately', () => {
    expect(calculateExponentialBackoffMs(1, 2000)).toBe(2000);
    expect(calculateExponentialBackoffMs(2, 2000)).toBe(4000);
    expect(calculateExponentialBackoffMs(3, 2000)).toBe(8000);
    expect(calculateExponentialBackoffMs(10, 2000, 60000)).toBe(60000);

    const now = 1730000000000;
    expect(isEligibleForRetry('PENDING', 0, 5, null, now)).toBe(true);
    expect(isEligibleForRetry('PENDING', 2, 5, now + 4000, now)).toBe(false);
    expect(isEligibleForRetry('PENDING', 2, 5, now - 100, now)).toBe(true);
    expect(isEligibleForRetry('PENDING', 5, 5, null, now)).toBe(false);
    expect(isEligibleForRetry('SYNCED', 1, 5, null, now)).toBe(false);
  });

  test('FieldOperationsRepository atomically persists devices, diagnostics, installations and outbox queue items (RF-07, RF-08)', async () => {
    const db = createTestDatabase();
    const repo = new FieldOperationsRepository(db);

    const device = await repo.upsertDiscoveredDevice({
      ipAddress: '192.168.88.1',
      macAddress: 'DC:2C:6E:11:22:33',
      hostname: 'mkt-borde-01',
      vendor: 'MikroTik',
    });

    expect(device.ipAddress).toBe('192.168.88.1');

    const { diagnostic, outboxItem: diagOutbox } = await repo.recordDiagnosticWithOutbox({
      deviceId: device.id,
      protocol: 'SNMP',
      rawOutput: '[SNMP v2c GetResponse | community=***REDACTED***]',
      parsedMetrics: {
        sysName: 'mkt-borde-01',
        sysUpTimeTicks: 420000,
        sysUpTimeFormatted: '0d 1h 10m 0s',
      },
      status: 'SUCCESS',
    });

    expect(diagnostic.protocol).toBe('SNMP');
    expect(diagOutbox.status).toBe('PENDING');
    expect(diagOutbox.endpoint).toBe('/api/v1/sync/diagnostics');

    const { installation, outboxItem: instOutbox } = await repo.recordInstallationWithOutbox({
      deviceId: device.id,
      serialNumber: 'MK-SN-202699',
      technicianNotes: 'ONT y router principal operativos en gabinete estanco.',
      latitude: -32.4845,
      longitude: -58.2321,
      photoUri: 'file:///data/user/0/com.networkdiagnosticsapp/files/ont_01.jpg',
    });

    expect(installation.latitude).toBeCloseTo(-32.4845, 4);
    expect(instOutbox.status).toBe('PENDING');
    expect(instOutbox.endpoint).toBe('/api/v1/sync/installations');

    const snapshot = await repo.getOfflineHistorySnapshot();
    expect(snapshot.devices).toHaveLength(1);
    expect(snapshot.devices[0]?.serialNumber).toBe('MK-SN-202699');
    expect(snapshot.diagnostics).toHaveLength(1);
    expect(snapshot.installations).toHaveLength(1);
    expect(snapshot.outboxStats).toEqual({
      pending: 2,
      syncing: 0,
      failed: 0,
      synced: 0,
    });
  });

  test('OutboxSyncService queues offline and flushes automatically when NetInfo detects reconnection (RF-07, PRD §8.2)', async () => {
    const db = createTestDatabase();
    const repo = new FieldOperationsRepository(db);

    const device = await repo.upsertDiscoveredDevice({
      ipAddress: '192.168.1.20',
      macAddress: '80:2A:A8:00:11:22',
      vendor: 'Ubiquiti Networks',
    });

    await repo.recordDiagnosticWithOutbox({
      deviceId: device.id,
      protocol: 'SSH',
      rawOutput: '> show version\nEdgeRouter X v2.0.9',
      parsedMetrics: { sysUpTimeFormatted: '5d 2h 10m 0s' },
      status: 'SUCCESS',
    });

    let isOnline = false;
    let netListenerCallback:
      | ((state: { isConnected: boolean | null; isInternetReachable: boolean | null }) => void)
      | null = null;

    const mockNetInfo: INetInfoDriver = {
      fetch: async () => ({
        isConnected: isOnline,
        isInternetReachable: isOnline,
      }),
      addEventListener: (listener) => {
        netListenerCallback = listener;
        return () => {
          netListenerCallback = null;
        };
      },
    };

    const postedRequests: Array<{ url: string; body: Record<string, unknown> }> = [];
    const mockHttp: IHttpSyncTransport = {
      postJson: async (url, bodyJson) => {
        postedRequests.push({
          url,
          body: JSON.parse(bodyJson) as Record<string, unknown>,
        });
        return { status: 201, ok: true };
      },
      checkHealth: async () => true,
    };

    const syncService = new OutboxSyncService({
      baseUrl: 'http://localhost:3000',
      database: db,
      netInfoDriver: mockNetInfo,
      httpTransport: mockHttp,
    });

    // 1. Mientras está en modo avión / offline, no debe enviar nada
    const offlineReport = await syncService.processPendingQueue();
    expect(offlineReport.skippedOffline).toBe(true);
    expect(postedRequests).toHaveLength(0);

    // 2. Suscribir listener de NetInfo y simular reconexión a internet
    syncService.startNetworkListener();
    isOnline = true;
    expect(netListenerCallback).not.toBeNull();
    netListenerCallback!({ isConnected: true, isInternetReachable: true });

    // Esperar a que concluya el ciclo asíncrono disparado por NetInfo
    await new Promise<void>((resolve) => setTimeout(resolve, 60));

    expect(postedRequests).toHaveLength(1);
    expect(postedRequests[0]?.url).toBe('http://localhost:3000/api/v1/sync/diagnostics');
    expect(typeof postedRequests[0]?.body.transactionId).toBe('string');

    const snapshotAfterSync = await repo.getOfflineHistorySnapshot();
    expect(snapshotAfterSync.outboxStats.synced).toBe(1);
    expect(snapshotAfterSync.outboxStats.pending).toBe(0);

    syncService.stopNetworkListener();
  });

  test('OutboxSyncService applies exponential backoff on HTTP 503 failure and transitions to FAILED when maxAttempts is exhausted (RNF-07)', async () => {
    const db = createTestDatabase();
    const syncService = new OutboxSyncService({
      baseUrl: 'http://localhost:3000',
      database: db,
      baseBackoffDelayMs: 1000,
      netInfoDriver: {
        fetch: async () => ({ isConnected: true, isInternetReachable: true }),
        addEventListener: () => () => {},
      },
      httpTransport: {
        postJson: async () => ({
          status: 503,
          ok: false,
          errorText: 'Service Unavailable',
        }),
        checkHealth: async () => true,
      },
    });

    const outboxId = await syncService.enqueue({
      entityType: 'INSTALLATION',
      entityId: 'inst-999',
      endpoint: '/api/v1/sync/installations',
      maxAttempts: 2,
      payload: {
        transactionId: 'tx-uuid-999',
        installationId: 'inst-999',
        deviceId: 'dev-999',
        technicianNotes: 'Prueba de fallo',
        latitude: -32.48,
        longitude: -58.23,
        photoUri: 'file:///data/user/0/com.networkdiagnosticsapp/files/f1.jpg',
        createdAt: Date.now(),
      },
    });

    // Intento 1 -> Falla con 503, queda en PENDING con attempts=1 y nextRetryAt en el futuro
    const firstReport = await syncService.processPendingQueue();
    expect(firstReport.failedCount).toBe(1);

    const repo = new FieldOperationsRepository(db);
    const snap1 = await repo.getOfflineHistorySnapshot();
    expect(snap1.outboxStats.pending).toBe(1);
    expect(snap1.outboxStats.failed).toBe(0);

    // Forzamos la expiración de la ventana de backoff para probar el segundo y último intento
    const itemRecord = await db.get<OutboxQueueItem>(TableName.OUTBOX_QUEUE).find(outboxId);
    await db.write(async () => {
      await itemRecord.update((rec) => {
        rec.nextRetryAt = Date.now() - 10;
      });
    });

    // Intento 2 (alcanza maxAttempts=2) -> Transiciona definitivamente a estado FAILED
    const secondReport = await syncService.processPendingQueue();
    expect(secondReport.failedCount).toBe(1);

    const snap2 = await repo.getOfflineHistorySnapshot();
    expect(snap2.outboxStats.pending).toBe(0);
    expect(snap2.outboxStats.failed).toBe(1);
  });
});
