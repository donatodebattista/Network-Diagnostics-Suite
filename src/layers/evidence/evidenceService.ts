import {
  parseEquipmentBarcode,
  ParsedChassisBarcode,
  SupportedBarcodeFormat,
} from './barcodeParser';
import { GpsService } from './gpsService';
import type { CapturedEvidence, GeoCoordinates } from './index';
import { captureSandboxedPhoto, ICameraPhotoHandle } from './mediaCaptureService';

export interface EvidenceServiceOptions {
  gpsService?: GpsService;
}

/**
 * Capa 3: Servicio Orquestador de Evidencia en Campo (RF-04, RF-05, RNF-03).
 * Coordina la identificación por código QR/Barras, la captura fotográfica en el sandbox interno
 * y el posicionamiento satelital GPS de alta precisión.
 */
export class EvidenceService {
  private readonly gpsService: GpsService;

  constructor(options: EvidenceServiceOptions = {}) {
    this.gpsService = options.gpsService ?? new GpsService();
  }

  public decodeChassisBarcode(
    rawValue: string,
    format: SupportedBarcodeFormat = 'qr',
  ): ParsedChassisBarcode {
    return parseEquipmentBarcode(rawValue, format);
  }

  public async acquireGpsCoordinates(): Promise<GeoCoordinates> {
    return this.gpsService.getCurrentCoordinates();
  }

  public async captureGeoreferencedEvidence(
    camera: ICameraPhotoHandle,
    serialBarcodeValue?: string,
  ): Promise<CapturedEvidence> {
    const [photoResult, coordinates] = await Promise.all([
      captureSandboxedPhoto(camera),
      this.gpsService.getCurrentCoordinates(),
    ]);

    const parsedBarcode = serialBarcodeValue
      ? parseEquipmentBarcode(serialBarcodeValue)
      : undefined;

    return {
      serialNumber: parsedBarcode?.serialNumber,
      photoUri: photoResult.photoUri,
      coordinates,
    };
  }
}
