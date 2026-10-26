import React, { useEffect, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useToolkit } from '../shared/context/ToolkitContext';
import type { StoredCredentialMetadata } from '../shared/security';

export const CredentialsVaultScreen: React.FC = () => {
  const { selectedDevice, services } = useToolkit();

  const [targetScope, setTargetScope] = useState<string>(
    selectedDevice?.ipAddress ?? 'global_default',
  );
  const [snmpCommunity, setSnmpCommunity] = useState<string>('public');
  const [sshUsername, setSshUsername] = useState<string>('admin');
  const [sshPassword, setSshPassword] = useState<string>('');
  const [sshPort, setSshPort] = useState<string>('22');
  const [storedMeta, setStoredMeta] =
    useState<StoredCredentialMetadata | null>(null);
  const [vaultFeedback, setVaultFeedback] = useState<string>(
    'Bóveda Android Keystore activa (RNF-01). Ninguna contraseña se almacena en SQLite ni se imprime en consola (RNF-02).',
  );

  useEffect(() => {
    void services.credentialStore
      .getCredentialMetadata(targetScope)
      .then((meta) => setStoredMeta(meta))
      .catch(() => setStoredMeta(null));
  }, [services.credentialStore, targetScope]);

  const handleSaveToKeystore = async (): Promise<void> => {
    try {
      const meta = await services.credentialStore.saveCredentials(
        {
          snmpCommunity: snmpCommunity.trim() || 'public',
          sshUsername: sshUsername.trim() || 'admin',
          sshPassword: sshPassword.length > 0 ? sshPassword : undefined,
          sshPort: Number(sshPort) || 22,
        },
        targetScope,
      );
      setStoredMeta(meta);
      setSshPassword('');
      setVaultFeedback(
        `Credenciales cifradas en Android Keystore para el ámbito "${meta.targetId}".`,
      );
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Fallo al guardar en Keystore';
      setVaultFeedback(`Error Keystore: ${msg}`);
    }
  };

  const handleClearKeystore = async (): Promise<void> => {
    await services.credentialStore.clearCredentials(targetScope);
    setStoredMeta(null);
    setVaultFeedback(
      `Credenciales eliminadas del Android Keystore para "${targetScope}".`,
    );
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>
          Bóveda Segura de Credenciales — Android Keystore (RNF-01 &amp; RNF-02)
        </Text>

        <Text style={styles.label}>
          Ámbito / Dispositivo Objetivo (IP o global_default):
        </Text>
        <TextInput
          style={styles.input}
          value={targetScope}
          onChangeText={setTargetScope}
          autoCapitalize="none"
          placeholder="global_default o IP del equipo"
          placeholderTextColor="#64748b"
        />

        <Text style={styles.label}>
          Community String SNMP v1/v2c (Cifrado en Keystore):
        </Text>
        <TextInput
          style={styles.input}
          value={snmpCommunity}
          onChangeText={setSnmpCommunity}
          secureTextEntry
          autoCapitalize="none"
          placeholder="public / private"
          placeholderTextColor="#64748b"
        />

        <Text style={styles.label}>Usuario SSH:</Text>
        <TextInput
          style={styles.input}
          value={sshUsername}
          onChangeText={setSshUsername}
          autoCapitalize="none"
          placeholder="admin / root"
          placeholderTextColor="#64748b"
        />

        <Text style={styles.label}>Contraseña SSH (No persistida en SQLite):</Text>
        <TextInput
          style={styles.input}
          value={sshPassword}
          onChangeText={setSshPassword}
          secureTextEntry
          autoCapitalize="none"
          placeholder="••••••••••••"
          placeholderTextColor="#64748b"
        />

        <Text style={styles.label}>Puerto TCP SSH:</Text>
        <TextInput
          style={styles.input}
          value={sshPort}
          onChangeText={setSshPort}
          keyboardType="numeric"
          placeholder="22"
          placeholderTextColor="#64748b"
        />

        <View style={styles.btnRow}>
          <TouchableOpacity
            style={styles.saveBtn}
            onPress={() => {
              void handleSaveToKeystore();
            }}>
            <Text style={styles.btnText}>Guardar en Android Keystore</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.clearBtn}
            onPress={() => {
              void handleClearKeystore();
            }}>
            <Text style={styles.btnText}>Revocar</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.feedbackText}>{vaultFeedback}</Text>
      </View>

      {storedMeta ? (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>
            Metadatos de Bóveda Verificados (Sin Secretos Expuestos)
          </Text>
          <Text style={styles.metaLine}>Ámbito: {storedMeta.targetId}</Text>
          <Text style={styles.metaLine}>
            Usuario SSH: {storedMeta.sshUsername} (Puerto {storedMeta.sshPort})
          </Text>
          <Text style={styles.metaLine}>
            Community SNMP Presente:{' '}
            {storedMeta.hasSnmpCommunity ? 'SÍ (PROTEGIDO)' : 'NO'}
          </Text>
          <Text style={styles.metaLine}>
            Secreto SSH Presente:{' '}
            {storedMeta.hasSshPassword || storedMeta.hasSshPrivateKey
              ? 'SÍ (PROTEGIDO)'
              : 'NO'}
          </Text>
        </View>
      ) : null}
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
    marginBottom: 8,
  },
  label: {
    color: '#94a3b8',
    fontSize: 11,
    marginBottom: 4,
  },
  input: {
    backgroundColor: '#1e293b',
    color: '#f8fafc',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 6,
    fontSize: 12,
    marginBottom: 10,
  },
  btnRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  saveBtn: {
    flex: 1,
    backgroundColor: '#0284c7',
    paddingVertical: 10,
    borderRadius: 6,
    alignItems: 'center',
  },
  clearBtn: {
    backgroundColor: '#b91c1c',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 6,
    alignItems: 'center',
  },
  btnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  feedbackText: {
    color: '#34d399',
    fontSize: 11,
    marginTop: 10,
  },
  metaLine: {
    color: '#cbd5e1',
    fontSize: 12,
    marginBottom: 4,
  },
});
