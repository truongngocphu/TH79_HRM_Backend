import mongoose from 'mongoose';
import { Branches, Departments, Employees, Positions, ContractStatuses } from '../models/raw.js';
import { getByLegacyId, idVariants, mapByLegacyId } from '../utils/legacyId.js';
import { hydrateLegacyId, hydrateLegacyIds, legacyIdentityById } from '../utils/legacySeedIdentity.js';

/**
 * Resolve lookup names for migrated employees.
 * V7 also recovers legacy numeric IDs in memory from stable business keys
 * (employee_code, branch_code, position_code, ...). This keeps the UI usable
 * even before an optional database backfill is applied.
 */
export async function enrichEmployees(rows = []) {
  if (!rows.length) return [];

  const [rawBranches, rawDepartments, rawPositions, rawStatuses] = await Promise.all([
    Branches.find({}).lean(),
    Departments.find({}).lean(),
    Positions.find({}).lean(),
    ContractStatuses.find({}).lean()
  ]);

  const branches = hydrateLegacyIds('branches', rawBranches);
  const departments = hydrateLegacyIds('departments', rawDepartments);
  const positions = hydrateLegacyIds('positions', rawPositions);
  const statuses = hydrateLegacyIds('contract_statuses', rawStatuses);

  const maps = {
    branch: mapByLegacyId(branches),
    department: mapByLegacyId(departments),
    position: mapByLegacyId(positions),
    status: mapByLegacyId(statuses)
  };

  return rows.map(raw => {
    const row = hydrateLegacyId('employees', raw);
    return {
      ...row,
      branch_name: getByLegacyId(maps.branch, row.branch_id)?.branch_name || null,
      department_name: getByLegacyId(maps.department, row.department_id)?.department_name || null,
      position_name: getByLegacyId(maps.position, row.position_id)?.position_name || null,
      contract_status_name: getByLegacyId(maps.status, row.contract_status_id)?.status_name || null
    };
  });
}

export async function employeeById(id) {
  if (id === null || id === undefined || id === '' || id === 'undefined' || id === 'null') return null;

  let row = null;
  const variants = idVariants(id);
  if (variants.length) {
    row = await Employees.findOne({
      id: { $in: variants },
      $or: [{ deleted_at: null }, { deleted_at: { $exists: false } }]
    }).lean();
  }

  // Some early MongoDB conversions lost the legacy numeric `id` field.
  // If the URL contains Mongo _id, still allow the record to be opened.
  if (!row && mongoose.isValidObjectId(String(id))) {
    row = await Employees.findOne({
      _id: new mongoose.Types.ObjectId(String(id)),
      $or: [{ deleted_at: null }, { deleted_at: { $exists: false } }]
    }).lean();
  }

  // If the URL contains the old numeric MySQL ID but Mongo lost `id`, recover
  // the stable employee_code from our non-sensitive legacy identity catalog.
  if (!row && /^\d+$/.test(String(id))) {
    const identity = legacyIdentityById('employees', Number(id));
    if (identity?.employee_code) {
      row = await Employees.findOne({
        employee_code: identity.employee_code,
        $or: [{ deleted_at: null }, { deleted_at: { $exists: false } }]
      }).lean();
    }
  }

  if (!row) return null;
  return (await enrichEmployees([row]))[0];
}
