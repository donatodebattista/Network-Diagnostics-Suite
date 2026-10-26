import NetInfo, { NetInfoState, NetInfoSubscription } from '@react-native-community/netinfo';
import type { Database } from '@nozbe/watermelondb';
import { Q } from '@nozbe/watermelondb';
import { getDatabase, OutboxQueueItem, TableName } from '../store';
import {
  DEFAULT_BASE_BACKOFF_MS,
  DEFAULT_MAX_OUTBOX_ATTEMPTS,
  isEligibleForRetry,
} from './backoff';
import type {
  EnqueueOutboxParams,
  IOutboxSyncService,
  OutboxSyncCycleReport,
} from './index';

export interface INetInfoDriver {
  fetch(): Promise<Pick<NetInfoState, 'isConnected' | 'isInternetReachable'>>;
  addEventListener(
    listener: (state: Pick<NetInfoState, 'isConnected' | 'isInternetReachable'>) => void,
  ): NetInfoSubscription;
}

export interface IHttpSyncTransport {
  postJson(
    url: string,
    bodyJson: string,
    timeoutMs: number,
  ): Promise<{ status: number; ok: boolean; errorText?: string }>;
  checkHealth(url: string, timeoutMs: number): Promise<boolean>;
}

const defaultHttpSyncTransport: IHttpSyncTransport = {
  postJson: async (url: string, bodyJson: string, timeoutMs: number) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: bodyJson,
        signal: controller.signal,
      });

      const ok = response.status === 200 || response.status === 201;
      const errorText = ok ? undefined : await response.text().catch(() => `HTTP ${response.status}`);
      return {
        status: response.status,
        ok,
        errorText,
      };
    } finally {
      clearTimeout(timer);
    }
  },
  checkHealth: async (url: string, timeoutMs: number) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
      });
      return response.status === 200;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  },
};

export interface OutboxSyncServiceOptions {
  baseUrl?: string;
  database?: Database;
  netInfoDriver?: INetInfoDriver;
  httpTransport?: IHttpSyncTransport;
  requestTimeoutMs?: number;
  baseBackoffDelayMs?: number;
  verifyHealthEndpoint?: boolean;
  onSyncCycleCompleted?: (report: OutboxSyncCycleReport) => void;
}

/**
 * Capa 5: Servicio de Sincronización Transaccional Outbox (RF-07, RNF-07, PRD §8.2).
 * Gestiona el encolado offline en WatermelonDB, escucha eventos de reconexión vía NetInfo
 * y despacha lotes pendientes hacia el Backend Stub con control de idempotencia y backoff exponencial.
 */
export class OutboxSyncService implements IOutboxSyncService {
  private readonly baseUrl: string;
  private readonly databaseGetter: () => Database;
  private readonly netInfoDriver: INetInfoDriver;
  private readonly httpTransport: IHttpSyncTransport;
  private readonly requestTimeoutMs: number;
  private readonly baseBackoffDelayMs: number;
  private readonly verifyHealthEndpoint: boolean;
  private readonly onSyncCycleCompleted?: (report: OutboxSyncCycleReport) => void;

  private netInfoUnsubscribe: NetInfoSubscription | null = null;
  private isProcessing = false;

  constructor(options: OutboxSyncServiceOptions = {}) {
    this.baseUrl = (options.baseUrl ?? 'http://10.0.2.2:3000').replace(/\/$/, '');
    this.databaseGetter = () => options.database ?? getDatabase();
    this.netInfoDriver = options.netInfoDriver ?? NetInfo;
    this.httpTransport = options.httpTransport ?? defaultHttpSyncTransport;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 5000;
    this.baseBackoffDelayMs = options.baseBackoffDelayMs ?? DEFAULT_BASE_BACKOFF_MS;
    this.verifyHealthEndpoint = options.verifyHealthEndpoint ?? false;
    this.onSyncCycleCompleted = options.onSyncCycleCompleted;
  }

  /**
   * Encola un nuevo registro transaccional con estado `PENDING` en la tabla `outbox_queue`.
   */
  public async enqueue(params: EnqueueOutboxParams): Promise<string> {
    const db = this.databaseGetter();
    const maxAttempts = params.maxAttempts ?? DEFAULT_MAX_OUTBOX_ATTEMPTS;
    const serializedPayload = JSON.stringify(params.payload);

    let createdId = '';
    await db.write(async () => {
      const record = await db
        .get<OutboxQueueItem>(TableName.OUTBOX_QUEUE)
        .create((item) => {
          item.entityType = params.entityType;
          item.entityId = params.entityId;
          item.endpoint = params.endpoint;
          item.payload = serializedPayload;
          item.attempts = 0;
          item.maxAttempts = maxAttempts;
          item.nextRetryAt = null;
          item.lastError = null;
          item.status = 'PENDING';
        });
      createdId = record.id;
    });

    return createdId;
  }

  /**
   * Procesa los elementos `PENDING` de `outbox_queue` cuya ventana de backoff haya expirado,
   * enviándolos al Backend Stub si hay conectividad activa.
   */
  public async processPendingQueue(): Promise<OutboxSyncCycleReport> {
    if (this.isProcessing) {
      return {
        attemptedCount: 0,
        syncedCount: 0,
        failedCount: 0,
        skippedOffline: false,
      };
    }

    this.isProcessing = true;

    try {
      const netState = await this.netInfoDriver.fetch();
      const isOnline =
        netState.isConnected === true && netState.isInternetReachable !== false;

      if (!isOnline) {
        return {
          attemptedCount: 0,
          syncedCount: 0,
          failedCount: 0,
          skippedOffline: true,
        };
      }

      if (this.verifyHealthEndpoint) {
        const backendHealthy = await this.httpTransport.checkHealth(
          `${this.baseUrl}/api/v1/health`,
          this.requestTimeoutMs,
        );
        if (!backendHealthy) {
          return {
            attemptedCount: 0,
            syncedCount: 0,
            failedCount: 0,
            skippedOffline: true,
          };
        }
      }

      const db = this.databaseGetter();
      const pendingItems = await db
        .get<OutboxQueueItem>(TableName.OUTBOX_QUEUE)
        .query(Q.where('status', 'PENDING'))
        .fetch();

      const now = Date.now();
      const eligibleItems = pendingItems.filter((item) =>
        isEligibleForRetry(
          item.status,
          item.attempts,
          item.maxAttempts,
          item.nextRetryAt,
          now,
        ),
      );

      let syncedCount = 0;
      let failedCount = 0;

      for (const item of eligibleItems) {
        await item.markSyncing();
        const targetUrl = `${this.baseUrl}${item.endpoint}`;

        try {
          const response = await this.httpTransport.postJson(
            targetUrl,
            item.payload,
            this.requestTimeoutMs,
          );

          if (response.ok) {
            await item.markSynced();
            syncedCount++;
          } else {
            await item.registerFailure(
              `HTTP ${response.status}: ${response.errorText ?? 'Backend error'}`,
              this.baseBackoffDelayMs,
            );
            failedCount++;
          }
        } catch (err) {
          const errorMessage =
            err instanceof Error ? err.message : 'Network timeout or socket failure';
          await item.registerFailure(errorMessage, this.baseBackoffDelayMs);
          failedCount++;
        }
      }

      const report: OutboxSyncCycleReport = {
        attemptedCount: eligibleItems.length,
        syncedCount,
        failedCount,
        skippedOffline: false,
      };

      if (this.onSyncCycleCompleted) {
        this.onSyncCycleCompleted(report);
      }

      return report;
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Inicia la suscripción reactiva a `@react-native-community/netinfo` (PRD §8.2.1).
   * Dispara automáticamente `processPendingQueue()` apenas se restablece la conexión.
   */
  public startNetworkListener(): void {
    if (this.netInfoUnsubscribe !== null) {
      return;
    }

    this.netInfoUnsubscribe = this.netInfoDriver.addEventListener((state) => {
      if (state.isConnected === true && state.isInternetReachable !== false) {
        void this.processPendingQueue();
      }
    });
  }

  /**
   * Cancela la suscripción activa de eventos de red.
   */
  public stopNetworkListener(): void {
    if (this.netInfoUnsubscribe !== null) {
      this.netInfoUnsubscribe();
      this.netInfoUnsubscribe = null;
    }
  }
}
