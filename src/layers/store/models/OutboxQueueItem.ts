import { Model } from '@nozbe/watermelondb';
import { date, field, readonly, text, writer } from '@nozbe/watermelondb/decorators';
import type {
  OutboxEntityType,
  OutboxPayload,
  OutboxStatus,
  OutboxSyncEndpoint,
} from '../../../shared/types/domain';
import { TableName } from '../schema';

export default class OutboxQueueItem extends Model {
  static table = TableName.OUTBOX_QUEUE;

  @field('entity_type') entityType!: OutboxEntityType;
  @field('entity_id') entityId!: string;
  @field('endpoint') endpoint!: OutboxSyncEndpoint;
  @text('payload') payload!: string;
  @field('attempts') attempts!: number;
  @field('max_attempts') maxAttempts!: number;
  @field('next_retry_at') nextRetryAt!: number | null;
  @text('last_error') lastError!: string | null;
  @field('status') status!: OutboxStatus;
  @readonly @date('created_at') createdAt!: Date;
  @readonly @date('updated_at') updatedAt!: Date;

  public getParsedPayload<T extends OutboxPayload = OutboxPayload>(): T {
    return JSON.parse(this.payload) as T;
  }

  @writer async markSyncing(): Promise<void> {
    await this.update((record) => {
      record.status = 'SYNCING';
    });
  }

  @writer async markSynced(): Promise<void> {
    await this.update((record) => {
      record.status = 'SYNCED';
      record.lastError = null;
      record.nextRetryAt = null;
    });
  }

  @writer async registerFailure(errorMessage: string, baseDelayMs = 2000): Promise<void> {
    const nextAttemptCount = this.attempts + 1;
    const isExhausted = nextAttemptCount >= this.maxAttempts;
    const backoffDelay = baseDelayMs * Math.pow(2, nextAttemptCount - 1);

    await this.update((record) => {
      record.attempts = nextAttemptCount;
      record.lastError = errorMessage;
      record.status = isExhausted ? 'FAILED' : 'PENDING';
      record.nextRetryAt = isExhausted ? null : Date.now() + backoffDelay;
    });
  }
}
