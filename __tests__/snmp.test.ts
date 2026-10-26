jest.mock('react-native-udp', () => ({
  __esModule: true,
  default: {
    createSocket: jest.fn(),
  },
}));

import {
  BerTag,
  buildInterfaceOids,
  decodeBerIntegerValue,
  decodeBerLength,
  decodeBerOidValue,
  decodeSnmpGetResponse,
  encodeBerInteger,
  encodeBerLength,
  encodeBerOctetString,
  encodeBerOid,
  encodeBerSequence,
  encodeBerTlv,
  encodeSnmpGetRequest,
  formatRedactedSnmpSummary,
  formatSnmpTimeTicks,
  ISnmpUdpSocket,
  MIB2_OIDS,
  readBerTlv,
  SnmpClient,
  SnmpErrorStatus,
  SnmpVersion,
} from '../src/layers/protocol/snmp';

class MockUdpSocket implements ISnmpUdpSocket {
  public closed = false;
  public lastSentPacket: Uint8Array | null = null;
  private errorListeners: Array<(err: Error) => void> = [];
  private messageListeners: Array<(msg: Uint8Array) => void> = [];
  private readonly onSendCallback?: (packet: Uint8Array, socket: MockUdpSocket) => void;

  constructor(onSendCallback?: (packet: Uint8Array, socket: MockUdpSocket) => void) {
    this.onSendCallback = onSendCallback;
  }

  public bind(_port?: number, callback?: () => void): void {
    if (callback) {
      callback();
    }
  }

  public send(
    msg: Uint8Array,
    _offset?: number,
    _length?: number,
    _port?: number,
    _address?: string,
    callback?: (error?: Error) => void,
  ): void {
    this.lastSentPacket = msg;
    if (callback) {
      callback();
    }
    if (this.onSendCallback) {
      this.onSendCallback(msg, this);
    }
  }

  public close(callback?: () => void): number {
    this.closed = true;
    if (callback) {
      callback();
    }
    return 0;
  }

  public on(event: 'error' | 'message', listener: ((err: Error) => void) | ((msg: Uint8Array) => void)): this {
    if (event === 'error') {
      this.errorListeners.push(listener as (err: Error) => void);
    } else if (event === 'message') {
      this.messageListeners.push(listener as (msg: Uint8Array) => void);
    }
    return this;
  }

  public emitMessage(datagram: Uint8Array): void {
    for (const listener of this.messageListeners) {
      listener(datagram);
    }
  }

  public removeAllListeners(): this {
    this.errorListeners = [];
    this.messageListeners = [];
    return this;
  }
}

const buildMockGetResponsePacket = (
  requestId: number,
  community: string,
  varBindNodes: readonly Uint8Array[],
  errorStatus: SnmpErrorStatus = SnmpErrorStatus.NO_ERROR,
): Uint8Array => {
  const varBindList = encodeBerSequence(varBindNodes, BerTag.SEQUENCE);
  const pdu = encodeBerSequence(
    [
      encodeBerInteger(requestId),
      encodeBerInteger(errorStatus),
      encodeBerInteger(0),
      varBindList,
    ],
    BerTag.GET_RESPONSE_PDU,
  );
  return encodeBerSequence(
    [encodeBerInteger(SnmpVersion.V2C), encodeBerOctetString(community), pdu],
    BerTag.SEQUENCE,
  );
};

const extractRequestIdFromGetRequest = (packet: Uint8Array): number => {
  const envelope = readBerTlv(packet, 0);
  const versionTlv = readBerTlv(envelope.value, 0);
  const communityTlv = readBerTlv(envelope.value, versionTlv.totalLength);
  const pduTlv = readBerTlv(
    envelope.value,
    versionTlv.totalLength + communityTlv.totalLength,
  );
  const reqIdTlv = readBerTlv(pduTlv.value, 0);
  return decodeBerIntegerValue(reqIdTlv.value);
};

describe('SNMP BER/ASN.1 Codec & Protocol Layer (Fase 2)', () => {
  test('encodes and decodes short and long BER lengths accurately', () => {
    const shortBytes = encodeBerLength(45);
    expect(Array.from(shortBytes)).toEqual([45]);
    expect(decodeBerLength(shortBytes, 0)).toEqual({ length: 45, bytesRead: 1 });

    const longBytes = encodeBerLength(300);
    expect(Array.from(longBytes)).toEqual([0x82, 0x01, 0x2c]);
    expect(decodeBerLength(longBytes, 0)).toEqual({ length: 300, bytesRead: 3 });
  });

  test('encodes and decodes signed BER integers including high-bit padding', () => {
    for (const candidate of [0, 1, 127, 128, 255, 32768, 123456789, -1, -128, -32769]) {
      const encoded = encodeBerInteger(candidate);
      const tlv = readBerTlv(encoded, 0);
      expect(tlv.tag).toBe(BerTag.INTEGER);
      expect(decodeBerIntegerValue(tlv.value)).toBe(candidate);
    }
  });

  test('encodes and decodes MIB-II OIDs and large enterprise sub-identifiers', () => {
    const testOids = [
      MIB2_OIDS.SYS_DESCR,
      MIB2_OIDS.SYS_UP_TIME,
      MIB2_OIDS.SYS_NAME,
      buildInterfaceOids(1).ifInOctetsOid,
      buildInterfaceOids(2).ifOutOctetsOid,
      '1.3.6.1.4.1.14988.1.1.1.1.0', // MikroTik Enterprise OID (multi-byte base-128)
    ];

    for (const oid of testOids) {
      const encoded = encodeBerOid(oid);
      const tlv = readBerTlv(encoded, 0);
      expect(tlv.tag).toBe(BerTag.OID);
      expect(decodeBerOidValue(tlv.value)).toBe(oid);
    }
  });

  test('builds valid SNMP GetRequest (0xA0) and decodes GetResponse (0xA2) without leaking community string (RNF-02)', () => {
    const secretCommunity = 'prv_telecom_rw_99!';
    const reqPacket = encodeSnmpGetRequest({
      version: SnmpVersion.V2C,
      community: secretCommunity,
      requestId: 424242,
      oids: [MIB2_OIDS.SYS_NAME, MIB2_OIDS.SYS_UP_TIME],
    });

    expect(reqPacket[0]).toBe(BerTag.SEQUENCE);

    const responsePacket = buildMockGetResponsePacket(424242, secretCommunity, [
      encodeBerSequence([
        encodeBerOid(MIB2_OIDS.SYS_NAME),
        encodeBerOctetString('OLT-NODO-NORTE-01'),
      ]),
      encodeBerSequence([
        encodeBerOid(MIB2_OIDS.SYS_UP_TIME),
        encodeBerTlv(BerTag.TIMETICKS, new Uint8Array([0x00, 0x83, 0xd6, 0x00])), // 8640000 ticks = 1d
      ]),
    ]);

    const decoded = decodeSnmpGetResponse(responsePacket);
    expect(decoded.requestId).toBe(424242);
    expect(decoded.errorStatus).toBe(SnmpErrorStatus.NO_ERROR);
    expect(decoded.varBinds).toHaveLength(2);
    expect(decoded.varBinds[0]?.value).toBe('OLT-NODO-NORTE-01');
    expect(decoded.varBinds[1]?.type).toBe('TIMETICKS');
    expect(decoded.varBinds[1]?.value).toBe(8640000);
    expect(formatSnmpTimeTicks(8640000)).toBe('1d 0h 0m 0s');

    const summary = formatRedactedSnmpSummary(decoded);
    expect(summary).toContain('community=***REDACTED***');
    expect(summary).not.toContain(secretCommunity);
    expect(JSON.stringify(decoded)).not.toContain(secretCommunity);
  });

  test('SnmpClient.runDeviceDiagnostic extracts MIB-II metrics and closes socket cleanly', async () => {
    let createdSocket: MockUdpSocket | null = null;

    const client = new SnmpClient({
      timeoutMs: 1000,
      interfaceIndices: [1],
      socketFactory: () => {
        createdSocket = new MockUdpSocket((sentPacket, sock) => {
          const reqId = extractRequestIdFromGetRequest(sentPacket);
          const { ifInOctetsOid, ifOutOctetsOid } = buildInterfaceOids(1);

          const responseDatagram = buildMockGetResponsePacket(reqId, 'public', [
            encodeBerSequence([
              encodeBerOid(MIB2_OIDS.SYS_DESCR),
              encodeBerOctetString('RouterOS RB4011iGS+'),
            ]),
            encodeBerSequence([
              encodeBerOid(MIB2_OIDS.SYS_UP_TIME),
              encodeBerTlv(BerTag.TIMETICKS, new Uint8Array([0x00, 0x05, 0x7e, 0x40])), // 360000 ticks = 1h
            ]),
            encodeBerSequence([
              encodeBerOid(MIB2_OIDS.SYS_NAME),
              encodeBerOctetString('GW-CONCEPCION-01'),
            ]),
            encodeBerSequence([
              encodeBerOid(ifInOctetsOid),
              encodeBerTlv(BerTag.COUNTER32, new Uint8Array([0x01, 0x00, 0x00, 0x00])), // 16777216 bytes
            ]),
            encodeBerSequence([
              encodeBerOid(ifOutOctetsOid),
              encodeBerTlv(BerTag.COUNTER32, new Uint8Array([0x00, 0x80, 0x00, 0x00])), // 8388608 bytes
            ]),
          ]);

          setTimeout(() => {
            sock.emitMessage(responseDatagram);
          }, 5);
        });
        return createdSocket;
      },
    });

    const result = await client.runDeviceDiagnostic('192.168.88.1', 'public');

    expect(result.metrics.sysDescr).toBe('RouterOS RB4011iGS+');
    expect(result.metrics.sysName).toBe('GW-CONCEPCION-01');
    expect(result.metrics.sysUpTimeTicks).toBe(360000);
    expect(result.metrics.sysUpTimeFormatted).toBe('0d 1h 0m 0s');
    expect(result.metrics.interfaces).toEqual([
      {
        ifIndex: 1,
        ifInOctets: 16777216,
        ifOutOctets: 8388608,
      },
    ]);
    expect(createdSocket).not.toBeNull();
    expect(createdSocket!.closed).toBe(true);
  });

  test('SnmpClient enforces deterministic timeout and releases socket on unresponsive target (RNF-05)', async () => {
    let createdSocket: MockUdpSocket | null = null;

    const client = new SnmpClient({
      timeoutMs: 80,
      socketFactory: () => {
        createdSocket = new MockUdpSocket();
        return createdSocket;
      },
    });

    await expect(
      client.executeGetRequest('192.168.88.254', 'public', [MIB2_OIDS.SYS_NAME], 80),
    ).rejects.toThrow(/timed out after 80ms/);

    expect(createdSocket).not.toBeNull();
    expect(createdSocket!.closed).toBe(true);
  });
});
