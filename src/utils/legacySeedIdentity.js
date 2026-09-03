import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mapPath = path.resolve(__dirname, '../../seed/legacy_id_map.json');
let catalog = {};
try {
  catalog = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
} catch (error) {
  console.warn('[legacy-id] Không đọc được legacy_id_map.json:', error.message);
}

function norm(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim().toLowerCase();
}

function stableKey(collectionName, row = {}) {
  const cfg = catalog[collectionName];
  if (!cfg?.keys?.length) return null;
  const values = cfg.keys.map(k => norm(row[k]));
  if (values.some(v => v === '')) return null;
  return values.join('|');
}

export function recoveredLegacyId(collectionName, row = {}) {
  if (row?.id !== null && row?.id !== undefined && row?.id !== '') return row.id;
  const cfg = catalog[collectionName];
  const key = stableKey(collectionName, row);
  if (!cfg || !key) return null;
  return cfg.by_key?.[key] ?? null;
}

export function legacyIdentityById(collectionName, id) {
  const cfg = catalog[collectionName];
  if (!cfg || id === null || id === undefined) return null;
  return cfg.by_id?.[String(id)] ?? null;
}

export function hydrateLegacyId(collectionName, row) {
  if (!row) return row;
  const recovered = recoveredLegacyId(collectionName, row);
  const publicId = recovered ?? row.id ?? row._id?.toString?.() ?? row._id ?? null;
  return publicId == null ? { ...row } : { ...row, id: publicId };
}

export function hydrateLegacyIds(collectionName, rows = []) {
  return rows.map(row => hydrateLegacyId(collectionName, row));
}

export function publicId(row) {
  return row?.id ?? row?._id?.toString?.() ?? row?._id ?? null;
}
