import * as Keychain from 'react-native-keychain';

export interface DeviceCredentials {
  snmpCommunity: string;
  sshUsername: string;
  sshPassword?: string;
  sshPrivateKey?: string;
  sshPort: number;
}

export interface StoredCredentialMetadata {
  targetId: string;
  hasSnmpCommunity: boolean;
  sshUsername: string;
  hasSshPassword: boolean;
  hasSshPrivateKey: boolean;
  sshPort: number;
}

const KEYCHAIN_SERVICE_PREFIX = 'com.networkdiagnosticsapp.vault';
const DEFAULT_GLOBAL_TARGET = 'global_default';

const buildServiceNamespace = (targetId: string): string => {
  const sanitized = targetId.trim().replace(/[^a-zA-Z0-9._-]/g, '_');
  return `${KEYCHAIN_SERVICE_PREFIX}.${sanitized || DEFAULT_GLOBAL_TARGET}`;
};

export interface IKeychainDriver {
  setGenericPassword(
    username: string,
    password: string,
    options?: Keychain.SetOptions,
  ): Promise<false | { service: string; storage: string }>;
  getGenericPassword(
    options?: Keychain.GetOptions,
  ): Promise<false | { username: string; password: string; service: string; storage: string }>;
  resetGenericPassword(options?: Keychain.BaseOptions): Promise<boolean>;
}

/**
 * Servicio de bóveda criptográfica para credenciales de red (RNF-01 & RNF-02).
 * Persiste community strings SNMP, contraseñas SSH y claves privadas exclusivamente
 * en el Android Keystore / iOS Keychain con nivel de seguridad hardware/software aislado.
 */
export class CredentialStore {
  private readonly driver: IKeychainDriver;

  constructor(driver: IKeychainDriver = Keychain) {
    this.driver = driver;
  }

  /**
   * Almacena de manera segura las credenciales asociadas a un dispositivo (IP/ID) o el perfil global por defecto.
   */
  public async saveCredentials(
    credentials: DeviceCredentials,
    targetId: string = DEFAULT_GLOBAL_TARGET,
  ): Promise<StoredCredentialMetadata> {
    if (!credentials.snmpCommunity.trim()) {
      throw new Error('SNMP community string is required');
    }
    if (!credentials.sshUsername.trim()) {
      throw new Error('SSH username is required');
    }

    const service = buildServiceNamespace(targetId);
    const serializedSecret = JSON.stringify({
      snmpCommunity: credentials.snmpCommunity,
      sshPassword: credentials.sshPassword,
      sshPrivateKey: credentials.sshPrivateKey,
      sshPort: credentials.sshPort || 22,
    });

    const result = await this.driver.setGenericPassword(
      credentials.sshUsername.trim(),
      serializedSecret,
      {
        service,
        accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        securityLevel: Keychain.SECURITY_LEVEL.SECURE_SOFTWARE,
      },
    );

    if (result === false) {
      throw new Error(`Failed to store credentials in secure keystore for target: ${targetId}`);
    }

    return {
      targetId,
      hasSnmpCommunity: true,
      sshUsername: credentials.sshUsername.trim(),
      hasSshPassword: Boolean(credentials.sshPassword),
      hasSshPrivateKey: Boolean(credentials.sshPrivateKey),
      sshPort: credentials.sshPort || 22,
    };
  }

  /**
   * Recupera las credenciales desencriptadas desde el Android Keystore para un equipo específico,
   * o recurre al perfil global si el equipo no tiene credenciales individuales.
   */
  public async getCredentials(
    targetId: string = DEFAULT_GLOBAL_TARGET,
  ): Promise<DeviceCredentials | null> {
    const service = buildServiceNamespace(targetId);
    const entry = await this.driver.getGenericPassword({ service });

    if (entry === false) {
      if (targetId !== DEFAULT_GLOBAL_TARGET) {
        return this.getCredentials(DEFAULT_GLOBAL_TARGET);
      }
      return null;
    }

    try {
      const parsed = JSON.parse(entry.password) as Partial<DeviceCredentials>;
      return {
        snmpCommunity:
          typeof parsed.snmpCommunity === 'string' && parsed.snmpCommunity.length > 0
            ? parsed.snmpCommunity
            : 'public',
        sshUsername: entry.username,
        sshPassword: typeof parsed.sshPassword === 'string' ? parsed.sshPassword : undefined,
        sshPrivateKey:
          typeof parsed.sshPrivateKey === 'string' ? parsed.sshPrivateKey : undefined,
        sshPort: typeof parsed.sshPort === 'number' ? parsed.sshPort : 22,
      };
    } catch {
      return null;
    }
  }

  /**
   * Retorna únicamente metadatos no sensibles (sin contraseñas ni community strings)
   * para poblar indicadores de estado en la UI cumpliendo RNF-02.
   */
  public async getCredentialMetadata(
    targetId: string = DEFAULT_GLOBAL_TARGET,
  ): Promise<StoredCredentialMetadata | null> {
    const creds = await this.getCredentials(targetId);
    if (!creds) {
      return null;
    }
    return {
      targetId,
      hasSnmpCommunity: creds.snmpCommunity.length > 0,
      sshUsername: creds.sshUsername,
      hasSshPassword: Boolean(creds.sshPassword),
      hasSshPrivateKey: Boolean(creds.sshPrivateKey),
      sshPort: creds.sshPort,
    };
  }

  /**
   * Elimina las credenciales asociadas al identificador indicado del Keystore nativo.
   */
  public async clearCredentials(targetId: string = DEFAULT_GLOBAL_TARGET): Promise<boolean> {
    const service = buildServiceNamespace(targetId);
    return this.driver.resetGenericPassword({ service });
  }
}
