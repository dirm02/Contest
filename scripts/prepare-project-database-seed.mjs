#!/usr/bin/env node
import { constants, existsSync, mkdirSync, readdirSync, rmSync, copyFileSync, lstatSync, linkSync, symlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const args = new Set(process.argv.slice(2));
const getArg = (name, fallback) => {
  const prefix = `${name}=`;
  const hit = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
};

const sourceRepo = resolve(getArg('--source', '/home/david/GitHub/hackathon2026'));
const seedDir = resolve(getArg('--seed-dir', 'services/postgres/seed'));
const mode = args.has('--copy') ? 'copy' : args.has('--symlink') ? 'symlink' : 'hardlink';

const sourceLocalDb = join(sourceRepo, '.local-db');
const sourceDataset = join(sourceRepo, 'dataset');
const targetLocalDb = join(seedDir, '.local-db');
const targetData = join(targetLocalDb, 'data');

function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

function copyTree(source, target, options = {}) {
  ensureDir(target);
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (options.exclude?.has(entry.name)) continue;
    const sourcePath = join(source, entry.name);
    const targetPath = join(target, entry.name);
    if (entry.isDirectory()) {
      copyTree(sourcePath, targetPath, options);
    } else if (entry.isSymbolicLink()) {
      const real = resolve(dirname(sourcePath), lstatSync(sourcePath).isSymbolicLink() ? sourcePath : '');
      symlinkSync(real, targetPath);
    } else if (entry.isFile()) {
      copyFileSync(sourcePath, targetPath, constants.COPYFILE_FICLONE);
    }
  }
}

function linkTree(source, target, linkMode) {
  ensureDir(target);
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const sourcePath = join(source, entry.name);
    const targetPath = join(target, entry.name);
    if (entry.isDirectory()) {
      linkTree(sourcePath, targetPath, linkMode);
    } else if (entry.isFile()) {
      if (linkMode === 'copy') {
        copyFileSync(sourcePath, targetPath, constants.COPYFILE_FICLONE);
      } else if (linkMode === 'symlink') {
        symlinkSync(sourcePath, targetPath);
      } else {
        try {
          linkSync(sourcePath, targetPath);
        } catch (error) {
          if (error.code !== 'EXDEV') throw error;
          copyFileSync(sourcePath, targetPath, constants.COPYFILE_FICLONE);
        }
      }
    }
  }
}

if (!existsSync(sourceLocalDb)) {
  throw new Error(`Missing source .local-db directory: ${sourceLocalDb}`);
}
if (!existsSync(sourceDataset)) {
  throw new Error(`Missing source dataset directory: ${sourceDataset}`);
}

ensureDir(seedDir);
rmSync(targetLocalDb, { recursive: true, force: true });
ensureDir(targetLocalDb);

copyTree(sourceLocalDb, targetLocalDb, {
  exclude: new Set(['node_modules', 'data', '.env']),
});

linkTree(sourceDataset, targetData, mode);

console.log(`Prepared project-local database seed at ${targetLocalDb}`);
console.log(`Dataset mode: ${mode}`);
console.log(`Next: run scripts/export-entity-vectors.mjs so vector data is present under ${join(seedDir, 'entity-vectors')}`);
