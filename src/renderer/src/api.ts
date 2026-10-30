import type { MarxApi } from '@shared/api-contract';

declare global {
  interface Window {
    marx: MarxApi;
  }
}

export const api = window.marx;
export const isMac = api.platform === 'darwin';
export const commandKey = isMac ? '⌘' : 'Ctrl+';
