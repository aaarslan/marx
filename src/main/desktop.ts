import { EventEmitter } from 'node:events';
import { execFileSync } from 'node:child_process';
import {randomUUID} from 'node:crypto';

export const handlers = new Map<string, (...args: any[]) => Promise<any>>();
let sequence = 0;
const pending = new Map<number, {resolve: (value: any) => void; reject: (error: Error) => void}>();
export const send = (value: unknown) => process.stdout.write(JSON.stringify(value) + '\n');
export function native(method: string, args: unknown = {}): Promise<any> {
  const id = ++sequence;
  return new Promise((resolve, reject) => { pending.set(id, {resolve, reject}); send({native: method, id, args}); });
}
export function resolveNative(message: {id: number; data?: unknown; error?: string}) {
  const task = pending.get(message.id); pending.delete(message.id);
  if (message.error) task?.reject(new Error(message.error)); else task?.resolve(message.data);
}
export const app = Object.assign(new EventEmitter(), {getPath: (name: string): string => {
  const value = name === 'userData' ? process.env.MARX_USER_DATA_DIR : process.env.MARX_DOWNLOADS_DIR;
  if (!value) throw new Error('Native desktop environment is unavailable.');
  return value;
}});
export class BrowserWindow {
  webContents = {mainFrame: {}, send: (channel: string, data: unknown) => send({event: channel, data})};
  show() { void native('show'); }
}
export const ipcMain = {handle: (channel: string, fn: (...args: any[]) => Promise<any>) => handlers.set(channel, fn)};
export const clipboard = {writeText: (text: string) => native('clipboard', {text})};
export const dialog = {
  showOpenDialog: (_window: BrowserWindow, options: any) => native('open', options),
  showSaveDialog: (_window: BrowserWindow, options: any) => native('save', options)
};
export const shell = {openExternal: (url: string) => native('external', {url}), showItemInFolder: (file: string) => native('reveal', {file})};
function credential(mode: string, input: Buffer): Buffer {
  if (!process.env.MARX_HOST_EXECUTABLE) throw new Error('Protected credential storage is unavailable.');
  return execFileSync(process.env.MARX_HOST_EXECUTABLE, ['--credential', mode], {input, maxBuffer: 1024 * 1024, windowsHide: true});
}
export const safeStorage = {
  isEncryptionAvailable: () => process.platform === 'win32' && Boolean(process.env.MARX_HOST_EXECUTABLE),
  getSelectedStorageBackend: () => 'windows-dpapi',
  encryptString: (text: string) => credential('protect', Buffer.from(text)),
  decryptString: (value: Buffer) => credential('unprotect', value).toString('utf8')
};
const notifications = new Map<string, Notification>();
export function notificationClicked(id: string) {const item=notifications.get(id);notifications.delete(id);item?.emit('click');}
export class Notification extends EventEmitter {
  constructor(private options: {title: string; body: string}) {super();}
  static isSupported() {return true;}
  show() {const id=randomUUID();notifications.set(id,this);if(notifications.size>64)notifications.delete(notifications.keys().next().value!);void native('notification', {...this.options,id}).catch(()=>notifications.delete(id));}
}
