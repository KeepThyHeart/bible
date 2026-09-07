import { describe, it, expect, vi } from 'vitest';
import { sendError, ErrorCodes } from '../utils/errorResponse';
import type { Response } from 'express';

function mockResponse(): Response {
  const res: Partial<Response> = {};
  res.json = vi.fn().mockReturnValue(res as Response);
  res.status = vi.fn().mockReturnValue(res as Response);
  return res as Response;
}

describe('ErrorCodes', () => {
  it('has expected error code values', () => {
    expect(ErrorCodes.NOT_FOUND).toBe('NOT_FOUND');
    expect(ErrorCodes.INVALID_PARAM).toBe('INVALID_PARAM');
    expect(ErrorCodes.INTERNAL_ERROR).toBe('INTERNAL_ERROR');
    expect(ErrorCodes.MODULE_NOT_FOUND).toBe('MODULE_NOT_FOUND');
  });
});

describe('sendError', () => {
  it('sets the correct HTTP status code', () => {
    const res = mockResponse();
    sendError(res, 400, ErrorCodes.INVALID_PARAM, 'Bad input');
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('sends a JSON error envelope with code and message', () => {
    const res = mockResponse();
    sendError(res, 404, ErrorCodes.NOT_FOUND, 'Verse not found');
    expect(res.json).toHaveBeenCalledWith({
      error: {
        code: 'NOT_FOUND',
        message: 'Verse not found',
      },
    });
  });

  it('works with 500 status and INTERNAL_ERROR', () => {
    const res = mockResponse();
    sendError(res, 500, ErrorCodes.INTERNAL_ERROR, 'Something went wrong');
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Something went wrong',
      },
    });
  });

  it('works with MODULE_NOT_FOUND', () => {
    const res = mockResponse();
    sendError(res, 404, ErrorCodes.MODULE_NOT_FOUND, 'Module "xyz" not found');
    expect(res.json).toHaveBeenCalledWith({
      error: {
        code: 'MODULE_NOT_FOUND',
        message: 'Module "xyz" not found',
      },
    });
  });
});
