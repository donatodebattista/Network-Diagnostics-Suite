/**
 * Capa 6: Reporting Layer
 * Responsabilidad: Compilación local de reportes PDF con métricas de red, evidencia fotográfica y geolocalización.
 */
export interface PdfReportRequest {
  installationId: string;
  deviceId: string;
}

export interface PdfReportResult {
  pdfPath: string;
  generatedAt: number;
}

export interface IReportingService {
  generateInstallationReport(request: PdfReportRequest): Promise<PdfReportResult>;
}

export * from './pdfTemplate';
export * from './reportingService';
