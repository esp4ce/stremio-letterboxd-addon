// Fails on any high or critical advisory reported by `npm audit --json` on stdin,
// except the ones listed in ALLOWED. Each entry needs a reason and is removed once a fix ships.
const ALLOWED = new Map([
  // braces: every published version is affected and no fix exists yet. It only reaches us through
  // eslint-config-next (lint tooling, a devDependency never shipped to production).
  ['GHSA-vfj7-8cjw-p6xm', 'braces via eslint-config-next, no patched release'],
]);

const BLOCKING = new Set(['high', 'critical']);

let input = '';
for await (const chunk of process.stdin) input += chunk;
const report = JSON.parse(input);

const advisories = new Map();
for (const vuln of Object.values(report.vulnerabilities ?? {})) {
  for (const via of vuln.via) {
    if (typeof via === 'object' && BLOCKING.has(via.severity)) advisories.set(via.url, via);
  }
}

const blocking = [];
for (const [url, advisory] of advisories) {
  const id = url.split('/').pop();
  if (ALLOWED.has(id)) {
    console.log(`allowed  ${id}  ${advisory.name}: ${ALLOWED.get(id)}`);
  } else {
    blocking.push(`${advisory.severity.padEnd(8)} ${id}  ${advisory.name}: ${advisory.title}`);
  }
}

if (blocking.length > 0) {
  console.error(blocking.join('\n'));
  process.exit(1);
}
console.log('No unallowed high or critical advisories.');
