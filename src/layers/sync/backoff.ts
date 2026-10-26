import type { OutboxStatus } from '../../shared/types/domain';

export const DEFAULT_MAX_OUTBOX_ATTEMPTS = 5;
export const DEFAULT_BASE_BACKOFF_MS = 2000;
export const MAX_BACKOFF_CAP_MS = 60000;

/**
 * Calcula el retardo de retroceso exponencial (Exponential Backoff, RNF-07)
 * para un intento fallido `attemptNumber` (1-indexado):
 * delay = min(maxDelayMs, baseDelayMs * 2^(attemptNumber - 1))
 */
export const calculateExponentialBackoffMs = (
  attemptNumber: number,
  baseDelayMs: number = DEFAULT_BASE_BACKOFF_MS,
  maxDelayMs: number = MAX_BACKOFF_CAP_MS,
): number => {
  const normalizedAttempt = Math.max(1, Math.floor(attemptNumber));
  const rawDelay = baseDelayMs * Math.pow(2, normalizedAttempt - 1);
  return Math.min(maxDelayMs, rawDelay);
};

/**
 * Determina si un registro de la cola Outbox se encuentra apto para ser procesado
 * en el ciclo actual de sincronización según su estado, contador de intentos y ventana de backoff.
 */
export const isEligibleForRetry = (
  status: OutboxStatus,
  attempts: number,
  maxAttempts: number,
  nextRetryAt: number | null,
  now: number = Date.now(),
): boolean => {
  if (status !== 'PENDING') {
    return false;
  }
  if (attempts >= maxAttempts) {
    return false;
  }
  if (nextRetryAt !== null && nextRetryAt > now) {
    return false;
  }
  return true;
};
