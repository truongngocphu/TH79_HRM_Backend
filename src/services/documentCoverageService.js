import { DocumentTypes, EmployeeDocuments, EmployeeDocumentFiles } from '../models/raw.js';
import { idVariants } from '../utils/legacyId.js';
import { hydrateLegacyId, hydrateLegacyIds } from '../utils/legacySeedIdentity.js';

export async function getRequiredDocumentTypes() {
  const rows = await DocumentTypes.find({ status: 'active', is_required: { $in: [1, true, '1', 'true'] } }).sort({ id: 1 }).lean();
  return hydrateLegacyIds('document_types', rows);
}

function publicEmployeeId(row) {
  return hydrateLegacyId('employees', row)?.id ?? null;
}

function asKey(value) {
  const n = Number(value);
  return Number.isFinite(n) ? String(n) : String(value ?? '');
}

/**
 * Digital coverage is intentionally based on an actual stored file (Cloudinary
 * or legacy file_path), not only employee_documents.document_status. This
 * keeps the list filter, dashboard and employee detail in sync.
 */
export async function getDigitalDocumentCoverage(employeeRows = [], requiredTypes = null) {
  const employees = (employeeRows || []).map(row => ({ row, id: publicEmployeeId(row) })).filter(x => x.id != null);
  const types = requiredTypes || await getRequiredDocumentTypes();
  const requiredIds = types.map(x => Number(x.id)).filter(Number.isFinite);
  const employeeIdVariants = [...new Set(employees.flatMap(x => idVariants(x.id)))];

  const presentByEmployee = new Map(employees.map(x => [asKey(x.id), new Set()]));
  if (!employees.length || !requiredIds.length) {
    return {
      requiredTypes: types,
      requiredIds,
      presentByEmployee,
      completed: 0,
      missing: employees.length * requiredIds.length,
      totalRequired: employees.length * requiredIds.length,
      percent: requiredIds.length ? 0 : 100,
      missingEmployees: requiredIds.length ? employees.length : 0
    };
  }

  const rawDocs = await EmployeeDocuments.find({
    employee_id: { $in: employeeIdVariants },
    document_type_id: { $in: [...new Set(requiredIds.flatMap(idVariants))] }
  }).lean();
  const docs = hydrateLegacyIds('employee_documents', rawDocs);
  const docIdVariants = [...new Set(docs.flatMap(d => idVariants(d.id)))];
  const files = docIdVariants.length
    ? await EmployeeDocumentFiles.find({ employee_document_id: { $in: docIdVariants } }).lean()
    : [];
  const fileDocIds = new Set(files.flatMap(f => idVariants(f.employee_document_id)).map(v => String(v)));

  for (const doc of docs) {
    const employeeKey = asKey(doc.employee_id);
    const typeId = Number(doc.document_type_id);
    if (!presentByEmployee.has(employeeKey) || !requiredIds.includes(typeId)) continue;
    const hasCloudOrDbFile = idVariants(doc.id).some(v => fileDocIds.has(String(v)));
    const hasLegacyFile = Boolean(doc.file_path || doc.cloudinary_public_id || doc.cloudinary_secure_url);
    if (hasCloudOrDbFile || hasLegacyFile) presentByEmployee.get(employeeKey).add(typeId);
  }

  const completed = [...presentByEmployee.values()].reduce((sum, set) => sum + set.size, 0);
  const totalRequired = employees.length * requiredIds.length;
  const missing = Math.max(0, totalRequired - completed);
  const missingEmployees = [...presentByEmployee.values()].filter(set => set.size < requiredIds.length).length;
  const percent = totalRequired ? Math.round((completed / totalRequired) * 100) : 100;

  return { requiredTypes: types, requiredIds, presentByEmployee, completed, missing, totalRequired, percent, missingEmployees };
}
