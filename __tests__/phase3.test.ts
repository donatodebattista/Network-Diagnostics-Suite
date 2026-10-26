jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: {
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'AccessibleWhenUnlockedThisDeviceOnly',
  },
  SECURITY_LEVEL: {
    SECURE_SOFTWARE: 'SECURE_SOFTWARE',
  },
  setGenericPassword: jest.fn(),
  getGenericPassword: jest.fn(),
  resetGenericPassword: jest.fn(),
}));

jest.mock('react-native-zeroconf', () => {
  return jest.fn().mockImplementation(() => ({
    scan: jest.fn(),
    stop: jest.fn(),
    on: jest.fn(),
    removeDeviceListeners: jest.fn(),
  }));
});

jest.mock('react-native-tcp-socket', () => ({
  __esModule: true,
  default: {
    createConnection: jest.fn(),
  },
}));

import {
  DiscoveredNode,
  DiscoveryService,
  IMdnsDriver,
  MdnsScanner,
  normalizeMacAddress,
  resolveVendorByMac,
} from '../src/layers/discovery';
import {
  ISshSessionHandle,
  ISshTransportBridge,
  resolveVendorProfile,
  SshClient,
  SshConnectionParams,
} from '../src/layers/protocol/ssh';
import {
  CredentialStore,
  IKeychainDriver,
} from '../src/shared/security/credentialStore';

class InMemoryKeychainDriver implements IKeychainDriver {
  private readonly vault = new Map<string, { username: string; password: string }>();

  public async setGenericPassword(
    username: string,
    password: string,
    options?: { service?: string },
  ): Promise<false | { service: string; storage: string }> {
    const key = options?.service ?? 'default';
    this.vault.set(key, { username, password });
    return { service: key, storage: 'AndroidKeystore' };
  }

  public async getGenericPassword(
    options?: { service?: string },
  ): Promise<false | { username: string; password: string; service: string; storage: string }> {
    const key = options?.service ?? 'default';
    const found = this.vault.get(key);
    if (!found) {
      return false;
    }
    return { ...found, service: key, storage: 'AndroidKeystore' };
  }

  public async resetGenericPassword(options?: { service?: string }): Promise<boolean> {
    const key = options?.service ?? 'default';
    return this.vault.delete(key);
  }
}

describe('Fase 3: Keystore Security, SSH Client & LAN Discovery', () => {
  test('CredentialStore isolates secrets in Keystore and exposes only redacted metadata (RNF-01, RNF-02)', async () => {
    const store = new CredentialStore(new InMemoryKeychainDriver());

    const metadata = await store.saveCredentials(
      {
        snmpCommunity: 'telecom_priv_ro',
        sshUsername: 'admin_campo',
        sshPassword: 'SuperSecretSshPassword!2026',
        sshPort: 2222,
      },
      '192.168.88.1',
    );

    expect(metadata.sshUsername).toBe('admin_campo');
    expect(metadata.hasSnmpCommunity).toBe(true);
    expect(metadata.hasSshPassword).toBe(true);
    expect(JSON.stringify(metadata)).not.toContain('SuperSecretSshPassword!2026');
    expect(JSON.stringify(metadata)).not.toContain('telecom_priv_ro');

    const retrieved = await store.getCredentials('192.168.88.1');
    expect(retrieved?.snmpCommunity).toBe('telecom_priv_ro');
    expect(retrieved?.sshPassword).toBe('SuperSecretSshPassword!2026');
    expect(retrieved?.sshPort).toBe(2222);
  });

  test('SshClient executes MikroTik batch commands, parses metrics, and closes session deterministically (RF-03, RNF-05)', async () => {
    const store = new CredentialStore(new InMemoryKeychainDriver());
    await store.saveCredentials({
      snmpCommunity: 'public',
      sshUsername: 'admin',
      sshPassword: 'mikrotik_secret_password',
      sshPort: 22,
    });

    let sessionDisconnected = false;

    const mockBridge: ISshTransportBridge = {
      connect: async (_params: SshConnectionParams): Promise<ISshSessionHandle> => ({
        execute: async (command: string): Promise<string> => {
          if (command === '/system resource print') {
            return 'uptime: 12d4h15m30s\nversion: 7.14.2 (stable)\nboard-name: CCR2004-1G-12S+2XS';
          }
          if (command === '/interface print') {
            return 'Flags: R - RUNNING\n 0 R ether1-wan\n 1 R sfp-sfpplus1-olt';
          }
          return 'OK';
        },
        disconnect: async (): Promise<void> => {
          sessionDisconnected = true;
        },
      }),
    };

    const sshClient = new SshClient({
      credentialStore: store,
      transportBridge: mockBridge,
      defaultTimeoutMs: 2000,
    });

    expect(resolveVendorProfile('MikroTik RouterOS')).toBe('MIKROTIK_ROUTEROS');

    const result = await sshClient.runVendorDiagnostic('192.168.88.1', 'MikroTik');

    expect(result.profile).toBe('MIKROTIK_ROUTEROS');
    expect(result.commandsExecuted).toEqual([
      '/system resource print',
      '/interface print',
    ]);
    expect(result.metrics.sysUpTimeFormatted).toBe('12d4h15m30s');
    expect(result.metrics.sysDescr).toBe('CCR2004-1G-12S+2XS (7.14.2 (stable))');
    expect(result.rawOutput).not.toContain('mikrotik_secret_password');
    expect(sessionDisconnected).toBe(true);
  });

  test('SshClient enforces deterministic timeout on hanging SSH host (RNF-05)', async () => {
    const store = new CredentialStore(new InMemoryKeychainDriver());
    await store.saveCredentials({
      snmpCommunity: 'public',
      sshUsername: 'root',
      sshPassword: 'ont_password',
      sshPort: 22,
    });

    const hangingBridge: ISshTransportBridge = {
      connect: () => new Promise<ISshSessionHandle>(() => {}),
    };

    const sshClient = new SshClient({
      credentialStore: store,
      transportBridge: hangingBridge,
      defaultTimeoutMs: 75,
    });

    await expect(
      sshClient.runVendorDiagnostic('192.168.100.1', 'Huawei ONT', 22, 75),
    ).rejects.toThrow(/timed out after 75ms/);
  });

  test('DiscoveryService merges mDNS and non-blocking subnet sweep with OUI vendor resolution (RF-01, RNF-04)', async () => {
    expect(normalizeMacAddress('dc-2c-6e-11-22-33')).toBe('DC:2C:6E:11:22:33');
    expect(resolveVendorByMac('DC:2C:6E:11:22:33')).toBe('MikroTik');
    expect(resolveVendorByMac('80:2A:A8:AA:BB:CC')).toBe('Ubiquiti Networks');

    const mockMdnsDriver: IMdnsDriver = {
      scan: () => {},
      stop: () => {},
      removeDeviceListeners: () => {},
      on: (event, listener) => {
        if (event === 'resolved') {
          setTimeout(() => {
            (listener as (svc: unknown) => void)({
              name: 'ubnt-ptp-norte',
              host: 'ubnt-ptp-norte.local.',
              addresses: ['192.168.1.20'],
              port: 22,
              txt: { mac: '80:2a:a8:00:11:22' },
            });
          }, 5);
        }
      },
    };

    const arpTable = new Map<string, string>([
      ['192.168.1.1', 'DC:2C:6E:44:55:66'],
      ['192.168.1.50', '48:FD:8E:99:88:77'],
    ]);

    const realtimeStream: DiscoveredNode[] = [];

    const discovery = new DiscoveryService({
      mdnsScanner: new MdnsScanner(() => mockMdnsDriver),
      mdnsDurationMs: 40,
      hostRange: { start: 1, end: 60 },
      concurrencyBatchSize: 20,
      arpTableReader: async () => arpTable,
      tcpProber: async (ip, port) => {
        if ((ip === '192.168.1.1' || ip === '192.168.1.50') && port === 22) {
          return { reachable: true, respondedInMs: 4 };
        }
        return { reachable: false, respondedInMs: 20 };
      },
    });

    const nodes = await discovery.scanLocalSubnet('192.168.1', 30, (node) => {
      realtimeStream.push(node);
    });

    expect(nodes).toHaveLength(3);
    expect(nodes[0]).toMatchObject({
      ipAddress: '192.168.1.1',
      macAddress: 'DC:2C:6E:44:55:66',
      vendor: 'MikroTik',
    });
    expect(nodes[1]).toMatchObject({
      ipAddress: '192.168.1.20',
      macAddress: '80:2A:A8:00:11:22',
      hostname: 'ubnt-ptp-norte.local.',
      vendor: 'Ubiquiti Networks',
    });
    expect(nodes[2]).toMatchObject({
      ipAddress: '192.168.1.50',
      macAddress: '48:FD:8E:99:88:77',
      vendor: 'Huawei Technologies',
    });
    expect(realtimeStream.length).toBeGreaterThanOrEqual(3);
  });
});
