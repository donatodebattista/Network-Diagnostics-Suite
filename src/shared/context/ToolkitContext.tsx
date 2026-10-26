import NetInfo from '@react-native-community/netinfo';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { DiscoveryService } from '../../layers/discovery';
import { EvidenceService } from '../../layers/evidence';
import { SnmpClient, SshClient } from '../../layers/protocol';
import { ReportingService } from '../../layers/reporting';
import {
  FieldOperationsRepository,
  OfflineHistorySnapshot,
} from '../../layers/store';
import { OutboxSyncService } from '../../layers/sync';
import { CredentialStore } from '../security';

export type ToolkitScreenTab =
  | 'DISCOVERY'
  | 'DIAGNOSTICS'
  | 'INSTALLATION'
  | 'HISTORY'
  | 'CREDENTIALS';

export interface ActiveDeviceSelection {
  id: string;
  ipAddress: string;
  macAddress: string;
  hostname?: string | null;
  vendor?: string | null;
  serialNumber?: string | null;
}

export interface ToolkitContextValue {
  activeTab: ToolkitScreenTab;
  setActiveTab: (tab: ToolkitScreenTab) => void;
  selectedDevice: ActiveDeviceSelection | null;
  setSelectedDevice: (device: ActiveDeviceSelection | null) => void;
  isOnline: boolean;
  historySnapshot: OfflineHistorySnapshot;
  refreshHistorySnapshot: () => Promise<void>;
  triggerManualSync: () => Promise<void>;
  services: {
    credentialStore: CredentialStore;
    discoveryService: DiscoveryService;
    snmpClient: SnmpClient;
    sshClient: SshClient;
    evidenceService: EvidenceService;
    reportingService: ReportingService;
    repository: FieldOperationsRepository;
    outboxSyncService: OutboxSyncService;
  };
}

const emptySnapshot: OfflineHistorySnapshot = {
  devices: [],
  diagnostics: [],
  installations: [],
  outboxStats: {
    pending: 0,
    syncing: 0,
    failed: 0,
    synced: 0,
  },
};

const ToolkitContext = createContext<ToolkitContextValue | null>(null);

export interface ToolkitProviderProps {
  children: React.ReactNode;
}

export const ToolkitProvider: React.FC<ToolkitProviderProps> = ({ children }) => {
  const [activeTab, setActiveTab] = useState<ToolkitScreenTab>('DISCOVERY');
  const [selectedDevice, setSelectedDevice] = useState<ActiveDeviceSelection | null>(null);
  const [isOnline, setIsOnline] = useState<boolean>(false);
  const [historySnapshot, setHistorySnapshot] =
    useState<OfflineHistorySnapshot>(emptySnapshot);

  const services = useMemo(() => {
    const credentialStore = new CredentialStore();
    const discoveryService = new DiscoveryService();
    const snmpClient = new SnmpClient();
    const sshClient = new SshClient({ credentialStore });
    const evidenceService = new EvidenceService();
    const reportingService = new ReportingService();
    const repository = new FieldOperationsRepository();
    const outboxSyncService = new OutboxSyncService({
      onSyncCycleCompleted: () => {
        void repository
          .getOfflineHistorySnapshot()
          .then((snap) => setHistorySnapshot(snap))
          .catch(() => {});
      },
    });

    return {
      credentialStore,
      discoveryService,
      snmpClient,
      sshClient,
      evidenceService,
      reportingService,
      repository,
      outboxSyncService,
    };
  }, []);

  const refreshHistorySnapshot = useCallback(async (): Promise<void> => {
    try {
      const snap = await services.repository.getOfflineHistorySnapshot();
      setHistorySnapshot(snap);
    } catch {
      // En entornos sin base nativa inicializada (e.g. test renderer básico), conservar snapshot vacío
    }
  }, [services.repository]);

  const triggerManualSync = useCallback(async (): Promise<void> => {
    await services.outboxSyncService.processPendingQueue();
    await refreshHistorySnapshot();
  }, [services.outboxSyncService, refreshHistorySnapshot]);

  useEffect(() => {
    void refreshHistorySnapshot();
    services.outboxSyncService.startNetworkListener();

    const unsubscribeNetInfo = NetInfo.addEventListener((state) => {
      const reachable =
        state.isConnected === true && state.isInternetReachable !== false;
      setIsOnline(reachable);
    });

    return () => {
      services.outboxSyncService.stopNetworkListener();
      unsubscribeNetInfo();
    };
  }, [refreshHistorySnapshot, services.outboxSyncService]);

  const contextValue = useMemo<ToolkitContextValue>(
    () => ({
      activeTab,
      setActiveTab,
      selectedDevice,
      setSelectedDevice,
      isOnline,
      historySnapshot,
      refreshHistorySnapshot,
      triggerManualSync,
      services,
    }),
    [
      activeTab,
      selectedDevice,
      isOnline,
      historySnapshot,
      refreshHistorySnapshot,
      triggerManualSync,
      services,
    ],
  );

  return (
    <ToolkitContext.Provider value={contextValue}>
      {children}
    </ToolkitContext.Provider>
  );
};

export const useToolkit = (): ToolkitContextValue => {
  const ctx = useContext(ToolkitContext);
  if (!ctx) {
    throw new Error('useToolkit must be used within a ToolkitProvider');
  }
  return ctx;
};
