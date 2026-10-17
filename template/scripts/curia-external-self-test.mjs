/** Policy, local preflight and CLI-help fixtures without network. Real sockets require the opt-in integration fixture. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, isMainModule } from './doc-lib.mjs';
import { normalizeExternalOptions, classifyAddress, selectExternalAddress, samePeerAddress, inspectExternalHeaders, EXTERNAL_LIMITS } from './curia-network.mjs';
import { parseExternalArgs, readExternalSource, unsafeTlsEnvironment, EXTERNAL_FILES, externalCodeIdentity } from './curia-external.mjs';
import { externalRecordFixtures } from './curia-external-records-self-test.mjs';
import { externalOriginalFixtures } from './curia-external-original-self-test.mjs';
export async function externalFixtures({ expectTrue }) {
  const assert = (name, ok, detail = '') => expectTrue(`Curia external [${name}]`, !!ok, detail);
  const reject = (name, fn) => { let error; try { fn(); } catch (e) { error = e; } assert(name, !!error, error?.message ?? 'not rejected'); };
  const input = { url: 'https://example.com/manual.md', allowOrigin: 'https://example.com', parser: 'utf8-text/1', nonSensitive: true };
  const normal = normalizeExternalOptions(input), headers = (raw, status = 200, opt = normal) => inspectExternalHeaders(status, raw, opt);
  assert('canonical-exact-origin', normal.host === 'example.com' && normal.port === 443 && !normal.allowInternal && normal.path === '/manual.md');
  const ip = normalizeExternalOptions({ ...input, url: 'https://[::1]:8443/manual', allowOrigin: 'https://[::1]:8443', allowInternalOrigin: 'https://[::1]:8443' });
  assert('internal-origin-is-exact-and-separate', ip.host === '::1' && ip.port === 8443 && ip.allowInternal);
  for (const [name, extra] of [
    ['http', { url: 'http://example.com/manual.md', allowOrigin: 'http://example.com' }], ['userinfo', { url: 'https://u:p@example.com/a' }],
    ['query', { url: 'https://example.com/a?token=SECRET' }], ['empty-query', { url: 'https://example.com/a?' }], ['fragment', { url: 'https://example.com/a#SECRET' }],
    ['implicit-case-normalization', { url: 'https://EXAMPLE.com/a' }], ['implicit-idna', { url: 'https://例子.example/a' }], ['dot-segment', { url: 'https://example.com/a/../b' }],
    ['encoded-dot-segment', { url: 'https://example.com/%2e%2e/b' }], ['backslash', { url: 'https://example.com\\@evil.test/a' }], ['url-control', { url: 'https://example.com/\na' }],
    ['origin-mismatch', { allowOrigin: 'https://other.example' }], ['origin-path', { allowOrigin: 'https://example.com/' }], ['internal-grant-mismatch', { allowInternalOrigin: 'https://internal.example' }],
    ['port-zero', { url: 'https://example.com:0/a', allowOrigin: 'https://example.com:0' }], ['port-alias', { url: 'https://example.com:443/a' }], ['unknown-parser', { parser: 'html-renderer/1' }],
    ['credentials-option', { credentials: 'SECRET' }], ['redirect-option', { redirects: 2 }], ['proxy-option', { proxy: 'https://private' }], ['headers-option', { headers: { Authorization: 'SECRET' } }],
    ['non-boolean-privacy', { nonSensitive: 'true' }], ['unbounded-body', { maxBytes: Number.MAX_SAFE_INTEGER }], ['zero-body-limit', { maxBytes: 0 }], ['fraction-timeout', { timeoutMs: 100.5 }],
    ['unbounded-timeout', { timeoutMs: EXTERNAL_LIMITS.maxTimeoutMs + 1 }], ['tiny-timeout', { timeoutMs: 99 }], ['trust-pem-sensitive-path', { trustCert: 'docs/root.pem' }],
    ['trust-outside-root', { trustCert: '../root.crt' }], ['untracked-without-local-source', { includeUntracked: true }], ['exclusion-without-local-source', { exclusions: ['docs'] }],
    ['binary-without-mime', { parser: 'digest-only/1' }], ['mime-wildcard', { parser: 'digest-only/1', mediaType: '*/*' }], ['text-mime-override', { mediaType: 'text/plain' }],
  ]) reject(name, () => normalizeExternalOptions({ ...input, ...extra }));
  assert('binary-typed-budget', normalizeExternalOptions({ ...input, parser: 'digest-only/1', mediaType: 'application/pdf', maxBytes: EXTERNAL_LIMITS.maxBinaryBytes }).maxBytes === EXTERNAL_LIMITS.maxBinaryBytes);
  reject('json-parser-limit-not-raised', () => normalizeExternalOptions({ ...input, parser: 'json-data/1', maxBytes: 65537 }));
  assert('explicit-ca-does-not-imply-internal-origin', !normalizeExternalOptions({ ...input, trustCert: 'docs/root.crt' }).allowInternal);
  for (const [name, addresses] of [
    ['private-v4', ['10.0.0.1', '127.0.0.1', '172.16.0.1', '172.31.255.255', '192.168.1.1']],
    ['private-v6', ['::1', 'fc00::1', 'fdff:ffff::1']],
  ]) for (const a of addresses) { assert(`${name}-${a}`, classifyAddress(a) === 'internal' && selectExternalAddress([a], false).state === 'denied' && selectExternalAddress([a], true).state === 'selected'); }
  for (const a of ['0.0.0.0', '0.9.1.2', '100.64.0.1', '100.100.100.200', '169.254.169.254', '192.0.0.1', '192.0.2.1', '192.88.99.1', '198.18.0.1', '198.51.100.1', '203.0.113.1', '224.0.0.1', '255.255.255.255', '::', '::ffff:127.0.0.1', '::ffff:7f00:1', '64:ff9b::a00:1', 'fe80::1', 'fe80::1%eth0', 'ff02::1', '2001::1', '2001:db8::1', '2002:7f00::1', '3fff::1', '4000::1', 'not-an-ip']) assert(`special-never-overridden-${a}`, selectExternalAddress([a], true).state === 'denied');
  for (const a of ['1.1.1.1', '8.8.8.8', '172.32.0.1', '192.169.0.1', '2606:4700:4700::1111', '2001:4860:4860::8888']) assert(`public-candidate-${a}`, classifyAddress(a) === 'public-candidate' && selectExternalAddress([a], false).state === 'selected');
  assert('mixed-dns-denies-before-choosing-public', selectExternalAddress(['1.1.1.1', '10.1.2.3'], false).selected === null);
  assert('mixed-special-denied-even-with-internal-grant', selectExternalAddress(['127.0.0.1', '169.254.169.254'], true).selected === null);
  assert('dns-cap', selectExternalAddress(Array(17).fill('1.1.1.1'), false).state === 'unavailable');
  assert('empty-dns-not-success', selectExternalAddress([], false).state === 'unavailable');
  assert('peer-mapping-only-not-target-authorization', samePeerAddress('::ffff:127.0.0.1', '127.0.0.1') && !samePeerAddress('::1', '127.0.0.1') && !samePeerAddress('1.1.1.1', '1.1.1.2'));
  assert('ipv6-peer-equivalence', samePeerAddress('0:0:0:0:0:0:0:1', '::1'));
  assert('complete-identity-response-headers', headers(['Content-Type', 'text/plain; charset="utf-8"', 'Content-Length', '4', 'ETag', 'PRIVATE_VALIDATOR']).ok);
  assert('server-validator-not-retained', !JSON.stringify(headers(['Content-Type', 'text/plain', 'ETag', 'PRIVATE_VALIDATOR'])).includes('PRIVATE_VALIDATOR'));
  for (const [name, raw, status] of [
    ['redirect', ['Location', 'https://private.example/?token=SECRET'], 302], ['cached-response', ['Content-Type', 'text/plain'], 304], ['partial-status', ['Content-Type', 'text/plain'], 206],
    ['error-status', ['Content-Type', 'text/plain'], 500], ['no-media-type', [], 200], ['compressed', ['Content-Type', 'text/plain', 'Content-Encoding', 'gzip'], 200],
    ['range-on-200', ['Content-Type', 'text/plain', 'Content-Range', 'bytes 0-1/100'], 200], ['declared-trailers', ['Content-Type', 'text/plain', 'Trailer', 'secret'], 200],
    ['duplicate-type', ['Content-Type', 'text/plain', 'Content-Type', 'text/plain'], 200], ['duplicate-length', ['Content-Type', 'text/plain', 'Content-Length', '2', 'Content-Length', '2'], 200],
    ['ambiguous-length-transfer', ['Content-Type', 'text/plain', 'Content-Length', '2', 'Transfer-Encoding', 'chunked'], 200], ['large-declared-size', ['Content-Type', 'text/plain', 'Content-Length', '9999999'], 200],
    ['invalid-declared-size', ['Content-Type', 'text/plain', 'Content-Length', '0x12'], 200], ['unsupported-transfer', ['Content-Type', 'text/plain', 'Transfer-Encoding', 'gzip'], 200],
    ['unsupported-charset', ['Content-Type', 'text/plain; charset=iso-8859-1'], 200], ['unknown-mime-param', ['Content-Type', 'text/plain; token=SECRET'], 200], ['binary-as-text', ['Content-Type', 'application/pdf'], 200],
  ]) { const result = headers(raw, status); assert(name, !result.ok && !JSON.stringify(result).includes('SECRET')); }
  assert('chunked-identity-supported', headers(['Content-Type', 'text/plain', 'Transfer-Encoding', 'chunked']).ok);
  const jsonOptions = normalizeExternalOptions({ ...input, parser: 'json-data/1' });
  assert('json-compatible-media', headers(['Content-Type', 'application/problem+json'], 200, jsonOptions).ok);
  const binaryOptions = normalizeExternalOptions({ ...input, parser: 'digest-only/1', mediaType: 'application/pdf' });
  assert('binary-exact-media-only', headers(['Content-Type', 'application/pdf'], 200, binaryOptions).ok && !headers(['Content-Type', 'application/octet-stream'], 200, binaryOptions).ok);
  for (const args of [['--url'], ['--all'], ['--url', input.url, '--url', input.url], ['--header', 'Authorization: SECRET'], ['--follow'], ['--timeout-ms', '1.5']]) reject('cli-invalid-' + args[0], () => parseExternalArgs(args));
  assert('cli-help-no-scope-needed', parseExternalArgs(['--help']).flags.help);
  assert('insecure-tls-env-denied', unsafeTlsEnvironment({ NODE_TLS_REJECT_UNAUTHORIZED: '0' }, []));
  assert('keylog-options-denied', unsafeTlsEnvironment({ NODE_OPTIONS: '"--tls-keylog=/tmp/key"' }, []) && unsafeTlsEnvironment({}, ['--tls-keylog=/tmp/key']) && unsafeTlsEnvironment({ SSLKEYLOGFILE: '/tmp/key' }, []));
  assert('ambient-proxy-not-credentials', !unsafeTlsEnvironment({ HTTPS_PROXY: 'http://user:SECRET@proxy', NODE_EXTRA_CA_CERTS: '/not-read-here' }, []));
  const noPrivacy = await readExternalSource('/not-a-worktree', { ...input, nonSensitive: false }), protectedResult = await readExternalSource('/not-a-worktree', { ...input, protected: true });
  assert('privacy-before-dns-code-or-local-probe', noPrivacy.tool === null && noPrivacy.request === null && noPrivacy.observation.attempts === 0 && noPrivacy.observation.dns === null);
  assert('protected-before-dns-code-or-local-probe', protectedResult.tool === null && protectedResult.unresolved.includes('external/authenticated-verifier-required'));
  const controller = new AbortController(); controller.abort(); const cancelled = await readExternalSource('/not-a-worktree', input, controller.signal);
  assert('already-cancelled-no-effects', cancelled.tool === null && cancelled.unresolved.includes('external/cancelled'));
  const internal = await readExternalSource('/not-a-worktree', { ...input, url: 'https://127.0.0.1:1/a', allowOrigin: 'https://127.0.0.1:1' });
  assert('ungranted-internal-no-socket', internal.observation.attempts === 0 && internal.sourceRef === null && internal.unresolved.includes('external/internal-origin-not-authorized'));
  assert('new-code-closure-without-extending-old-contracts', EXTERNAL_FILES.length === 13 && externalCodeIdentity().map(f => f.file).join(',') === EXTERNAL_FILES.join(','));
  assert('ordinary-rule-sets-unchanged', !readFileSync(join(ROOT, 'scripts/curia-workflow.mjs'), 'utf8').includes("rule('external'"));
  await externalOriginalFixtures({ expectTrue });
  await externalRecordFixtures({ expectTrue });
}
if (isMainModule(import.meta.url)) { let passed = 0; const failed = []; await externalFixtures({ expectTrue: (name, ok, detail) => ok ? passed++ : failed.push({ name, detail }) }); console.log(JSON.stringify({ passed, failed }, null, 2)); if (failed.length) process.exitCode = 1; }
