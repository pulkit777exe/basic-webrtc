/**
 * Minimal TURN/UDP server for the browser rig.
 *
 * What it is: just enough of RFC 5766 for Chromium to gather relay candidates,
 * bind channels, and push media through them — Allocate (with
 * long-term-credential 401), Refresh, CreatePermission, ChannelBind, Send/Data
 * indications, and ChannelData relay in both directions.
 *
 * What it is not: a TURN server. No TCP/TLS transport, no IPv6, no bandwidth or
 * quota enforcement, no nonce expiry (one nonce per process), static credentials
 * from argv. It exists so `specs/turn.spec.ts` can prove the relay path carries
 * media, which the loopback-host-candidate rig cannot show. Do not deploy it,
 * do not point production at it.
 *
 * Run standalone:  bun run frontend/e2e/turn-server.ts [port] [--user=u --pass=p --realm=r --host=h]
 * Prints `TURN ready <host>:<port>` once listening (`0` picks an ephemeral
 * port, which is how the spec avoids collisions).
 *
 * Networking: binds 0.0.0.0 by default and advertises the machine's LAN IPv4
 * address in XOR-RELAYED-ADDRESS — not loopback. Browsers on the same host
 * reliably reach the LAN address, while loopback-targeted UDP from a
 * Chromium sandbox is dropped on some setups (observed: zero datagrams
 * arriving at a 127.0.0.1-bound server while the LAN-bound one gets the full
 * handshake). Pass `--host=127.0.0.1` for strictly loopback-only operation.
 *
 * Dependency-free on purpose (node:dgram + node:crypto + node:os only): this
 * has to boot inside CI with nothing installed, next to `signaling-server.ts`.
 */
import { createSocket, type RemoteInfo, type Socket } from 'node:dgram';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { networkInterfaces } from 'node:os';

export interface TurnServerOptions {
  port?: number;
  username?: string;
  password?: string;
  realm?: string;
  /**
   * Address to bind (main + relay sockets) and to advertise in
   * XOR-RELAYED-ADDRESS. Defaults to 0.0.0.0 with the discovered LAN IPv4
   * advertised; pass 127.0.0.1 for strictly loopback-only operation.
   */
  host?: string;
}

const MAGIC = 0x2112a442;
const SOFTWARE = 'e2e-turn';
const DEFAULT_LIFETIME = 600;
const PERMISSION_LIFETIME_MS = 300_000;

/**
 * Pick the IPv4 address to advertise in XOR-RELAYED-ADDRESS: the first
 * non-internal address that is not a point-to-point or container-bridge
 * interface, else any non-internal IPv4, else loopback. Pure over its input
 * so the preference order is checkable without touching the machine.
 */
export function pickAdvertiseAddress(
  interfaces: Record<
    string,
    Array<{ address: string; family: string | number; internal: boolean; cidr?: string | null }> | undefined
  >,
): string {
  const isV4 = (f: string | number) => f === 'IPv4' || f === 4;
  const skippedIface = /^(docker|br-|veth|tun|tap|wg|proton|tailscale|utun|awdl|anpi|bridge)/;
  const prefixOf = (cidr: string | null | undefined): number | null => {
    if (!cidr) return null;
    const slash = cidr.indexOf('/');
    if (slash < 0) return null;
    const n = Number(cidr.slice(slash + 1));
    return Number.isInteger(n) && n >= 0 && n <= 32 ? n : null;
  };
  const candidates: Array<{ address: string; preferred: boolean }> = [];
  for (const [name, addrs] of Object.entries(interfaces)) {
    for (const a of addrs ?? []) {
      if (!isV4(a.family) || a.internal) continue;
      const octets = a.address.split('.').map(Number);
      if (octets.length !== 4 || octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) continue;
      const prefix = prefixOf(a.cidr);
      candidates.push({
        address: a.address,
        preferred: !skippedIface.test(name) && prefix !== 32,
      });
    }
  }
  return candidates.find((c) => c.preferred)?.address ?? candidates[0]?.address ?? '127.0.0.1';
}

// STUN/TURN message types this server speaks. Success and error types are
// derived from the request method per RFC 5389 §6 (class bits C0/C1 set on
// the method bits), NOT a single constant: Allocate success is 0x0103 but
// Allocate *error* is 0x0113, Refresh error 0x0114, CreatePermission error
// 0x0118, ChannelBind error 0x0119. Only Binding error is 0x0111.
//
// Getting this wrong is silent and total: strict clients (Chromium) match a
// response by transaction ID *and* expected type, so a 0x0111 answering an
// Allocate request is dropped without a log line and the client retransmits
// the anonymous Allocate forever. Lenient clients (aioice) match by ID only,
// which is why a wrong constant can pass every self-written probe while real
// browsers never get past allocation.
const ALLOCATE = 0x0003;
const BINDING = 0x0001;
const BINDING_OK = 0x0101;
const ALLOCATE_OK = 0x0103;
const REFRESH = 0x0004;
const REFRESH_OK = 0x0104;
const CREATE_PERMISSION = 0x0008;
const CREATE_PERMISSION_OK = 0x0108;
const CHANNEL_BIND = 0x0009;
const CHANNEL_BIND_OK = 0x0109;
const SEND_INDICATION = 0x0016;
const DATA_INDICATION = 0x0017;

/** Failure-class type for a request method: method bits with C0+C1 set. */
function errorTypeFor(requestType: number): number {
  return requestType | 0x110;
}

// Attribute types.
const ATTR_USERNAME = 0x0006;
const ATTR_MESSAGE_INTEGRITY = 0x0008;
const ATTR_ERROR_CODE = 0x0009;
const ATTR_CHANNEL_NUMBER = 0x000c;
const ATTR_LIFETIME = 0x000d;
const ATTR_XOR_PEER_ADDRESS = 0x0012;
const ATTR_DATA = 0x0013;
const ATTR_REALM = 0x0014;
const ATTR_NONCE = 0x0015;
const ATTR_XOR_RELAYED_ADDRESS = 0x0016;
const ATTR_REQUESTED_TRANSPORT = 0x0019;
const ATTR_XOR_MAPPED_ADDRESS = 0x0020;
const ATTR_SOFTWARE = 0x8022;
const ATTR_FINGERPRINT = 0x8028;

interface StunAttr {
  type: number;
  value: Buffer;
}

interface ParsedStun {
  msgType: number;
  transId: Buffer;
  attrs: StunAttr[];
}

/** Parse a STUN message. Null when the framing is wrong — never throws. */
export function parseStunMessage(buf: Buffer): ParsedStun | null {
  if (buf.length < 20) return null;
  const msgType = buf.readUInt16BE(0);
  const length = buf.readUInt16BE(2);
  if (buf.readUInt32BE(4) !== MAGIC) return null;
  if (buf.length < 20 + length) return null;
  const transId = buf.subarray(8, 20);
  const attrs: StunAttr[] = [];
  let off = 20;
  const end = 20 + length;
  while (off + 4 <= end) {
    const type = buf.readUInt16BE(off);
    const attrLen = buf.readUInt16BE(off + 2);
    if (off + 4 + attrLen > end) return null;
    attrs.push({ type, value: Buffer.from(buf.subarray(off + 4, off + 4 + attrLen)) });
    off += 4 + ((attrLen + 3) & ~3);
  }
  return { msgType, transId, attrs };
}

function attrBuf(type: number, value: Buffer): Buffer {
  const head = Buffer.alloc(4);
  head.writeUInt16BE(type, 0);
  head.writeUInt16BE(value.length, 2);
  const pad = (4 - (value.length % 4)) % 4;
  return pad === 0 ? Buffer.concat([head, value]) : Buffer.concat([head, value, Buffer.alloc(pad)]);
}

const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[((c ^ buf[i]!) >>> 0) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Serialise a STUN message. The header length is final before the HMAC runs,
 * and the HMAC input ends at the attribute *preceding* MESSAGE-INTEGRITY —
 * the integrity attribute's own 4-byte header is NOT hashed (RFC 5389
 * §14.5). Including it is the old draft-ietf-behave convention several
 * tutorials still show; it self-verifies (builder and verifier sharing the
 * mistake agree with each other) while every real client — Chromium, aioice,
 * coturn — rejects it. This exact compensating error cost a debugging cycle:
 * the in-repo probe passed while two independent stacks 401-looped.
 */
export function buildStunMessage(
  msgType: number,
  transId: Buffer,
  attrBufs: Buffer[],
  integrityKey?: Buffer,
): Buffer {
  const attrsLen = attrBufs.reduce((n, b) => n + b.length, 0);
  let bodyLen = attrsLen;
  if (integrityKey) bodyLen += 24;
  bodyLen += 8; // fingerprint, always present
  const header = Buffer.alloc(20);
  header.writeUInt16BE(msgType, 0);
  header.writeUInt16BE(bodyLen, 2);
  header.writeUInt32BE(MAGIC, 4);
  transId.copy(header, 8);
  let out = Buffer.concat([header, ...attrBufs]);
  if (integrityKey) {
    const hmacHeader = Buffer.from(header);
    hmacHeader.writeUInt16BE(attrsLen + 24, 2);
    const mac = createHmac('sha1', integrityKey)
      .update(Buffer.concat([hmacHeader, ...attrBufs]))
      .digest();
    const miHead = Buffer.alloc(4);
    miHead.writeUInt16BE(ATTR_MESSAGE_INTEGRITY, 0);
    miHead.writeUInt16BE(20, 2);
    out = Buffer.concat([out, miHead, mac]);
  }
  const fp = Buffer.alloc(4);
  fp.writeUInt32BE((crc32(out) ^ 0x5354554e) >>> 0, 0);
  return Buffer.concat([out, attrBuf(ATTR_FINGERPRINT, fp)]);
}

/**
 * Verify MESSAGE-INTEGRITY against the raw datagram. The header length field
 * is rewritten to end at the integrity attribute before hashing — verifying
 * against the received length (which includes a trailing fingerprint) fails
 * even for a correct sender. And the integrity header itself is not part of
 * the input (see `buildStunMessage`).
 */
export function verifyMessageIntegrity(raw: Buffer, key: Buffer): boolean {
  let off = 20;
  const end = 20 + raw.readUInt16BE(2);
  while (off + 4 <= end) {
    const type = raw.readUInt16BE(off);
    const attrLen = raw.readUInt16BE(off + 2);
    if (type === ATTR_MESSAGE_INTEGRITY) {
      if (attrLen !== 20 || off + 24 > end) return false;
      const stored = raw.subarray(off + 4, off + 24);
      const head = Buffer.from(raw.subarray(0, 20));
      head.writeUInt16BE(off - 20 + 24, 2);
      const mac = createHmac('sha1', key)
        .update(Buffer.concat([head, raw.subarray(20, off)]))
        .digest();
      return mac.equals(stored);
    }
    off += 4 + ((attrLen + 3) & ~3);
  }
  return false;
}

function textAttr(type: number, text: string): Buffer {
  return attrBuf(type, Buffer.from(text, 'utf8'));
}

function errorAttr(cls: number, num: number, reason: string): Buffer {
  return attrBuf(
    ATTR_ERROR_CODE,
    Buffer.concat([Buffer.from([0, 0, cls, num]), Buffer.from(reason, 'utf8')]),
  );
}

/** IPv4 only — relayed addresses are always dotted quads, so anything else is a bug. */
export function parseXorAddress(value: Buffer): { address: string; port: number } | null {
  if (value.length < 8 || value[1] !== 0x01) return null;
  const port = value.readUInt16BE(2) ^ 0x2112;
  const address = [value[4]! ^ 0x21, value[5]! ^ 0x12, value[6]! ^ 0xa4, value[7]! ^ 0x42].join(
    '.',
  );
  return { address, port };
}

export function xorAddressAttr(type: number, address: string, port: number): Buffer {
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    throw new Error(`not an IPv4 address: ${address}`);
  }
  const xoredPort = port ^ 0x2112;
  return attrBuf(
    type,
    Buffer.from([
      0,
      0x01,
      (xoredPort >> 8) & 0xff,
      xoredPort & 0xff,
      octets[0]! ^ 0x21,
      octets[1]! ^ 0x12,
      octets[2]! ^ 0xa4,
      octets[3]! ^ 0x42,
    ]),
  );
}

interface Allocation {
  clientAddress: string;
  clientPort: number;
  relay: Socket;
  relayPort: number;
  permissions: Map<string, number>;
  channels: Map<number, string>;
  peerChannel: Map<string, number>;
}

export async function startServer(options: TurnServerOptions = {}): Promise<{
  host: string;
  port: number;
  close: () => Promise<void>;
}> {
  const username = options.username ?? 'e2e';
  const password = options.password ?? 'e2e-pass';
  const realm = options.realm ?? 'e2e';
  // MD5 is not an oversight: RFC 5389 §15.4 defines the long-term credential
  // key as MD5(username ":" realm ":" password), and that key is exactly what
  // Chromium and every other TURN client use to compute MESSAGE-INTEGRITY
  // (HMAC-SHA1, see buildStunMessage). Substituting a stronger hash here would
  // break interoperability with real clients rather than harden anything — the
  // password never travels anywhere, it only labels a test rig (see header).
  const integrityKey = createHash('md5').update(`${username}:${realm}:${password}`).digest();
  const nonce = randomBytes(8).toString('hex');
  // Bind all interfaces but advertise one reachable address: browsers on this
  // host reliably reach the LAN address (see header), so that is what relay
  // candidates carry. An explicit --host pins both bind and advertisement.
  const bindHost = options.host ?? '0.0.0.0';
  const advertiseHost = options.host ?? pickAdvertiseAddress(networkInterfaces());

  const allocations = new Map<string, Allocation>();
  const sock = createSocket('udp4');
  const clientKey = (r: RemoteInfo) => `${r.address}:${r.port}`;
  const peerKey = (address: string, port: number) => `${address}:${port}`;

  const softwareAttr = () => textAttr(ATTR_SOFTWARE, SOFTWARE);

  function send(to: RemoteInfo, buf: Buffer): void {
    sock.send(buf, to.port, to.address);
  }

  function errorResponse(
    to: RemoteInfo,
    parsed: ParsedStun,
    cls: number,
    num: number,
    reason: string,
    authenticated: boolean,
  ): void {
    const attrs = [
      errorAttr(cls, num, reason),
      textAttr(ATTR_REALM, realm),
      textAttr(ATTR_NONCE, nonce),
      softwareAttr(),
    ];
    send(
      to,
      buildStunMessage(
        errorTypeFor(parsed.msgType),
        parsed.transId,
        attrs,
        authenticated ? integrityKey : undefined,
      ),
    );
  }

  function unauthorized(to: RemoteInfo, parsed: ParsedStun): void {
    const attrs = [
      errorAttr(4, 1, 'Unauthorized'),
      textAttr(ATTR_REALM, realm),
      textAttr(ATTR_NONCE, nonce),
      softwareAttr(),
    ];
    send(to, buildStunMessage(errorTypeFor(parsed.msgType), parsed.transId, attrs, undefined));
  }

  function findAttr(parsed: ParsedStun, type: number): Buffer | null {
    const attr = parsed.attrs.find((a) => a.type === type);
    return attr ? attr.value : null;
  }

  /** Long-term-credential gate shared by every request type. */
  function authenticated(raw: Buffer, parsed: ParsedStun): boolean {
    const user = findAttr(parsed, ATTR_USERNAME);
    const seenRealm = findAttr(parsed, ATTR_REALM);
    const seenNonce = findAttr(parsed, ATTR_NONCE);
    if (!user || user.toString('utf8') !== username) return false;
    if (!seenRealm || seenRealm.toString('utf8') !== realm) return false;
    if (!seenNonce || seenNonce.toString('utf8') !== nonce) return false;
    return verifyMessageIntegrity(raw, integrityKey);
  }

  async function handleAllocate(raw: Buffer, parsed: ParsedStun, from: RemoteInfo): Promise<void> {
    if (!authenticated(raw, parsed)) {
      unauthorized(from, parsed);
      return;
    }
    const transport = findAttr(parsed, ATTR_REQUESTED_TRANSPORT);
    if (!transport || transport[0] !== 17) {
      errorResponse(from, parsed, 4, 42, 'Unsupported Transport Protocol', true);
      return;
    }
    const key = clientKey(from);
    let alloc = allocations.get(key);
    if (!alloc) {
      const relay = createSocket('udp4');
      await new Promise<void>((resolve, reject) => {
        relay.once('error', reject);
        relay.bind(0, bindHost, () => resolve());
      });
      const relayPort = (relay.address() as { port: number }).port;
      alloc = {
        clientAddress: from.address,
        clientPort: from.port,
        relay,
        relayPort,
        permissions: new Map(),
        channels: new Map(),
        peerChannel: new Map(),
      };
      allocations.set(key, alloc);
      relay.on('message', (data, peer) => relayInbound(alloc!, data, peer));
      relay.on('error', () => {});
    }
    send(
      from,
      buildStunMessage(
        ALLOCATE_OK,
        parsed.transId,
        [
          xorAddressAttr(ATTR_XOR_RELAYED_ADDRESS, advertiseHost, alloc.relayPort),
          xorAddressAttr(ATTR_XOR_MAPPED_ADDRESS, from.address, from.port),
          (() => {
            const lifetime = Buffer.alloc(4);
            lifetime.writeUInt32BE(DEFAULT_LIFETIME, 0);
            return attrBuf(ATTR_LIFETIME, lifetime);
          })(),
          softwareAttr(),
        ],
        integrityKey,
      ),
    );
  }

  function relayInbound(alloc: Allocation, data: Buffer, peer: RemoteInfo): void {
    const pk = peerKey(peer.address, peer.port);
    const installed = alloc.permissions.get(pk);
    if (!installed || installed < Date.now()) return;
    const to = { address: alloc.clientAddress, port: alloc.clientPort } as RemoteInfo;
    const channel = alloc.peerChannel.get(pk);
    if (channel !== undefined) {
      const out = Buffer.alloc(4 + data.length);
      out.writeUInt16BE(channel, 0);
      out.writeUInt16BE(data.length, 2);
      data.copy(out, 4);
      send(to, out);
      return;
    }
    const transId = randomBytes(12);
    send(
      to,
      buildStunMessage(
        DATA_INDICATION,
        transId,
        [xorAddressAttr(ATTR_XOR_PEER_ADDRESS, peer.address, peer.port), attrBuf(ATTR_DATA, data)],
        integrityKey,
      ),
    );
  }

  function handleRefresh(raw: Buffer, parsed: ParsedStun, from: RemoteInfo): void {
    if (!authenticated(raw, parsed)) {
      unauthorized(from, parsed);
      return;
    }
    const key = clientKey(from);
    const alloc = allocations.get(key);
    if (!alloc) {
      errorResponse(from, parsed, 4, 37, 'Allocation Mismatch', true);
      return;
    }
    const requested = findAttr(parsed, ATTR_LIFETIME);
    const lifetime = requested ? Math.min(requested.readUInt32BE(0), DEFAULT_LIFETIME) : DEFAULT_LIFETIME;
    if (lifetime === 0) {
      alloc.relay.close();
      allocations.delete(key);
    }
    const lifetimeAttr = Buffer.alloc(4);
    lifetimeAttr.writeUInt32BE(lifetime, 0);
    send(
      from,
      buildStunMessage(
        REFRESH_OK,
        parsed.transId,
        [attrBuf(ATTR_LIFETIME, lifetimeAttr), softwareAttr()],
        integrityKey,
      ),
    );
  }

  function handleCreatePermission(raw: Buffer, parsed: ParsedStun, from: RemoteInfo): void {
    if (!authenticated(raw, parsed)) {
      unauthorized(from, parsed);
      return;
    }
    const alloc = allocations.get(clientKey(from));
    if (!alloc) {
      errorResponse(from, parsed, 4, 37, 'Allocation Mismatch', true);
      return;
    }
    const peerValue = findAttr(parsed, ATTR_XOR_PEER_ADDRESS);
    const peer = peerValue ? parseXorAddress(peerValue) : null;
    if (!peer) {
      errorResponse(from, parsed, 4, 0, 'Bad Request', true);
      return;
    }
    alloc.permissions.set(peerKey(peer.address, peer.port), Date.now() + PERMISSION_LIFETIME_MS);
    send(
      from,
      buildStunMessage(CREATE_PERMISSION_OK, parsed.transId, [softwareAttr()], integrityKey),
    );
  }

  function handleChannelBind(raw: Buffer, parsed: ParsedStun, from: RemoteInfo): void {
    if (!authenticated(raw, parsed)) {
      unauthorized(from, parsed);
      return;
    }
    const alloc = allocations.get(clientKey(from));
    if (!alloc) {
      errorResponse(from, parsed, 4, 37, 'Allocation Mismatch', true);
      return;
    }
    const numberValue = findAttr(parsed, ATTR_CHANNEL_NUMBER);
    const peerValue = findAttr(parsed, ATTR_XOR_PEER_ADDRESS);
    const peer = peerValue ? parseXorAddress(peerValue) : null;
    const channel = numberValue ? numberValue.readUInt16BE(0) : 0;
    if (!peer || channel < 0x4000 || channel > 0x7ffe) {
      errorResponse(from, parsed, 4, 0, 'Bad Request', true);
      return;
    }
    const pk = peerKey(peer.address, peer.port);
    const boundTo = alloc.channels.get(channel);
    if (boundTo !== undefined && boundTo !== pk) {
      errorResponse(from, parsed, 4, 0, 'Bad Request', true);
      return;
    }
    const previous = alloc.peerChannel.get(pk);
    if (previous !== undefined) alloc.channels.delete(previous);
    alloc.channels.set(channel, pk);
    alloc.peerChannel.set(pk, channel);
    alloc.permissions.set(pk, Date.now() + PERMISSION_LIFETIME_MS);
    send(from, buildStunMessage(CHANNEL_BIND_OK, parsed.transId, [softwareAttr()], integrityKey));
  }

  function handleSendIndication(parsed: ParsedStun, from: RemoteInfo): void {
    const alloc = allocations.get(clientKey(from));
    if (!alloc) return;
    const peerValue = findAttr(parsed, ATTR_XOR_PEER_ADDRESS);
    const data = findAttr(parsed, ATTR_DATA);
    const peer = peerValue ? parseXorAddress(peerValue) : null;
    if (!peer || !data) return;
    const installed = alloc.permissions.get(peerKey(peer.address, peer.port));
    if (!installed || installed < Date.now()) return;
    alloc.relay.send(data, peer.port, peer.address);
  }

  function handleChannelData(msg: Buffer, from: RemoteInfo): void {
    if (msg.length < 4) return;
    const alloc = allocations.get(clientKey(from));
    if (!alloc) return;
    const channel = msg.readUInt16BE(0);
    const length = msg.readUInt16BE(2);
    const peer = alloc.channels.get(channel);
    if (!peer) return;
    const separator = peer.lastIndexOf(':');
    alloc.relay.send(
      msg.subarray(4, 4 + length),
      Number(peer.slice(separator + 1)),
      peer.slice(0, separator),
    );
  }

  sock.on('message', (msg: Buffer, from: RemoteInfo) => {
    void (async () => {
      try {
        if (msg.length === 0) return;
        if ((msg[0]! & 0xc0) === 0x40) {
          handleChannelData(msg, from);
          return;
        }
        if ((msg[0]! & 0xc0) !== 0x00) return;
        const parsed = parseStunMessage(msg);
        if (!parsed) return;
        switch (parsed.msgType) {
          case BINDING:
            // Plain RFC 5389 binding: answer with the client's mapped address.
            // Chromium sends these while gathering (srflx via the TURN host);
            // answering is harmless and proves the reverse path delivers.
            send(
              from,
              buildStunMessage(
                BINDING_OK,
                parsed.transId,
                [
                  xorAddressAttr(ATTR_XOR_MAPPED_ADDRESS, from.address, from.port),
                  softwareAttr(),
                ],
              ),
            );
            break;
          case ALLOCATE:
            await handleAllocate(msg, parsed, from);
            break;
          case REFRESH:
            handleRefresh(msg, parsed, from);
            break;
          case CREATE_PERMISSION:
            handleCreatePermission(msg, parsed, from);
            break;
          case CHANNEL_BIND:
            handleChannelBind(msg, parsed, from);
            break;
          case SEND_INDICATION:
            handleSendIndication(parsed, from);
            break;
          default:
            break;
        }
      } catch {
        // A malformed datagram must never take down the server mid-run.
      }
    })();
  });
  sock.on('error', () => {});

  const requestedPort = options.port ?? 3479;
  await new Promise<void>((resolve, reject) => {
    sock.once('error', reject);
    sock.bind(requestedPort, bindHost, () => resolve());
  });
  const boundPort = (sock.address() as { port: number }).port;

  return {
    host: advertiseHost,
    port: boundPort,
    close: async () => {
      for (const alloc of allocations.values()) alloc.relay.close();
      allocations.clear();
      await new Promise<void>((resolve) => sock.close(() => resolve()));
    },
  };
}

function parseArgs(argv: string[]): TurnServerOptions {
  const options: TurnServerOptions = {};
  for (const arg of argv) {
    if (arg.startsWith('--user=')) options.username = arg.slice('--user='.length);
    else if (arg.startsWith('--pass=')) options.password = arg.slice('--pass='.length);
    else if (arg.startsWith('--realm=')) options.realm = arg.slice('--realm='.length);
    else if (arg.startsWith('--host=')) options.host = arg.slice('--host='.length);
    else if (!Number.isNaN(Number(arg))) options.port = Number(arg);
  }
  return options;
}

// CLI: bun run frontend/e2e/turn-server.ts [port]. Prints the bound address so
// the spec can hand it to the harness page without a fixed-port collision.
const isCli = process.argv[1]?.endsWith('turn-server.ts') ?? false;
if (isCli) {
  const server = await startServer(parseArgs(process.argv.slice(2)));
  console.log(`TURN ready ${server.host}:${server.port}`);
}
