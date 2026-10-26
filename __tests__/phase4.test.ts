jest.mock('@nozbe/watermelondb/adapters/sqlite', () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock('react-native-geolocation-service', () => ({
  __esModule: true,
  default: {
    getCurrentPosition: jest.fn(),
  },
}));

jest.mock('react-native-html-to-pdf', () => ({
  generatePDF: jest.fn(),
}));

import type { GeoOptions, GeoPosition } from 'react-native-geolocation-service';
import {
  DEFAULT_GPS_OPTIONS,
  ensurePrivateSandboxUri,
  EvidenceService,
  GpsService,
  ICameraPhotoHandle,
  IGeolocationDriver,
  parseEquipmentBarcode,
} from '../src/layers/evidence';
import {
  buildInstallationReportHtml,
  InstallationReportTemplateData,
  ReportingService,
} from '../src/layers/reporting';

describe('Fase 4: Evidence Layer (QR/Barcode, Sandbox Camera, GPS) & Reporting Layer (PDF)', () => {
  test('parseEquipmentBarcode decodes JSON QR, key-value telecom labels, and Code-128 serials (RF-04)', () => {
    const jsonQr = parseEquipmentBarcode(
      '{"serial":"hw-ont-998877","mac":"48:fd:8e:11:22:33","model":"EchoLife HG8245H"}',
      'qr',
    );
    expect(jsonQr.serialNumber).toBe('HW-ONT-998877');
    expect(jsonQr.macAddress).toBe('48:FD:8E:11:22:33');
    expect(jsonQr.vendor).toBe('Huawei Technologies');
    expect(jsonQr.model).toBe('EchoLife HG8245H');

    const kvBarcode = parseEquipmentBarcode(
      'SN:ZTEGC887766;MAC:00-19-C6-AA-BB-CC',
      'qr',
    );
    expect(kvBarcode.serialNumber).toBe('ZTEGC887766');
    expect(kvBarcode.macAddress).toBe('00:19:C6:AA:BB:CC');
    expect(kvBarcode.vendor).toBe('ZTE Corporation');

    const code128 = parseEquipmentBarcode('  rb4011-sn-009182  ', 'code-128');
    expect(code128.serialNumber).toBe('RB4011-SN-009182');
    expect(code128.format).toBe('code-128');
  });

  test('GpsService enforces high-accuracy satellite options (10000ms timeout, 5000ms maxAge) (PRD §9.2)', async () => {
    let capturedOptions: GeoOptions | undefined;

    const mockGeoDriver: IGeolocationDriver = {
      getCurrentPosition: (onSuccess, _onError, options) => {
        capturedOptions = options;
        const fakePosition: GeoPosition = {
          coords: {
            latitude: -32.484512,
            longitude: -58.232145,
            altitude: 24.5,
            accuracy: 3.8,
            heading: 0,
            speed: 0,
          },
          timestamp: 1730000000000,
        };
        onSuccess(fakePosition);
      },
    };

    const gpsService = new GpsService(mockGeoDriver);
    const coords = await gpsService.getCurrentCoordinates();

    expect(capturedOptions).toMatchObject({
      enableHighAccuracy: DEFAULT_GPS_OPTIONS.enableHighAccuracy,
      timeout: 10000,
      maximumAge: 5000,
    });
    expect(coords.latitude).toBeCloseTo(-32.484512, 6);
    expect(coords.longitude).toBeCloseTo(-58.232145, 6);
    expect(coords.altitude).toBe(24.5);
    expect(coords.accuracy).toBe(3.8);
  });

  test('ensurePrivateSandboxUri allows internal sandbox paths and blocks public gallery paths (RNF-03)', () => {
    const validInternal = ensurePrivateSandboxUri(
      '/data/user/0/com.networkdiagnosticsapp/cache/vision_photo_01.jpg',
    );
    expect(validInternal).toBe(
      'file:///data/user/0/com.networkdiagnosticsapp/cache/vision_photo_01.jpg',
    );

    expect(() =>
      ensurePrivateSandboxUri('/storage/emulated/0/DCIM/Camera/IMG_2026.jpg'),
    ).toThrow(/Security violation \(RNF-03\)/);
  });

  test('EvidenceService orchestrates photo capture, GPS coordinates, and barcode serial (RF-04, RF-05)', async () => {
    const mockGeoDriver: IGeolocationDriver = {
      getCurrentPosition: (onSuccess) => {
        onSuccess({
          coords: {
            latitude: -32.481,
            longitude: -58.239,
            altitude: 18,
            accuracy: 4.2,
            heading: null,
            speed: null,
          },
          timestamp: 1730000100000,
        });
      },
    };

    const mockCamera: ICameraPhotoHandle = {
      capturePhotoToFile: async () => ({
        filePath: '/data/user/0/com.networkdiagnosticsapp/files/evidencia_ont.jpg',
      }),
    };

    const evidenceService = new EvidenceService({
      gpsService: new GpsService(mockGeoDriver),
    });

    const evidence = await evidenceService.captureGeoreferencedEvidence(
      mockCamera,
      'SN:MK-CCR2004-7788',
    );

    expect(evidence.serialNumber).toBe('MK-CCR2004-7788');
    expect(evidence.photoUri).toBe(
      'file:///data/user/0/com.networkdiagnosticsapp/files/evidencia_ont.jpg',
    );
    expect(evidence.coordinates.latitude).toBeCloseTo(-32.481, 4);
  });

  test('ReportingService compiles PDF report containing all 6 PRD §9.3 sections (RF-06)', async () => {
    const sampleData: InstallationReportTemplateData = {
      reportId: 'RPT-INST001',
      generatedAt: 1730000500000,
      technicianName: 'Ing. Donato — Campo FCyT',
      device: {
        id: 'dev-uuid-01',
        ipAddress: '192.168.88.1',
        macAddress: 'DC:2C:6E:11:22:33',
        hostname: 'mkt-core-cdelu',
        vendor: 'MikroTik',
        serialNumber: 'MK-CCR2004-7788',
      },
      installation: {
        id: 'inst-uuid-001',
        technicianNotes: 'Enlace FO fusionado con atenuación -17.4 dBm <OK>.',
        latitude: -32.484512,
        longitude: -58.232145,
        photoUri: 'file:///data/user/0/com.networkdiagnosticsapp/files/evidencia_ont.jpg',
        createdAt: 1730000400000,
      },
      diagnostics: [
        {
          id: 'diag-01',
          protocol: 'SNMP',
          status: 'SUCCESS',
          executedAt: 1730000300000,
          metrics: {
            sysName: 'mkt-core-cdelu',
            sysUpTimeFormatted: '4d 12h 0m 0s',
            interfaces: [{ ifIndex: 1, ifInOctets: 450000, ifOutOctets: 210000 }],
          },
          rawOutput: '[SNMP v2c GetResponse | community=***REDACTED***]',
        },
      ],
    };

    const html = buildInstallationReportHtml(sampleData);
    expect(html).toContain('FCyT (UADER) — Sede Concepción del Uruguay');
    expect(html).toContain('MK-CCR2004-7788');
    expect(html).toContain('if#1: IN=450000B / OUT=210000B');
    expect(html).toContain('-32.484512°');
    expect(html).toContain('&lt;OK&gt;'); // Verifica sanitización HTML

    let capturedHtml = '';
    const reportingService = new ReportingService({
      pdfDriver: {
        convert: async (options) => {
          capturedHtml = options.html;
          return {
            filePath: `/data/user/0/com.networkdiagnosticsapp/files/Documents/${options.fileName}.pdf`,
            numberOfPages: 1,
          };
        },
      },
    });

    const pdfResult = await reportingService.compileReportFromData(sampleData);
    expect(capturedHtml).toContain('Network Diagnostics Suite — Informe Técnico de Instalación');
    expect(pdfResult.pdfPath).toContain('reporte_instalacion_inst-uuid-001.pdf');
  });
});
