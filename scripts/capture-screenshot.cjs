const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'marx-screenshot-'));
app.setPath('userData', profile);
app.on('browser-window-created', (_event, win) => {
  win.on('show', () => win.hide());
});
app.once('quit', () => fs.rmSync(profile, { recursive: true, force: true }));
require('../out/main/index.js');

async function waitFor(contents, expression) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await contents.executeJavaScript(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Timed out waiting for the Marx screenshot state.');
}

app.whenReady().then(async () => {
  const win = BrowserWindow.getAllWindows()[0];
  try {
    const contents = win.webContents;
    contents.setBackgroundThrottling(false);
    await waitFor(contents, 'Boolean(document.querySelector(".nav-item"))');
    await contents.executeJavaScript('Array.from(document.querySelectorAll(".nav-item")).find(button => button.textContent.trim() === "Results").click()');
    await waitFor(contents, 'Array.from(document.querySelectorAll("button")).some(button => button.textContent.trim() === "Load demo results")');
    await contents.executeJavaScript('Array.from(document.querySelectorAll("button")).find(button => button.textContent.trim() === "Load demo results").click()');
    await waitFor(contents, 'document.querySelectorAll(".finding-link").length === 9');
    await contents.executeJavaScript('document.fonts.ready.then(() => true)');
    await contents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))');
    const image = await contents.capturePage(undefined, { stayHidden: true, stayAwake: true });
    if (image.isEmpty()) throw new Error('The screenshot was empty.');
    const target = path.join(__dirname, '../docs/screenshot.png');
    fs.writeFileSync(target, image.toPNG());
    console.log(`wrote ${target} (${image.getSize().width}x${image.getSize().height})`);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    win.destroy();
    app.quit();
  }
});
