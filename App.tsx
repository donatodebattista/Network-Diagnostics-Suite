import React from 'react';
import {
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import {
  CredentialsVaultScreen,
  DiagnosticsConsoleScreen,
  DiscoveryScreen,
  InstallationEvidenceScreen,
  OfflineHistoryScreen,
} from './src/screens';
import { StatusHeader } from './src/shared/components';
import {
  ToolkitProvider,
  ToolkitScreenTab,
  useToolkit,
} from './src/shared/context/ToolkitContext';

const NAV_ITEMS: ReadonlyArray<{ key: ToolkitScreenTab; label: string }> = [
  { key: 'DISCOVERY', label: 'Red LAN' },
  { key: 'DIAGNOSTICS', label: 'SNMP / SSH' },
  { key: 'INSTALLATION', label: 'Evidencia & PDF' },
  { key: 'HISTORY', label: 'Historial' },
  { key: 'CREDENTIALS', label: 'Keystore' },
];

const ToolkitShell: React.FC = () => {
  const { activeTab, setActiveTab } = useToolkit();

  const renderActiveScreen = (): React.ReactNode => {
    switch (activeTab) {
      case 'DISCOVERY':
        return <DiscoveryScreen />;
      case 'DIAGNOSTICS':
        return <DiagnosticsConsoleScreen />;
      case 'INSTALLATION':
        return <InstallationEvidenceScreen />;
      case 'HISTORY':
        return <OfflineHistoryScreen />;
      case 'CREDENTIALS':
        return <CredentialsVaultScreen />;
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" />
      <StatusHeader />
      <View style={styles.screenBody}>{renderActiveScreen()}</View>
      <View style={styles.bottomNav}>
        {NAV_ITEMS.map((tab) => {
          const isFocused = activeTab === tab.key;
          return (
            <TouchableOpacity
              key={tab.key}
              style={[styles.navItem, isFocused ? styles.navItemActive : null]}
              onPress={() => setActiveTab(tab.key)}>
              <Text
                style={[
                  styles.navLabel,
                  isFocused ? styles.navLabelActive : null,
                ]}>
                {tab.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </SafeAreaView>
  );
};

export default function App(): React.JSX.Element {
  return (
    <SafeAreaProvider>
      <ToolkitProvider>
        <ToolkitShell />
      </ToolkitProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  screenBody: {
    flex: 1,
    backgroundColor: '#020617',
  },
  bottomNav: {
    flexDirection: 'row',
    backgroundColor: '#0f172a',
    borderTopWidth: 1,
    borderTopColor: '#1e293b',
    paddingVertical: 6,
    paddingHorizontal: 6,
  },
  navItem: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 6,
  },
  navItemActive: {
    backgroundColor: '#1e293b',
  },
  navLabel: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '600',
  },
  navLabelActive: {
    color: '#38bdf8',
    fontWeight: '700',
  },
});
