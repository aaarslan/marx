const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawn } = require('node:child_process');
const { createRequire } = require('node:module');

const project = path.resolve(__dirname, '..');
const projectRequire = createRequire(path.join(project, 'package.json'));
const PATCH_VERSIONS = {
  '@electron/asar': '3.4.1',
  '@electron/universal': '2.0.3',
  'app-builder-lib': '26.18.0',
  'dir-compare': '4.2.0'
};

function packageInfo(request, name) {
  let filename;
  try { filename = request.resolve(`${name}/package.json`); }
  catch { filename = request.resolve(name); }
  let directory = path.dirname(filename);
  for (;;) {
    const manifest = path.join(directory, 'package.json');
    if (fs.existsSync(manifest)) {
      const value = JSON.parse(fs.readFileSync(manifest, 'utf8'));
      if (value.name && value.version) return { ...value, directory, manifest };
    }
    const parent = path.dirname(directory);
    if (parent === directory) throw new Error(`Cannot find the manifest for ${name}.`);
    directory = parent;
  }
}

function installedPackages() {
  const directories = [path.join(project, 'node_modules')];
  const visited = new Set();
  const packages = new Map();
  for (let cursor = 0; cursor < directories.length; cursor++) {
    const directory = directories[cursor];
    if (!fs.existsSync(directory)) continue;
    const canonical = fs.realpathSync(directory);
    if (visited.has(canonical)) continue;
    visited.add(canonical);
    const candidates = [];
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const target = path.join(directory, entry.name);
      if (entry.name.startsWith('@')) {
        for (const child of fs.readdirSync(target)) candidates.push(path.join(target, child));
      } else candidates.push(target);
    }
    for (const candidate of candidates) {
      const manifest = path.join(candidate, 'package.json');
      if (!fs.existsSync(manifest)) continue;
      const canonicalManifest = fs.realpathSync(manifest);
      if (packages.has(canonicalManifest)) continue;
      const value = JSON.parse(fs.readFileSync(canonicalManifest, 'utf8'));
      packages.set(canonicalManifest, { name: value.name, version: value.version, manifest: canonicalManifest });
      const packageDirectory = path.dirname(canonicalManifest);
      directories.push(path.join(packageDirectory, 'node_modules'));
      const parent = path.dirname(packageDirectory);
      directories.push(path.basename(parent).startsWith('@') ? path.dirname(parent) : parent);
    }
  }
  return [...packages.values()];
}

function verifyDependencies() {
  const manifest = JSON.parse(fs.readFileSync(path.join(project, 'package.json'), 'utf8'));
  const resolved = [];
  for (const [name, version] of Object.entries(PATCH_VERSIONS)) {
    const consumer = packageInfo(projectRequire, name);
    assert.equal(consumer.version, version, `${name} changed: review its patch and packaging contracts before updating PATCH_VERSIONS.`);
    const patch = manifest.patchedDependencies?.[`${name}@${version}`];
    assert.ok(typeof patch === 'string' && fs.existsSync(path.resolve(project, patch)), `Missing committed patch for ${name}@${version}.`);
    const request = createRequire(consumer.manifest);
    for (const slot of ['picomatch', 'minimatch']) {
      const replacement = packageInfo(request, slot);
      assert.equal(replacement.name, 'picomatch', `${name}'s ${slot} must resolve to actual Picomatch code.`);
      assert.equal(replacement.version, '4.0.7');
      resolved.push({ consumer: name, slot, name: replacement.name, version: replacement.version });
    }
    if (name === '@electron/asar') {
      for (const slot of ['fdir', 'glob']) {
        const replacement = packageInfo(request, slot);
        assert.equal(replacement.name, 'fdir', `ASAR's ${slot} must resolve to actual fdir code.`);
        assert.equal(replacement.version, '6.5.0');
        resolved.push({ consumer: name, slot, name: replacement.name, version: replacement.version });
      }
    }
  }
  const builderRequest = createRequire(packageInfo(projectRequire, 'app-builder-lib').manifest);
  const lock = builderRequest('json5').parse(fs.readFileSync(path.join(project, 'bun.lock'), 'utf8'));
  const locked = Object.entries(lock.packages).filter(([, entry]) => /^minimatch@|^glob@7(?:\.|$)/.test(entry[0]));
  assert.deepEqual(locked, [], 'The lockfile still resolves a real minimatch or glob 7 package; dependency slot names alone are not evidence of removal.');
  const installed = installedPackages();
  const forbidden = installed.filter(item => item.name === 'minimatch' || (item.name === 'glob' && /^7(?:\.|$)/.test(item.version)));
  assert.deepEqual(forbidden, [], 'Installed packages still contain minimatch or glob 7. Perform a clean frozen install.');
  return { patchedVersions: PATCH_VERSIONS, resolved, installedPackages: installed.length };
}

function loadWithPath(filename, paths, overrides = {}) {
  const module = { exports: {} };
  const request = createRequire(filename);
  const requireDependency = name => name === 'path' || name === 'node:path' ? paths : Object.hasOwn(overrides, name) ? overrides[name] : request(name);
  const source = fs.readFileSync(filename, 'utf8');
  const execute = vm.runInThisContext(`(function(require,module,exports,__dirname,__filename){${source}\n})`, { filename });
  execute(requireDependency, module, module.exports, path.dirname(filename), filename);
  return module.exports;
}

function verifyFileMatchers() {
  const mainFile = projectRequire.resolve('app-builder-lib/out/fileMatcher');
  const filterFile = projectRequire.resolve('app-builder-lib/out/util/filter');
  const input = [
    ['out', true, true], ['out/main', true, true], ['out/renderer/assets', true, true],
    ['out/main/index.js', false, true], ['out/preload/index.js', false, true],
    ['out/renderer/index.html', false, true], ['out/renderer/assets/app.js', false, true],
    ['package.json', false, true], ['out/renderer/.config', false, true],
    ['out/main/index.js.map', false, false], ['out/renderer/cache.tsbuildinfo', false, false],
    ['out/main/types.d.ts', false, false], ['out/main/debug.pdb', false, false],
    ['out/main/.DS_Store', false, false], ['out/renderer/._app.js', false, false],
    ['out/renderer/node_modules', true, true], ['node_modules', true, false],
    ['src/main/index.ts', false, false], ['docs', true, false], ['tests/spec.js', false, false],
    ['OUT/main/index.js', false, false]
  ];
  const results = [];
  for (const [platform, root] of [['linux', '/tmp/project with spaces'], ['darwin', '/Users/test/Project With Spaces'], ['win32', 'C:\\work space\\marx'], ['win32', '\\\\server\\share\\marx']]) {
    const paths = platform === 'win32' ? path.win32 : path.posix;
    const filter = loadWithPath(filterFile, paths);
    const matcherModule = loadWithPath(mainFile, paths, { './util/filter': filter });
    const files = ['out/main/**', 'out/preload/**', 'out/renderer/**', 'package.json', '!**/*.map', '!**/*.tsbuildinfo'];
    const packager = { projectDir: root, buildResourcesDir: 'build', config: { files }, isPrepackedAppAsar: false, debugLogger: { isEnabled: false } };
    const [matcher] = matcherModule.getMainFileMatchers(root, paths.join(root, 'dist', 'resources'), value => value, {}, { info: packager }, paths.join(root, 'dist'), false);
    const accepts = matcher.createFilter();
    for (const [relative, directory, expected] of input) {
      assert.equal(accepts(paths.join(root, ...relative.split('/')), { isDirectory: () => directory }), expected, `${platform} ${root}: ${relative}`);
    }
    const match = (patterns, relative, directory = false) => new matcherModule.FileMatcher(root, paths.join(root, 'dest'), value => value, patterns).createFilter()(paths.join(root, ...relative.split('/')), { isDirectory: () => directory });
    assert.equal(match(['**/*', '!**/*.map', 'out/renderer/keep.map'], 'out/renderer/keep.map'), true);
    assert.equal(match(['**/*', '!**/*.map', 'out/renderer/keep.map'], 'out/renderer/drop.map'), false);
    assert.equal(match(['assets'], 'assets/nested/icon.png'), true);
    assert.equal(match(['assets/{logo,banner}.{png,svg}'], 'assets', true), true);
    assert.equal(match(['assets/{logo,banner}.{png,svg}'], 'assets/logo.png'), true);
    assert.equal(match(['assets/{logo,banner}.{png,svg}'], 'assets/no.jpg'), false);
    assert.equal(match(['a/{b/c,d/e}/file.js'], 'a/b', true), true);
    assert.equal(match(['a/{b/c,d/e}/file.js'], 'a/d', true), true);
    assert.equal(match(['a/{b/c,d/e}/file.js'], 'a/b/c/file.js'), true);
    assert.equal(match(['a/{b/c,d/e}/file.js'], 'a/d/e/file.js'), true);
    assert.equal(match(['a/{b/c,d/e}/file.js'], 'a/b/e/file.js'), false);
    const destination = paths.join(root, 'destination');
    const [mapped] = matcherModule.getFileMatchers({ extraResources: [{ from: 'extra source', to: 'mapped target', filter: ['nested/*.js'] }] }, 'extraResources', destination, { macroExpander: value => value, customBuildOptions: {}, globalOutDir: paths.join(root, 'dist'), defaultSrc: root });
    assert.equal(mapped.from, paths.join(root, 'extra source'));
    assert.equal(mapped.to, paths.join(destination, 'mapped target'));
    const mappedFilter = mapped.createFilter();
    assert.equal(mappedFilter(paths.join(mapped.from, 'nested'), { isDirectory: () => true }), true);
    assert.equal(mappedFilter(paths.join(mapped.from, 'nested', 'module.js'), { isDirectory: () => false }), true);
    assert.equal(mappedFilter(paths.join(mapped.from, 'nested', 'module.js.map'), { isDirectory: () => false }), false);
    results.push({ platform, root, assertions: input.length + 16 });
  }
  return { pathImplementations: results, nativePlatform: process.platform, assertions: results.reduce((sum, item) => sum + item.assertions, 0) };
}

function archiveEntries(asar, archive) {
  return asar.listPackage(archive).map(entry => entry.replaceAll('\\', '/').replace(/^\//, '')).sort();
}

async function verifyAsar() {
  const asar = projectRequire('@electron/asar');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'marx-asar-contracts-'));
  const source = path.join(temporary, 'source with spaces');
  fs.mkdirSync(source);
  const files = new Map([
    ['main.js', Buffer.from('module.exports = "archive fixture";\n')],
    ['.hidden', Buffer.from('hidden root file')],
    ['..name', Buffer.from('internal dot-prefixed filename')],
    ['.config/visible.txt', Buffer.from('hidden parent directory')],
    ['assets/literal[1].txt', Buffer.from('literal brackets')],
    ['assets/empty.bin', Buffer.alloc(0)],
    ['assets/nested/binary.dat', Buffer.from([0, 1, 2, 127, 128, 255])],
    ['assets/space ü.txt', Buffer.from('unicode filename')],
    ['native/addon.node', Buffer.from([4, 3, 2, 1])],
    ['external/nested/data.txt', Buffer.from('unpacked directory')],
    ['drop.skip', Buffer.from('ignored fixture')],
    ['bin/run.sh', Buffer.from('#!/bin/sh\nexit 0\n')]
  ]);
  const skipped = [];
  try {
    for (const [relative, data] of files) {
      const target = path.join(source, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, data);
    }
    fs.mkdirSync(path.join(source, 'empty'));
    fs.mkdirSync(path.join(source, 'assets', 'empty'));
    fs.chmodSync(path.join(source, 'bin', 'run.sh'), 0o755);
    let links = true;
    try {
      fs.symlinkSync('main.js', path.join(source, 'file-link'), 'file');
      fs.symlinkSync('assets', path.join(source, 'dir-link'), 'dir');
      fs.symlinkSync(path.join(source, 'main.js'), path.join(source, 'absolute-file-link'), 'file');
      fs.symlinkSync(path.join(source, 'assets'), path.join(source, 'absolute-dir-link'), 'dir');
      fs.symlinkSync(path.join(source, '..name'), path.join(source, 'dot-name-link'), 'file');
    } catch (error) {
      if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) throw error;
      links = false;
      for (const name of ['file-link', 'dir-link', 'absolute-file-link', 'absolute-dir-link', 'dot-name-link']) fs.rmSync(path.join(source, name), { force: true });
      skipped.push('Native symlink fixtures require Windows Developer Mode or symlink permission.');
    }
    const archive = path.join(temporary, 'default.asar');
    await asar.createPackage(source, archive);
    const entries = archiveEntries(asar, archive);
    for (const [relative, data] of files) {
      assert.ok(entries.includes(relative), `Missing ASAR file ${relative}`);
      assert.deepEqual(asar.extractFile(archive, relative), data, `Changed bytes in ${relative}`);
    }
    for (const directory of ['empty', 'assets/empty', '.config']) assert.ok('files' in asar.statFile(archive, directory));
    if (process.platform !== 'win32') assert.equal(asar.statFile(archive, 'bin/run.sh').executable, true);
    if (links) {
      assert.equal(asar.statFile(archive, 'file-link', false).link, 'main.js');
      assert.equal(asar.statFile(archive, 'dir-link', false).link, 'assets');
      assert.equal(asar.statFile(archive, 'absolute-file-link', false).link, 'main.js');
      assert.equal(asar.statFile(archive, 'absolute-dir-link', false).link, 'assets');
      assert.equal(asar.statFile(archive, 'dot-name-link', false).link, '..name');
      assert.deepEqual(asar.extractFile(archive, 'file-link'), files.get('main.js'));
      assert.deepEqual(asar.extractFile(archive, 'absolute-file-link'), files.get('main.js'));
      assert.ok(!entries.some(entry => entry.startsWith('dir-link/') || entry.startsWith('absolute-dir-link/')), 'Crawling must not duplicate descendants through a directory symlink.');
    }
    const extracted = path.join(temporary, 'extracted');
    asar.extractAll(archive, extracted);
    for (const [relative, data] of files) assert.deepEqual(fs.readFileSync(path.join(extracted, relative)), data);
    assert.equal(fs.readdirSync(path.join(extracted, 'empty')).length, 0);
    assert.equal(fs.readdirSync(path.join(extracted, 'assets', 'empty')).length, 0);
    if (links && process.platform !== 'win32') {
      assert.ok(fs.lstatSync(path.join(extracted, 'file-link')).isSymbolicLink());
      assert.ok(fs.lstatSync(path.join(extracted, 'dir-link')).isSymbolicLink());
    }
    const unpacked = path.join(temporary, 'unpacked.asar');
    await asar.createPackageWithOptions(source, unpacked, { unpack: '*.node', unpackDir: 'external' });
    assert.equal(asar.statFile(unpacked, 'native/addon.node').unpacked, true);
    assert.equal(asar.statFile(unpacked, 'external/nested/data.txt').unpacked, true);
    assert.notEqual(asar.statFile(unpacked, 'main.js').unpacked, true);
    assert.deepEqual(fs.readFileSync(path.join(`${unpacked}.unpacked`, 'native', 'addon.node')), files.get('native/addon.node'));
    assert.deepEqual(asar.extractFile(unpacked, 'external/nested/data.txt'), files.get('external/nested/data.txt'));
    const filtered = path.join(temporary, 'filtered.asar');
    await asar.createPackageWithOptions(source, filtered, { dot: false, globOptions: { ignore: '**/*.skip' } });
    const filteredEntries = archiveEntries(asar, filtered);
    assert.ok(filteredEntries.includes('main.js'));
    assert.ok(!filteredEntries.includes('.hidden') && !filteredEntries.includes('.config') && !filteredEntries.includes('drop.skip'));
    const streamArchive = path.join(temporary, 'streams.asar');
    const streams = [
      { path: 'empty', type: 'directory', unpacked: false },
      { path: 'native', type: 'directory', unpacked: true },
      ...['main.js', '.hidden', 'native/addon.node'].map(relative => ({ path: relative, type: 'file', stat: fs.statSync(path.join(source, relative)), unpacked: relative.endsWith('.node'), streamGenerator: () => fs.createReadStream(path.join(source, relative)) }))
    ];
    if (links) streams.push({ path: 'file-link', type: 'link', stat: fs.lstatSync(path.join(source, 'file-link')), unpacked: false, symlink: 'main.js' });
    await asar.createPackageFromStreams(streamArchive, streams);
    assert.deepEqual(asar.extractFile(streamArchive, '.hidden'), files.get('.hidden'));
    assert.deepEqual(asar.extractFile(streamArchive, 'native/addon.node'), files.get('native/addon.node'));
    assert.ok('files' in asar.statFile(streamArchive, 'empty'));
    if (links) assert.deepEqual(asar.extractFile(streamArchive, 'file-link'), files.get('main.js'));
    if (links) {
      fs.writeFileSync(path.join(temporary, 'outside.txt'), 'must not enter the archive');
      fs.symlinkSync('../outside.txt', path.join(source, 'escape'), 'file');
      await assert.rejects(asar.createPackage(source, path.join(temporary, 'escape.asar')), /links out of the package/);
      fs.rmSync(path.join(source, 'escape'));
      fs.symlinkSync(path.join(temporary, 'outside.txt'), path.join(source, 'absolute-escape'), 'file');
      await assert.rejects(asar.createPackage(source, path.join(temporary, 'absolute-escape.asar')), /links out of the package/);
      await assert.rejects(asar.createPackageFromStreams(path.join(temporary, 'stream-escape.asar'), [{ path: 'escape', type: 'link', stat: fs.lstatSync(path.join(source, 'absolute-escape')), unpacked: false, symlink: path.join(temporary, 'outside.txt') }]), /links out of the package/);
    }
    const filesystemModule = loadWithPath(projectRequire.resolve('@electron/asar/lib/filesystem'), path.win32);
    const windowsFilesystem = new filesystemModule.Filesystem('C:\\archive');
    for (const target of ['..\\outside.txt', 'C:\\outside.txt', 'D:\\outside.txt', '\\\\server\\share\\outside.txt']) {
      assert.throws(() => windowsFilesystem.insertLink('C:\\archive\\escape', false, 'C:\\archive', target, 'C:\\archive'), /links out of the package/);
    }
    assert.equal(windowsFilesystem.insertLink('C:\\archive\\internal', false, 'C:\\archive', 'C:\\archive\\..name', 'C:\\archive'), '..name');
    return { files: files.size, entries: entries.length, archives: ['default', 'unpacked', 'filtered', 'streams'], symlinks: links, windowsLinkAssertions: 5, skipped };
  } finally {
    asar.uncacheAll();
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

function inspectArchive(archive) {
  const asar = projectRequire('@electron/asar');
  const manifest = JSON.parse(asar.extractFile(archive, 'package.json').toString('utf8'));
  assert.equal(manifest.name, 'marx');
  assert.equal(manifest.main, './out/main/index.js');
  const entries = archiveEntries(asar, archive);
  for (const required of ['package.json', 'out/main/index.js', 'out/preload/index.js', 'out/renderer/index.html']) assert.ok(entries.includes(required), `Packaged app is missing ${required}.`);
  assert.ok(!entries.some(entry => /(?:^|\/)(?:src|tests|docs|node_modules)(?:\/|$)|\.(?:map|tsbuildinfo)$/.test(entry)), 'Sources, tests, documentation, development modules, or maps leaked into app.asar.');
  const inventory = entries.map(entry => {
    const stat = asar.statFile(archive, entry, false);
    if ('files' in stat) return { path: entry, type: 'directory' };
    if ('link' in stat) return { path: entry, type: 'link', target: stat.link };
    const data = asar.extractFile(archive, entry);
    const local = path.join(project, entry);
    if (entry.startsWith('out/')) assert.deepEqual(data, fs.readFileSync(local), `Packaged bytes differ from the current build: ${entry}`);
    return { path: entry, type: 'file', bytes: data.length, sha256: crypto.createHash('sha256').update(data).digest('hex'), unpacked: Boolean(stat.unpacked) };
  });
  const built = fs.readdirSync(path.join(project, 'out'), { recursive: true, withFileTypes: true }).filter(entry => entry.isFile()).map(entry => path.relative(project, path.join(entry.parentPath, entry.name)).replaceAll('\\', '/')).filter(entry => !/\.(?:map|tsbuildinfo)$/.test(entry));
  for (const entry of built) assert.ok(entries.includes(entry), `A compiled asset was omitted: ${entry}`);
  return { archive, manifest, inventory };
}

function run(executable, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd: project, stdio: 'inherit', ...options });
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`${path.basename(executable)} failed (${signal || code}).`)));
  });
}

function displayCommand(executable, args) {
  return process.platform === 'linux' && !process.env.DISPLAY ? { executable: 'xvfb-run', args: ['-a', executable, ...args] } : { executable, args };
}

async function launchPackagedApp(binary, directory) {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  const profile = path.join(directory, 'launch-profile');
  fs.mkdirSync(profile);
  const command = displayCommand(binary, [...(process.getuid?.() === 0 ? ['--no-sandbox'] : []), `--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1']);
  const env = { ...process.env, XDG_CONFIG_HOME: profile };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(command.executable, command.args, { env, detached: true, stdio: ['ignore', 'ignore', 'pipe'] });
  let diagnostics = '';
  let spawnError;
  child.once('error', error => { spawnError = error; });
  child.stderr.on('data', value => { diagnostics = (diagnostics + value).slice(-16_000); });
  let socket;
  try {
    const deadline = Date.now() + 20_000;
    let target;
    while (!target && Date.now() < deadline) {
      if (spawnError) throw spawnError;
      try { const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(500) })).json(); target = targets.find(item => item.type === 'page'); } catch {}
      if (!target) await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(target, `Packaged application did not open a page. ${diagnostics}`);
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
    let id = 0;
    const pending = new Map();
    socket.addEventListener('message', event => { const value = JSON.parse(event.data); const resolve = pending.get(value.id); if (resolve) { pending.delete(value.id); resolve(value); } });
    const evaluate = expression => new Promise((resolve, reject) => {
      const request = ++id;
      const timer = setTimeout(() => { pending.delete(request); reject(new Error('The packaged renderer stopped responding.')); }, 3000);
      pending.set(request, result => { clearTimeout(timer); resolve(result); });
      socket.send(JSON.stringify({ id: request, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
    });
    let snapshot;
    while (Date.now() < deadline) {
      const result = await evaluate('({ title: document.title, url: location.href, navigation: Array.from(document.querySelectorAll(".nav-item")).map(item => item.textContent.trim()), hasApi: Boolean(window.marx?.workbench?.bootstrap), width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth })');
      snapshot = result.result?.result?.value;
      if (snapshot?.navigation?.includes('Workbench')) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(snapshot?.title, 'Marx');
    assert.ok(snapshot.navigation.includes('Workbench'));
    assert.equal(snapshot.hasApi, true);
    assert.ok(snapshot.url.includes('/resources/app.asar/out/renderer/index.html'));
    assert.ok(snapshot.scrollWidth <= snapshot.width);
    return { binary, snapshot };
  } finally {
    socket?.close();
    if (child.pid) { try { process.kill(-child.pid, 'SIGTERM'); } catch {} }
  }
}

async function verifyPackage(options) {
  assert.equal(process.platform, 'linux', 'The executable package gate currently targets Linux. Portable filter and ASAR checks also run on macOS and Windows.');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'marx-packaging-'));
  const electron = projectRequire('electron');
  const electronDist = path.dirname(electron);
  const expectedElectron = packageInfo(projectRequire, 'electron').version;
  await run(process.execPath, [path.join(packageInfo(projectRequire, 'electron-vite').directory, 'bin', 'electron-vite.js'), 'build']);
  await run(process.execPath, [projectRequire.resolve('electron-builder/out/cli/cli.js'), '--linux', `--${process.arch}`, '--dir', '--publish', 'never', `--config.directories.output=${directory}`, `--config.electronDist=${electronDist}`, '--config.npmRebuild=false'], { env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' } });
  const unpacked = path.join(directory, process.arch === 'x64' ? 'linux-unpacked' : `linux-${process.arch}-unpacked`);
  assert.equal(fs.readFileSync(path.join(unpacked, 'version'), 'utf8').trim(), expectedElectron);
  const archive = inspectArchive(path.join(unpacked, 'resources', 'app.asar'));
  fs.writeFileSync(path.join(directory, 'inventory.json'), JSON.stringify(archive, null, 2));
  const result = { directory, electronVersion: expectedElectron, archive: archive.archive, inventory: path.join(directory, 'inventory.json') };
  if (options.launch) result.launch = await launchPackagedApp(path.join(unpacked, 'marx'), directory);
  if (options.acceptance) {
    const harness = path.join(directory, 'acceptance', 'scripts', 'verify-cli.cjs');
    fs.mkdirSync(path.dirname(harness), { recursive: true });
    fs.mkdirSync(path.join(directory, 'acceptance', 'docs'));
    fs.copyFileSync(path.join(project, 'scripts', 'verify-cli.cjs'), harness);
    const command = displayCommand(electron, [...(process.getuid?.() === 0 ? ['--no-sandbox'] : []), harness]);
    const env = { ...process.env, MARX_ACCEPTANCE_BUNDLE: archive.archive };
    delete env.ELECTRON_RUN_AS_NODE;
    await run(command.executable, command.args, { env });
    result.acceptance = 'passed against packaged app.asar';
  }
  return result;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('Usage: bun run verify:packaging [--package [--launch] [--acceptance]] [--archive path/to/app.asar]\nDefault: verify patched dependencies, portable file filters and ASAR preservation.\n--package: build and package Linux into a new temporary directory, then inventory its archive.\n--launch: launch the unpacked executable with an isolated profile (uses Xvfb without DISPLAY).\n--acceptance: run the synthetic Electron workflow against the packaged archive.\n--archive: inspect an existing archive against the current compiled output.');
    return;
  }
  const options = { package: false, launch: false, acceptance: false, archive: null };
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === '--package') options.package = true;
    else if (argument === '--launch') options.launch = true;
    else if (argument === '--acceptance') options.acceptance = true;
    else if (argument === '--archive' && args[index + 1]) options.archive = path.resolve(args[++index]);
    else throw new Error(`Unknown or incomplete option ${argument}. Use --help.`);
  }
  assert.ok(options.package || !(options.launch || options.acceptance), '--launch and --acceptance require --package.');
  assert.ok(!(options.package && options.archive), 'Choose --package or --archive.');
  const result = { result: 'passed', dependencies: verifyDependencies(), filters: verifyFileMatchers(), asar: await verifyAsar() };
  if (options.archive) result.archive = inspectArchive(options.archive);
  if (options.package) result.package = await verifyPackage(options);
  console.log(JSON.stringify(result, null, 2));
}

module.exports = { verifyDependencies, verifyFileMatchers, verifyAsar, inspectArchive, verifyPackage };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
