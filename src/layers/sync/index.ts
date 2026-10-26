/**
 * Capa 5: Sync Layer (Outbox Pattern)
 * Responsabilidad: Encolado transaccional offline-first, escucha reactiva NetInfo y sincronización con backoff exponencial.
 */
import type {
  OutboxEntityType,
  OutboxPayload,
  OutboxSyncEndpoint,
} from '../../shared/types/domain';

export interface EnqueueOutboxParams {
  entityType: OutboxEntityType;
  entityId: string;
  endpoint: OutboxSyncEndpoint;
  payload: OutboxPayload;
  maxAttempts?: number;
}

export interface OutboxSyncCycleReport {
  attemptedCount: number;
  syncedCount: number;
  failedCount: number;
  skippedOffline: boolean;
}

export interface IOutboxSyncService {
  enqueue(params: EnqueueOutboxParams): Promise<string>;
  processPendingQueue(): Promise<OutboxSyncCycleReport>;
  startNetworkListener(): void;
  stopNetworkListener(): void;
}

export * from './backoff';
export * from './outboxSyncService';
