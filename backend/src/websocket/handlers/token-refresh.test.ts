// token_refresh lets a call outlive its room token's exp. The server must only
// accept a replacement that is genuinely valid *for this socket* — same user,
// same room, unexpired, and not a waiting-room token.
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Secrets must exist before jwt.ts is evaluated (it reads env at load).
process.env.JWT_SECRET ||= 'test-jwt-secret';
const { generateRoomToken, generateWaitingToken } = await import('../../utils/jwt');
const { handlerRegistry } = await import('./index');
const jwt = (await import('jsonwebtoken')).default;

type Ctx = Parameters<NonNullable<ReturnType<typeof handlerRegistry.get>>>[0];

function makeCtx(currentToken: string | undefined, userId = 'u1', roomId = 'r1') {
  const ws = { userId, roomId, roomToken: currentToken } as Ctx['ws'];
  const send = vi.fn();
  const sendError = vi.fn();
  const ctx = {
    ws,
    signal: {},
    userId,
    roomId,
    handler: { send, sendError },
  } as unknown as Ctx;
  return { ctx, ws, send, sendError };
}

const refresh = handlerRegistry.get('token_refresh')!;

describe('token_refresh', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Rejections are expected here and logged; keep the output readable.
    vi.spyOn(console, 'warn').mockImplementation((() => undefined) as never);
  });

  it('is registered', () => {
    expect(refresh).toBeTypeOf('function');
  });

  it('accepts a valid replacement and acks it', async () => {
    const { ctx, ws, send } = makeCtx(generateRoomToken('u1', 'r1'));
    const replacement = generateRoomToken('u1', 'r1');

    await refresh({ ...ctx, signal: { roomToken: replacement } });

    expect(ws.roomToken).toBe(replacement);
    expect(send).toHaveBeenCalledWith(ws, { type: 'token_refresh_ack' });
  });

  it('rejects a token for a different room and keeps the current one', async () => {
    const original = generateRoomToken('u1', 'r1');
    const { ctx, ws, send, sendError } = makeCtx(original);

    await refresh({ ...ctx, signal: { roomToken: generateRoomToken('u1', 'other') } });

    expect(ws.roomToken).toBe(original);
    expect(send).not.toHaveBeenCalled();
    expect(sendError).toHaveBeenCalled();
  });

  it('rejects a token minted for a different user', async () => {
    const original = generateRoomToken('u1', 'r1');
    const { ctx, ws } = makeCtx(original);

    await refresh({ ...ctx, signal: { roomToken: generateRoomToken('attacker', 'r1') } });

    expect(ws.roomToken).toBe(original);
  });

  it('rejects a waiting-room token (not admitted to the call)', async () => {
    const original = generateRoomToken('u1', 'r1');
    const { ctx, ws } = makeCtx(original);

    await refresh({ ...ctx, signal: { roomToken: generateWaitingToken('u1', 'r1') } });

    expect(ws.roomToken).toBe(original);
  });

  it('rejects an expired token', async () => {
    const original = generateRoomToken('u1', 'r1');
    const { ctx, ws } = makeCtx(original);
    const expired = jwt.sign(
      { userId: 'u1', roomId: 'r1', exp: Math.floor(Date.now() / 1000) - 60 },
      process.env.JWT_SECRET!,
    );

    await refresh({ ...ctx, signal: { roomToken: expired } });

    expect(ws.roomToken).toBe(original);
  });

  it('rejects a malformed or unsigned token', async () => {
    const original = generateRoomToken('u1', 'r1');
    const { ctx, ws } = makeCtx(original);

    await refresh({ ...ctx, signal: { roomToken: 'not.a.jwt' } });
    expect(ws.roomToken).toBe(original);

    // Correct shape, wrong signing key.
    const forged = jwt.sign({ userId: 'u1', roomId: 'r1', exp: Math.floor(Date.now() / 1000) + 600 }, 'wrong-secret');
    await refresh({ ...ctx, signal: { roomToken: forged } });
    expect(ws.roomToken).toBe(original);
  });

  it('errors when no token is supplied', async () => {
    const { ctx, sendError } = makeCtx(generateRoomToken('u1', 'r1'));
    await refresh(ctx);
    expect(sendError).toHaveBeenCalled();
  });
});
