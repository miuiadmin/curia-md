/** Opt-in Registry dependencies: disposable data-only Git fixtures, no application runtime. */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { ROOT, isMainModule } from './doc-lib.mjs';
import { buildImpactWorkflow, buildReadWorkflow, normalizeImpactOptions, parseImpactArgs, IMPACT_RULES, CONFIGURATION_IMPACT_RULES, GIT_CONFIGURATION_IMPACT_RULES, MOVE_CONFIGURATION_IMPACT_RULES, GIT_MOVE_CONFIGURATION_IMPACT_RULES, GUARD_CONFIGURATION_IMPACT_RULES, GIT_GUARD_CONFIGURATION_IMPACT_RULES, READ_RULE_SETS, READ_RULES } from './curia-workflow.mjs';
import { buildInventory, buildImpactInventory, readInventoryConfiguration, readInventoryRelations, normalizeGitChangeOptions, prepareGitChangeSelection, observeGitChanges } from './curia-query.mjs';
import { IMPACT_LIMITS, planImpact } from './curia-impact.mjs';
import { normalizeRelations } from './curia-relations.mjs';

export function configurationImpactFixtures({ expectTrue, registry }) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'curia-configuration-impact-'))), cli = fileURLToPath(new URL('./curia-workflow.mjs', import.meta.url));
  const env = { ...process.env }; for (const key of Object.keys(env)) if (key.startsWith('GIT_') || ['CURIA_ROOT', 'CURIA_STAGED', 'CURIA_ROOT', 'CURIA_STAGED'].includes(key)) delete env[key];
  const git = (...args) => execFileSync('git', args, { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim();
  const put = (path, value) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), value); };
  const remove = path => rmSync(join(root, path), { recursive: true, force: true });
  const assert = (name, ok, detail = '') => expectTrue(`Curia configuration impact [${name}]`, ok, detail);
  const reject = (name, fn) => { let error; try { fn(); } catch (e) { error = e; } assert(name, !!error, error?.message ?? '未拒绝'); };
  const regPath = '.agents/doc-types.json', a = 'docs/items/a.md', b = 'docs/items/b.md', special = 'docs/items/special/guide.md', data = 'docs/items/data.json', pdf = 'docs/items/manual.pdf', receipt = 'docs/records/receipt.json', other = 'handbook/items/other.md';
  const paths = [a, b, special, data, pdf, receipt, other].sort(), within = ['docs/items', 'docs/records', 'handbook/items'];
  const base = structuredClone(registry); delete base.instance;
  const native = authority => ({ parser: 'markdown-native-header/1', fields: { id: 'Doc-id', version: 'Version', lifecycle: 'Lifecycle', owner: 'Owner', pointer: 'Native-current' }, lifecycles: { current: { view: 'current', facets: {} } }, authorityLinks: [authority] });
  const relations = { schema: 'curia.relations/1', parser: 'markdown-header-relations/1' };
  const instance = { schema: 'curia.instance/1', owner: 'fixture', surfaces: [
    { id: 'control', kind: 'root', members: [{ path: '.agents', kind: 'directory', role: 'control' }], entry: '.agents/README.md', authorityLinks: ['AGENTS.md'] },
    { id: 'knowledge', kind: 'root', members: [{ path: 'docs', kind: 'directory', role: 'knowledge' }], entry: 'docs/README.md', authorityLinks: ['AGENTS.md'] },
    { id: 'handbook', kind: 'root', members: [{ path: 'handbook', kind: 'directory', role: 'knowledge' }], entry: 'handbook/README.md', authorityLinks: ['rules/handbook.md'] },
  ], nativeProfiles: { general: native('rules/general.md'), specific: native('rules/special.md') }, mappings: [
    { path: 'docs/items', kind: 'directory', nativeProfile: 'general', relations },
    { path: 'docs/items/special', kind: 'directory', nativeProfile: 'specific' },
  ], recordStore: { schema: 'curia.record-store/1', path: 'docs/records', owner: 'fixture', authorityLinks: ['rules/records.md'] } };
  const configure = (value = instance) => put(regPath, JSON.stringify({ ...base, ...(value ? { instance: value } : {}) }) + '\n');
  const md = (sentinel, refs = '') => `# Fixture\n\nStatus: current\nOwner: fixture\n${refs}\n\n${sentinel}\n`;
  const restore = () => { configure(); put(a, md('CONFIG_A_BODY', 'Normative-refs: [b](b.md)')); put(b, md('CONFIG_B_BODY')); put(special, md('CONFIG_SPECIAL_BODY')); put(data, '{invalid-json-but-config-is-data-only'); put(pdf, Buffer.from('%PDF-UNREAD_BINARY\0\xff')); put(receipt, '{"receipt":"not-read"}'); put(other, md('HANDBOOK_UNREAD')); put('.gitignore', ''); };
  const opts = { changed: [regPath], within, nonSensitive: true, configuration: 'only' };
  const plan = extra => buildImpactWorkflow(root, { ...opts, ...extra });
  const cap = (extra = {}) => buildImpactInventory(root, { paths: within, exclusions: extra.exclusions ?? [] }, { changed: [regPath], nonSensitive: true, configuration: 'only', ...Object.fromEntries(Object.entries(extra).filter(([k]) => k !== 'exclusions')) });
  const projection = extra => readInventoryConfiguration(cap(), extra);
  const has = (report, code) => report.unresolved.some(f => f.code === code);
  const withDecoder = (fn, run) => { const Native = globalThis.TextDecoder; globalThis.TextDecoder = class extends Native { decode(...args) { const text = super.decode(...args); fn(text); return text; } }; try { return run(); } finally { globalThis.TextDecoder = Native; } };
  const call = args => spawnSync(process.execPath, [cli, 'impact', ...(args.includes('--list-checks') ? [] : ['--root', root]), ...args], { cwd: root, env, encoding: 'utf8' });
  const cliArgs = ['--configuration', 'only', '--changed', regPath, '--within', 'docs/items', '--non-sensitive', '--strict', '--json'];
  try {
    for (const path of ['AGENTS.md', '.agents/README.md', 'docs/README.md', 'handbook/README.md']) put(path, '# Navigation only\n');
    for (const path of ['rules/general.md', 'rules/special.md', 'rules/records.md', 'rules/handbook.md', 'private/HIDDEN_AUTHORITY_NAME.md']) put(path, 'AUTHORITY_BODY_UNREAD');
    restore(); git('init', '-q'); git('add', '--', 'AGENTS.md', '.agents', 'docs', 'handbook', '.gitignore', 'rules', 'private');
    git('-c', 'user.name=fixture', '-c', 'user.email=fixture@local', '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'configuration fixture', '--', 'AGENTS.md', '.agents', 'docs', 'handbook', '.gitignore', 'rules', 'private');
    const indexBefore = readFileSync(join(root, '.git/index'));
    const before = Date.now(); let bodyDecodes = 0;
    let report = withDecoder(text => { if (text.includes('CONFIG_A_BODY') || text.includes('CONFIG_B_BODY')) bodyDecodes++; }, () => plan({ at: '2000-01-01T00:00:00Z', now: '2001-01-01T00:00:00Z' }));
    const after = Date.now();
    assert('configuration-chain', report.complete && report.schema === 'curia.impact-plan/4' && report.impact.schema === 'curia.impact-graph/4' && report.configuration.schema === 'curia.configuration-dependencies/3' && report.configuration.moves.length === 0 && report.impact.reviewPaths.join(',') === paths.join(','), JSON.stringify(report.unresolved));
    assert('configuration-only-no-body-read', !bodyDecodes && report.coverage.openedFiles === 0 && report.coverage.chargedBytes === 0 && report.coverage.inspected === 0 && report.configuration.bodiesRead === 0 && report.documents.every(d => d.state === 'configuration-only' && d.parser === null) && !report.execution.effects.includes('bounded-relation-source-inspection'));
    assert('no-pdf-json-or-authority-body-evidence', report.sourceRefs.length === 1 && report.sourceRefs[0].uri === `repo:${regPath}` && report.evidenceRefs.length === 1 && !/CONFIG_A_BODY|UNREAD_BINARY|invalid-json|HANDBOOK_UNREAD/.test(JSON.stringify(report)));
    const source = report.sourceRefs[0];
    assert('actual-registry-bytes-and-observation-time', source.revision.value === createHash('sha256').update(readFileSync(join(root, regPath))).digest('hex') && source.revision.algorithm === 'sha256' && source.revision.canonicalization === 'raw-bytes/1' && Date.parse(source.observedAt) >= before && Date.parse(source.observedAt) <= after);
    assert('registry-pointer-is-not-a-document-locator', report.impact.affected.find(d => d.path === a).reasons.some(r => r.declaration === regPath && r.kind === 'configuration' && r.locator.pointer === '' && r.direction === 'reverse-configuration'));
    assert('body-inspection-is-explicitly-not-applicable', report.checks.find(c => c.id === 'curia-impact/inspection').state === 'not-applicable' && report.checks.find(c => c.id === 'curia-impact/configuration').state === 'pass' && report.limitations.includes('document-body-relations-not-inspected'));
    assert('no-index-or-run-write', readFileSync(join(root, '.git/index')).equals(indexBefore) && !existsSync(join(root, 'docs/records/events')));
    report = plan({ changed: ['AGENTS.md'] }); assert('surface-authority-selective', report.complete && report.impact.reviewPaths.length === 6 && !report.impact.reviewPaths.includes(other));
    report = plan({ changed: ['rules/general.md'] }); assert('effective-native-profile-only', report.complete && report.impact.reviewPaths.join(',') === [a, b, data, pdf].sort().join(',') && report.configuration.references.filter(r => r.kind === 'native-profile-authority' && r.source === special).every(r => r.target === 'rules/special.md' && r.locator.pointer === '/instance/nativeProfiles/specific/authorityLinks/0'));
    report = plan({ changed: ['rules/records.md'] }); assert('record-store-authority-selective', report.complete && report.impact.reviewPaths.join(',') === receipt && report.impact.references.some(r => r.kind === 'record-store-authority' && r.locator.pointer === '/instance/recordStore/authorityLinks/0'));
    report = plan({ changed: ['docs/README.md'] }); assert('entry-is-not-implicit-authority', report.complete && report.impact.reviewPaths.length === 0);
    report = plan({ changed: [b], within: [a, b], configuration: undefined });
    assert('default-impact-contract-unchanged', report.complete && report.schema === 'curia.impact-plan/1' && report.impact.schema === 'curia.impact-graph/1' && !report.configuration && report.sourceRefs.length === 2 && report.checks.every(r => r.version === 1));
    const read = buildReadWorkflow(root, { selection: { paths: [a] } }); assert('ordinary-read-not-upgraded-or-expanded', read.schema === 'curia.read-workflow/1' && read.documents.length === 1 && !read.configuration && !READ_RULE_SETS.some(set => set.some(rule => rule.id.startsWith('curia-impact/'))));
    assert('contracts-versioned-independently', IMPACT_RULES.every(r => r.version === 1) && CONFIGURATION_IMPACT_RULES.length === 5 && GIT_CONFIGURATION_IMPACT_RULES.length === 6 && READ_RULE_SETS.at(-1) === READ_RULES);
    put(a, md('CONFIG_A_BODY', 'Normative-refs: [guide](special/guide.md)'));
    report = plan({ changed: ['rules/special.md'], within: [a, special], configuration: 'include' });
    assert('configuration-and-body-chain', report.complete && report.impact.reviewPaths.join(',') === [a, special].sort().join(',') && report.impact.affected.find(d => d.path === a).depth === 2 && report.sourceRefs.length === 3, JSON.stringify(report.unresolved));
    report = plan({ changed: ['rules/special.md'], within: [a, special] }); assert('only-does-not-pretend-body-dependencies', report.complete && report.impact.reviewPaths.join(',') === special && report.coverage.openedFiles === 0);
    restore(); report = plan({ configuration: 'include' }); assert('include-preserves-unmapped-and-unparsed-gaps', !report.complete && has(report, 'impact/binding-missing') && report.configuration.complete);
    configure(null); report = plan({ within: ['docs/items'] }); assert('default-two-roots-configuration-without-mappings', report.complete && report.configuration.references.every(r => r.kind === 'configuration'));
    report = plan({ within: ['docs/items'], changed: ['AGENTS.md'] }); assert('default-layout-never-guesses-authority', report.complete && report.impact.reviewPaths.length === 0); restore();
    let config = structuredClone(instance); config.surfaces[1].authorityLinks.push('private/HIDDEN_AUTHORITY_NAME.md'); configure(config);
    report = plan(); assert('configuration-private-authority-withheld', !report.complete && has(report, 'configuration/authority-withheld') && !JSON.stringify(report).includes('HIDDEN_AUTHORITY_NAME') && report.sourceRefs.length === 1);
    restore(); report = plan({ exclusions: ['rules/general.md'] }); assert('explicit-authority-exclusion-hides-name', !report.complete && has(report, 'configuration/authority-withheld') && !report.configuration.references.some(r => r.target === 'rules/general.md') && !report.impact.references.some(r => r.target === 'rules/general.md'));
    // Caller-authored exclusions may be echoed; the dependency projection itself never echoes withheld names.
    assert('withheld-name-not-in-projection', !JSON.stringify(report.configuration).includes('rules/general.md'));
    for (const extra of [{ configuration: true }, { configuration: 'auto' }, { configuration: null }, { nonSensitive: false }, { exclusions: [regPath] }, { exclusions: ['.agents'] }, { changed: ['private/hidden.md'] }, { unexpected: true }]) reject('invalid-before-io-' + JSON.stringify(extra), () => buildImpactWorkflow('/not/a/repo', { ...opts, ...extra }));
    reject('ordinary-registry-name-still-private', () => normalizeImpactOptions({ ...opts, configuration: undefined }));
    reject('excluded-registry-capability-before-io', () => buildImpactInventory('/not/a/repo', { paths: ['docs'], exclusions: [regPath] }, { changed: ['AGENTS.md'], nonSensitive: true, configuration: 'only' }));
    let projected; let capability = cap(); reject('configuration-capability-not-serializable', () => readInventoryConfiguration(JSON.parse(JSON.stringify(capability))));
    reject('configuration-capability-not-fabricated', () => readInventoryConfiguration({}));
    reject('paths-only-does-not-grant-configuration', () => readInventoryConfiguration(buildInventory(root, null, { readMetadata: false, selection: { paths: [a] } })));
    reject('normal-impact-does-not-grant-configuration', () => readInventoryConfiguration(buildImpactInventory(root, { paths: [a] }, { changed: [a], nonSensitive: true })));
    reject('configuration-only-does-not-grant-bodies', () => readInventoryRelations(capability));
    capability.input.selection.paths = ['private']; capability.instance = { forged: true };
    projected = readInventoryConfiguration(capability); assert('public-inventory-mutation-cannot-expand-scope', projected.complete && projected.documents.map(d => d.path).sort().join(',') === paths.join(','));
    reject('configuration-unknown-budget', () => projection({ unknown: true }));
    report = plan({ limits: { maxFiles: 1 } }); assert('object-budget-does-not-fake-completeness', !report.complete && report.configuration.truncated && report.impact.truncated && report.sourceRefs.length === 0 && report.coverage.openedFiles === 0);
    report = plan({ within: ['docs/missing'] }); assert('empty-scope-not-green', !report.complete && report.sourceRefs.length === 0);
    report = plan({ inventoryOnly: true }); assert('inventory-is-not-dependency-proof', !report.complete && !report.configuration && !report.impact && report.sourceRefs.length === 0);
    report = plan({ within: [a, b], limits: { maxFileBytes: 1, maxTotalBytes: 1 } }); assert('registry-budget-independent-of-body-budget', report.complete && report.configuration.limits.maxRegistryBytes === 1048576 && report.coverage.chargedBytes === 0);
    capability = cap(); put(a, md('CHANGED_AFTER_INVENTORY')); projected = readInventoryConfiguration(capability);
    assert('document-drift-withdraws-configuration', !projected.stable && !projected.registry && !projected.references.length && !projected.documents.length); restore();
    capability = cap(); configure({ ...instance, owner: 'changed' }); projected = readInventoryConfiguration(capability);
    assert('configuration-snapshot-withdrawal', !projected.stable && !projected.registry && !projected.references.length); restore();
    capability = cap(); put('.gitignore', `${a}\n`); projected = readInventoryConfiguration(capability);
    assert('ignored-set-drift-withdraws', !projected.stable && !projected.registry && !projected.references.length); restore();
    put('.gitignore', `${regPath}\n`); report = plan(); assert('ignored-registry-not-projected', !report.complete && !report.sourceRefs.length && !report.configuration.registry); restore();
    capability = cap(); put(`docs/items/${base.rawMarker}`, ''); projected = readInventoryConfiguration(capability);
    assert('raw-zone-drift-withdraws', !projected.stable && !projected.registry); remove(`docs/items/${base.rawMarker}`); restore();
    capability = cap(); put(b, md('INDEX_CHANGED')); git('add', '--', b); projected = readInventoryConfiguration(capability);
    assert('index-drift-withdraws', !projected.stable && !projected.registry); restore(); git('add', '--', b);
    remove(a); symlinkSync('b.md', join(root, a)); report = plan(); assert('symlink-still-blocked-without-body-read', !report.complete && !report.sourceRefs.length); unlinkSync(join(root, a)); restore();
    let mutated = false; report = withDecoder(text => { if (!mutated && text.includes('CONFIG_A_BODY')) { mutated = true; configure({ ...instance, owner: 'drift' }); } }, () => plan({ changed: [b], within: [a, b], configuration: 'include' }));
    assert('include-phase-drift-withdraws-every-source', mutated && !report.complete && !report.sourceRefs.length && !report.evidenceRefs.length && !report.configuration.registry && !report.configuration.references.length && !report.impact.affected.length); restore();
    const guardCode = 'checks/config-check.mjs', guardRules = 'rules/check-policy.md', guardConfig = 'checks/runtime-options.json';
    put(guardCode, "throw Error('MUST_NOT_EXECUTE');\n"); put(guardRules, 'GUARD_AUTHORITY_BODY_NOT_READ'); put(guardConfig, 'GUARD_CONFIG_BODY_NOT_READ');
    const guard = { schema: 'curia.guard/1', owner: 'fixture', authorityLinks: [guardRules], activation: 'explicit', onEmpty: 'fail', command: { program: 'node', script: guardCode, args: [], cwd: '.', identityPaths: [guardCode, guardConfig] }, inputScope: { mode: 'git', paths: ['docs/items'], exclusions: [b], includeUntracked: false, includeIgnored: false }, effects: { write: false, network: false, externalSystems: false, sensitiveRead: false }, privacy: { sensitivePaths: [], output: 'discard', args: 'non-sensitive-static' }, environment: [], expectedExitCodes: [0], parser: { id: 'aggregate-exit/1', ruleIds: [] }, limits: { timeoutMs: 2000, killGraceMs: 50, maxOutputBytes: 16384, maxFiles: 32, maxFileBytes: 1048576, maxTotalBytes: 2097152, cpuMs: null, memoryBytes: null, maxProcesses: null } };
    const guarded = structuredClone(instance); guarded.guards = { local: guard }; configure(guarded);
    report = plan({ changed: [guardCode] });
    const guardedPaths = [a, special, data, pdf].sort();
    assert('guard-code-selective', report.complete && report.impact.reviewPaths.join(',') === guardedPaths.join(',') && report.configuration.guardScope === 'primary-repository-declarations-only');
    assert('guard-code-is-not-source-evidence', report.sourceRefs.length === 1 && report.sourceRefs[0].uri === `repo:${regPath}` && report.coverage.openedFiles === 0 && report.configuration.bodiesRead === 0 && !JSON.stringify(report).includes('GUARD_CONFIG_BODY_NOT_READ'));
    assert('guard-pointer-and-identity', report.configuration.references.some(r => r.source === a && r.target === guardCode && r.kind === 'guard-code' && r.locator.pointer === '/instance/guards/local/command/identityPaths/0'));
    assert('guard-authority-selective', plan({ changed: [guardRules] }).impact.reviewPaths.join(',') === guardedPaths.join(','));
    assert('guard-explicit-support-config', plan({ changed: [guardConfig] }).impact.reviewPaths.join(',') === guardedPaths.join(','));
    assert('guard-unrelated-change-not-inferred', plan({ changed: ['checks/undeclared-config.json'] }).impact.reviewPaths.length === 0);
    const denied = [guardCode, guardRules, guardConfig, a, b, special, data, pdf].map(p => join(root, p));
    const trapped = spawnSync(process.execPath, ['--input-type=module', '-e', `import fs from 'node:fs';import{syncBuiltinESMExports}from'node:module';const denied=new Set(${JSON.stringify(denied)}),original=fs.openSync;let opens=0,control=false;fs.openSync=function(p,...args){if(denied.has(String(p))){opens++;throw Error('FORBIDDEN_CONFIG_READ');}return original.call(fs,p,...args)};try{fs.readFileSync(${JSON.stringify(join(root,guardCode))})}catch(e){control=e.message==='FORBIDDEN_CONFIG_READ'}opens=0;syncBuiltinESMExports();const {buildImpactWorkflow}=await import(${JSON.stringify(new URL('./curia-workflow.mjs',import.meta.url).href)});const report=buildImpactWorkflow(${JSON.stringify(root)},${JSON.stringify({...opts,changed:[guardCode]})});console.log(JSON.stringify({control,opens,complete:report.complete,paths:report.impact?.reviewPaths}));`], {cwd:root,env,encoding:'utf8',maxBuffer:16*1024*1024});
    const trapResult = trapped.status === 0 ? JSON.parse(trapped.stdout) : null;
    assert('guard-no-target-or-body-open', trapResult?.control && trapResult.opens === 0 && trapResult.complete && trapResult.paths.join(',') === guardedPaths.join(','), trapped.stderr);
    guarded.guards.local.privacy.sensitivePaths = [guardConfig]; configure(guarded); report = plan({ changed: [guardCode] });
    assert('guard-private-dependency-withheld', !report.complete && has(report,'configuration/guard-dependency-withheld') && !JSON.stringify(report.configuration).includes(guardConfig));
    guarded.guards.local.privacy.sensitivePaths = []; configure(guarded); report = plan({ changed: [guardCode], exclusions: [guardConfig] });
    assert('guard-explicit-exclusion-withheld', !report.complete && has(report,'configuration/guard-dependency-withheld') && !JSON.stringify(report.configuration).includes(guardConfig));
    guarded.guards.local.privacy.sensitivePaths = [a]; configure(guarded); report = plan({ changed: [guardCode] });
    assert('guard-sensitive-input-not-a-complete-dependency', !report.complete && has(report,'configuration/guard-input-withheld') && !report.configuration.references.some(r=>r.source===a&&r.kind.startsWith('guard-')));
    let secretDecodes=0,allowedDecodes=0;
    report=withDecoder(text=>{if(text.includes('CONFIG_A_BODY'))secretDecodes++;if(text.includes('CONFIG_B_BODY'))allowedDecodes++;},()=>plan({changed:[guardCode],within:[a,b],configuration:'include'}));
    assert('guard-private-source-blocked-before-read',secretDecodes===0&&allowedDecodes>0&&!report.complete&&has(report,'impact/guard-sensitive-source')&&!report.sourceRefs.some(r=>r.uri===`repo:${a}`),JSON.stringify({secretDecodes,allowedDecodes,unresolved:report.unresolved}));
    guarded.guards.local.privacy.sensitivePaths=[];guarded.guards.unused={...structuredClone(guard),inputScope:{...guard.inputScope,paths:['not-selected']},privacy:{...guard.privacy,sensitivePaths:[a]}};configure(guarded);secretDecodes=0;
    report=withDecoder(text=>{if(text.includes('CONFIG_A_BODY'))secretDecodes++;},()=>plan({changed:[guardCode],within:[a,b],configuration:'include'}));
    assert('guard-private-source-from-other-declaration',secretDecodes===0&&!report.complete&&has(report,'impact/guard-sensitive-source')&&!report.sourceRefs.some(r=>r.uri===`repo:${a}`));
    guarded.guards.unused.privacy.sensitivePaths=[guardRules];configure(guarded);report=plan({changed:[guardCode]});
    assert('guard-private-target-from-other-declaration',!report.complete&&has(report,'configuration/guard-dependency-withheld')&&!JSON.stringify(report.configuration).includes(guardRules));
    guarded.guards.unused.privacy.sensitivePaths=['AGENTS.md'];configure(guarded);report=plan({changed:[guardCode]});
    assert('guard-private-surface-authority-withheld',!report.complete&&has(report,'configuration/authority-withheld')&&!JSON.stringify(report.configuration).includes('AGENTS.md'));
    delete guarded.guards.unused;guarded.guards.local.privacy.sensitivePaths=['docs/items'];configure(guarded);secretDecodes=0;allowedDecodes=0;
    report=withDecoder(text=>{if(text.includes('CONFIG_A_BODY'))secretDecodes++;if(text.includes('CONFIG_B_BODY'))allowedDecodes++;},()=>plan({changed:[guardCode],within:[a,b],configuration:'include'}));
    assert('guard-private-parent-keeps-all-withheld-incomplete',secretDecodes===0&&allowedDecodes===0&&!report.complete&&report.input.stable&&report.coverage.openedFiles===0&&report.documents.every(d=>d.state==='not-read'&&d.reason==='guard-sensitive-source')&&has(report,'impact/guard-sensitive-source')&&report.sourceRefs.every(r=>r.uri===`repo:${regPath}`));
    guarded.guards.local.privacy.sensitivePaths=[a];configure(guarded);
    const includeProbe=spawnSync(process.execPath,['--input-type=module','-e',`
      import fs from 'node:fs';import{syncBuiltinESMExports}from'node:module';
      const secret=${JSON.stringify(join(root,a))},allowed=${JSON.stringify(join(root,b))},original=fs.openSync;
      let secretOpens=0,allowedOpens=0,control=false;
      fs.openSync=function(p,...args){if(String(p)===secret){secretOpens++;throw Error('FORBIDDEN_CONFIG_READ')}if(String(p)===allowed)allowedOpens++;return original.call(fs,p,...args)};
      try{fs.readFileSync(secret)}catch(e){control=e.message==='FORBIDDEN_CONFIG_READ'}secretOpens=0;allowedOpens=0;syncBuiltinESMExports();
      const {buildImpactWorkflow}=await import(${JSON.stringify(new URL('./curia-workflow.mjs',import.meta.url).href)});
      const report=buildImpactWorkflow(${JSON.stringify(root)},${JSON.stringify({...opts,changed:[guardCode],within:[a,b],configuration:'include'})});
      console.log(JSON.stringify({control,secretOpens,allowedOpens,complete:report.complete,gap:report.unresolved.some(f=>f.code==='impact/guard-sensitive-source'),privateSource:report.sourceRefs.some(r=>r.uri===${JSON.stringify(`repo:${a}`)})}));
    `],{cwd:root,env,encoding:'utf8',maxBuffer:16*1024*1024});
    const includeReads=includeProbe.status===0?JSON.parse(includeProbe.stdout):null;
    assert('guard-private-source-never-opened',includeReads?.control&&includeReads.secretOpens===0&&includeReads.allowedOpens>0&&!includeReads.complete&&includeReads.gap&&!includeReads.privateSource,includeProbe.stderr||JSON.stringify(includeReads));
    guarded.guards.local.privacy.sensitivePaths=[regPath];configure(guarded);
    reject('guard-private-registry-conflict',()=>plan({changed:[guardCode],within:[a,b],configuration:'include'}));
    for(const mode of ['only','include','inventory']){
      guarded.guards.local.privacy.sensitivePaths=['.agents'];configure(guarded);let conflict;secretDecodes=0;allowedDecodes=0;
      try{withDecoder(text=>{if(text.includes('CONFIG_A_BODY'))secretDecodes++;if(text.includes('CONFIG_B_BODY'))allowedDecodes++;},()=>plan({changed:[guardCode],within:[a,b],configuration:mode==='inventory'?'include':mode,inventoryOnly:mode==='inventory'}));}catch(e){conflict=e;}
      assert('guard-private-registry-parent-'+mode,conflict?.message==='敏感声明与配置分析来源冲突 [curia2/configuration-sensitive-registry]'&&secretDecodes===0&&allowedDecodes===0);
    }
    guarded.guards.local.privacy.sensitivePaths = []; guarded.guards.local.inputScope.paths = ['.']; configure(guarded);
    assert('guard-root-scope-preserves-exclusion', plan({ changed: [guardCode] }).impact.reviewPaths.join(',') === paths.filter(p=>p!==b).join(','));
    guarded.guards.local.inputScope.paths = ['docs/items'];
    const fresh = 'docs/items/new.md'; put(fresh,md('UNTRACKED_GUARD_INPUT')); configure(guarded);
    assert('guard-tracked-policy-respected', !plan({changed:[guardCode],includeUntracked:true}).impact.reviewPaths.includes(fresh));
    guarded.guards.local.inputScope.includeUntracked = true; configure(guarded);
    assert('guard-explicit-untracked-policy', plan({changed:[guardCode],includeUntracked:true}).impact.reviewPaths.includes(fresh));
    guarded.guards.local.inputScope.mode = 'filesystem'; guarded.guards.local.inputScope.includeIgnored = true; configure(guarded);
    assert('guard-filesystem-stays-in-impact-scope', plan({changed:[guardCode],within:[a],includeUntracked:true}).impact.reviewPaths.join(',') === a);
    remove(fresh); guarded.guards.local = structuredClone(guard); guarded.guards.local.inputScope = {mode:'git',paths:['docs/items'],exclusions:[b],includeUntracked:false,includeIgnored:false};
    guarded.guards.local.schema = 'curia.guard/2'; guarded.guards.local.repositoryInputs = [{id:'secondary',within:['foreign-input'],exclusions:[],includeUntracked:false}]; configure(guarded);
    report = plan({changed:[guardCode]}); assert('guard-multi-primary-declarations-only', report.complete && report.configuration.guardScope === 'primary-repository-declarations-only' && !JSON.stringify(report.configuration).includes('foreign-input') && report.impact.reviewPaths.join(',') === guardedPaths.join(','));
    const guardSound = structuredClone(report.configuration), guardDocs = report.configuration.documents;
    for (const [name, mutate] of [
      ['downgrade',c=>c.schema='curia.configuration-dependencies/2'], ['scope-upgrade',c=>c.guardScope='all-repositories'],
      ['wrong-field',c=>c.references.find(r=>r.kind==='guard-code').locator.pointer='/instance/guards/local/authorityLinks/0'],
      ['wrong-kind',c=>c.references.find(r=>r.kind==='guard-code').kind='surface-authority'],
      ['external-path',c=>c.references.find(r=>r.kind==='guard-code').target='/outside'],
    ]) {const bad=structuredClone(guardSound);mutate(bad);reject('guard-wire-'+name,()=>planImpact(guardDocs,[guardCode],{stable:true,configuration:bad,configurationOnly:true}));}
    const legacy = structuredClone(guardSound); legacy.schema='curia.configuration-dependencies/2';delete legacy.guardScope;legacy.references=legacy.references.filter(r=>!r.kind.startsWith('guard-'));
    assert('guard-legacy-config-keeps-own-vocabulary',planImpact(guardDocs,[guardCode],{stable:true,configuration:legacy,configurationOnly:true}).schema==='curia.impact-graph/3');
    configure(guarded);capability=cap();guarded.guards.local.command.identityPaths.push('checks/new-support.json');configure(guarded);projected=readInventoryConfiguration(capability);
    assert('guard-definition-drift-withdraws',!projected.stable&&!projected.references.length&&!projected.registry);
    // Authority paths must exist so the fixture reaches edge accounting, not the earlier path gate.
    const privateAuthorities=Array.from({length:4096},(_,i)=>`private/guard-${i}.md`);for(const path of privateAuthorities)put(path,'UNREAD_PRIVATE_AUTHORITY');
    guarded.guards = Object.fromEntries(Array.from({length:5},(_,n)=>['guard-'+n,{...structuredClone(guard),authorityLinks:privateAuthorities}]));configure(guarded);report=plan({within:[a],changed:[guardCode]});
    assert('guard-withheld-edges-consume-shared-budget',!report.complete&&report.configuration.truncated&&report.configuration.consideredEdges+report.configuration.consideredMoves<=IMPACT_LIMITS.maxEdges&&!JSON.stringify(report.configuration).includes('private/guard-'),JSON.stringify({complete:report.complete,configuration:report.configuration,unresolved:report.unresolved}));
    assert('guard-rule-history-frozen',MOVE_CONFIGURATION_IMPACT_RULES.find(r=>r.id==='curia-impact/configuration').version===2&&GUARD_CONFIGURATION_IMPACT_RULES.find(r=>r.id==='curia-impact/configuration').version===3);
    restore();
    // Old locator a@commit is intentionally also a real, reused current path a.
    const moveInstance = structuredClone(instance), revision = git('rev-parse', 'HEAD');
    moveInstance.moves = { schema: 'curia.moves/1', artifacts: [{ id: 'manual', current: b, previous: [{ path: a, revision, basis: [special] }] }] };
    const movePlan = extra => plan({ within: [a, b], changed: [special], ...extra });
    configure(moveInstance); report = movePlan();
    assert('move-basis-selective', report.complete && report.impact.reviewPaths.join(',') === b && report.configuration.moves.length === 1 && report.impact.moves[0].previous.revision === revision && report.impact.affected.find(d => d.path === b).reasons.some(r => r.kind === 'move-basis' && r.via === special));
    assert('move-config-does-not-verify-history-or-read-basis', report.sourceRefs.length === 1 && report.coverage.openedFiles === 0 && report.configuration.bodiesRead === 0 && !report.configuration.references.some(r => r.target === a) && report.limitations.includes('move-declarations-not-identity-or-approval-verification'));
    assert('move-edges-point-to-registry-not-body', report.configuration.moves[0].basis[0].locator.pointer === '/instance/moves/artifacts/0/previous/0/basis/0' && report.configuration.references.filter(r => r.kind === 'move-basis').every(r => r.locator.pointer === report.configuration.moves[0].basis[0].locator.pointer && r.declaration === regPath));
    report = movePlan({ changed: [a] }); assert('reused-historical-path-not-an-edge', report.complete && report.impact.reviewPaths.join(',') === a && report.impact.affected.every(d => d.path !== b));
    report = movePlan({ configuration: 'include' }); assert('move-basis-and-text-transitive', report.complete && report.impact.reviewPaths.join(',') === [a, b].join(',') && report.impact.affected.find(d => d.path === a).depth === 2);
    report = movePlan({ changed: [regPath] }); assert('move-registry-change-conservative', report.complete && report.impact.reviewPaths.join(',') === [a, b].join(','));
    moveInstance.moves.artifacts[0].previous[0].basis = [a]; configure(moveInstance);
    report = movePlan({ changed: [a] }); assert('reused-path-explicit-current-basis-is-an-edge', report.complete && report.impact.reviewPaths.join(',') === [a, b].join(','));
    moveInstance.moves.artifacts[0].previous[0].path = b; configure(moveInstance);
    report = movePlan({ changed: [a] }); assert('roundtrip-historical-current-name-not-self-basis', report.complete && report.impact.moves[0].previous.path === b && report.impact.reviewPaths.includes(b));
    moveInstance.moves.artifacts[0].previous[0] = { path: a, revision: 'f'.repeat(64), basis: [special] }; configure(moveInstance);
    report = movePlan(); assert('unobserved-history-remains-declaration-only', report.complete && report.impact.moves[0].previous.revision === 'f'.repeat(64) && report.sourceRefs.length === 1);
    moveInstance.moves.artifacts[0].previous.push({ path: a, revision, basis: [special] }); configure(moveInstance);
    report = movePlan(); assert('same-path-distinct-revisions-retained', report.complete && report.impact.moves.length === 2 && report.impact.affected.find(d => d.path === b).reasons.filter(r => r.kind === 'move-basis').length === 2);
    report = movePlan({ exclusions: [a] }); assert('excluded-history-withholds-rows-and-edges', !report.complete && has(report, 'configuration/move-withheld') && !report.configuration.moves.length && !report.configuration.references.some(r => r.kind === 'move-basis') && !JSON.stringify(report.configuration).includes(a));
    moveInstance.moves.artifacts[0].previous = [{ path: 'private/HIDDEN_MOVE_NAME.md', revision, basis: [special] }]; configure(moveInstance);
    report = movePlan(); assert('private-history-withholds-entire-binding', !report.complete && !JSON.stringify(report).includes('HIDDEN_MOVE_NAME') && report.configuration.consideredMoves === 1 && !report.impact.moves.length && !report.configuration.references.some(r => r.kind === 'move-basis'));
    moveInstance.moves.artifacts[0].previous[0] = { path: a, revision, basis: [special, 'docs/private/HIDDEN_BASIS_NAME.md'] }; configure(moveInstance);
    report = movePlan({ within: [b] }); assert('private-basis-hides-siblings-and-history', !report.complete && !JSON.stringify(report).includes('HIDDEN_BASIS_NAME') && !JSON.stringify(report.configuration).includes(a) && !report.configuration.moves.length && !report.configuration.references.some(r => r.kind === 'move-basis'));
    moveInstance.moves.artifacts[0].previous[0].basis = [special]; configure(moveInstance);
    report = movePlan({ changed: [regPath], exclusions: [special] }); assert('excluded-basis-atomic-withholding', !report.complete && !report.configuration.moves.length && !report.configuration.references.some(r => r.kind === 'move-basis'));
    report = movePlan({ within: [a] }); assert('unselected-move-no-phantom-gap-or-row', report.complete && !report.configuration.moves.length);
    capability = cap(); configure({ ...moveInstance, owner: 'changed-after-capture' }); projected = readInventoryConfiguration(capability);
    assert('move-registry-drift-withdraws-rows', !projected.stable && !projected.moves.length && !projected.references.length && !projected.registry); configure(moveInstance);
    mutated = false; report = withDecoder(text => { if (!mutated && text.includes('CONFIG_A_BODY')) { mutated = true; configure({ ...moveInstance, owner: 'move-drift' }); } }, () => movePlan({ configuration: 'include' }));
    assert('move-include-drift-withdraws-rows-and-evidence', mutated && !report.complete && !report.configuration.moves.length && !report.impact.moves.length && !report.sourceRefs.length && !report.impact.affected.length); configure(moveInstance);
    const sound = movePlan().configuration, soundDocs = [{ path: a }, { path: b }];
    for (const [name, mutate] of [
      ['missing-row', c => c.moves = []], ['missing-edge', c => c.references = c.references.filter(r => r.kind !== 'move-basis')],
      ['wrong-target', c => c.references.find(r => r.kind === 'move-basis').target = a], ['wrong-pointer', c => c.moves[0].basis[0].locator.pointer += '/0'],
      ['old-vocabulary', c => c.schema = 'curia.configuration-dependencies/1'], ['unknown-version', c => c.schema = 'curia.configuration-dependencies/4'],
      ['historical-basis-forgery', c => c.references.push({ ...c.references.find(r => r.kind === 'move-basis'), target: a })], ['duplicate-row', c => { c.moves.push(c.moves[0]); c.consideredMoves++; }],
      ['extra-row-field', c => c.moves[0].approved = true], ['ref-not-revision', c => c.moves[0].previous.revision = 'HEAD'], ['undeclared-current', c => c.moves[0].current = other],
      ['different-basis-role', c => c.references.find(r => r.kind === 'move-basis').kind = 'surface-authority'], ['unbudgeted-moves', c => c.consideredMoves = 0],
    ]) { const bad = structuredClone(sound); mutate(bad); reject('move-wire-' + name, () => planImpact(soundDocs, [special], { stable: true, configuration: bad, configurationOnly: true })); }
    const capped = structuredClone(sound); capped.consideredEdges = IMPACT_LIMITS.maxEdges - capped.consideredMoves;
    let moveGraph = planImpact([{ path: a, state: 'read', text: md('BODY', 'Normative-refs: [b](b.md)'), envelope: { format: 'md', status: 'current', gaps: [] }, binding: normalizeRelations(relations, 'fixture') }, { path: b }], [special], { stable: true, configuration: capped });
    assert('moves-withheld-declarations-reserve-joint-body-budget', !moveGraph.complete && moveGraph.truncated && moveGraph.moves.length === 1 && !moveGraph.references.some(r => r.field === 'Normative-refs'));
    // A group that cannot wholly fit must not leave an edge without its historical declaration.
    moveInstance.surfaces[1].authorityLinks = Array.from({ length: IMPACT_LIMITS.maxEdges - 3 }, (_, i) => `rules/authority-${i}.md`); for (const path of moveInstance.surfaces[1].authorityLinks) put(path, 'unread'); configure(moveInstance);
    report = movePlan({ within: [b] }); assert('move-budget-no-partial-group', !report.complete && report.configuration.truncated && !report.configuration.moves.length && !report.configuration.references.some(r => r.kind === 'move-basis') && report.configuration.consideredEdges === IMPACT_LIMITS.maxEdges - 1, JSON.stringify({ findings: report.unresolved, cost: report.configuration.consideredEdges, moves: report.configuration.consideredMoves })); restore();
    // Bound considered declarations too: many withheld links must not evade the edge budget.
    config = structuredClone(instance); config.surfaces[1].authorityLinks = Array.from({ length: 9000 }, (_, i) => `private/authority-${i}.md`); for (const path of config.surfaces[1].authorityLinks) put(path, 'unread'); configure(config);
    report = plan(); assert('withheld-edges-consume-budget', !report.complete && report.configuration.truncated && report.configuration.consideredEdges === IMPACT_LIMITS.maxEdges && report.configuration.findings.length < 10); restore();
    const binding = normalizeRelations(relations, 'fixture'), doc = (path, refs = '') => ({ path, state: 'read', text: md('BODY', refs), envelope: { format: 'md', status: 'current', gaps: [] }, binding });
    const configuration = references => ({ schema: 'curia.configuration-dependencies/1', stable: true, complete: true, references });
    const ref = (source, target) => ({ source, target, kind: 'surface-authority', field: 'Registry', declaration: regPath, locator: { kind: 'json-pointer/1', pointer: '/instance/surfaces/1/authorityLinks/0' } });
    let graph = planImpact([doc(a), doc(b)], [a], { stable: true, configuration: configuration([ref(a, b), ref(b, a)]), configurationOnly: true });
    assert('configuration-cycles-terminate', graph.schema === 'curia.impact-graph/2' && !Object.hasOwn(graph, 'moves') && graph.complete && graph.affected.length === 2 && graph.affected.find(d => d.path === b).depth === 1);
    graph = planImpact([doc(a)], [regPath], { stable: true, configuration: { ...configuration([]), stable: false }, configurationOnly: true }); assert('unstable-config-never-produces-candidates', !graph.complete && graph.affected.length === 0);
    for (const bad of [{ source: 'docs/outside.md' }, { kind: 'execute' }, { declaration: 'fake.json' }, { locator: { kind: 'line/1', pointer: '/bad' } }, { locator: { kind: 'json-pointer/1', pointer: 'bad' } }]) reject('invalid-configuration-edge-' + JSON.stringify(bad), () => planImpact([doc(a)], [b], { stable: true, configuration: configuration([{ ...ref(a, b), ...bad }]) }));
    reject('configuration-only-needs-projection', () => planImpact([doc(a)], [a], { stable: true, configurationOnly: true }));
    const dense = Array.from({ length: 256 }, (_, i) => doc(`docs/${i}.md`, 'Normative-refs: ' + Array.from({ length: 64 }, (_, n) => `[t](${n}.md)`).join(' ')));
    graph = planImpact(dense, ['docs/0.md'], { stable: true, configuration: configuration([ref('docs/0.md', regPath)]) });
    assert('configuration-shares-total-edge-budget', !graph.complete && graph.truncated && graph.references.length === IMPACT_LIMITS.maxEdges);
    let run = call(cliArgs); assert('actual-cli-config-zero', run.status === 0 && JSON.parse(run.stdout).complete, run.stderr);
    run = call([...cliArgs, '--max-files', '1']); assert('actual-cli-config-incomplete-one', run.status === 1 && !JSON.parse(run.stdout).complete);
    assert('actual-cli-config-invalid-two', call([...cliArgs, '--configuration', 'include']).status === 2);
    for (const extra of [['--configuration', 'auto'], ['--configuration', 'only', '--configuration', 'only'], ['--help', '--configuration', 'only'], ['--list-checks', '--configuration', 'unknown']]) reject('invalid-cli-' + extra.join('-'), () => parseImpactArgs(extra));
    run = call(['--list-checks', '--configuration', 'only', '--json']); assert('configuration-cli-contract-discovery', run.status === 0 && JSON.stringify(JSON.parse(run.stdout)) === JSON.stringify(GUARD_CONFIGURATION_IMPACT_RULES));
    run = call(['--list-checks', '--configuration', 'include', '--git-base', 'HEAD', '--json']); assert('configuration-git-cli-contract-discovery', run.status === 0 && JSON.stringify(JSON.parse(run.stdout)) === JSON.stringify(GIT_GUARD_CONFIGURATION_IMPACT_RULES));
    const gitOpts = { configuration: 'only', gitBase: 'HEAD', changesWithin: [regPath], within, nonSensitive: true }, gitPlan = extra => buildImpactWorkflow(root, { ...gitOpts, ...extra });
    report = gitPlan(); assert('git-no-changes-does-not-fake-config-check', report.complete && report.outcome === 'no-changes-within-scope' && !report.configuration && report.checks.find(c => c.id === 'curia-impact/configuration').state === 'not-applicable');
    configure({ ...instance, owner: 'worktree-change' }); report = gitPlan();
    assert('configuration-git-dirty-registry', report.complete && report.changeObservation.schema === 'curia.git-change-observation/3' && report.scope.changed.join(',') === regPath && report.impact.reviewPaths.length === paths.length && report.changeObservation.objects[0].worktreeChange === 'content', JSON.stringify(report.unresolved));
    git('add', '--', regPath); configure(); const beforeTwoAxis = readFileSync(join(root, '.git/index')); report = gitPlan();
    assert('configuration-git-two-axes', report.complete && report.changeObservation.objects[0].staged === 'content' && report.changeObservation.objects[0].worktreeChange === 'content' && readFileSync(join(root, '.git/index')).equals(beforeTwoAxis)); git('add', '--', regPath);
    reject('registry-stays-private-in-default-changes', () => normalizeGitChangeOptions({ base: 'HEAD', within: [regPath], nonSensitive: true }));
    reject('registry-opt-in-not-general-private-bypass', () => normalizeGitChangeOptions({ base: 'HEAD', within: ['private/data.json'], includeRegistry: true, nonSensitive: true }));
    let selection = prepareGitChangeSelection(root, { base: 'HEAD', within: ['.agents'], includeRegistry: true, nonSensitive: true }); assert('registry-requires-exact-change-path', selection.objects.every(o => o.path !== regPath));
    selection = prepareGitChangeSelection(root, { base: 'HEAD', within: [regPath], includeRegistry: true, nonSensitive: true }); assert('explicit-registry-capability-version', selection.schema === 'curia.git-change-selection/2' && selection.registryAuthorization === 'explicit-registry-path-only');
    configure({ ...instance, owner: 'changed-after-selection' }); projected = observeGitChanges(selection); assert('registry-git-selection-drift', !projected.complete && !projected.changed.length && !projected.openedFiles); restore();
    configure({ ...instance, owner: 'before-second-phase' }); report = gitPlan({ now: () => { configure({ ...instance, owner: 'during-second-phase' }); return new Date().toISOString(); } });
    assert('configuration-git-cross-phase-drift', !report.complete && !report.impact && !report.sourceRefs.length && !report.evidenceRefs.length && !report.changeObservation.complete && !report.scope.changed.length && !report.configuration?.registry); restore();
    const gitArgs = ['--configuration', 'only', '--git-base', 'HEAD', '--changes-within', regPath, '--within', 'docs/items', '--non-sensitive', '--strict', '--json'];
    configure({ ...instance, owner: 'cli-change' }); run = call(gitArgs); assert('actual-cli-config-git', run.status === 0 && JSON.parse(run.stdout).impact.reviewPaths.length === 5, run.stderr); restore();
    // A deliberately stale index must neither invoke clean filters nor refresh itself.
    put('driver.sh', '#!/bin/sh\nprintf executed >> "$PWD/DRIVER_EXECUTED"\ncat\n'); chmodSync(join(root, 'driver.sh'), 0o755);
    git('config', 'filter.hostile.clean', './driver.sh'); git('config', 'filter.hostile.smudge', './driver.sh'); git('config', 'diff.hostile.command', './driver.sh'); git('config', 'diff.hostile.textconv', './driver.sh'); git('config', 'core.fsmonitor', './driver.sh');
    put('.gitattributes', '.agents/doc-types.json filter=hostile diff=hostile\n');
    configure({ ...instance, owner: 'racy-original' }); utimesSync(join(root, regPath), new Date('2020-01-02'), new Date('2020-01-02')); git('-c', 'core.fsmonitor=false', 'add', '--', regPath);
    configure({ ...instance, owner: 'racy-modified' }); utimesSync(join(root, regPath), new Date('2020-01-02'), new Date('2020-01-02')); utimesSync(join(root, '.git/index'), new Date('2020-01-01'), new Date('2020-01-01')); git('config', 'core.trustctime', 'false'); remove('DRIVER_EXECUTED');
    const racyIndex = readFileSync(join(root, '.git/index')); report = gitPlan(); run = call(gitArgs);
    assert('configuration-racy-index-no-drivers-or-writes', report.complete && run.status === 0 && report.changeObservation.objects[0].worktreeChange === 'content' && !existsSync(join(root, 'DRIVER_EXECUTED')) && readFileSync(join(root, '.git/index')).equals(racyIndex));
    git('-c', 'core.fsmonitor=false', 'diff-files', '--no-ext-diff', '--name-only', '--', regPath); assert('configuration-driver-trap-positive-control', existsSync(join(root, 'DRIVER_EXECUTED'))); remove('DRIVER_EXECUTED');
    for (const key of ['filter.hostile.clean', 'filter.hostile.smudge', 'diff.hostile.command', 'diff.hostile.textconv', 'core.fsmonitor', 'core.trustctime']) git('config', '--unset', key); remove('.gitattributes'); restore(); git('add', '--', regPath);
    const registryOid = git('rev-parse', `HEAD:${regPath}`); git('update-index', '--cacheinfo', '120000', registryOid, regPath);
    reject('bad-registry-index-not-hidden-by-good-worktree', () => plan()); reject('bad-registry-index-not-hidden-in-git-mode', () => gitPlan()); git('add', '--', regPath);
    configure({ ...instance, owner: 'x'.repeat(1048576) }); reject('registry-cap-remains-bounded', () => plan()); restore();
  } finally { rmSync(root, { recursive: true, force: true }); }
}

if (isMainModule(import.meta.url)) {
  let passed = 0; const failures = [];
  configurationImpactFixtures({ registry: JSON.parse(readFileSync(join(ROOT, '.agents/doc-types.json'), 'utf8')), expectTrue: (name, ok, detail = '') => ok ? passed++ : failures.push(`${name}: ${detail}`) });
  console.log(JSON.stringify({ passed, failed: failures.length, failures }, null, 2)); if (failures.length) process.exitCode = 1;
}
