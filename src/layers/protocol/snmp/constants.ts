export const SNMP_DEFAULT_PORT = 161;
export const SNMP_DEFAULT_TIMEOUT_MS = 2000;

export enum SnmpVersion {
  V1 = 0x00,
  V2C = 0x01,
}

export enum BerTag {
  INTEGER = 0x02,
  OCTET_STRING = 0x04,
  NULL = 0x05,
  OID = 0x06,
  SEQUENCE = 0x30,
  IP_ADDRESS = 0x40,
  COUNTER32 = 0x41,
  GAUGE32 = 0x42,
  TIMETICKS = 0x43,
  OPAQUE = 0x44,
  COUNTER64 = 0x46,
  NO_SUCH_OBJECT = 0x80,
  NO_SUCH_INSTANCE = 0x81,
  END_OF_MIB_VIEW = 0x82,
  GET_REQUEST_PDU = 0xa0,
  GET_NEXT_REQUEST_PDU = 0xa1,
  GET_RESPONSE_PDU = 0xa2,
}

export enum SnmpErrorStatus {
  NO_ERROR = 0,
  TOO_BIG = 1,
  NO_SUCH_NAME = 2,
  BAD_VALUE = 3,
  READ_ONLY = 4,
  GEN_ERR = 5,
}

export const MIB2_OIDS = {
  SYS_DESCR: '1.3.6.1.2.1.1.1.0',
  SYS_UP_TIME: '1.3.6.1.2.1.1.3.0',
  SYS_NAME: '1.3.6.1.2.1.1.5.0',
  IF_IN_OCTETS_PREFIX: '1.3.6.1.2.1.2.2.1.10',
  IF_OUT_OCTETS_PREFIX: '1.3.6.1.2.1.2.2.1.16',
} as const;

export interface InterfaceMibOids {
  ifIndex: number;
  ifInOctetsOid: string;
  ifOutOctetsOid: string;
}

export const buildInterfaceOids = (ifIndex: number): InterfaceMibOids => {
  if (!Number.isInteger(ifIndex) || ifIndex < 1) {
    throw new Error(`Invalid SNMP interface index: ${ifIndex}`);
  }
  return {
    ifIndex,
    ifInOctetsOid: `${MIB2_OIDS.IF_IN_OCTETS_PREFIX}.${ifIndex}`,
    ifOutOctetsOid: `${MIB2_OIDS.IF_OUT_OCTETS_PREFIX}.${ifIndex}`,
  };
};
