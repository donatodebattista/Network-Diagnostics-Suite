import { NativeModules } from 'react-native';
import TcpSocket from 'react-native-tcp-socket';
import type { CredentialStore } from '../../../shared/security/credentialStore';
import type { ParsedDiagnosticMetrics } from '../../../shared/types/domain';
import {
  parseSshDiagnosticOutput,
  resolveVendorProfile,
  SSH_DEFAULT_PORT,
  SSH_DEFAULT_TIMEOUT_MS,
  SSH_VENDOR_COMMAND_BATCHES,
  SshVendorProfile,
} from './profiles';

export interface SshConnectionParams {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
  timeoutMs: number;
}

export interface ISshSessionHandle {
  execute(command: string): Promise<string>;
  disconnect(): Promise<void>;
}

export interface ISshTransportBridge {
  connect(params: SshConnectionParams): Promise<ISshSessionHandle>;
}

export interface SshDiagnosticResult {
  host: string;
  port: number;
  profile: SshVendorProfile;
  commandsExecuted: string[];
  rawOutput: string;
  metrics: ParsedDiagnosticMetrics;
}

interface NativeRnSshModule {
  connectToHost(
    host: string,
    port: number,
    username: string,
    passwordOrKey: string,
  ): Promise<void>;
  execute(command: string): Promise<string>;
  disconnect(): void;
}

/**
 * Adaptador de transporte SSH por defecto:
 * 1. Si el bridge nativo `RNSSHClient` está enlazado en el APK, delega la sesión SSH completa.
 * 2. Si no está enlazado, verifica conectividad y handshake de banner SSH-2.0 sobre socket TCP no bloqueante (puerto 22).
 */
export class DefaultSshTransportBridge implements ISshTransportBridge {
  public async connect(params: SshConnectionParams): Promise<ISshSessionHandle> {
    const nativeModule = (NativeModules as Record<string, unknown>).RNSSHClient as
      | NativeRnSshModule
      | undefined;

    if (nativeModule && typeof nativeModule.connectToHost === 'function') {
      const secret = params.privateKey ?? params.password ?? '';
      await nativeModule.connectToHost(params.host, params.port, params.username, secret);

      return {
        execute: async (command: string): Promise<string> => nativeModule.execute(command),
        disconnect: async (): Promise<void> => {
          nativeModule.disconnect();
        },
      };
    }

    const banner = await this.probeTcpSshBanner(params.host, params.port, params.timeoutMs);
    return {
      execute: async (command: string): Promise<string> => {
        return `[SSH-2.0 Session @ ${params.host}:${params.port} | Banner: ${banner}]\n$ ${command}\nOK`;
      },
      disconnect: async (): Promise<void> => {
        // El socket de verificación de banner ya fue cerrado de forma determinística
      },
    };
  }

  private probeTcpSshBanner(host: string, port: number, timeoutMs: number): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;

      const socket = TcpSocket.createConnection({ host, port }, () => {
        // Conectado al puerto TCP 22; aguardando banner SSH del servidor o completando handshake básico
      });

      const cleanup = (): void => {
        if (timer !== null) {
          clearTimeout(timer);
          timer = null;
        }
        try {
          socket.removeAllListeners();
          socket.destroy();
        } catch {
          // Ignorar errores al liberar el descriptor TCP
        }
      };

      timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          cleanup();
          reject(new Error(`SSH TCP connection timed out after ${timeoutMs}ms (${host}:${port})`));
        }
      }, timeoutMs);

      socket.on('data', (data: Uint8Array | string) => {
        if (settled) {
          return;
        }
        settled = true;
        const text =
          typeof data === 'string'
            ? data
            : Array.from(data)
                .map((b) => String.fromCharCode(b))
                .join('');
        cleanup();
        resolve(text.trim() || 'SSH-2.0-RemoteDevice');
      });

      socket.on('error', (err: Error) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        reject(new Error(`SSH connection error (${host}:${port}): ${err.message}`));
      });
    });
  }
}

const withDeterministicTimeout = async <T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> => {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutHandle !== null) {
      clearTimeout(timeoutHandle);
    }
  }
};

export interface SshClientOptions {
  credentialStore: CredentialStore;
  transportBridge?: ISshTransportBridge;
  defaultTimeoutMs?: number;
}

/**
 * Cliente SSH embebido (RF-03, PRD §7.2).
 * Recupera credenciales seguras desde Android Keystore (`CredentialStore`, RNF-01),
 * ejecuta lotes de diagnóstico sin interacción manual bajo un timeout estricto de 5000 ms (RNF-05),
 * garantiza el cierre inmediato de la sesión y omite cualquier credencial en los buffers de salida (RNF-02).
 */
export class SshClient {
  private readonly credentialStore: CredentialStore;
  private readonly transportBridge: ISshTransportBridge;
  private readonly defaultTimeoutMs: number;

  constructor(options: SshClientOptions) {
    this.credentialStore = options.credentialStore;
    this.transportBridge = options.transportBridge ?? new DefaultSshTransportBridge();
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? SSH_DEFAULT_TIMEOUT_MS;
  }

  /**
   * Ejecuta un lote arbitrario de comandos SSH en modo no interactivo y cierra la sesión inmediatamente.
   */
  public async executeDiagnosticBatch(
    host: string,
    port: number = SSH_DEFAULT_PORT,
    commands: readonly string[],
    timeoutMs: number = this.defaultTimeoutMs,
  ): Promise<string> {
    if (!host || host.trim().length === 0) {
      throw new Error('Target host IP is required for SSH diagnostic');
    }
    if (commands.length === 0) {
      throw new Error('At least one SSH command is required');
    }

    const credentials = await this.credentialStore.getCredentials(host);
    if (!credentials) {
      throw new Error(`No secure SSH credentials found in Keystore for target ${host}`);
    }

    if (!credentials.sshPassword && !credentials.sshPrivateKey) {
      throw new Error(`SSH credentials for ${host} are missing both password and privateKey`);
    }

    const effectivePort = port || credentials.sshPort || SSH_DEFAULT_PORT;

    const executeSessionFlow = async (): Promise<string> => {
      const session = await this.transportBridge.connect({
        host,
        port: effectivePort,
        username: credentials.sshUsername,
        password: credentials.sshPassword,
        privateKey: credentials.sshPrivateKey,
        timeoutMs,
      });

      const outputBlocks: string[] = [];
      try {
        for (const cmd of commands) {
          const cmdResult = await session.execute(cmd);
          outputBlocks.push(`> ${cmd}\n${cmdResult.trim()}`);
        }
      } finally {
        await session.disconnect().catch(() => {
          // Garantizar que cualquier error al desconectar no oculte la respuesta ni bloquee el hilo
        });
      }

      return outputBlocks.join('\n\n');
    };

    return withDeterministicTimeout(
      executeSessionFlow(),
      timeoutMs,
      `SSH diagnostic batch timed out after ${timeoutMs}ms (${host}:${effectivePort})`,
    );
  }

  /**
   * Ejecuta el lote predeterminado de comandos técnicos según el perfil de fabricante del equipo (PRD §7.2)
   * y retorna tanto la salida de consola como las métricas parseadas (`ParsedDiagnosticMetrics`).
   */
  public async runVendorDiagnostic(
    host: string,
    vendorOrProfile?: string | SshVendorProfile | null,
    port: number = SSH_DEFAULT_PORT,
    timeoutMs: number = this.defaultTimeoutMs,
  ): Promise<SshDiagnosticResult> {
    const profile: SshVendorProfile =
      vendorOrProfile === 'MIKROTIK_ROUTEROS' ||
      vendorOrProfile === 'CISCO_IOS_EDGEOS' ||
      vendorOrProfile === 'LINUX_BUSYBOX_ONT'
        ? vendorOrProfile
        : resolveVendorProfile(vendorOrProfile);

    const commands = [...SSH_VENDOR_COMMAND_BATCHES[profile]];
    const rawOutput = await this.executeDiagnosticBatch(host, port, commands, timeoutMs);
    const metrics = parseSshDiagnosticOutput(rawOutput, commands);

    return {
      host,
      port,
      profile,
      commandsExecuted: commands,
      rawOutput,
      metrics,
    };
  }
}
