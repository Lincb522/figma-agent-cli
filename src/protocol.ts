export const PORT = 38471;
export const VERSION = 1;
export const MAX_BODY = 24 * 1024 * 1024;
export const METHODS = ['document', 'selection', 'inspect', 'find', 'fonts', 'apply', 'patch', 'delete', 'select', 'export', 'image', 'variables', 'styles', 'boolean', 'boolean-set', 'audit', 'icon-shape', 'prototype-get', 'prototype-set', 'eval'] as const;
export type Method = typeof METHODS[number];
export interface Command { id: string; method: Method; params: Record<string, any>; timeoutMs: number }
export interface Fault { code: string; message: string; recovery?: string; details?: unknown }
export type Reply = { ok: true; id: string; result: any } | { ok: false; id: string; error: Fault };
export interface Context { document: string; page: string; pageId: string; selection: { id: string; name: string; type: string }[] }
export class AgentError extends Error {
  constructor(public code: string, message: string, public recovery?: string, public details?: unknown) { super(message); }
}
export function fault(error: unknown): Fault {
  if (error instanceof AgentError) return { code: error.code, message: error.message, recovery: error.recovery, details: error.details };
  return { code: 'COMMAND_FAILED', message: error instanceof Error ? error.message : String(error) };
}
export function validateCommand(input: any): Command {
  if (!input || typeof input.id !== 'string' || !/^[a-zA-Z0-9_.:-]{1,120}$/.test(input.id)) throw new AgentError('INVALID_REQUEST', 'A request ID of 1–120 safe characters is required.');
  if (!METHODS.includes(input.method)) throw new AgentError('INVALID_METHOD', 'Unknown command method.', 'Run figma-agent schema.');
  if (!input.params || typeof input.params !== 'object' || Array.isArray(input.params)) throw new AgentError('INVALID_PARAMS', 'params must be an object.');
  if (!Number.isInteger(input.timeoutMs) || input.timeoutMs < 100 || input.timeoutMs > 300_000) throw new AgentError('INVALID_TIMEOUT', 'timeoutMs must be an integer between 100 and 300000.');
  return input;
}
