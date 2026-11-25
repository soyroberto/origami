'use strict';

// Operator-only local CLI. This module never exposes an HTTP administration API.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DEFAULT_PATH = path.join(__dirname, 'authorized-users.local.json');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_FILE_BYTES = 64 * 1024;

function isUuid(value) {
  return typeof value === 'string' && UUID.test(value);
}

function readAllowlist(filePath = DEFAULT_PATH) {
  let fd;
  try {
    // Missing means nobody is authorized. Malformed/unreadable is NOT empty:
    // callers must deny access, and the CLI must not overwrite existing data.
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_FILE_BYTES) {
      throw new Error('Invalid private allowlist file');
    }
    fd = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const opened = fs.fstatSync(fd);
    if (!opened.isFile() || opened.size > MAX_FILE_BYTES) throw new Error('Invalid private allowlist file');
    const data = JSON.parse(fs.readFileSync(fd, 'utf8'));
    if (!data || data.version !== 1 || !Array.isArray(data.userIds) || !data.userIds.every(isUuid)) {
      throw new Error('Invalid allowlist schema');
    }
    return { ...data, userIds: [...new Set(data.userIds.map((id) => id.toLowerCase()))] };
  } catch (error) {
    if (error.code === 'ENOENT') return { version: 1, userIds: [] };
    throw new Error('Cannot read a valid private allowlist');
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function updateAllowlist(filePath, action, userId) {
  if (!['add', 'remove'].includes(action) || !isUuid(userId)) {
    throw new Error('Use add/remove with a UUID, never an email');
  }
  const absolute = path.resolve(filePath);
  const lockPath = absolute + '.lock';
  const temporary = path.join(path.dirname(absolute), '.' + path.basename(absolute) + '.' + crypto.randomBytes(12).toString('hex') + '.tmp');
  let lockFd;
  let tempFd;
  let tempCreated = false;
  try {
    // Serialize operator updates: never silently lose another CLI's additions.
    lockFd = fs.openSync(lockPath, 'wx', 0o600);
    const data = readAllowlist(absolute);
    const id = userId.toLowerCase();
    const ids = new Set(data.userIds);
    if (action === 'add') ids.add(id);
    else ids.delete(id);
    data.userIds = [...ids].sort();
    const content = JSON.stringify(data, null, 2) + '\n';
    if (Buffer.byteLength(content) > MAX_FILE_BYTES) throw new Error('Allowlist is too large');
    tempFd = fs.openSync(temporary, 'wx', 0o600);
    tempCreated = true;
    fs.writeFileSync(tempFd, content, 'utf8');
    fs.fchmodSync(tempFd, 0o600);
    fs.fsyncSync(tempFd);
    fs.closeSync(tempFd);
    tempFd = undefined;
    fs.renameSync(temporary, absolute);
    tempCreated = false;
    return data;
  } finally {
    if (tempFd !== undefined) fs.closeSync(tempFd);
    if (tempCreated) fs.unlinkSync(temporary);
    if (lockFd !== undefined) {
      fs.closeSync(lockFd);
      fs.unlinkSync(lockPath);
    }
  }
}

function main(args) {
  const [action, id] = args;
  if ((action === 'list' && args.length === 1) || (['add', 'remove'].includes(action) && args.length === 2 && isUuid(id))) {
    try {
      const result = action === 'list' ? readAllowlist() : updateAllowlist(DEFAULT_PATH, action, id);
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      return;
    } catch (_) {
      process.stderr.write('Allowlist update/read failed. Check the private file and any active operator lock; existing data was not discarded.\n');
      process.exitCode = 1;
      return;
    }
  }
  process.stderr.write('Usage: node beta/access.cjs add UUID | remove UUID | list\nOnly manually approved Supabase user UUIDs grant access. Emails never do.\n');
  process.exitCode = 1;
}

module.exports = { isUuid, readAllowlist, updateAllowlist };
if (require.main === module) main(process.argv.slice(2));
