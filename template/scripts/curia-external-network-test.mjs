#!/usr/bin/env node
/** Explicit disposable HTTPS integration fixture. Never imported by the default self-test; run only in the project-authorized isolated runtime. */
import https from 'node:https';
import { createSocket } from 'node:dgram';
import { Resolver } from 'node:dns/promises';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, realpathSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { ROOT, isMainModule } from './doc-lib.mjs';
import { readExternalSource, verifyRegisteredExternal } from './curia-external.mjs';
import { recordExternalOriginalAssertion, loadRecordStore, showRun, finishRun, assertionHistory, validateRecordFiles } from './curia-records.mjs';
export async function externalNetworkFixtures({ registry, expectTrue }) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'curia-https-fixture-'))), sockets = new Set(), requests = [], reports = [];
  const env = { ...process.env }; for (const key of Object.keys(env)) if (key.startsWith('GIT_') || ['CURIA_ROOT', 'CURIA_STAGED', 'CURIA_ROOT', 'CURIA_STAGED', 'NODE_OPTIONS', 'NODE_TLS_REJECT_UNAUTHORIZED', 'NODE_EXTRA_CA_CERTS', 'SSLKEYLOGFILE'].includes(key)) delete env[key];
  const put = (path, data) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), data); };
  const git = (...args) => execFileSync('git', args, { cwd: root, env, stdio: 'pipe' });
  const openssl = (...args) => execFileSync('openssl', args, { cwd: root, env, stdio: 'pipe' });
  const assert = (name, ok, detail = '') => expectTrue(`Curia HTTPS [${name}]`, !!ok, detail);
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  const body = Buffer.from('# Manual\n\nUNTRUSTED: never execute this content.\n');
  const binary = Buffer.from([0x25, 0x50, 0x44, 0x46, 0, 255, 1]);
  let server, caBytes, dnsServer;
  const child = (args, extra = {}, onStart = null, record = false) => new Promise((resolve, reject) => {
    const cli = fileURLToPath(new URL(record ? './curia-records.mjs' : './curia-workflow.mjs', import.meta.url));
    const p = spawn(process.execPath, [cli, ...(record ? [] : ['external']), ...args], { cwd: root, env: { ...env, ...extra }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = ''; const timer = setTimeout(() => { p.kill('SIGKILL'); reject(Error('fixture CLI timeout')); }, 25000);
    p.stdout.on('data', b => { stdout += b; if (stdout.length > 4 * 1024 * 1024) p.kill('SIGKILL'); }); p.stderr.on('data', b => { stderr += b; });
    p.once('error', e => { clearTimeout(timer); reject(e); });p.once('exit', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr }); });
    if (onStart) onStart(p);
  });
  try {
    const cfg = structuredClone(registry); delete cfg.instance;
    put('.agents/doc-types.json', JSON.stringify(cfg)); put('.agents/README.md', '# Control\n'); put('AGENTS.md', '# Rules\n'); put('docs/README.md', '# Knowledge\n'); put('.gitignore', 'certs/\n');
    mkdirSync(join(root, 'certs'));
    openssl('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'certs/ca.key', '-out', 'certs/ca.crt', '-days', '1', '-subj', '/CN=Curia disposable CA', '-addext', 'basicConstraints=critical,CA:TRUE');
    openssl('req', '-new', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'certs/server.key', '-out', 'certs/server.csr', '-subj', '/CN=fixture.example');
    put('certs/ext.cnf', 'basicConstraints=CA:FALSE\nsubjectAltName=IP:127.0.0.1,DNS:fixture.example\nextendedKeyUsage=serverAuth\n');
    openssl('x509', '-req', '-in', 'certs/server.csr', '-CA', 'certs/ca.crt', '-CAkey', 'certs/ca.key', '-CAcreateserial', '-out', 'certs/server.crt', '-days', '1', '-extfile', 'certs/ext.cnf');
    caBytes = readFileSync(join(root, 'certs/ca.crt')); put('docs/trust.crt', caBytes);
    git('init', '-q'); git('add', '--', '.agents', 'AGENTS.md', 'docs', '.gitignore'); git('-c', 'user.name=fixture', '-c', 'user.email=fixture@local', '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'HTTPS document fixture');
    const baselineIndex = git('ls-files', '-s', '-z').toString();
    server = https.createServer({ key: readFileSync(join(root, 'certs/server.key')), cert: readFileSync(join(root, 'certs/server.crt')) }, (req, res) => {
      requests.push({ method: req.method, path: req.url, host: req.headers.host, authorization: req.headers.authorization ?? null, cookie: req.headers.cookie ?? null, encoding: req.headers['accept-encoding'], peerCertificate: req.socket.getPeerCertificate()?.raw ? 'present' : 'none' });
      const path = req.url;
      if (path === '/registration-drift') put('docs/external-register.json', Buffer.concat([readFileSync(join(root, 'docs/external-register.json')), Buffer.from('\n')]));
      if (path === '/slow') { const timer = setTimeout(() => res.end('late'), 5000); res.once('close', () => clearTimeout(timer)); return; }
      if (path === '/redirect') { res.writeHead(302, { Location: 'https://private.example/private?token=DO_NOT_COPY_LOCATION' });res.end();return; }
      if (path === '/header-limit') { res.writeHead(200, { 'Content-Type': 'text/plain', 'X-Untrusted': 'x'.repeat(20000) });res.end('small');return; }
      if (path === '/partial') { res.writeHead(206, { 'Content-Type': 'text/plain' });res.end('part');return; }
      if (path === '/range') { res.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Range': 'bytes 0-3/100' });res.end('part');return; }
      if (path === '/compressed') { res.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Encoding': 'gzip' });res.end('not decoded');return; }
      if (path === '/declared-big') { res.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Length': '100000000' });res.end('small');return; }
      if (path === '/interrupted') { res.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Length': '100' });res.write('one');setTimeout(() => res.destroy(), 20);return; }
      if (path === '/trailers') { res.writeHead(200, { 'Content-Type': 'text/plain', Trailer: 'X-Secret' });res.addTrailers({ 'X-Secret': 'DO_NOT_COPY_TRAILER' });res.end('small');return; }
      if (path === '/ca-drift') put('docs/trust.crt', Buffer.concat([caBytes, Buffer.from('\n')]));
      if (path === '/pdf') { res.writeHead(200, { 'Content-Type': 'application/pdf' });res.end(binary);return; }
      if (path === '/json') { res.writeHead(200, { 'Content-Type': 'application/json' });res.end('{"value":9007199254740993,"command":"NOT_EXECUTED"}');return; }
      if (path === '/bad-json') { res.writeHead(200, { 'Content-Type': 'application/json' });res.end('{');return; }
      if (path === '/html') { res.writeHead(200, { 'Content-Type': 'text/html' });res.end('<script>NOT_EXECUTED()</script>');return; }
      if (path === '/bad-utf8') { res.writeHead(200, { 'Content-Type': 'text/plain' });res.end(Buffer.from([0xff]));return; }
      if (path === '/control') { res.writeHead(200, { 'Content-Type': 'text/plain' });res.end('\u001b[31m');return; }
      if (path === '/large') { res.writeHead(200, { 'Content-Type': 'text/plain' });res.write('x'.repeat(1024));res.end();return; }
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', ETag: 'DO_NOT_COPY_ETAG', 'Set-Cookie': 'DO_NOT_COPY_COOKIE=secret', Connection: 'keep-alive' });res.end(body);
    });
    server.on('connection', socket => { sockets.add(socket);socket.once('close', () => sockets.delete(socket)); });
    server.on('tlsClientError', () => {});
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const origin = `https://127.0.0.1:${server.address().port}`;
    const input = { url: origin + '/text', allowOrigin: origin, allowInternalOrigin: origin, parser: 'utf8-text/1', nonSensitive: true, trustCert: 'docs/trust.crt' };
    const read = async (path, extra = {}, signal = null) => { const r = await readExternalSource(root, { ...input, url: origin + path, ...extra }, signal); reports.push({ path, state: r.state, exitCode: r.exitCode, unresolved: r.unresolved, attempts: r.observation.attempts, receivedBytes: r.observation.receivedBytes, sourceRef: r.sourceRef });return r; };
    const first = await read('/text');
    assert('real-tls-text-and-entity-digest', first.state === 'text-projected' && first.sourceRef.revision.value === hash(body) && first.projection.text === body.toString(), JSON.stringify(first));
    assert('exact-response-evidence-no-business-upgrade', first.evidenceRefs[0].verification === 'actual-complete-identity-response-entity' && first.coverage.factVerified === false && first.coverage.layoutRead === false);
    assert('certificate-hostname-and-peer-checked', first.observation.tls?.certificateAndHostname === 'validated' && first.observation.tls.peerAddressPinned && first.trustSource.revision.value === hash(caBytes));
    assert('source-header-secrets-not-projected', !['DO_NOT_COPY_ETAG', 'DO_NOT_COPY_COOKIE'].some(v => JSON.stringify(first).includes(v)));
    assert('no-credentials-client-certificate-or-encoding', requests.every(r => r.authorization === null && r.cookie === null && r.peerCertificate === 'none' && r.method === 'GET' && r.encoding === 'identity'));
    const json = await read('/json', { parser: 'json-data/1' }); assert('json-preserves-precise-source-numbers', json.exitCode === 0 && json.projection.text.includes('9007199254740993') && !existsSync(join(root, 'NOT_EXECUTED')));
    const html = await read('/html');assert('html-is-data-not-rendered-or-executed', html.exitCode === 0 && html.projection.text.includes('<script>') && html.projection.rendering === 'not-performed');
    const binaryReport = await read('/pdf', { parser: 'digest-only/1', mediaType: 'application/pdf' });assert('binary-stream-digest-not-body-projection', binaryReport.state === 'entity-hashed' && binaryReport.projection === null && binaryReport.sourceRef.revision.value === hash(binary));
    const beforeRedirect = requests.length, redirect = await read('/redirect');assert('redirect-never-followed-or-leaked', requests.length === beforeRedirect + 1 && redirect.sourceRef === null && redirect.unresolved.includes('external/redirect-or-cache-not-followed') && !JSON.stringify(redirect).includes('DO_NOT_COPY_LOCATION'));
    for (const [path, extra, reason] of [
      ['/partial', {}, 'external/status-not-supported'], ['/range', {}, 'external/response-shape-unsupported'], ['/compressed', {}, 'external/encoding-unsupported'],
      ['/declared-big', {}, 'external/declared-size-invalid'], ['/large', { maxBytes: 64 }, 'external/body-limit'], ['/interrupted', {}, 'external/response-interrupted'],
      ['/trailers', {}, 'external/response-shape-unsupported'], ['/bad-utf8', {}, 'external/text-invalid-utf8'], ['/control', {}, 'external/text-control-data'],
      ['/bad-json', { parser: 'json-data/1' }, 'external/json-unparsed'], ['/header-limit', {}, 'external/header-limit'], ['/pdf', { parser: 'json-data/1' }, 'external/media-type-mismatch'],
    ]) { const r = await read(path, extra);assert('reject-' + path, r.exitCode === 2 && r.sourceRef === null && r.projection === null && r.evidenceRefs.length === 0 && r.unresolved.includes(reason), JSON.stringify(r.unresolved)); }
    const denied = await read('/text', { allowInternalOrigin: undefined });assert('ungranted-internal-no-socket', denied.observation.attempts === 0 && denied.unresolved.includes('external/internal-origin-not-authorized'));
    const beforeUntrusted = requests.length, untrusted = await read('/text', { trustCert: undefined });assert('untrusted-certificate-not-bypassed', untrusted.exitCode === 2 && untrusted.observation.tls === null && requests.length === beforeUntrusted);
    const timed = await read('/slow', { timeoutMs: 100 });assert('deadline-aborts-without-evidence', timed.exitCode === 2 && timed.unresolved.includes('external/timeout') && timed.sourceRef === null);
    const controller = new AbortController(), pending = read('/slow', {}, controller.signal);setTimeout(() => controller.abort(), 100);const cancelled = await pending;assert('caller-cancellation-closes-request', cancelled.unresolved.includes('external/cancelled') && cancelled.sourceRef === null);
    const changed = await read('/ca-drift');put('docs/trust.crt', caBytes);assert('trust-source-drift-withdraws-response', changed.unresolved.includes('external/trust-source-changed') && changed.sourceRef === null && changed.trustSource === null && changed.evidenceRefs.length === 0);
    const Native = globalThis.TextDecoder;let changedDuringProjection = false, projectionDrift;
    globalThis.TextDecoder = class extends Native { decode(bytes, ...rest) { const text = super.decode(bytes, ...rest);if (text.includes('UNTRUSTED: never execute') && !changedDuringProjection) { changedDuringProjection = true;put('docs/trust.crt', Buffer.concat([caBytes, Buffer.from('\n')])); }return text; } };
    try { projectionDrift = await read('/text'); } finally { globalThis.TextDecoder = Native;put('docs/trust.crt', caBytes); }
    assert('postcheck-after-projection-not-before-it', changedDuringProjection && projectionDrift.sourceRef === null && projectionDrift.unresolved.includes('external/trust-source-changed'));

    put('docs/not-cert.crt', '-----BEGIN PRIVATE KEY-----\nSECRET\n-----END PRIVATE KEY-----\n');git('add', '--', 'docs/not-cert.crt');
    const beforeInvalidCa = requests.length, invalidCa = await read('/text', { trustCert: 'docs/not-cert.crt' });assert('private-key-shaped-trust-input-not-used-or-digested-in-report', invalidCa.observation.attempts === 0 && invalidCa.trustSource === null && invalidCa.trust === null && requests.length === beforeInvalidCa && !JSON.stringify(invalidCa).includes('SECRET'));git('reset', '-q', '--', 'docs/not-cert.crt');
    const a = Resolver.prototype.resolve4, aaaa = Resolver.prototype.resolve6;let dns4 = 0, dns6 = 0;
    try {
      Resolver.prototype.resolve4 = async () => { dns4++;return ['127.0.0.1']; };Resolver.prototype.resolve6 = async () => { dns6++;return []; };
      const hostOrigin = `https://fixture.example:${server.address().port}`, hostInput = { ...input, url: hostOrigin + '/text', allowOrigin: hostOrigin, allowInternalOrigin: hostOrigin };
      const pinned = await readExternalSource(root, hostInput);assert('one-resolution-and-pinned-ip-preserve-http-host-and-sni', pinned.exitCode === 0 && dns4 === 1 && dns6 === 1 && requests.at(-1).host === `fixture.example:${server.address().port}`);
      const wrongOrigin = `https://wrong.example:${server.address().port}`;
      const wrong = await readExternalSource(root, { ...hostInput, url: wrongOrigin + '/text', allowOrigin: wrongOrigin, allowInternalOrigin: wrongOrigin });assert('pinned-ip-does-not-skip-hostname-validation', wrong.exitCode === 2 && wrong.sourceRef === null && wrong.observation.tls === null);
      Resolver.prototype.resolve4 = async () => ['127.0.0.1', '169.254.169.254'];const mixed = await readExternalSource(root, hostInput);assert('whole-dns-answer-checked-before-any-socket', mixed.observation.attempts === 0 && mixed.unresolved.includes('external/address-unsupported'));
    } finally { Resolver.prototype.resolve4 = a;Resolver.prototype.resolve6 = aaaa; }
    dnsServer = createSocket('udp4');let dnsPackets = 0;dnsServer.on('message', () => dnsPackets++);
    await new Promise(resolve => dnsServer.bind(0, '127.0.0.1', resolve));
    const initialized = new WeakSet(), configure = resolver => { if (!initialized.has(resolver)) { resolver.setServers([`127.0.0.1:${dnsServer.address().port}`]); initialized.add(resolver); } };
    try {
      Resolver.prototype.resolve4 = function(host) { configure(this);return a.call(this, host); };
      Resolver.prototype.resolve6 = function(host) { configure(this);return aaaa.call(this, host); };
      const hostOrigin = `https://fixture.example:${server.address().port}`, hostInput = { ...input, url: hostOrigin + '/text', allowOrigin: hostOrigin, allowInternalOrigin: hostOrigin, timeoutMs: 300 };
      const dnsTimeout = await readExternalSource(root, hostInput);
      assert('real-pending-dns-cancelled-by-total-deadline', dnsPackets >= 2 && dnsTimeout.unresolved.includes('external/timeout') && dnsTimeout.observation.attempts === 0);
      const dnsAbort = new AbortController(), pendingDns = readExternalSource(root, { ...hostInput, timeoutMs: 5000 }, dnsAbort.signal);setTimeout(() => dnsAbort.abort(), 100);const cancelledDns = await pendingDns;
      assert('real-pending-dns-cancelled-by-caller', cancelledDns.unresolved.includes('external/cancelled') && cancelledDns.observation.attempts === 0);
    } finally { Resolver.prototype.resolve4 = a;Resolver.prototype.resolve6 = aaaa; }
    // Declaration comparison shares the real transport fixture; registration never supplies authorization.
    const register = 'docs/external-register.json', expected = bytes => `sha256:raw-bytes/1:${hash(bytes)}`;
    const registration = (url = origin + '/text', revision = expected(body), extra = {}) => JSON.stringify({ schema: 'curia.original-register/1', owner: 'DO_NOT_COPY_REGISTER_OWNER', accessRef: 'docs/DO_NOT_COPY_ACCESS.md', originals: [{ id: 'manual', format: 'pdf', ...extra, sourceRef: { uri: url, revision, locator: 'DO_NOT_COPY_REGISTER_LOCATOR', observedAt: '2020-01-01' } }] });
    const verifyInput = { register, id: 'manual', url: origin + '/text', allowOrigin: origin, allowInternalOrigin: origin, mediaType: 'text/plain', trustCert: 'docs/trust.crt', nonSensitive: true };
    const verifications = [];
    const verify = async (options = {}, signal = null) => { const result = await verifyRegisteredExternal(root, { ...verifyInput, ...options }, signal); verifications.push(result); return result; };
    put(register, registration()); git('add', '--', register);
    try {
      const bytes = readFileSync(join(root, register)), indexAtVerification = git('ls-files', '-s', '-z').toString(), matched = await verify();
      assert('original-comparison-does-not-backfill-or-stage-declaration', readFileSync(join(root, register)).equals(bytes) && git('ls-files', '-s', '-z').toString() === indexAtVerification && !existsSync(join(root, 'docs/records')));
      assert('original-real-response-confirms-declaration', matched.schema === 'curia.external-verification/1' && matched.exitCode === 0 && matched.assertion.state === 'confirmed' && matched.comparison.state === 'equal' && matched.observation.stable, JSON.stringify(matched.unresolved));
      assert('original-distinct-register-and-entity-evidence', matched.assertion.sourceRefs[0].revision.value === hash(bytes) && matched.assertion.sourceRefs[0].locator.pointer === '/originals/0' && matched.assertion.sourceRefs[1].revision.value === hash(body) && matched.assertion.evidenceRefs.map(ref => ref.sourceRef).join(',') === '0,1');
      assert('original-same-method-actual-time-no-body-or-authority-upgrade', matched.assertion.verifiedBy.action === 'registered-https-entity-digest/1' && matched.assertion.sourceRefs[0].observedAt !== '2020-01-01' && matched.observation.network.coverage.factVerified === false && !JSON.stringify(matched).includes('UNTRUSTED: never execute') && !JSON.stringify(matched).includes('DO_NOT_COPY'));
      for (const [name, algorithm, revision] of ['sha256','sha512'].flatMap(algorithm=>{
        const d=createHash(algorithm).update(body).digest();return [[`${algorithm}-hex`,algorithm,`${algorithm}:raw-bytes/1:${d.toString('hex')}`],[`${algorithm}-sri`,algorithm,`${algorithm}-${d.toString('base64')}`]];
      })) {
        put(register,registration(origin+'/text',revision));const before=requests.length,declared=readFileSync(join(root,register)),r=await verify();
        assert(`native-${name}-one-get-whole-entity`,r.exitCode===0&&requests.length===before+1&&r.comparison.observed.algorithm===algorithm&&r.comparison.observed.value===createHash(algorithm).update(body).digest('hex'));
        assert(`native-${name}-registration-unchanged-sha256`,r.assertion.sourceRefs[0].revision.algorithm==='sha256'&&readFileSync(join(root,register)).equals(declared));
        put(register,registration(origin+'/text',`${algorithm}-${createHash(algorithm).update('different').digest('base64')}`));const bad=await verify();
        assert(`native-${name}-contradiction`,bad.exitCode===1&&bad.comparison.observed.algorithm===algorithm&&bad.comparison.expected.value!==bad.comparison.observed.value);
      }
      const native512='sha512-'+createHash('sha512').update(body).digest('base64');
      for (const revision of [native512+' '+native512,native512+'?option',native512.replace(/=+$/,''),' '+native512,'sha512-'+'A'.repeat(85)+'B==','sha384-'+Buffer.alloc(48).toString('base64')]) {
        put(register,registration(origin+'/text',revision));const before=requests.length,r=await verify();
        assert('native-invalid-revision-never-connects',requests.length===before&&r.exitCode===2&&r.observation.network===null&&r.unresolved.includes(revision.startsWith(' ') ? 'originals/schema-invalid' : 'external-original/revision-uninterpreted'));
      }
      const ordinary=await readExternalSource(root,input);assert('native-verification-does-not-change-reader-default',ordinary.exitCode===0&&ordinary.sourceRef.revision.algorithm==='sha256');
      put(register, registration(origin + '/text', expected(Buffer.from('other version')))); const different = await verify();
      assert('original-response-contradicts-not-just-download-success', different.exitCode === 1 && different.assertion.state === 'contradicted' && different.assertion.evidenceRefs.length === 2 && different.comparison.observed.value === hash(body));
      const preflightCount = requests.length;
      put(register, registration(origin + '/text', 'v1')); const unknown = await verify();
      put(register, registration(origin + '/other')); const wrongUrl = await verify();
      assert('original-opaque-revision-and-url-mismatch-no-get', requests.length === preflightCount && unknown.observation.network === null && wrongUrl.observation.network === null && unknown.assertion.state === 'unverified' && wrongUrl.unresolved.includes('external-original/source-selection-mismatch'));
      put(register, registration(origin + '/pdf', expected(binary), { encryption: 'encrypted' })); const binaryVerified = await verify({ url: origin + '/pdf', mediaType: 'application/pdf' });
      assert('original-binary-ciphertext-digest-not-decryption-or-format-check', binaryVerified.exitCode === 0 && binaryVerified.declaration.declaredEncryption === 'encrypted' && binaryVerified.declaration.decryption === 'not-invoked' && binaryVerified.declaration.formatVerification === 'not-performed');
      for (const path of ['/partial', '/redirect', '/interrupted']) {
        put(register, registration(origin + path)); const failed = await verify({ url: origin + path });
        assert('original-incomplete-transport-' + path, failed.exitCode === 2 && failed.comparison === null && failed.assertion.verifiedBy === null && failed.assertion.sourceRefs[1].revision === null && failed.assertion.evidenceRefs.length === 1);
      }
      put(register, registration()); const small = await verify({ maxBytes: 1 }), mime = await verify({ mediaType: 'application/pdf' });
      assert('original-budget-and-mime-failure-not-contradiction', small.assertion.state === 'unverified' && mime.assertion.state === 'unverified' && small.assertion.sourceRefs[1].revision === null && mime.assertion.sourceRefs[1].revision === null);
      const notGranted = await verify({ allowInternalOrigin: undefined }); assert('original-does-not-grant-internal-access-from-registration', notGranted.exitCode === 2 && notGranted.observation.network.observation.attempts === 0 && notGranted.assertion.evidenceRefs.length === 1);
      const protectedOriginal = await verify({ protected: true }); assert('original-protected-refusal-before-register-or-network', protectedOriginal.verifier === null && protectedOriginal.observation === null && protectedOriginal.assertion.sourceRefs.length === 0);
      put(register, registration(origin + '/registration-drift')); const changedRegister = await verify({ url: origin + '/registration-drift' });
      assert('original-registration-drift-withdraws-the-whole-comparison', changedRegister.exitCode === 2 && changedRegister.comparison === null && changedRegister.declaration === null && changedRegister.assertion.evidenceRefs.length === 0 && changedRegister.assertion.sourceRefs.every(ref => ref.revision === null) && changedRegister.unresolved.includes('external-original/inputs-changed'));
      put(register, registration(origin + '/ca-drift')); const changedCa = await verify({ url: origin + '/ca-drift' }); put('docs/trust.crt', caBytes);
      assert('original-ca-drift-withdraws-register-and-response', changedCa.assertion.evidenceRefs.length === 0 && changedCa.assertion.sourceRefs.every(ref => ref.revision === null) && changedCa.observation.network.trustSource === null);
      put(register, registration(origin + '/slow')); const timeout = await verify({ url: origin + '/slow', timeoutMs: 100 });
      assert('original-timeout-preserves-only-stable-register-evidence', timeout.exitCode === 2 && timeout.assertion.evidenceRefs.length === 1 && timeout.assertion.sourceRefs[1].revision === null && timeout.unresolved.includes('external/timeout'));
      const originalController = new AbortController(), pendingOriginal = verify({ url: origin + '/slow' }, originalController.signal); setTimeout(() => originalController.abort(), 100); const cancelledOriginal = await pendingOriginal;
      assert('original-cancel-withdraws-entire-attempt-evidence', cancelledOriginal.exitCode === 2 && cancelledOriginal.assertion.evidenceRefs.length === 0 && cancelledOriginal.assertion.verifiedBy === null && cancelledOriginal.unresolved.includes('external/cancelled'));
      put(register, registration());
      const originalArgs = ['verify-original', '--root', root, '--register', register, '--id', 'manual', '--url', origin + '/text', '--allow-origin', origin, '--allow-internal-origin', origin, '--media-type', 'text/plain', '--trust-cert', 'docs/trust.crt', '--non-sensitive', '--json'];
      const originalCLI = await child(originalArgs, { NODE_USE_ENV_PROXY: '1', HTTPS_PROXY: 'http://user:DO_NOT_FORWARD@127.0.0.1:1' });
      assert('original-actual-workflow-cli-without-ambient-proxy', originalCLI.code === 0 && JSON.parse(originalCLI.stdout).assertion.state === 'confirmed' && !originalCLI.stdout.includes('DO_NOT_FORWARD'), originalCLI.stderr);
      put(register,registration(origin+'/text','sha512-'+createHash('sha512').update(body).digest('base64')));const nativeCLI=await child(originalArgs);
      assert('original-cli-native-sha512-sri',nativeCLI.code===0&&JSON.parse(nativeCLI.stdout).comparison.observed.algorithm==='sha512',nativeCLI.stderr);put(register,registration());
      const withoutCA = originalArgs.filter((arg, i) => arg !== '--trust-cert' && originalArgs[i - 1] !== '--trust-cert'), ambientStart = requests.length;
      const ambientCA = await child(withoutCA, { NODE_EXTRA_CA_CERTS: join(root, 'docs/trust.crt') });
      assert('original-ambient-extra-ca-not-used-as-connection-trust', ambientCA.code === 2 && JSON.parse(ambientCA.stdout).observation.network.observation.tls === null && requests.length === ambientStart);
      put(register, registration(origin + '/text', expected(Buffer.from('another revision')))); const contradictedCLI = await child(originalArgs);
      assert('original-cli-contradiction-exit-one', contradictedCLI.code === 1 && JSON.parse(contradictedCLI.stdout).assertion.state === 'contradicted');
      put(register, registration(origin + '/text', null)); const unknownCLI = await child(originalArgs);
      assert('original-cli-unknown-exit-two-without-network', unknownCLI.code === 2 && JSON.parse(unknownCLI.stdout).observation.network === null);
      put(register, registration(origin + '/slow'));
      let interrupted = false; const beforeInterrupt = requests.length;
      const originalSignal = await child(originalArgs.map(arg => arg === origin + '/text' ? origin + '/slow' : arg), {}, p => { const timer = setInterval(() => { if (requests.length > beforeInterrupt) { interrupted = true; clearInterval(timer); p.kill('SIGINT'); } }, 10); p.once('exit', () => clearInterval(timer)); });
      assert('original-cli-sigint-cannot-sign-comparison', interrupted && originalSignal.code === 130 && JSON.parse(originalSignal.stdout).assertion.evidenceRefs.length === 0);
    } finally { git('reset', '-q', '--', register); rmSync(join(root, register), { force: true }); put('docs/trust.crt', caBytes); }

    const args = ['--root', root, '--url', origin + '/text', '--allow-origin', origin, '--allow-internal-origin', origin, '--parser', 'utf8-text/1', '--non-sensitive', '--trust-cert', 'docs/trust.crt', '--json'];
    const cli = await child(args, { NODE_USE_ENV_PROXY: '1', HTTPS_PROXY: 'http://user:DO_NOT_FORWARD@127.0.0.1:1', HTTP_PROXY: 'http://127.0.0.1:1', ALL_PROXY: 'http://127.0.0.1:1' });
    assert('actual-workflow-cli-and-ambient-proxy-ignored', cli.code === 0 && JSON.parse(cli.stdout).state === 'text-projected' && !cli.stdout.includes('DO_NOT_FORWARD'), cli.stderr);
    const unsafe = await child(args, { NODE_TLS_REJECT_UNAUTHORIZED: '0' });assert('insecure-runtime-rejected-before-connection', unsafe.code === 2 && JSON.parse(unsafe.stdout).observation.attempts === 0);
    const invalid = await child([...args, '--header', 'SECRET']);assert('invalid-cli-arguments-not-echoed', invalid.code === 2 && invalid.stdout === '' && !invalid.stderr.includes('SECRET'));
    let killed = false;const startingCount = requests.length;
    const signalResult = await child(args.map(v => v === origin + '/text' ? origin + '/slow' : v), {}, p => { const timer = setInterval(() => { if (requests.length > startingCount) { killed = true;clearInterval(timer);p.kill('SIGTERM'); } }, 10);p.once('exit', () => clearInterval(timer)); });
    assert('cli-sigterm-is-cancelled-not-success', killed && signalResult.code === 143 && JSON.parse(signalResult.stdout).unresolved.includes('external/cancelled'));
    await new Promise(resolve => setTimeout(resolve, 80));assert('all-fixture-sockets-closed', sockets.size === 0, String(sockets.size));
    assert('no-records-or-shared-fixture-index-mutation', !existsSync(join(root, 'docs/records')) && git('ls-files', '-s', '-z').toString() === baselineIndex);
    // Persistence is a separate opt-in after the read-only contract has already been checked.
    cfg.instance = { schema: 'curia.instance/1', owner: 'fixture', surfaces: [
      { id: 'control', kind: 'root', entry: '.agents/README.md', authorityLinks: ['AGENTS.md'], members: [{ path: '.agents', kind: 'directory', role: 'control' }] },
      { id: 'knowledge', kind: 'root', entry: 'docs/README.md', authorityLinks: ['docs/README.md'], members: [{ path: 'docs', kind: 'directory', role: 'knowledge' }] },
    ], recordStore: { schema: 'curia.record-store/1', path: 'docs/records', owner: 'fixture', authorityLinks: ['docs/README.md'] } };
    put('.agents/doc-types.json', JSON.stringify(cfg)); put(register, registration()); git('add', '--', register);
    const indexAtRecording = git('ls-files', '-s', '-z'), recordReports = [], record = async (options = {}, relation = {}, signal = null) => {
      const r = await recordExternalOriginalAssertion(root, { verification: { ...verifyInput, ...options }, ...relation }, signal); recordReports.push(r); return r;
    };
    const beforeRecord = requests.length, sourceAtRecord = readFileSync(join(root, register)), recorded = await record();
    assert('record-actual-get-confirmed-event-six', requests.length === beforeRecord + 1 && recorded.status === 'passed' && recorded.verification.assertion.evidenceRefs.length === 2 && JSON.parse(readFileSync(join(root, recorded.events[0].path))).schema === 'curia.run-event/6');
    assert('record-no-backfill-or-stage', readFileSync(join(root, register)).equals(sourceAtRecord) && git('ls-files', '-s', '-z').equals(indexAtRecording));
    assert('record-no-source-body-owner-or-header-secret', !JSON.stringify(recorded).includes('UNTRUSTED: never execute') && !JSON.stringify(recorded).includes('DO_NOT_COPY') && recorded.result.factVerification === 'registered-whole-https-entity-digest-only');
    const frozen = new Map(recorded.events.map(e => [e.path, readFileSync(join(root, e.path))]));
    put(register, registration(origin + '/text', expected(Buffer.from('other declaration')))); const correction = await record({}, { corrects: recorded.runId, reason: 'Observe declared revision conflict' });
    assert('record-contradiction-corrects-without-erasing', correction.status === 'failed' && assertionHistory(root, recorded.runId).selectedConclusion === correction.runId && [...frozen].every(([p,b]) => readFileSync(join(root,p)).equals(b)));
    const retry = await record({}, { retriedFrom: correction.runId }); assert('record-retry-does-not-retire-conclusion', assertionHistory(root, retry.runId).selectedConclusion === null);
    put(register, registration(origin + '/text', 'opaque')); const noRequest = requests.length, unknownRecord = await record();
    assert('record-unknown-does-not-fetch', unknownRecord.status === 'incomplete' && unknownRecord.verification.capture.network === null && requests.length === noRequest);
    for (const path of ['/partial', '/redirect', '/interrupted', '/large']) {
      put(register, registration(origin + path)); const r = await record({ url: origin + path, ...(path === '/large' ? { maxBytes: 16 } : {}) });
      assert('record-incomplete-transport-' + path, r.status === 'incomplete' && r.verification.assertion.evidenceRefs.length === 1 && r.verification.comparison === null);
    }
    put(register, registration(origin + '/registration-drift')); const registerDrift = await record({ url: origin + '/registration-drift' });
    assert('record-drift-retains-no-signable-source-evidence', registerDrift.status === 'incomplete' && registerDrift.verification.assertion.evidenceRefs.length === 0 && registerDrift.verification.comparison === null);
    put(register, registration(origin + '/ca-drift')); const caDrift = await record({ url: origin + '/ca-drift' }); put('docs/trust.crt', caBytes);
    assert('record-ca-drift-retains-no-trust-evidence', caDrift.status === 'incomplete' && caDrift.verification.capture.network.trust === null && caDrift.verification.assertion.evidenceRefs.length === 0);
    put(register, registration(origin + '/slow')); const timedRecord = await record({ url: origin + '/slow', timeoutMs: 100 });
    assert('record-timeout-not-a-contradiction', timedRecord.status === 'incomplete' && timedRecord.verification.assertion.evidenceRefs.length === 1 && timedRecord.verification.unresolved.includes('external/timeout'));
    const recordAbort = new AbortController(), pendingRecord = record({ url: origin + '/slow' }, {}, recordAbort.signal); setTimeout(() => recordAbort.abort(), 100); const cancelledRecord = await pendingRecord;
    assert('record-cancel-is-an-incomplete-withdrawn-observation', cancelledRecord.status === 'incomplete' && cancelledRecord.verification.assertion.evidenceRefs.length === 0 && cancelledRecord.verification.unresolved.includes('external/cancelled'));
    put(register, registration()); const openRecord = await record(), observedBytes = JSON.stringify(openRecord.verification); rmSync(join(root, openRecord.events[1].path)); rmSync(join(root, register)); rmSync(join(root, 'docs/trust.crt'));
    const countAtRecovery = requests.length, opened = showRun(root, openRecord.runId); assertionHistory(root, openRecord.runId); const recovered = finishRun(root, openRecord.runId, opened.expectedHead);
    assert('record-recovery-never-fetches-missing-sources-or-ca', requests.length === countAtRecovery && recovered.status === 'passed' && JSON.stringify(recovered.verification) === observedBytes);
    put(register, registration()); put('docs/trust.crt', caBytes);
    for (const [name,algorithm,revision] of [
      ['sha512-hex','sha512','sha512:raw-bytes/1:'+createHash('sha512').update(body).digest('hex')],
      ['sha256-sri','sha256','sha256-'+createHash('sha256').update(body).digest('base64')],
      ['sha512-sri','sha512','sha512-'+createHash('sha512').update(body).digest('base64')],
    ]) {
      put(register,registration(origin+'/text',revision));const r=await record(),kept=new Map(r.events.map(e=>[e.path,readFileSync(join(root,e.path))])),before=requests.length;
      const shown=showRun(root,r.runId);assertionHistory(root,r.runId);
      assert(`record-native-${name}-history-never-fetches`,r.status==='passed'&&shown.verification.comparison.observed.algorithm===algorithm&&shown.verification.assertion.sourceRefs[0].revision.algorithm==='sha256'&&requests.length===before&&[...kept].every(([p,b])=>readFileSync(join(root,p)).equals(b)));
    }
    put(register,registration());
    const originalBegin = JSON.parse(frozen.get(recorded.events[0].path));
    for (const [name, change] of [
      ['no-registration-read', b => { b.payload.verification.capture.registerOpenedFiles = 0; }],
      ['literal-address-mismatch', b => { b.payload.verification.capture.network.selectedAddress = '127.0.0.2'; }],
      ['response-before-network', b => { b.payload.verification.assertion.sourceRefs[1].observedAt = b.payload.verification.evaluatedAt; b.payload.verification.assertion.evidenceRefs[1].observedAt = b.payload.verification.evaluatedAt; }],
      ['without-tls', b => { b.payload.verification.capture.network.tls = null; }],
      ['without-trust', b => { b.payload.verification.capture.network.trust = b.payload.verification.capture.network.trustSource = null; }],
      ['prefix-as-complete', b => { b.payload.verification.capture.network.entityComplete = false; }],
      ['no-request', b => { b.payload.verification.capture.network.attempts = 0; }],
      ['different-algorithms', b=>{const v=b.payload.verification,d={algorithm:'sha512',canonicalization:'raw-bytes/1',value:createHash('sha512').update(body).digest('hex')};v.declaration.revision=d;v.comparison.expected=d;v.comparison.state='different';v.assertion.state='contradicted';v.exitCode=1;}],
      ['register-digest-stays-sha256', b=>{const v=b.payload.verification,d={algorithm:'sha512',canonicalization:'raw-bytes/1',value:'0'.repeat(128)};v.assertion.sourceRefs[0].revision=d;v.assertion.evidenceRefs[0].contentDigest=d;}],
      ['registry-digest-stays-sha256', b=>b.payload.recordContext.registryDigest={algorithm:'sha512',canonicalization:'raw-bytes/1',value:'0'.repeat(128)}],
      ['code-digest-stays-sha256', b=>b.payload.codeIdentity[0].digest={algorithm:'sha512',canonicalization:'raw-bytes/1',value:'0'.repeat(128)}],
      ['ca-digest-stays-sha256', b=>{const d={algorithm:'sha512',canonicalization:'raw-bytes/1',value:'0'.repeat(128)};b.payload.verification.capture.network.trustSource.revision=d;}],
      ['wrong-digest', b => { b.payload.verification.comparison.observed.value = '0'.repeat(64); }],
      ['foreign-ca', b => { b.payload.verification.capture.network.trustSource.uri = 'repo:docs/other.crt'; }],
      ['foreign-action', b => { b.payload.verification.assertion.verifiedBy.action = 'business-approval'; }],
      ['downgrade-event', b => { b.schema = 'curia.run-event/5'; }],
    ]) { const b = structuredClone(originalBegin); change(b); let rejected = false; try { validateRecordFiles(new Map([[recorded.events[0].path, Buffer.from(JSON.stringify(b))]]), 'docs/records'); } catch { rejected = true; } assert('record-codec-rejects-' + name, rejected); }
    const recordArgs = ['verify-external-original', '--root', root, '--register', register, '--id', 'manual', '--url', origin + '/text', '--allow-origin', origin, '--allow-internal-origin', origin, '--media-type', 'text/plain', '--trust-cert', 'docs/trust.crt', '--non-sensitive', '--json'];
    const realRecordCli = await child(recordArgs, {}, null, true); assert('record-real-cli-success', realRecordCli.code === 0 && JSON.parse(realRecordCli.stdout).verification.assertion.state === 'confirmed', realRecordCli.stderr);
    put(register, registration(origin + '/text', expected(Buffer.from('wrong')))); const wrongRecordCli = await child(recordArgs, {}, null, true); assert('record-real-cli-contradiction', wrongRecordCli.code === 1 && JSON.parse(wrongRecordCli.stdout).status === 'failed');
    put(register, registration(origin + '/slow'));
    for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]]) {
      const countBefore = requests.length; let sent = false;
      const stopped = await child(recordArgs.map(arg => arg === origin + '/text' ? origin + '/slow' : arg), {}, p => { const timer = setInterval(() => { if (requests.length > countBefore) { sent = true; clearInterval(timer); p.kill(signal); } }, 10); p.once('exit', () => clearInterval(timer)); }, true);
      assert('record-real-cli-' + signal, sent && stopped.code === code && JSON.parse(stopped.stdout).status === 'incomplete' && JSON.parse(stopped.stdout).verification.assertion.evidenceRefs.length === 0, stopped.stderr);
    }
    assert('record-requests-remain-one-way-and-credential-free', requests.every(r => r.authorization === null && r.cookie === null && r.peerCertificate === 'none' && r.method === 'GET' && r.encoding === 'identity'));
    assert('record-store-remains-valid-and-index-unchanged', loadRecordStore(root).runs.size > 0 && git('ls-files', '-s', '-z').equals(indexAtRecording));
    await new Promise(resolve => setTimeout(resolve, 80)); assert('record-all-fixture-sockets-closed', sockets.size === 0, String(sockets.size));
    return { runtime: process.version, reports, verifications, recordReports, requests: requests.length, socketsAfter: sockets.size, sourceFilesUnchanged: readFileSync(join(root, 'docs/trust.crt')).equals(caBytes) };
  } finally {
    if (dnsServer) await new Promise(resolve => dnsServer.close(resolve));
    for (const socket of sockets) socket.destroy();
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    rmSync(root, { recursive: true, force: true });
  }
}
if (isMainModule(import.meta.url)) {
  if (process.argv.length !== 3 || process.argv[2] !== '--allow-local-fixture') { console.error('只在项目授权的隔离运行环境显式运行：node scripts/curia-external-network-test.mjs --allow-local-fixture');process.exitCode = 2; }
  else { let passed = 0;const failed = [];const evidence = await externalNetworkFixtures({ registry: JSON.parse(readFileSync(join(ROOT, '.agents/doc-types.json'), 'utf8')), expectTrue: (name, ok, detail) => ok ? passed++ : failed.push({ name, detail }) });console.log(JSON.stringify({ passed, failed, evidence }, null, 2));if (failed.length) process.exitCode = 1; }
}
