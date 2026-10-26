/**
 * Capa 3: Evidence Layer
 * Responsabilidad: Captura de códigos QR/Barras (VisionCamera), fotografías en sandbox privado y coordenadas GPS.
 */
export interface GeoCoordinates {
  latitude: number;
  longitude: number;
  altitude: number | null;
  accuracy: number;
  timestamp: number;
}

export interface CapturedEvidence {
  serialNumber?: string;
  photoUri: string;
  coordinates: GeoCoordinates;
}
