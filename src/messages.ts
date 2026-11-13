/** Messages between the background worker and the content script of a tab. */
export type Message = { type: 'TOGGLE' } | { type: 'STATUS' } | { type: 'OFF' };
export type StatusReply = { on: boolean };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

export const isMessage = (v: unknown): v is Message =>
  isObject(v) && (v.type === 'TOGGLE' || v.type === 'STATUS' || v.type === 'OFF');

export const isStatusReply = (v: unknown): v is StatusReply => isObject(v) && typeof v.on === 'boolean';
