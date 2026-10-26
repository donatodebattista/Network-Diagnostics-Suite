import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useToolkit } from '../context/ToolkitContext';

export const StatusHeader: React.FC = () => {
  const { isOnline, historySnapshot, selectedDevice, triggerManualSync } =
    useToolkit();
  const { outboxStats } = historySnapshot;

  return (
    <View style={styles.headerContainer}>
      <View style={styles.topRow}>
        <View>
          <Text style={styles.appTitle}>Network Diagnostics Suite</Text>
          <Text style={styles.subtitle}>
            FCyT — Field Telecom Toolkit (Offline-First)
          </Text>
        </View>
        <View
          style={[
            styles.connectivityBadge,
            isOnline ? styles.onlineBadge : styles.offlineBadge,
          ]}>
          <Text style={styles.connectivityText}>
            {isOnline ? 'ONLINE • SYNC ACTIVO' : 'OFFLINE • MODO CAMPO'}
          </Text>
        </View>
      </View>

      <View style={styles.outboxBar}>
        <View style={styles.statsGroup}>
          <Text style={styles.statLabel}>
            Outbox Pendientes:{' '}
            <Text style={styles.statValuePending}>{outboxStats.pending}</Text>
          </Text>
          <Text style={styles.statLabel}>
            Sincronizados:{' '}
            <Text style={styles.statValueSynced}>{outboxStats.synced}</Text>
          </Text>
          {outboxStats.failed > 0 ? (
            <Text style={styles.statLabel}>
              Fallidos:{' '}
              <Text style={styles.statValueFailed}>{outboxStats.failed}</Text>
            </Text>
          ) : null}
        </View>

        <TouchableOpacity
          style={styles.syncButton}
          onPress={() => {
            void triggerManualSync();
          }}>
          <Text style={styles.syncButtonText}>Sincronizar Outbox</Text>
        </TouchableOpacity>
      </View>

      {selectedDevice ? (
        <View style={styles.activeDeviceBar}>
          <Text style={styles.activeDeviceText}>
            Objetivo Activo: {selectedDevice.ipAddress} ({selectedDevice.macAddress})
            {selectedDevice.vendor ? ` • ${selectedDevice.vendor}` : ''}
            {selectedDevice.serialNumber
              ? ` • SN: ${selectedDevice.serialNumber}`
              : ''}
          </Text>
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  headerContainer: {
    backgroundColor: '#0f172a',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  appTitle: {
    color: '#f8fafc',
    fontSize: 17,
    fontWeight: '700',
  },
  subtitle: {
    color: '#94a3b8',
    fontSize: 11,
    marginTop: 2,
  },
  connectivityBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  onlineBadge: {
    backgroundColor: '#065f46',
  },
  offlineBadge: {
    backgroundColor: '#92400e',
  },
  connectivityText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '700',
  },
  outboxBar: {
    marginTop: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#1e293b',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  statsGroup: {
    flexDirection: 'row',
    gap: 12,
  },
  statLabel: {
    color: '#cbd5e1',
    fontSize: 11,
  },
  statValuePending: {
    color: '#fbbf24',
    fontWeight: '700',
  },
  statValueSynced: {
    color: '#34d399',
    fontWeight: '700',
  },
  statValueFailed: {
    color: '#f87171',
    fontWeight: '700',
  },
  syncButton: {
    backgroundColor: '#2563eb',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 4,
  },
  syncButtonText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '600',
  },
  activeDeviceBar: {
    marginTop: 8,
    backgroundColor: '#172554',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 4,
    borderLeftWidth: 3,
    borderLeftColor: '#38bdf8',
  },
  activeDeviceText: {
    color: '#e0f2fe',
    fontSize: 11,
    fontWeight: '600',
  },
});
