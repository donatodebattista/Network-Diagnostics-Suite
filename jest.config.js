module.exports = {
  preset: '@react-native/jest-preset',
  transformIgnorePatterns: [
    'node_modules/(?!(jest-)?react-native|@react-native(-community)?|react-native-udp|react-native-keychain|react-native-zeroconf|react-native-tcp-socket|@nozbe/watermelondb)/',
  ],
};
