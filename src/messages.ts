/** Messages between the background worker and the content script of each frame. */
export type Message = { type: 'STATUS' } | { type: 'OFF' } | { type: 'NOTICE'; text: string };
export type StatusReply = { on: boolean };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

export const isMessage = (v: unknown): v is Message =>
  isObject(v) && (v.type === 'STATUS' || v.type === 'OFF' || (v.type === 'NOTICE' && typeof v.text === 'string'));

export const isStatusReply = (v: unknown): v is StatusReply => isObject(v) && typeof v.on === 'boolean';
