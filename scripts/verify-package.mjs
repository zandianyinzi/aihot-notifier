#!/usr/bin/env node
// Release check for aihot-notifier.zip. Run after packing: node scripts/verify-package.mjs [zip]
// Fails (exit 1) unless the ZIP holds exactly the pack.sh whitelist, every entry matches the
// working tree byte-for-byte, and every script/icon the extension references is packaged.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const zipPath = path.resolve(root, process.argv[2] || 'aihot-notifier.zip');
const ALLOWED_HOSTS = ['https://aihot.news/*'];
const problems = [];

// Minimal ZIP reader (stored + deflate), enough for archives produced by zip or .NET.
function readZip(file) {
  const buf = fs.readFileSync(file);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a ZIP archive (end of central directory not found)');
  const count = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(offset) !== 0x02014b50) throw new Error('corrupt central directory');
    const method = buf.readUInt16LE(offset + 10);
    const compressedSize = buf.readUInt32LE(offset + 20);
    const nameLength = buf.readUInt16LE(offset + 28);
    const extraLength = buf.readUInt16LE(offset + 30);
    const commentLength = buf.readUInt16LE(offset + 32);
    const localOffset = buf.readUInt32LE(offset + 42);
    const name = buf.toString('utf8', offset + 46, offset + 46 + nameLength);
    offset += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith('/')) continue;
    const dataStart = localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28);
    const raw = buf.subarray(dataStart, dataStart + compressedSize);
    if (method !== 0 && method !== 8) throw new Error(`${name}: unsupported compression method ${method}`);
    entries.set(name, method === 0 ? Buffer.from(raw) : zlib.inflateRawSync(raw));
  }
  return entries;
}

// The pack.sh `zip -r` argument list is the single whitelist source.
function readWhitelist() {
  const script = fs.readFileSync(path.join(root, 'pack.sh'), 'utf8').replace(/\r\n/g, '\n');
  const block = script.match(/zip -r \S+ \\\n([\s\S]*?)\n\s*-x /);
  if (!block) throw new Error('could not find the zip whitelist in pack.sh');
  const listed = block[1].split('\n').map(line => line.replace(/\\$/, '').trim()).filter(Boolean);
  return listed.flatMap(entry => {
    const full = path.join(root, entry);
    if (!fs.existsSync(full)) { problems.push(`pack.sh lists missing path: ${entry}`); return []; }
    if (!fs.statSync(full).isDirectory()) return [entry];
    return fs.readdirSync(full, { recursive: true })
      .map(child => path.posix.join(entry.replace(/\/$/, ''), child.split(path.sep).join('/')))
      .filter(child => fs.statSync(path.join(root, child)).isFile() && path.basename(child) !== '.DS_Store');
  });
}

let entries;
try {
  entries = readZip(zipPath);
} catch (error) {
  console.error(`✗ ${path.relative(root, zipPath)}: ${error.message}`);
  process.exit(1);
}

const expected = new Set(readWhitelist());
const actual = new Set(entries.keys());

for (const name of actual) {
  if (name.includes('\\')) problems.push(`entry uses a backslash path: ${name}`);
  if (path.posix.basename(name).startsWith('_')) problems.push(`entry name starts with "_" (Chrome rejects it): ${name}`);
  if (!expected.has(name)) problems.push(`entry is not in the pack.sh whitelist: ${name}`);
  else if (!entries.get(name).equals(fs.readFileSync(path.join(root, name)))) problems.push(`entry differs from the working tree: ${name}`);
}
for (const name of expected) {
  if (!actual.has(name)) problems.push(`whitelisted file missing from ZIP: ${name}`);
}

// Every file the extension loads must be inside the package.
const text = name => actual.has(name) ? entries.get(name).toString('utf8') : '';
let manifest = {};
try { manifest = JSON.parse(text('manifest.json')); } catch { problems.push('manifest.json missing or invalid'); }
const references = new Set([
  manifest.background?.service_worker,
  manifest.action?.default_popup,
  ...Object.values(manifest.icons || {}),
  ...Object.values(manifest.action?.default_icon || {})
].filter(Boolean));
for (const name of actual) {
  const body = name.endsWith('.js') || name.endsWith('.html') ? text(name) : '';
  for (const match of body.matchAll(/importScripts\(\s*'([^']+)'\s*\)/g)) references.add(match[1]);
  for (const match of body.matchAll(/<script\s+src="([^"]+)"/g)) references.add(match[1]);
  for (const match of body.matchAll(/['"](icons\/[\w.-]+\.png)['"]/g)) references.add(match[1]);
}
for (const ref of references) {
  if (!actual.has(ref)) problems.push(`referenced file not packaged: ${ref}`);
}

const workingVersion = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')).version;
if (manifest.version !== workingVersion) problems.push(`ZIP version ${manifest.version} != manifest.json ${workingVersion}`);
const hosts = manifest.host_permissions || [];
if (hosts.length !== ALLOWED_HOSTS.length || hosts.some(host => !ALLOWED_HOSTS.includes(host))) {
  problems.push(`host_permissions must stay ${JSON.stringify(ALLOWED_HOSTS)}, got ${JSON.stringify(hosts)}`);
}

if (problems.length > 0) {
  problems.forEach(problem => console.error(`✗ ${problem}`));
  process.exit(1);
}
console.log(`✓ ${path.relative(root, zipPath)} v${manifest.version}: ${actual.size} files match pack.sh and the working tree; ${references.size} references resolved`);
