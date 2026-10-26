// Gestión segura de credenciales en Android Keystore vía react-native-keychain (RNF-01)
export interface DeviceCredentials {
  snmpCommunity?: string;
  sshUsername?: string;
  sshPassword?: string;
  sshPrivateKey?: string;
}
