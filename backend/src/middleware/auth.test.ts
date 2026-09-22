import { describe, it, expect } from 'vitest';
import type { Request, Response } from 'express';
import { requireUser } from './auth';

interface FakeRes {
  statusCode: number;
  body: unknown;
  status: (code: number) => FakeRes;
  json: (payload: unknown) => FakeRes;
}

function makeRes(): { res: Response; raw: FakeRes } {
  const raw: FakeRes = {
    statusCode: 0,
    body: undefined,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return { res: raw as unknown as Response, raw };
}

describe('requireUser', () => {
  it('returns the authenticated user without touching the response', () => {
    const req = { user: { id: 'u1', email: 'a@b.c' } } as Request;
    const { res, raw } = makeRes();

    const user = requireUser(req, res);

    expect(user).toEqual({ id: 'u1', email: 'a@b.c' });
    expect(raw.statusCode).toBe(0);
    expect(raw.body).toBeUndefined();
  });

  it('replies 401 UNAUTHORIZED and returns null when no user is attached', () => {
    const req = {} as Request;
    const { res, raw } = makeRes();

    const user = requireUser(req, res);

    expect(user).toBeNull();
    expect(raw.statusCode).toBe(401);
    expect(raw.body).toEqual({ error: 'UNAUTHORIZED', code: 'UNAUTHORIZED' });
  });
});
