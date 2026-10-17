/** Register preflight and denied-network fixtures; real HTTPS comparison stays in the opt-in network suite. */
import https from 'node:https';
import { Resolver } from 'node:dns/promises';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { ROOT, isMainModule } from './doc-lib.mjs';
import { normalizeExternalOriginalOptions, parseExternalOriginalArgs, verifyRegisteredExternal, EXTERNAL_ORIGINAL_METHOD, EXTERNAL_ORIGINAL_LIMITS } from './curia-external.mjs';
export async function externalOriginalFixtures({ expectTrue }) {
  const assert = (name, ok, detail = '') => expectTrue(`Curia external original [${name}]`, !!ok, detail);
  const reject = (name, fn) => { let error; try { fn(); } catch (e) { error = e; } assert(name, !!error); };
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'curia-external-register-'))), register = 'docs/source-register.json';
  const input = { register, id: 'manual', url: 'https://127.0.0.1:9/manual.pdf', allowOrigin: 'https://127.0.0.1:9', allowInternalOrigin: 'https://127.0.0.1:9', mediaType: 'application/pdf', nonSensitive: true };
  const table = (revision = null, uri = input.url) => JSON.stringify({ schema: 'curia.original-register/1', owner: 'DO_NOT_COPY_OWNER', accessRef: 'docs/DO_NOT_COPY_ACCESS.md', originals: [{ id: 'manual', format: 'pdf', sourceRef: { uri, revision, locator: 'DO_NOT_COPY_LOCATOR', observedAt: '2026-01-01' } }] });
  const put = (path, data) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), data); };
  const env = { ...process.env }; for (const key of Object.keys(env)) if (key.startsWith('GIT_') || ['CURIA_ROOT', 'CURIA_ROOT', 'CURIA_STAGED', 'CURIA_STAGED', 'NODE_OPTIONS'].includes(key)) delete env[key];
  const git = (...args) => execFileSync('git', args, { cwd: root, env, stdio: 'pipe' });
  const request = https.request, resolve4 = Resolver.prototype.resolve4, resolve6 = Resolver.prototype.resolve6;
  let requests = 0, dns = 0;
  https.request = () => { requests++; throw Error('fixture refuses real network'); };
  Resolver.prototype.resolve4 = Resolver.prototype.resolve6 = async () => { dns++; throw Error('fixture refuses real DNS'); };
  try {
    const registry = JSON.parse(readFileSync(join(ROOT, '.agents/doc-types.json'), 'utf8')); delete registry.instance;
    put('.agents/doc-types.json', JSON.stringify(registry)); put('.agents/README.md', '# Control\n'); put('AGENTS.md', '# Rules\n'); put('docs/README.md', '# Knowledge\n'); put('.gitignore', 'docs/ignored.json\n');
    put(register, table()); put('docs/.env', table()); put('docs/ignored.json', table());
    git('init', '-q', '-b', 'main'); git('config', 'gc.auto', '0'); git('add', '--', '.agents', 'AGENTS.md', '.gitignore', 'docs'); git('-c', 'user.name=fixture', '-c', 'user.email=fixture@local', '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'external declaration preflight');
    const index = git('ls-files', '-s', '-z').toString();
    const normalized = normalizeExternalOriginalOptions({ ...input, includeUntracked: true, exclusions: ['docs/ignored.json'] });
    assert('fixed-digest-parser-separate-local-opt-in', normalized.network.parser === 'digest-only/1' && normalized.includeUntracked && normalized.networkInput.includeUntracked === undefined);
    const argv = ['--register', register, '--id', 'manual', '--url', input.url, '--allow-origin', input.allowOrigin, '--media-type', input.mediaType, '--all', '--exclude', 'docs/ignored.json', '--non-sensitive', '--json'];
    assert('cli-local-all-without-ca', parseExternalOriginalArgs(argv).options.includeUntracked && parseExternalOriginalArgs(argv).flags.json);
    assert('cli-help-without-source', parseExternalOriginalArgs(['--help']).flags.help);
    for (const [name, extra] of [
      ['unknown-fields', { response: {} }], ['forged-report', { evidenceRefs: [] }], ['parser-override', { parser: 'utf8-text/1' }], ['no-mime', { mediaType: undefined }],
      ['bad-id', { id: 'Manual' }], ['trailing-id-newline', { id: 'manual\n' }], ['bad-register', { register: '../outside.json' }], ['register-uri-ambiguity', { register: 'docs/a#b.json' }],
      ['boolean-consent', { nonSensitive: 'true' }], ['origin-mismatch', { allowOrigin: 'https://other.example' }], ['credential-url', { url: 'https://secret@127.0.0.1:9/manual.pdf' }],
      ['shared-ca-register', { register: 'docs/trust.crt', trustCert: 'docs/trust.crt' }], ['register-budget-override', { maxRegisterBytes: 1 }], ['network-budget-overflow', { maxBytes: 16 * 1024 * 1024 + 1 }],
    ]) reject(name, () => normalizeExternalOriginalOptions({ ...input, ...extra }));
    for (const args of [[...argv, '--parser', 'digest-only/1'], [...argv, '--register', register], [...argv, '--id', 'manual'], ['--id'], ['--response', 'untrusted.json']]) reject('cli-reject-' + args.at(-1), () => parseExternalOriginalArgs(args));
    const privateResult = await verifyRegisteredExternal('/not-a-worktree', { ...input, nonSensitive: false });
    assert('privacy-before-local-code-and-network-probes', privateResult.verifier === null && privateResult.observation === null && privateResult.assertion.sourceRefs.length === 0 && privateResult.assertion.scope.url === null);
    const protectedResult = await verifyRegisteredExternal('/not-a-worktree', { ...input, protected: true });
    assert('protected-no-downgrade', protectedResult.verifier === null && protectedResult.observation === null && protectedResult.unresolved.includes('external/authenticated-verifier-required'));
    const controller = new AbortController(); controller.abort(); const cancelled = await verifyRegisteredExternal('/not-a-worktree', input, controller.signal);
    assert('pre-cancelled-no-input-probes', cancelled.verifier === null && cancelled.observation === null && cancelled.unresolved.includes('external/cancelled'));
    const savedTls = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    try { process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; const r = await verifyRegisteredExternal(root, input); assert('unsafe-runtime-before-register-read', r.verifier === null && r.observation === null && r.unresolved.includes('external/unsafe-tls-runtime')); }
    finally { if (savedTls === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED; else process.env.NODE_TLS_REJECT_UNAUTHORIZED = savedTls; }
    const unknown = await verifyRegisteredExternal(root, input);
    assert('unknown-revision-register-only-evidence', unknown.schema === 'curia.external-verification/1' && unknown.assertion.scope.method === EXTERNAL_ORIGINAL_METHOD && unknown.assertion.state === 'unverified' && unknown.observation.network === null && unknown.assertion.evidenceRefs.length === 1 && unknown.assertion.sourceRefs[1].revision === null && unknown.unresolved.includes('external-original/revision-uninterpreted'), JSON.stringify(unknown));
    assert('declared-attribution-and-locator-not-copied', !['DO_NOT_COPY_OWNER', 'DO_NOT_COPY_ACCESS', 'DO_NOT_COPY_LOCATOR'].some(v => JSON.stringify(unknown).includes(v)));
    const absent = await verifyRegisteredExternal(root, { ...input, id: 'absent' }); assert('missing-entry-no-network', absent.observation.network === null && absent.unresolved.includes('external-original/entry-not-found'));
    for (const uri of ['repo:docs/manual.pdf', 'paper:box-1', 'https://other.example/manual.pdf']) { put(register, table('sha256:raw-bytes/1:' + 'a'.repeat(64), uri)); const r = await verifyRegisteredExternal(root, input); assert('no-uri-derived-authorization-' + uri.split(':')[0], r.observation.network === null && r.unresolved.includes('external-original/source-selection-mismatch')); }
    for (const revision of ['v1', 'sha512:raw-bytes/1:' + 'a'.repeat(64), 'sha256:normalized/1:' + 'a'.repeat(64), 'sha256:raw-bytes/1:' + 'A'.repeat(64)]) { put(register, table(revision)); const r = await verifyRegisteredExternal(root, input); assert('uninterpreted-digest-no-network-' + revision.slice(0, 18), r.observation.network === null && r.unresolved.includes('external-original/revision-uninterpreted')); }
    put(register, '{'); const malformed = await verifyRegisteredExternal(root, input); assert('invalid-register-no-network', malformed.observation.network === null && malformed.assertion.state === 'unverified');
    put(register, Buffer.from([0xff])); const encoding = await verifyRegisteredExternal(root, input); assert('invalid-encoding-no-network', encoding.observation.network === null && encoding.unresolved.includes('external-original/register-encoding-invalid'));
    put(register, 'x'.repeat(EXTERNAL_ORIGINAL_LIMITS.registerBytes + 1)); const oversized = await verifyRegisteredExternal(root, input); assert('oversized-register-no-prefix-evidence', oversized.observation.network === null && oversized.assertion.evidenceRefs.length === 0 && oversized.observation.registration.openedFiles === 0);
    put(register, table());
    for (const extra of [{ register: 'docs/.env' }, { exclusions: ['docs'] }, { register: 'docs/ignored.json', includeUntracked: true }]) { const r = await verifyRegisteredExternal(root, { ...input, ...extra }); assert('privacy-and-exclusion-precede-network-' + JSON.stringify(extra), r.assertion.evidenceRefs.length === 0 && r.observation?.network == null); }
    put('docs/raw/.agents-raw', ''); put('docs/raw/table.json', table()); const raw = await verifyRegisteredExternal(root, { ...input, register: 'docs/raw/table.json', includeUntracked: true }); assert('raw-register-not-read', raw.assertion.evidenceRefs.length === 0 && raw.observation?.network == null);
    symlinkSync('source-register.json', join(root, 'docs/alias.json')); const alias = await verifyRegisteredExternal(root, { ...input, register: 'docs/alias.json', includeUntracked: true }); assert('symlink-register-not-read', alias.assertion.evidenceRefs.length === 0 && alias.observation?.network == null);
    put('docs/new.json', table()); const untracked = await verifyRegisteredExternal(root, { ...input, register: 'docs/new.json' }), optedIn = await verifyRegisteredExternal(root, { ...input, register: 'docs/new.json', includeUntracked: true });
    assert('untracked-register-requires-opt-in', untracked.assertion.evidenceRefs.length === 0 && optedIn.assertion.evidenceRefs.length === 1 && optedIn.observation.network === null);
    put(register, table('sha256:raw-bytes/1:' + 'a'.repeat(64)));
    const Decoder = globalThis.TextDecoder; let drifted = false;
    globalThis.TextDecoder = class extends Decoder { decode(bytes, ...rest) { const text = super.decode(bytes, ...rest); if (text.includes('DO_NOT_COPY_OWNER') && !drifted) { drifted = true; put(register, text + '\n'); } return text; } };
    try { const drift = await verifyRegisteredExternal(root, input); assert('parser-time-register-drift-withdraws-before-network', drifted && drift.observation.network === null && drift.assertion.evidenceRefs.length === 0 && drift.assertion.sourceRefs.every(ref => ref.revision === null) && drift.unresolved.includes('external-original/inputs-changed')); }
    finally { globalThis.TextDecoder = Decoder; }
    assert('all-preflight-cases-have-zero-dns-and-requests', dns === 0 && requests === 0, JSON.stringify({ dns, requests }));
    assert('no-records-default-adoption-or-index-writes', !existsSync(join(root, 'docs/records')) && !JSON.parse(readFileSync(join(root, '.agents/doc-types.json'))).instance && git('ls-files', '-s', '-z').toString() === index);
  } finally { https.request = request; Resolver.prototype.resolve4 = resolve4; Resolver.prototype.resolve6 = resolve6; rmSync(root, { recursive: true, force: true }); }
}
if (isMainModule(import.meta.url)) { let passed = 0; const failed = []; await externalOriginalFixtures({ expectTrue: (name, ok, detail) => ok ? passed++ : failed.push({ name, detail }) }); console.log(JSON.stringify({ passed, failed }, null, 2)); if (failed.length) process.exitCode = 1; }
