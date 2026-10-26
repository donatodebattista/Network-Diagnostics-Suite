import Geolocation, {
  GeoError,
  GeoOptions,
  GeoPosition,
} from 'react-native-geolocation-service';
import type { GeoCoordinates } from './index';

/**
 * Parámetros estrictos de geolocalización satelital especificados en el PRD (§9.2):
 * - enableHighAccuracy: true
 * - timeout: 10000 ms
 * - maximumAge: 5000 ms
 */
export const DEFAULT_GPS_OPTIONS: Readonly<GeoOptions> = {
  enableHighAccuracy: true,
  timeout: 10000,
  maximumAge: 5000,
  forceRequestLocation: true,
  showLocationDialog: true,
};

export interface IGeolocationDriver {
  getCurrentPosition(
    successCallback: (position: GeoPosition) => void,
    errorCallback?: (error: GeoError) => void,
    options?: GeoOptions,
  ): void;
}

export class GpsService {
  private readonly driver: IGeolocationDriver;

  constructor(driver: IGeolocationDriver = Geolocation) {
    this.driver = driver;
  }

  /**
   * Obtiene las coordenadas satelitales actuales con alta precisión (RF-05, PRD §9.2).
   */
  public async getCurrentCoordinates(
    customOptions?: Partial<GeoOptions>,
  ): Promise<GeoCoordinates> {
    const mergedOptions: GeoOptions = {
      ...DEFAULT_GPS_OPTIONS,
      ...customOptions,
    };

    return new Promise<GeoCoordinates>((resolve, reject) => {
      this.driver.getCurrentPosition(
        (position: GeoPosition) => {
          const { latitude, longitude, altitude, accuracy } = position.coords;

          if (
            !Number.isFinite(latitude) ||
            !Number.isFinite(longitude) ||
            latitude < -90 ||
            latitude > 90 ||
            longitude < -180 ||
            longitude > 180
          ) {
            reject(new Error('Invalid GPS coordinates received from satellite provider'));
            return;
          }

          resolve({
            latitude,
            longitude,
            altitude: typeof altitude === 'number' && Number.isFinite(altitude) ? altitude : null,
            accuracy: typeof accuracy === 'number' && Number.isFinite(accuracy) ? accuracy : 0,
            timestamp: position.timestamp || Date.now(),
          });
        },
        (error: GeoError) => {
          reject(
            new Error(`GPS acquisition failed (code ${error.code}): ${error.message}`),
          );
        },
        mergedOptions,
      );
    });
  }
}
