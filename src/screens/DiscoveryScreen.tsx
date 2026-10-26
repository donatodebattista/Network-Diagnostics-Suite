import React, { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  DiscoveredNode,
  normalizeMacAddress,
  resolveVendorByMac,
} from '../layers/discovery';
import { useToolkit } from '../shared/context/ToolkitContext';

export const DiscoveryScreen: React.FC = () => {
  const {
    services,
    selectedDevice,
    setSelectedDevice,
    setActiveTab,
    refreshHistorySnapshot,
  } = useToolkit();

  const [subnetPrefix, setSubnetPrefix] = useState<string>('192.168.88');
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [discoveredNodes, setDiscoveredNodes] = useState<DiscoveredNode[]>([]);
  const [statusMessage, setStatusMessage] = useState<string>(
    'Listo para emitir consultas mDNS y barrido de subred LAN.',
  );

  const [manualIp, setManualIp] = useState<string>('192.168.88.1');
  const [manualMac, setManualMac] = useState<string>('DC:2C:6E:11:22:33');
  const [manualHostname, setManualHostname] = useState<string>('mkt-router-campo');

  const handleStartScan = async (): Promise<void> => {
    if (isScanning) {
      services.discoveryService.stopScan();
      setIsScanning(false);
      setStatusMessage('Escaneo LAN detenido por el técnico.');
      return;
    }

    setIsScanning(true);
    setDiscoveredNodes([]);
    setStatusMessage(`Escaneando segmento ${subnetPrefix}.0/24 vía mDNS + sockets...`);

    try {
      const results = await services.discoveryService.scanLocalSubnet(
        subnetPrefix,
        300,
        (realtimeNode) => {
          setDiscoveredNodes((prev) => {
            const filtered = prev.filter(
              (item) => item.ipAddress !== realtimeNode.ipAddress,
            );
            return [...filtered, realtimeNode].sort((a, b) =>
              a.ipAddress.localeCompare(b.ipAddress, undefined, { numeric: true }),
            );
          });
        },
      );

      for (const node of results) {
        try {
          await services.repository.upsertDiscoveredDevice({
            ipAddress: node.ipAddress,
            macAddress: node.macAddress,
            hostname: node.hostname ?? null,
            vendor: node.vendor ?? null,
          });
        } catch {
          // Continuar si el adaptador nativo aún no está enlazado en vista previa
        }
      }

      await refreshHistorySnapshot();
      setStatusMessage(
        `Escaneo finalizado: ${results.length} nodo(s) detectado(s) en ${subnetPrefix}.0/24.`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error en escaneo de subred';
      setStatusMessage(`Error: ${msg}`);
    } finally {
      setIsScanning(false);
    }
  };

  const handleSelectNode = async (node: DiscoveredNode): Promise<void> => {
    let persistedId = `dev-${node.ipAddress.replace(/\./g, '-')}`;
    let serialNumber: string | null = null;

    try {
      const saved = await services.repository.upsertDiscoveredDevice({
        ipAddress: node.ipAddress,
        macAddress: node.macAddress,
        hostname: node.hostname ?? null,
        vendor: node.vendor ?? null,
      });
      persistedId = saved.id;
      serialNumber = saved.serialNumber;
      await refreshHistorySnapshot();
    } catch {
      // Fallback a ID determinístico en memoria
    }

    setSelectedDevice({
      id: persistedId,
      ipAddress: node.ipAddress,
      macAddress: node.macAddress,
      hostname: node.hostname ?? null,
      vendor: node.vendor ?? null,
      serialNumber,
    });
  };

  const handleAddManualNode = async (): Promise<void> => {
    const cleanIp = manualIp.trim();
    if (!cleanIp) {
      return;
    }
    const cleanMac = normalizeMacAddress(manualMac) ?? '02:00:C0:A8:58:01';
    const vendor = resolveVendorByMac(cleanMac) ?? 'Equipo LAN';
    const node: DiscoveredNode = {
      ipAddress: cleanIp,
      macAddress: cleanMac,
      hostname: manualHostname.trim() || undefined,
      vendor,
      respondedInMs: 2,
    };

    setDiscoveredNodes((prev) => {
      const withoutDup = prev.filter((item) => item.ipAddress !== node.ipAddress);
      return [node, ...withoutDup];
    });

    await handleSelectNode(node);
    setStatusMessage(`Nodo ${cleanIp} (${vendor}) registrado y seleccionado.`);
  };

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>
          Escaneo de Red Local LAN &amp; mDNS (RF-01)
        </Text>
        <View style={styles.inputRow}>
          <TextInput
            style={styles.subnetInput}
            value={subnetPrefix}
            onChangeText={setSubnetPrefix}
            placeholder="Prefijo /24 (ej. 192.168.88)"
            placeholderTextColor="#64748b"
            autoCapitalize="none"
          />
          <TouchableOpacity
            style={[
              styles.scanButton,
              isScanning ? styles.stopButton : styles.primaryButton,
            ]}
            onPress={() => {
              void handleStartScan();
            }}>
            {isScanning ? (
              <ActivityIndicator size="small" color="#ffffff" />
            ) : null}
            <Text style={styles.buttonText}>
              {isScanning ? 'Detener' : 'Escanear Red'}
            </Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.statusText}>{statusMessage}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>
          Registro Rápido / Sonda Directa de Equipo en Campo
        </Text>
        <View style={styles.manualGrid}>
          <TextInput
            style={styles.smallInput}
            value={manualIp}
            onChangeText={setManualIp}
            placeholder="IP (ej. 192.168.88.1)"
            placeholderTextColor="#64748b"
          />
          <TextInput
            style={styles.smallInput}
            value={manualMac}
            onChangeText={setManualMac}
            placeholder="MAC (ej. DC:2C:6E:11:22:33)"
            placeholderTextColor="#64748b"
          />
          <TextInput
            style={styles.smallInput}
            value={manualHostname}
            onChangeText={setManualHostname}
            placeholder="Hostname"
            placeholderTextColor="#64748b"
          />
        </View>
        <TouchableOpacity
          style={styles.secondaryButton}
          onPress={() => {
            void handleAddManualNode();
          }}>
          <Text style={styles.buttonText}>Vincular y Seleccionar Equipo</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.listHeader}>
        Nodos Detectados ({discoveredNodes.length})
      </Text>

      <FlatList
        data={discoveredNodes}
        keyExtractor={(item) => item.ipAddress}
        ListEmptyComponent={
          <Text style={styles.emptyText}>
            Pulsa &quot;Escanear Red&quot; o vincula un nodo para iniciar el diagnóstico.
          </Text>
        }
        renderItem={({ item }) => {
          const isSelected = selectedDevice?.ipAddress === item.ipAddress;
          return (
            <View
              style={[
                styles.nodeItem,
                isSelected ? styles.nodeItemSelected : null,
              ]}>
              <View style={styles.nodeInfo}>
                <Text style={styles.nodeIp}>
                  {item.ipAddress}{' '}
                  <Text style={styles.nodeLatency}>({item.respondedInMs} ms)</Text>
                </Text>
                <Text style={styles.nodeMeta}>
                  MAC: {item.macAddress} • {item.vendor ?? 'Fabricante Desconocido'}
                </Text>
                {item.hostname ? (
                  <Text style={styles.nodeHostname}>Host: {item.hostname}</Text>
                ) : null}
              </View>

              <View style={styles.nodeActions}>
                <TouchableOpacity
                  style={styles.actionChip}
                  onPress={() => {
                    void handleSelectNode(item).then(() => {
                      setActiveTab('DIAGNOSTICS');
                    });
                  }}>
                  <Text style={styles.actionChipText}>SNMP / SSH</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.actionChip, styles.installChip]}
                  onPress={() => {
                    void handleSelectNode(item).then(() => {
                      setActiveTab('INSTALLATION');
                    });
                  }}>
                  <Text style={styles.actionChipText}>Instalar</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        }}
      />
    </View>
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
    marginBottom: 8,
  },
  inputRow: {
    flexDirection: 'row',
    gap: 8,
  },
  subnetInput: {
    flex: 1,
    backgroundColor: '#1e293b',
    color: '#f8fafc',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 6,
    fontSize: 13,
  },
  scanButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 6,
  },
  primaryButton: {
    backgroundColor: '#0284c7',
  },
  stopButton: {
    backgroundColor: '#dc2626',
  },
  secondaryButton: {
    backgroundColor: '#334155',
    paddingVertical: 8,
    borderRadius: 6,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  statusText: {
    color: '#94a3b8',
    fontSize: 11,
    marginTop: 8,
  },
  manualGrid: {
    flexDirection: 'row',
    gap: 6,
  },
  smallInput: {
    flex: 1,
    backgroundColor: '#1e293b',
    color: '#f8fafc',
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 6,
    fontSize: 11,
  },
  listHeader: {
    color: '#cbd5e1',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 6,
  },
  emptyText: {
    color: '#64748b',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 24,
  },
  nodeItem: {
    backgroundColor: '#0f172a',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#1e293b',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  nodeItemSelected: {
    borderColor: '#38bdf8',
    backgroundColor: '#0c4a6e',
  },
  nodeInfo: {
    flex: 1,
  },
  nodeIp: {
    color: '#f8fafc',
    fontSize: 14,
    fontWeight: '700',
  },
  nodeLatency: {
    color: '#34d399',
    fontSize: 11,
    fontWeight: '400',
  },
  nodeMeta: {
    color: '#cbd5e1',
    fontSize: 11,
    marginTop: 2,
  },
  nodeHostname: {
    color: '#94a3b8',
    fontSize: 11,
    marginTop: 2,
  },
  nodeActions: {
    flexDirection: 'row',
    gap: 6,
  },
  actionChip: {
    backgroundColor: '#0284c7',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 5,
  },
  installChip: {
    backgroundColor: '#059669',
  },
  actionChipText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '700',
  },
});
