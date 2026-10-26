import {
  decodeBerIntegerValue,
  decodeBerOctetStringValue,
  decodeBerOidValue,
  decodeBerUnsignedValue,
  encodeBerInteger,
  encodeBerNull,
  encodeBerOctetString,
  encodeBerOid,
  encodeBerSequence,
  readBerTlv,
} from './berCodec';
import { BerTag, SnmpErrorStatus, SnmpVersion } from './constants';

export type SnmpValueType =
  | 'INTEGER'
  | 'OCTET_STRING'
  | 'NULL'
  | 'OID'
  | 'IP_ADDRESS'
  | 'COUNTER32'
  | 'GAUGE32'
  | 'TIMETICKS'
  | 'COUNTER64'
  | 'NO_SUCH_OBJECT'
  | 'NO_SUCH_INSTANCE'
  | 'END_OF_MIB_VIEW'
  | 'UNKNOWN';

export interface SnmpVarBind {
  oid: string;
  type: SnmpValueType;
  value: string | number | null;
  rawBytes: Uint8Array;
}

export interface SnmpGetRequestParams {
  version?: SnmpVersion;
  community: string;
  requestId: number;
  oids: readonly string[];
}

export interface SnmpGetResponseMessage {
  version: SnmpVersion;
  requestId: number;
  errorStatus: SnmpErrorStatus;
  errorIndex: number;
  varBinds: SnmpVarBind[];
}

/**
 * Formatea centésimas de segundo (TimeTicks SNMP) en formato humano legible: "Xd Xh Xm Xs".
 */
export const formatSnmpTimeTicks = (ticks: number): string => {
  if (!Number.isFinite(ticks) || ticks < 0) {
    return '0d 0h 0m 0s';
  }

  const totalSeconds = Math.floor(ticks / 100);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return `${days}d ${hours}h ${minutes}m ${seconds}s`;
};

/**
 * Construye una trama binaria SNMP GetRequest (PDU Type 0xA0) codificada en BER/ASN.1.
 */
export const encodeSnmpGetRequest = ({
  version = SnmpVersion.V2C,
  community,
  requestId,
  oids,
}: SnmpGetRequestParams): Uint8Array => {
  if (!community || community.trim().length === 0) {
    throw new Error('SNMP community string cannot be empty');
  }

  if (oids.length === 0) {
    throw new Error('At least one OID is required to build an SNMP GetRequest');
  }

  const varBindNodes = oids.map((oid) =>
    encodeBerSequence([encodeBerOid(oid), encodeBerNull()], BerTag.SEQUENCE),
  );

  const varBindList = encodeBerSequence(varBindNodes, BerTag.SEQUENCE);

  const pdu = encodeBerSequence(
    [
      encodeBerInteger(requestId),
      encodeBerInteger(SnmpErrorStatus.NO_ERROR),
      encodeBerInteger(0),
      varBindList,
    ],
    BerTag.GET_REQUEST_PDU,
  );

  return encodeBerSequence(
    [encodeBerInteger(version), encodeBerOctetString(community), pdu],
    BerTag.SEQUENCE,
  );
};

const parseVarBindValue = (
  tag: number,
  valueBytes: Uint8Array,
): { type: SnmpValueType; value: string | number | null } => {
  switch (tag) {
    case BerTag.INTEGER:
      return { type: 'INTEGER', value: decodeBerIntegerValue(valueBytes) };
    case BerTag.OCTET_STRING:
      return { type: 'OCTET_STRING', value: decodeBerOctetStringValue(valueBytes) };
    case BerTag.NULL:
      return { type: 'NULL', value: null };
    case BerTag.OID:
      return { type: 'OID', value: decodeBerOidValue(valueBytes) };
    case BerTag.IP_ADDRESS:
      return {
        type: 'IP_ADDRESS',
        value: Array.from(valueBytes).join('.'),
      };
    case BerTag.COUNTER32:
      return { type: 'COUNTER32', value: decodeBerUnsignedValue(valueBytes) };
    case BerTag.GAUGE32:
      return { type: 'GAUGE32', value: decodeBerUnsignedValue(valueBytes) };
    case BerTag.TIMETICKS:
      return { type: 'TIMETICKS', value: decodeBerUnsignedValue(valueBytes) };
    case BerTag.COUNTER64:
      return { type: 'COUNTER64', value: decodeBerUnsignedValue(valueBytes) };
    case BerTag.NO_SUCH_OBJECT:
      return { type: 'NO_SUCH_OBJECT', value: null };
    case BerTag.NO_SUCH_INSTANCE:
      return { type: 'NO_SUCH_INSTANCE', value: null };
    case BerTag.END_OF_MIB_VIEW:
      return { type: 'END_OF_MIB_VIEW', value: null };
    default:
      return {
        type: 'UNKNOWN',
        value: decodeBerOctetStringValue(valueBytes),
      };
  }
};

/**
 * Decodifica un datagrama binario SNMP GetResponse (PDU Type 0xA2) codificado en BER/ASN.1.
 * Nota de seguridad (RNF-02): El community string recibido en la trama se valida estructuralmente
 * pero se descarta del objeto retornado para impedir fugas accidentales en logs o base de datos.
 */
export const decodeSnmpGetResponse = (datagram: Uint8Array): SnmpGetResponseMessage => {
  const rootNode = readBerTlv(datagram, 0);
  if (rootNode.tag !== BerTag.SEQUENCE) {
    throw new Error(
      `Invalid SNMP message envelope: expected SEQUENCE (0x30), got 0x${rootNode.tag.toString(16)}`,
    );
  }

  let cursor = 0;
  const envelopeBuffer = rootNode.value;

  const versionNode = readBerTlv(envelopeBuffer, cursor);
  if (versionNode.tag !== BerTag.INTEGER) {
    throw new Error('Invalid SNMP version field: expected INTEGER (0x02)');
  }
  const version = decodeBerIntegerValue(versionNode.value) as SnmpVersion;
  cursor += versionNode.totalLength;

  const communityNode = readBerTlv(envelopeBuffer, cursor);
  if (communityNode.tag !== BerTag.OCTET_STRING) {
    throw new Error('Invalid SNMP community field: expected OCTET_STRING (0x04)');
  }
  // RNF-02: No retenemos ni exponemos el valor en texto plano del community string
  cursor += communityNode.totalLength;

  const pduNode = readBerTlv(envelopeBuffer, cursor);
  if (pduNode.tag !== BerTag.GET_RESPONSE_PDU) {
    throw new Error(
      `Unexpected SNMP PDU tag: expected GetResponse (0xa2), got 0x${pduNode.tag.toString(16)}`,
    );
  }

  let pduCursor = 0;
  const pduBuffer = pduNode.value;

  const requestIdNode = readBerTlv(pduBuffer, pduCursor);
  if (requestIdNode.tag !== BerTag.INTEGER) {
    throw new Error('Invalid SNMP requestId: expected INTEGER (0x02)');
  }
  const requestId = decodeBerIntegerValue(requestIdNode.value);
  pduCursor += requestIdNode.totalLength;

  const errorStatusNode = readBerTlv(pduBuffer, pduCursor);
  if (errorStatusNode.tag !== BerTag.INTEGER) {
    throw new Error('Invalid SNMP errorStatus: expected INTEGER (0x02)');
  }
  const errorStatus = decodeBerIntegerValue(errorStatusNode.value) as SnmpErrorStatus;
  pduCursor += errorStatusNode.totalLength;

  const errorIndexNode = readBerTlv(pduBuffer, pduCursor);
  if (errorIndexNode.tag !== BerTag.INTEGER) {
    throw new Error('Invalid SNMP errorIndex: expected INTEGER (0x02)');
  }
  const errorIndex = decodeBerIntegerValue(errorIndexNode.value);
  pduCursor += errorIndexNode.totalLength;

  const varBindListNode = readBerTlv(pduBuffer, pduCursor);
  if (varBindListNode.tag !== BerTag.SEQUENCE) {
    throw new Error('Invalid SNMP VarBindList: expected SEQUENCE (0x30)');
  }

  const varBinds: SnmpVarBind[] = [];
  let vbListCursor = 0;
  const vbListBuffer = varBindListNode.value;

  while (vbListCursor < vbListBuffer.length) {
    const varBindNode = readBerTlv(vbListBuffer, vbListCursor);
    if (varBindNode.tag !== BerTag.SEQUENCE) {
      throw new Error('Invalid SNMP VarBind item: expected SEQUENCE (0x30)');
    }

    const oidNode = readBerTlv(varBindNode.value, 0);
    if (oidNode.tag !== BerTag.OID) {
      throw new Error('Invalid SNMP VarBind OID: expected OID (0x06)');
    }
    const oid = decodeBerOidValue(oidNode.value);

    const valNode = readBerTlv(varBindNode.value, oidNode.totalLength);
    const { type, value } = parseVarBindValue(valNode.tag, valNode.value);

    varBinds.push({
      oid,
      type,
      value,
      rawBytes: new Uint8Array(valNode.value),
    });

    vbListCursor += varBindNode.totalLength;
  }

  return {
    version,
    requestId,
    errorStatus,
    errorIndex,
    varBinds,
  };
};

/**
 * Genera un resumen textual sanitizado de la respuesta SNMP sin incluir credenciales (RNF-02),
 * apto para persistirse en `diagnostics.raw_output` o mostrarse en la consola técnica.
 */
export const formatRedactedSnmpSummary = (response: SnmpGetResponseMessage): string => {
  const header = `[SNMP v${response.version === SnmpVersion.V2C ? '2c' : '1'} GetResponse | reqId=${response.requestId} | errStatus=${response.errorStatus} | community=***REDACTED***]`;
  const lines = response.varBinds.map(
    (vb) => `${vb.oid} = (${vb.type}) ${vb.value === null ? 'NULL' : String(vb.value)}`,
  );
  return [header, ...lines].join('\n');
};
