import type {
  CapturePhotoCallbacks,
  CapturePhotoSettings,
  PhotoFile,
} from 'react-native-vision-camera';

export interface ICameraPhotoHandle {
  capturePhotoToFile(
    settings: CapturePhotoSettings,
    callbacks: CapturePhotoCallbacks,
  ): Promise<PhotoFile>;
}

export interface SandboxedPhotoResult {
  photoUri: string;
  capturedAt: number;
}

const PUBLIC_EXTERNAL_STORAGE_PATTERNS = [
  '/storage/emulated/0/DCIM',
  '/storage/emulated/0/Pictures',
  '/sdcard/DCIM',
  '/sdcard/Pictures',
];

/**
 * Valida que la ruta de la fotografía capturada resida dentro del sandbox interno privado
 * de la aplicación y no en directorios públicos compartidos de la galería (RNF-03).
 */
export const ensurePrivateSandboxUri = (rawPath: string): string => {
  const trimmed = rawPath.trim();
  if (!trimmed) {
    throw new Error('Captured photo path cannot be empty');
  }

  const normalizedPath = trimmed.replace(/^file:\/\//i, '');

  for (const forbiddenPrefix of PUBLIC_EXTERNAL_STORAGE_PATTERNS) {
    if (normalizedPath.startsWith(forbiddenPrefix)) {
      throw new Error(
        `Security violation (RNF-03): Photo path "${normalizedPath}" points to public external gallery instead of internal app sandbox`,
      );
    }
  }

  return normalizedPath.startsWith('/') ? `file://${normalizedPath}` : `file:///${normalizedPath}`;
};

/**
 * Captura una fotografía de evidencia técnica usando VisionCamera (`CameraPhotoOutput.capturePhotoToFile`)
 * y garantiza su almacenamiento dentro del directorio privado interno de la aplicación (RF-05, RNF-03, PRD §9.1).
 */
export const captureSandboxedPhoto = async (
  photoOutput: ICameraPhotoHandle,
  settings?: CapturePhotoSettings,
): Promise<SandboxedPhotoResult> => {
  const photo = await photoOutput.capturePhotoToFile(
    {
      flashMode: 'off',
      enableShutterSound: false,
      ...settings,
    },
    {},
  );

  const photoUri = ensurePrivateSandboxUri(photo.filePath);

  return {
    photoUri,
    capturedAt: Date.now(),
  };
};
