import { Branches, Departments, Positions } from '../models/raw.js';
import { recoveredLegacyId } from '../utils/legacySeedIdentity.js';

const configs = [
  { collection: 'branches', Model: Branches, codeKey: 'branch_code' },
  { collection: 'departments', Model: Departments, codeKey: 'department_code' },
  { collection: 'positions', Model: Positions, codeKey: 'position_code' }
];

let repairPromise = null;

function numeric(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Persist stable, unique numeric ids for organization dictionaries.
 *
 * During the MySQL -> MongoDB migration several original rows lost their `id`
 * field. The app could still recover those ids in memory from branch_code /
 * department_code / position_code, but a newly-created record could reuse the
 * same numeric id. That made employee.branch_id=1 resolve to the wrong branch.
 *
 * Rules:
 *  1. Seeded/migrated business codes keep their original legacy id.
 *  2. User-created rows keep a current id only when it does not collide with a
 *     reserved legacy id or another row.
 *  3. Collisions receive a new id above every known/reserved id.
 */
async function repairCollection({ collection, Model }) {
  const rows = await Model.find({}).sort({ created_at: 1, _id: 1 }).lean();
  if (!rows.length) return { collection, changed: 0, total: 0 };

  const seedIdByMongo = new Map();
  const reserved = new Set();
  let maxKnown = 0;

  for (const row of rows) {
    const recovered = numeric(recoveredLegacyId(collection, row));
    if (recovered) {
      seedIdByMongo.set(String(row._id), recovered);
      reserved.add(recovered);
      maxKnown = Math.max(maxKnown, recovered);
    }
    const current = numeric(row.id);
    if (current) maxKnown = Math.max(maxKnown, current);
  }

  const used = new Set();
  const assignments = new Map();

  // Seed identities win their historical id. Duplicate business-code rows do
  // not get the same id; only the first row can claim it.
  for (const row of rows) {
    const seedId = seedIdByMongo.get(String(row._id));
    if (!seedId || used.has(seedId)) continue;
    assignments.set(String(row._id), seedId);
    used.add(seedId);
  }

  let next = Math.max(maxKnown, ...used, 0) + 1;
  const nextFree = () => {
    while (used.has(next) || reserved.has(next)) next += 1;
    const out = next;
    used.add(out);
    next += 1;
    return out;
  };

  for (const row of rows) {
    const key = String(row._id);
    if (assignments.has(key)) continue;
    const current = numeric(row.id);
    if (current && !used.has(current) && !reserved.has(current)) {
      assignments.set(key, current);
      used.add(current);
    } else {
      assignments.set(key, nextFree());
    }
  }

  let changed = 0;
  for (const row of rows) {
    const assigned = assignments.get(String(row._id));
    if (Number(row.id) !== assigned || typeof row.id !== 'number') {
      await Model.updateOne({ _id: row._id }, { $set: { id: assigned, updated_at: new Date() } });
      changed += 1;
    }
  }

  return { collection, changed, total: rows.length };
}

export async function ensureOrganizationIds({ force = false } = {}) {
  if (!force && repairPromise) return repairPromise;
  repairPromise = (async () => {
    const result = [];
    for (const config of configs) result.push(await repairCollection(config));
    const changed = result.reduce((sum, x) => sum + x.changed, 0);
    if (changed) {
      console.log(`[organization] Đã chuẩn hóa ${changed} ID cơ cấu tổ chức để tránh trùng liên kết.`);
    }
    return result;
  })();

  try {
    return await repairPromise;
  } catch (error) {
    repairPromise = null;
    throw error;
  }
}
