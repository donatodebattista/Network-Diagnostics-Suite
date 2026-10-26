import type { Database } from '@nozbe/watermelondb';
import { Q } from '@nozbe/watermelondb';
import { generatePDF, PDFOptions, PDFResult } from 'react-native-html-to-pdf';
import {
  Device,
  Diagnostic,
  getDatabase,
  Installation,
  TableName,
} from '../store';
import type { IReportingService, PdfReportRequest, PdfReportResult } from './index';
import {
  buildInstallationReportHtml,
  DiagnosticSummaryItem,
  InstallationReportTemplateData,
} from './pdfTemplate';

export interface IPdfGeneratorDriver {
  convert(options: PDFOptions): Promise<PDFResult>;
}

const defaultPdfGeneratorDriver: IPdfGeneratorDriver = {
  convert: (options: PDFOptions) => generatePDF(options),
};

export interface ReportingServiceOptions {
  database?: Database;
  pdfDriver?: IPdfGeneratorDriver;
}

/**
 * Capa 6: Servicio de Generación de Reportes PDF Locales (RF-06, PRD §9.3).
 * Consolida datos del equipo, métricas SNMP/SSH, coordenadas GPS y evidencia fotográfica
 * en un archivo PDF almacenado en el dispositivo e impacta la ruta resultante en WatermelonDB.
 */
export class ReportingService implements IReportingService {
  private readonly databaseGetter: () => Database;
  private readonly pdfDriver: IPdfGeneratorDriver;

  constructor(options: ReportingServiceOptions = {}) {
    this.databaseGetter = () => options.database ?? getDatabase();
    this.pdfDriver = options.pdfDriver ?? defaultPdfGeneratorDriver;
  }

  /**
   * Compila un documento PDF directamente a partir de la estructura consolidada de datos.
   */
  public async compileReportFromData(
    templateData: InstallationReportTemplateData,
  ): Promise<PdfReportResult> {
    const html = buildInstallationReportHtml(templateData);
    const sanitizedFileName = `reporte_instalacion_${templateData.installation.id.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

    const pdfResult = await this.pdfDriver.convert({
      html,
      fileName: sanitizedFileName,
      directory: 'Documents',
      shouldPrintBackgrounds: true,
    });

    if (!pdfResult.filePath) {
      throw new Error('PDF compiler completed without returning a local filePath');
    }

    return {
      pdfPath: pdfResult.filePath,
      generatedAt: templateData.generatedAt,
    };
  }

  /**
   * Recupera la instalación, el equipo y su historial de diagnósticos desde WatermelonDB,
   * genera el PDF local y actualiza `installation.pdfPath` transaccionalmente.
   */
  public async generateInstallationReport(
    request: PdfReportRequest,
  ): Promise<PdfReportResult> {
    const db = this.databaseGetter();

    const installation = await db
      .get<Installation>(TableName.INSTALLATIONS)
      .find(request.installationId);

    const device = await db
      .get<Device>(TableName.DEVICES)
      .find(request.deviceId);

    const diagnosticsRecords = await db
      .get<Diagnostic>(TableName.DIAGNOSTICS)
      .query(Q.where('device_id', device.id))
      .fetch();

    const diagnostics: DiagnosticSummaryItem[] = diagnosticsRecords.map((diag) => ({
      id: diag.id,
      protocol: diag.protocol,
      status: diag.status,
      executedAt: diag.executedAt.getTime(),
      metrics: diag.parsedMetrics,
      rawOutput: diag.rawOutput,
    }));

    const now = Date.now();
    const templateData: InstallationReportTemplateData = {
      reportId: `RPT-${installation.id.slice(0, 8).toUpperCase()}`,
      generatedAt: now,
      device: {
        id: device.id,
        ipAddress: device.ipAddress,
        macAddress: device.macAddress,
        hostname: device.hostname,
        vendor: device.vendor,
        serialNumber: device.serialNumber,
      },
      installation: {
        id: installation.id,
        technicianNotes: installation.technicianNotes,
        latitude: installation.latitude,
        longitude: installation.longitude,
        photoUri: installation.photoUri,
        createdAt: installation.createdAt.getTime(),
      },
      diagnostics,
    };

    const result = await this.compileReportFromData(templateData);

    await db.write(async () => {
      await installation.update((record) => {
        record.pdfPath = result.pdfPath;
      });
    });

    return result;
  }
}
