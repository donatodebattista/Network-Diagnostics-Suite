import React from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useToolkit } from '../shared/context/ToolkitContext';

export const OfflineHistoryScreen: React.FC = () => {
  const { historySnapshot, refreshHistorySnapshot, triggerManualSync } =
    useToolkit();
  const { devices, diagnostics, installations, outboxStats } = historySnapshot;

  return (
    <ScrollView style={styles.container}>
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <Text style={styles.sectionTitle}>
            Cola de Sincronización Outbox (RF-07 / RNF-07)
          </Text>
          <TouchableOpacity
            style={styles.refreshBtn}
            onPress={() => {
              void triggerManualSync();
            }}>
            <Text style={styles.refreshBtnText}>Procesar Cola Ahora</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.statsRow}>
          <View style={styles.statBox}>
            <Text style={styles.statNumber}>{outboxStats.pending}</Text>
            <Text style={styles.statCaption}>PENDING</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statNumber}>{outboxStats.syncing}</Text>
            <Text style={styles.statCaption}>SYNCING</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={[styles.statNumber, styles.syncedColor]}>
              {outboxStats.synced}
            </Text>
            <Text style={styles.statCaption}>SYNCED</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={[styles.statNumber, styles.failedColor]}>
              {outboxStats.failed}
            </Text>
            <Text style={styles.statCaption}>FAILED</Text>
          </View>
        </View>
      </View>

      <View style={styles.card}>
        <View style={styles.headerRow}>
          <Text style={styles.sectionTitle}>
            Equipos Cacheados en WatermelonDB ({devices.length})
          </Text>
          <TouchableOpacity
            onPress={() => {
              void refreshHistorySnapshot();
            }}>
            <Text style={styles.linkText}>Actualizar</Text>
          </TouchableOpacity>
        </View>
        {devices.length === 0 ? (
          <Text style={styles.emptyText}>
            Sin equipos registrados aún en la base SQLite local.
          </Text>
        ) : (
          devices.map((dev) => (
            <View key={dev.id} style={styles.itemRow}>
              <Text style={styles.itemTitle}>
                {dev.ipAddress} ({dev.macAddress})
              </Text>
              <Text style={styles.itemSub}>
                Fabricante: {dev.vendor ?? 'N/D'} • Host: {dev.hostname ?? 'N/D'}{' '}
                • SN: {dev.serialNumber ?? 'Sin escaneo QR'}
              </Text>
            </View>
          ))
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>
          Historial de Diagnósticos SNMP &amp; SSH ({diagnostics.length})
        </Text>
        {diagnostics.length === 0 ? (
          <Text style={styles.emptyText}>
            Sin diagnósticos ejecutados en el historial offline.
          </Text>
        ) : (
          diagnostics.map((diag) => (
            <View key={diag.id} style={styles.itemRow}>
              <Text style={styles.itemTitle}>
                [{diag.protocol}] Estado: {diag.status}
              </Text>
              <Text style={styles.itemSub}>
                Uptime: {diag.parsedMetrics.sysUpTimeFormatted ?? 'N/D'} • Sistema:{' '}
                {diag.parsedMetrics.sysName ?? diag.parsedMetrics.sysDescr ?? 'N/D'}
              </Text>
            </View>
          ))
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>
          Instalaciones Georreferenciadas y Reportes PDF ({installations.length})
        </Text>
        {installations.length === 0 ? (
          <Text style={styles.emptyText}>
            Sin intervenciones de instalación registradas.
          </Text>
        ) : (
          installations.map((inst) => (
            <View key={inst.id} style={styles.itemRow}>
              <Text style={styles.itemTitle}>
                GPS: {inst.latitude.toFixed(5)}°, {inst.longitude.toFixed(5)}°
              </Text>
              <Text style={styles.itemSub}>{inst.technicianNotes}</Text>
              {inst.pdfPath ? (
                <Text style={styles.pdfBadge}>PDF: {inst.pdfPath}</Text>
              ) : null}
            </View>
          ))
        )}
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
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  sectionTitle: {
    color: '#f8fafc',
    fontSize: 14,
    fontWeight: '700',
  },
  refreshBtn: {
    backgroundColor: '#2563eb',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 5,
  },
  refreshBtnText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '600',
  },
  linkText: {
    color: '#38bdf8',
    fontSize: 12,
    fontWeight: '600',
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  statBox: {
    flex: 1,
    backgroundColor: '#1e293b',
    paddingVertical: 10,
    borderRadius: 6,
    alignItems: 'center',
  },
  statNumber: {
    color: '#fbbf24',
    fontSize: 18,
    fontWeight: '700',
  },
  syncedColor: {
    color: '#34d399',
  },
  failedColor: {
    color: '#f87171',
  },
  statCaption: {
    color: '#94a3b8',
    fontSize: 10,
    marginTop: 2,
    fontWeight: '600',
  },
  emptyText: {
    color: '#64748b',
    fontSize: 12,
    marginTop: 4,
  },
  itemRow: {
    borderTopWidth: 1,
    borderTopColor: '#1e293b',
    paddingVertical: 8,
    marginTop: 4,
  },
  itemTitle: {
    color: '#e2e8f0',
    fontSize: 12,
    fontWeight: '700',
  },
  itemSub: {
    color: '#94a3b8',
    fontSize: 11,
    marginTop: 2,
  },
  pdfBadge: {
    color: '#34d399',
    fontSize: 10,
    fontFamily: 'monospace',
    marginTop: 4,
  },
});
