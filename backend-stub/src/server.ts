import cors from 'cors';
import express, { Request, Response } from 'express';
import type {
  SyncAckResponse,
  SyncDiagnosticRequest,
  SyncInstallationRequest,
} from './types';

const app = express();
const PORT = Number(process.env.PORT ?? 3000);

app.use(cors());
app.use(express.json({ limit: '25mb' }));

// Almacenamiento en memoria con control de idempotencia por transactionId (PRD §8.2)
const processedTransactions = new Set<string>();
const syncedDiagnostics: SyncDiagnosticRequest[] = [];
const syncedInstallations: SyncInstallationRequest[] = [];

app.get('/api/v1/health', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'OK',
    service: 'network-diagnostics-backend-stub',
    timestamp: new Date().toISOString(),
    stats: {
      diagnosticsCount: syncedDiagnostics.length,
      installationsCount: syncedInstallations.length,
      uniqueTransactions: processedTransactions.size,
    },
  });
});

app.post(
  '/api/v1/sync/diagnostics',
  (
    req: Request<Record<string, never>, SyncAckResponse | { error: string }, Partial<SyncDiagnosticRequest>>,
    res: Response<SyncAckResponse | { error: string }>,
  ) => {
    const body = req.body;

    if (
      typeof body.transactionId !== 'string' ||
      typeof body.diagnosticId !== 'string' ||
      typeof body.deviceId !== 'string' ||
      (body.protocol !== 'SNMP' && body.protocol !== 'SSH')
    ) {
      res.status(400).json({
        error: 'Payload de diagnóstico inválido: faltan campos obligatorios (transactionId, diagnosticId, deviceId, protocol).',
      });
      return;
    }

    const isDuplicate = processedTransactions.has(body.transactionId);
    if (!isDuplicate) {
      processedTransactions.add(body.transactionId);
      syncedDiagnostics.push(body as SyncDiagnosticRequest);
    }

    res.status(isDuplicate ? 200 : 201).json({
      acknowledged: true,
      transactionId: body.transactionId,
      entityId: body.diagnosticId,
      duplicate: isDuplicate,
      syncedAt: new Date().toISOString(),
    });
  },
);

app.post(
  '/api/v1/sync/installations',
  (
    req: Request<Record<string, never>, SyncAckResponse | { error: string }, Partial<SyncInstallationRequest>>,
    res: Response<SyncAckResponse | { error: string }>,
  ) => {
    const body = req.body;

    if (
      typeof body.transactionId !== 'string' ||
      typeof body.installationId !== 'string' ||
      typeof body.deviceId !== 'string' ||
      typeof body.latitude !== 'number' ||
      typeof body.longitude !== 'number'
    ) {
      res.status(400).json({
        error: 'Payload de instalación inválido: faltan campos obligatorios (transactionId, installationId, deviceId, latitude, longitude).',
      });
      return;
    }

    const isDuplicate = processedTransactions.has(body.transactionId);
    if (!isDuplicate) {
      processedTransactions.add(body.transactionId);
      syncedInstallations.push(body as SyncInstallationRequest);
    }

    res.status(isDuplicate ? 200 : 201).json({
      acknowledged: true,
      transactionId: body.transactionId,
      entityId: body.installationId,
      duplicate: isDuplicate,
      syncedAt: new Date().toISOString(),
    });
  },
);

if (require.main === module) {
  app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`[BackendStub] Servidor de sincronización activo en http://0.0.0.0:${PORT}`);
  });
}

export { app };
