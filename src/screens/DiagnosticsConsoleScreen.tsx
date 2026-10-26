import React, { useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  SSH_VENDOR_COMMAND_BATCHES,
  SshVendorProfile,
} from '../layers/protocol';
import { useToolkit } from '../shared/context/ToolkitContext';
import type { ParsedDiagnosticMetrics } from '../shared/types/domain';

const VENDOR_PROFILES: readonly SshVendorProfile[] = [
  'MIKROTIK_ROUTEROS',
  'CISCO_IOS_EDGEOS',
  'LINUX_BUSYBOX_ONT',
];

export const DiagnosticsConsoleScreen: React.FC = () => {
  const { selectedDevice, services, refreshHistorySnapshot } = useToolkit();

  const [selectedSshProfile, setSelectedSshProfile] =
    useState<SshVendorProfile>('MIKROTIK_ROUTEROS');
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [latestMetrics, setLatestMetrics] =
    useState<ParsedDiagnosticMetrics | null>(null);
  const [consoleLog, setConsoleLog] = useState<string>(
    'Consola lista. Las credenciales se recuperan desde Android Keystore sin exponerse en texto plano (RNF-01 / RNF-02).',
  );

  const appendLog = (entry: string): void => {
    const timestamp = new Date().toISOString().slice(11, 19);
    setConsoleLog((prev) => `[${timestamp}] ${entry}\n\n${prev}`);
  };

  const handleRunSnmp = async (): Promise<void> => {
    if (!selectedDevice) {
      appendLog('Selecciona primero un equipo objetivo en la pestaña Red LAN.');
      return;
    }

    setIsRunning(true);
    appendLog(
      `Enviando SNMP v2c GetRequest (0xA0) BER/ASN.1 a ${selectedDevice.ipAddress}:161 (timeout=2000ms)...`,
    );

    try {
      const storedCreds = await services.credentialStore.getCredentials(
        selectedDevice.ipAddress,
      );
      const community = storedCreds?.snmpCommunity ?? 'public';

      const result = await services.snmpClient.runDeviceDiagnostic(
        selectedDevice.ipAddress,
        community,
        2000,
      );

      setLatestMetrics(result.metrics);
      appendLog(result.rawOutput);

      await services.repository.recordDiagnosticWithOutbox({
        deviceId: selectedDevice.id,
        protocol: 'SNMP',
        rawOutput: result.rawOutput,
        parsedMetrics: result.metrics,
        status: 'SUCCESS',
      });
      await refreshHistorySnapshot();
      appendLog(
        'Diagnóstico SNMP persistido en WatermelonDB y encolado en Outbox (PENDING).',
      );
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Fallo UDP SNMP';
      appendLog(`[SNMP ERROR] ${errMsg}`);

      try {
        await services.repository.recordDiagnosticWithOutbox({
          deviceId: selectedDevice.id,
          protocol: 'SNMP',
          rawOutput: errMsg,
          parsedMetrics: { rawSummary: errMsg },
          status: 'FAILED',
        });
        await refreshHistorySnapshot();
      } catch {
        // Ignorar si el dispositivo aún no existe en SQLite
      }
    } finally {
      setIsRunning(false);
    }
  };

  const handleRunSsh = async (): Promise<void> => {
    if (!selectedDevice) {
      appendLog('Selecciona primero un equipo objetivo en la pestaña Red LAN.');
      return;
    }

    setIsRunning(true);
    const commands = SSH_VENDOR_COMMAND_BATCHES[selectedSshProfile];
    appendLog(
      `Iniciando sesión SSH hacia ${selectedDevice.ipAddress}:22 [Perfil: ${selectedSshProfile} | Comandos: ${commands.join(', ')}]...`,
    );

    try {
      const result = await services.sshClient.runVendorDiagnostic(
        selectedDevice.ipAddress,
        selectedSshProfile,
        22,
        5000,
      );

      setLatestMetrics(result.metrics);
      appendLog(result.rawOutput);

      await services.repository.recordDiagnosticWithOutbox({
        deviceId: selectedDevice.id,
        protocol: 'SSH',
        rawOutput: result.rawOutput,
        parsedMetrics: result.metrics,
        status: 'SUCCESS',
      });
      await refreshHistorySnapshot();
      appendLog(
        'Diagnóstico SSH persistido en WatermelonDB y encolado en Outbox (PENDING).',
      );
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Fallo en sesión SSH';
      appendLog(`[SSH ERROR] ${errMsg}`);

      try {
        await services.repository.recordDiagnosticWithOutbox({
          deviceId: selectedDevice.id,
          protocol: 'SSH',
          rawOutput: errMsg,
          parsedMetrics: { rawSummary: errMsg },
          status: 'FAILED',
        });
        await refreshHistorySnapshot();
      } catch {
        // Ignorar si el dispositivo aún no existe en SQLite
      }
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>
          Diagnóstico de Protocolos de Bajo Nivel (RF-02 &amp; RF-03)
        </Text>
        <Text style={styles.targetInfo}>
          {selectedDevice
            ? `Objetivo: ${selectedDevice.ipAddress} (${selectedDevice.macAddress}) — ${selectedDevice.vendor ?? 'Genérico'}`
            : 'Ningún equipo seleccionado. Ve a la pestaña Red LAN para elegir un nodo.'}
        </Text>

        <View style={styles.buttonRow}>
          <TouchableOpacity
            style={[styles.actionBtn, styles.snmpBtn]}
            disabled={isRunning}
            onPress={() => {
              void handleRunSnmp();
            }}>
            <Text style={styles.btnText}>
              Consultar SNMP v2c (UDP/161)
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionBtn, styles.sshBtn]}
            disabled={isRunning}
            onPress={() => {
              void handleRunSsh();
            }}>
            <Text style={styles.btnText}>Ejecutar Lote SSH (TCP/22)</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.subLabel}>Perfil de Comandos SSH por Fabricante:</Text>
        <View style={styles.profileRow}>
          {VENDOR_PROFILES.map((profile) => {
            const active = selectedSshProfile === profile;
            return (
              <TouchableOpacity
                key={profile}
                style={[styles.profileChip, active ? styles.profileChipActive : null]}
                onPress={() => setSelectedSshProfile(profile)}>
                <Text style={styles.profileChipText}>{profile}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {isRunning ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator size="small" color="#38bdf8" />
            <Text style={styles.loadingText}>
              Ejecutando transacción de red con timeout determinístico...
            </Text>
          </View>
        ) : null}
      </View>

      {latestMetrics ? (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>
            Métricas MIB-II / Sistema Decodificadas
          </Text>
          <Text style={styles.metricLine}>
            sysName: <Text style={styles.metricVal}>{latestMetrics.sysName ?? 'N/D'}</Text>
          </Text>
          <Text style={styles.metricLine}>
            sysDescr:{' '}
            <Text style={styles.metricVal}>{latestMetrics.sysDescr ?? 'N/D'}</Text>
          </Text>
          <Text style={styles.metricLine}>
            sysUpTime:{' '}
            <Text style={styles.metricVal}>
              {latestMetrics.sysUpTimeFormatted ?? 'N/D'}
            </Text>
          </Text>
          {latestMetrics.interfaces && latestMetrics.interfaces.length > 0 ? (
            <View style={styles.ifaceBox}>
              {latestMetrics.interfaces.map((iface) => (
                <Text key={iface.ifIndex} style={styles.metricLine}>
                  Interfaz #{iface.ifIndex}: IN={iface.ifInOctets} octets | OUT=
                  {iface.ifOutOctets} octets
                </Text>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}

      <View style={styles.consoleBox}>
        <Text style={styles.consoleHeader}>
          CONSOLA DE SALIDA SANITIZADA (RNF-02)
        </Text>
        <Text style={styles.consoleText}>{consoleLog}</Text>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 14,
    backgroundColor: '#020617',
  },
  card: {
    backgroundColor: '#0f172a',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  sectionTitle: {
    color: '#f8fafc',
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 6,
  },
  targetInfo: {
    color: '#38bdf8',
    fontSize: 12,
    marginBottom: 10,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  actionBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 6,
    alignItems: 'center',
  },
  snmpBtn: {
    backgroundColor: '#0284c7',
  },
  sshBtn: {
    backgroundColor: '#4f46e5',
  },
  btnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  subLabel: {
    color: '#94a3b8',
    fontSize: 11,
    marginBottom: 6,
  },
  profileRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  profileChip: {
    backgroundColor: '#1e293b',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 4,
  },
  profileChipActive: {
    backgroundColor: '#0369a1',
  },
  profileChipText: {
    color: '#e2e8f0',
    fontSize: 10,
    fontWeight: '600',
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
  },
  loadingText: {
    color: '#38bdf8',
    fontSize: 11,
  },
  metricLine: {
    color: '#cbd5e1',
    fontSize: 12,
    marginBottom: 3,
  },
  metricVal: {
    color: '#34d399',
    fontWeight: '700',
  },
  ifaceBox: {
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: '#1e293b',
  },
  consoleBox: {
    backgroundColor: '#090d16',
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: '#1e293b',
    marginBottom: 24,
  },
  consoleHeader: {
    color: '#64748b',
    fontSize: 10,
    fontWeight: '700',
    marginBottom: 8,
  },
  consoleText: {
    color: '#10b981',
    fontFamily: 'monospace',
    fontSize: 11,
    lineHeight: 16,
  },
});
