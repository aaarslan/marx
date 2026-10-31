import readline from 'node:readline';
import {app, BrowserWindow, handlers, resolveNative, send, notificationClicked} from './desktop';
import {registerIpcHandlers} from './ipc';
import {stopCliProcesses} from './cliProcess';
const win = new BrowserWindow();
registerIpcHandlers({getWindow: () => win});
const lines = readline.createInterface({input: process.stdin, crlfDelay: Infinity});
let active = 0;
lines.on('line', line => {
  let message: any;
  try { message = JSON.parse(line); } catch { process.exit(1); }
  if (message.reply) {resolveNative(message); return;}
  if (message.channel === '$notification-click') {notificationClicked(message.args[0]);return;}
  if (message.channel === '$shutdown') {stopCliProcesses(); app.emit('will-quit'); process.exit(0);}
  if (++active > 256) {active--;send({id:message.id,error:'Desktop request capacity exceeded.'});return;}
  const handler = handlers.get(message.channel);
  if (!handler) {active--;send({id:message.id,error:'Unknown desktop operation.'});return;}
  void Promise.resolve().then(() => handler({sender:win.webContents,senderFrame:win.webContents.mainFrame}, ...message.args.map((value: unknown) => value === null ? undefined : value)))
    .then(result => send({id:message.id,result})).catch(() => send({id:message.id,error:'Desktop operation failed.'})).finally(() => active--);
});
lines.on('close', () => {stopCliProcesses(); app.emit('will-quit'); process.exit(0);});
send({ready:true});
