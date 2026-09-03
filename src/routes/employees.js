import { Router } from 'express';
import multer from 'multer';
import * as XLSX from 'xlsx';
import {
  Employees, Branches, Departments, Positions, ContractStatuses,
  EmployeeDocuments, EmployeeDocumentFiles, EmployeeDocumentReviews, DocumentTypes,
  EmployeeContracts, EmployeeContractFiles, ContractTypes, EmployeeStatusHistory, SalaryProfiles, EmployeeDecisions
} from '../models/raw.js';
import { can } from '../middleware/auth.js';
import { enrichEmployees, employeeById } from '../services/employeeService.js';
import { nextId } from '../utils/id.js';
import { audit } from '../services/auditService.js';
import { escapeRegex } from '../utils/normalize.js';
import { getByLegacyId, idVariants, mapByLegacyId } from '../utils/legacyId.js';
import { hydrateLegacyId, hydrateLegacyIds } from '../utils/legacySeedIdentity.js';
import { getDigitalDocumentCoverage, getRequiredDocumentTypes } from '../services/documentCoverageService.js';
import { ensureOrganizationIds } from '../services/organizationService.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.get('/lookups', async (req, res, next) => {
  try {
    // Guarantees branch/department/position numeric ids are unique before they
    // are exposed as <option> values in employee forms.
    await ensureOrganizationIds();
    const [branches, departments, positions, statuses, documentTypes] = await Promise.all([
      Branches.find({ status: 'active' }).sort({ branch_name: 1 }).lean(),
      Departments.find({ status: 'active' }).sort({ department_name: 1 }).lean(),
      Positions.find({ status: 'active' }).sort({ position_name: 1 }).lean(),
      ContractStatuses.find({ is_active: 1 }).sort({ sort_order: 1 }).lean(),
      DocumentTypes.find({ status: 'active' }).sort({ id: 1 }).lean()
    ]);
    res.json({
      branches: hydrateLegacyIds('branches', branches),
      departments: hydrateLegacyIds('departments', departments),
      positions: hydrateLegacyIds('positions', positions),
      statuses: hydrateLegacyIds('contract_statuses', statuses),
      documentTypes: hydrateLegacyIds('document_types', documentTypes)
    });
  } catch (error) { next(error); }
});

router.get('/export', can('employee.view'), async (req, res) => {
  const rows = await enrichEmployees(await Employees.find({ deleted_at: null }).sort({ id: 1 }).lean());
  const data = rows.map(e => ({
    'Mã NV': e.employee_code,
    'Họ tên': e.full_name,
    'Giới tính': e.gender,
    'Ngày sinh': e.date_of_birth || '',
    'Điện thoại': e.phone || '',
    'Email': e.email || '',
    'CCCD': e.identity_number || '',
    'Chi nhánh': e.branch_name || '',
    'Phòng ban': e.department_name || '',
    'Chức vụ': e.position_name || '',
    'Ngày nhận việc': e.join_date || '',
    'Trạng thái': e.employment_status
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'NhanSu');
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
  res.setHeader('Content-Disposition', 'attachment; filename="TH79_NhanSu.xlsx"');
  res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(buf);
});


router.get('/export/csv', can('employee.view'), async (req, res) => {
  const rows = await enrichEmployees(await Employees.find({ deleted_at: null }).sort({ id: 1 }).lean());
  const headers = ['Mã NV','Họ tên','Giới tính','Ngày sinh','Điện thoại','Email','CCCD','Chi nhánh','Phòng ban','Chức vụ','Ngày nhận việc','Trạng thái'];
  const escape = value => `"${String(value ?? '').replace(/"/g,'""')}"`;
  const lines = [headers.map(escape).join(',')];
  for (const e of rows) lines.push([
    e.employee_code,e.full_name,e.gender,e.date_of_birth||'',e.phone||'',e.email||'',e.identity_number||'',
    e.branch_name||'',e.department_name||'',e.position_name||'',e.join_date||'',e.employment_status
  ].map(escape).join(','));
  const csv='\uFEFF'+lines.join('\r\n');
  res.setHeader('Content-Disposition','attachment; filename="TH79_NhanSu.csv"');
  res.type('text/csv; charset=utf-8').send(csv);
});

router.get('/import/template', can('employee.import'), async (req, res) => {
  const ws = XLSX.utils.json_to_sheet([{
    'Mã NV': 'TH79-NV0065', 'Họ tên': 'Nguyễn Văn A', 'Giới tính': 'male',
    'Ngày sinh': '2000-01-01', 'Điện thoại': '0900000000', 'Email': 'a@example.com',
    'CCCD': '001200000001', 'Chi nhánh': 'Trụ sở chính', 'Phòng ban': 'Kỹ thuật',
    'Chức vụ': 'Nhân viên kỹ thuật', 'Ngày nhận việc': '2026-08-28', 'Trạng thái': 'probation'
  }]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'NhanSu');
  res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    .send(XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' }));
});

router.post('/import/preview', can('employee.import'), upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'Chưa chọn file Excel.' });
  const wb = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: true });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
  const preview = [];
  for (const [i, r] of rows.entries()) {
    const code = String(r['Mã NV'] || r.employee_code || '').trim();
    const name = String(r['Họ tên'] || r.full_name || '').trim();
    const existing = code ? await Employees.findOne({ employee_code: code, deleted_at: null }).lean() : null;
    const errors = [];
    if (!name) errors.push('Thiếu họ tên');
    preview.push({
      row: i + 2,
      action: existing ? 'update' : 'create',
      employee_id: existing ? hydrateLegacyId('employees', existing).id : null,
      data: {
        employee_code: code, full_name: name, gender: r['Giới tính'] || 'unknown',
        date_of_birth: toDate(r['Ngày sinh']), phone: String(r['Điện thoại'] || ''),
        email: String(r['Email'] || ''), identity_number: String(r['CCCD'] || ''),
        join_date: toDate(r['Ngày nhận việc']), employment_status: r['Trạng thái'] || 'probation',
        branch_name: r['Chi nhánh'] || '', department_name: r['Phòng ban'] || '', position_name: r['Chức vụ'] || ''
      },
      errors
    });
  }
  res.json({
    preview,
    summary: { total: preview.length, valid: preview.filter(x => !x.errors.length).length, errors: preview.filter(x => x.errors.length).length }
  });
});

router.post('/import/confirm', can('employee.import'), async (req, res) => {
  const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
  const [rawBranches, rawDepartments, rawPositions] = await Promise.all([
    Branches.find({}).lean(), Departments.find({}).lean(), Positions.find({}).lean()
  ]);
  const branches = hydrateLegacyIds('branches', rawBranches);
  const departments = hydrateLegacyIds('departments', rawDepartments);
  const positions = hydrateLegacyIds('positions', rawPositions);
  let created = 0, updated = 0;
  for (const r of rows.filter(x => !x.errors?.length)) {
    const d = { ...r.data };
    d.branch_id = findName(branches, 'branch_name', d.branch_name);
    d.department_id = findName(departments, 'department_name', d.department_name);
    d.position_id = findName(positions, 'position_name', d.position_name);
    delete d.branch_name; delete d.department_name; delete d.position_name;
    if (r.employee_id) {
      const target = await employeeById(r.employee_id);
      if (target?._id) {
        await Employees.updateOne({ _id: target._id }, { $set: { ...d, updated_at: new Date() } });
        updated++;
      }
    } else {
      d.id = await nextId('employees');
      d.company_id = 1;
      d.employee_code = d.employee_code || `TH79-NV${String(d.id).padStart(4, '0')}`;
      d.contract_status_id = d.employment_status === 'probation' ? 2 : 1;
      d.created_at = new Date(); d.updated_at = new Date(); d.deleted_at = null;
      await Employees.create(d); created++;
    }
  }
  await audit(req, { module: 'employees', action: 'import', description: `Import Excel: ${created} mới, ${updated} cập nhật`, newValues: { created, updated } });
  res.json({ created, updated });
});

router.get('/', can('employee.view'), async (req, res) => {
  const page = Math.max(1, Number(req.query.page || 1));
  const limit = Math.min(100, Math.max(10, Number(req.query.limit || 20)));
  const filter = { $or: [{ deleted_at: null }, { deleted_at: { $exists: false } }] };
  if (req.query.status) filter.employment_status = req.query.status;
  if (req.query.branch_id) filter.branch_id = { $in: idVariants(req.query.branch_id) };
  if (req.query.department_id) filter.department_id = { $in: idVariants(req.query.department_id) };
  if (req.query.position_id) filter.position_id = { $in: idVariants(req.query.position_id) };
  if (req.query.q) {
    const rx = new RegExp(escapeRegex(req.query.q), 'i');
    filter.$and = [{ $or: [{ full_name: rx }, { employee_code: rx }, { phone: rx }, { email: rx }, { identity_number: rx }] }];
  }

  // Tình trạng hồ sơ được tính từ file số thực tế (Cloudinary hoặc file legacy),
  // không chỉ dựa vào document_status. Nhờ vậy bộ lọc phản ánh đúng file đã upload.
  const requiredTypes = await getRequiredDocumentTypes();
  const requiredIds = requiredTypes.map(x => Number(x.id)).filter(Number.isFinite);
  if (req.query.doc && requiredIds.length) {
    const candidates = await Employees.find(filter).lean();
    const coverage = await getDigitalDocumentCoverage(candidates, requiredTypes);
    const matchedMongoIds = candidates.filter(row => {
      const employee = hydrateLegacyId('employees', row);
      const count = coverage.presentByEmployee.get(String(Number(employee.id)))?.size || 0;
      return req.query.doc === 'missing' ? count < requiredIds.length
        : req.query.doc === 'complete' ? count >= requiredIds.length
        : true;
    }).map(row => row._id);
    filter._id = { $in: matchedMongoIds };
  }

  const [rows, total] = await Promise.all([
    Employees.find(filter).sort({ id: 1 }).skip((page - 1) * limit).limit(limit).lean(),
    Employees.countDocuments(filter)
  ]);
  const items = await enrichEmployees(rows);
  const pageCoverage = await getDigitalDocumentCoverage(rows, requiredTypes);
  res.json({
    items: items.map(e => ({
      ...e,
      document_completed: pageCoverage.presentByEmployee.get(String(Number(e.id)))?.size || 0,
      document_total: requiredIds.length,
      document_complete: requiredIds.length > 0 && (pageCoverage.presentByEmployee.get(String(Number(e.id)))?.size || 0) >= requiredIds.length
    })),
    page, limit, total, pages: Math.ceil(total / limit)
  });
});

router.get('/:id', can('employee.view'), async (req, res) => {
  const employee = await employeeById(req.params.id);
  if (!employee) return res.status(404).json({ message: 'Không tìm thấy nhân viên.' });
  // Query related collections by the recovered legacy employee ID, not by a
  // possibly Mongo ObjectId URL. This prevents cross-employee data leaks and
  // incorrect document/history counts on migrated databases.
  const employeeIds = idVariants(employee.id);

  const [documents, contracts, history, types, contractTypes, salaryProfiles, decisions] = await Promise.all([
    EmployeeDocuments.find({ employee_id: { $in: employeeIds } }).sort({ document_type_id: 1 }).lean(),
    EmployeeContracts.find({ employee_id: { $in: employeeIds } }).sort({ id: -1 }).lean(),
    EmployeeStatusHistory.find({ employee_id: { $in: employeeIds } }).sort({ effective_date: -1, id: -1 }).lean(),
    DocumentTypes.find({}).lean(),
    ContractTypes.find({}).lean(),
    SalaryProfiles.find({ employee_id: { $in: employeeIds } }).sort({ effective_from: -1, id: -1 }).lean(),
    EmployeeDecisions.find({ employee_id: { $in: employeeIds } }).sort({ effective_date: -1, decision_date: -1, id: -1 }).lean()
  ]);

  const safeDocuments = hydrateLegacyIds('employee_documents', documents);
  const safeTypes = hydrateLegacyIds('document_types', types);
  const safeContractTypes = hydrateLegacyIds('contract_types', contractTypes);
  const docIds = safeDocuments.flatMap(d => idVariants(d.id));
  // Contracts may not have a stable legacy key in very old conversions. Keep
  // Mongo _id as a UI-safe id if needed; related files still use legacy ids
  // when they are present.
  const safeContracts = contracts.map(c => hydrateLegacyId('employee_contracts', c));
  const contractIds = safeContracts.flatMap(c => idVariants(c.id)).filter(x => !String(x).match(/^[0-9a-f]{24}$/i));
  const [reviews, docFiles, contractFiles] = await Promise.all([
    docIds.length ? EmployeeDocumentReviews.find({ employee_document_id: { $in: docIds } }).sort({ reviewed_at: -1, id: -1 }).lean() : [],
    docIds.length ? EmployeeDocumentFiles.find({ employee_document_id: { $in: docIds } }).sort({ uploaded_at: -1, id: -1 }).lean() : [],
    contractIds.length ? EmployeeContractFiles.find({ employee_contract_id: { $in: contractIds } }).sort({ uploaded_at: -1, id: -1 }).lean() : []
  ]);

  const typeMap = mapByLegacyId(safeTypes);
  const contractTypeMap = mapByLegacyId(safeContractTypes);
  const reviewsByDoc = new Map();
  for (const r of reviews) {
    const key = String(Number(r.employee_document_id));
    if (!reviewsByDoc.has(key)) reviewsByDoc.set(key, r);
  }
  const filesByDoc = groupByLegacyForeignKey(docFiles, 'employee_document_id');
  const filesByContract = groupByLegacyForeignKey(contractFiles, 'employee_contract_id');

  res.json({
    employee,
    documents: safeDocuments.map(d => {
      const review = reviewsByDoc.get(String(Number(d.id)));
      return {
        ...d,
        document_type_name: getByLegacyId(typeMap, d.document_type_id)?.document_name || '',
        verification_status: review?.review_status || d.verification_status || 'pending',
        verification_note: review?.note || null,
        files: filesByDoc.get(String(Number(d.id))) || []
      };
    }),
    contracts: safeContracts.map(c => ({
      ...c,
      contract_type_name: getByLegacyId(contractTypeMap, c.contract_type_id)?.contract_type_name || '',
      files: filesByContract.get(String(Number(c.id))) || []
    })),
    history: history.map(h => ({ ...h, id: h.id ?? h._id?.toString?.() ?? h._id })),
    contractTypes: safeContractTypes,
    salaryProfiles: salaryProfiles.map(x => ({ ...x, id: x.id ?? x._id?.toString?.() ?? x._id })),
    decisions: decisions.map(x => ({ ...x, id: x.id ?? x._id?.toString?.() ?? x._id }))
  });
});

router.post('/', can('employee.create'), async (req, res) => {
  const id = await nextId('employees');
  const d = sanitizeEmployee(req.body);
  d.id = id; d.company_id = 1;
  d.employee_code = d.employee_code || `TH79-NV${String(id).padStart(4, '0')}`;
  d.created_at = new Date(); d.updated_at = new Date(); d.deleted_at = null;
  await Employees.create(d);
  await EmployeeStatusHistory.create({ id: await nextId('employee_status_history'), employee_id: id, old_status: null, new_status: d.employment_status || 'active', effective_date: new Date().toISOString().slice(0, 10), reason: 'Tạo hồ sơ' });
  await audit(req, { module: 'employees', action: 'create', recordType: 'employee', recordId: id, employeeId: id, description: `Tạo hồ sơ nhân viên: ${d.full_name}`, newValues: d });
  res.status(201).json({ id });
});

router.put('/:id', can('employee.update'), async (req, res) => {
  const old = await employeeById(req.params.id);
  if (!old) return res.status(404).json({ message: 'Không tìm thấy nhân viên.' });
  const d = sanitizeEmployee(req.body);
  await Employees.updateOne({ _id: old._id }, { $set: { ...d, updated_at: new Date() } });
  if (d.employment_status && d.employment_status !== old.employment_status) {
    await EmployeeStatusHistory.create({ id: await nextId('employee_status_history'), employee_id: Number(old.id), old_status: old.employment_status, new_status: d.employment_status, effective_date: new Date().toISOString().slice(0, 10), reason: 'Cập nhật hồ sơ' });
  }
  await audit(req, { module: 'employees', action: 'update', recordType: 'employee', recordId: old.id, employeeId: old.id, description: `Cập nhật hồ sơ nhân viên: ${old.full_name}`, oldValues: old, newValues: d });
  res.json({ ok: true, id: old.id });
});

router.delete('/:id', can('employee.delete'), async (req, res) => {
  const e = await employeeById(req.params.id);
  if (!e) return res.status(404).json({ message: 'Không tìm thấy nhân viên.' });
  await Employees.updateOne({ _id: e._id }, { $set: { deleted_at: new Date(), employment_status: 'inactive', updated_at: new Date() } });
  await audit(req, { module: 'employees', action: 'delete', recordType: 'employee', recordId: e.id, employeeId: e.id, description: `Xóa mềm hồ sơ: ${e.full_name}` });
  res.json({ ok: true });
});

function toDate(v) {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'number') {
    const p = XLSX.SSF.parse_date_code(v);
    return p ? new Date(Date.UTC(p.y, p.m - 1, p.d)) : null;
  }
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function findName(rows, key, value) {
  const n = String(value || '').trim().toLowerCase();
  return rows.find(x => String(x[key] || '').trim().toLowerCase() === n)?.id || null;
}

function groupByLegacyForeignKey(rows, key) {
  const out = new Map();
  for (const row of rows) {
    const k = String(Number(row[key]));
    if (!out.has(k)) out.set(k, []);
    out.get(k).push(row);
  }
  return out;
}

function sanitizeEmployee(b) {
  const keys = [
    'branch_id','department_id','position_id','contract_status_id','employee_code','full_name','gender',
    'date_of_birth','professional_qualification','identity_number','permanent_address','current_address','phone','email',
    'social_insurance_number','social_insurance_status','social_insurance_raw','join_date','probation_end_date',
    'recruitment_decision_no','employment_status','note'
  ];
  const o = {};
  for (const k of keys) if (Object.prototype.hasOwnProperty.call(b, k)) o[k] = b[k];
  for (const k of ['branch_id','department_id','position_id','contract_status_id']) o[k] = o[k] ? Number(o[k]) : null;
  return o;
}

export default router;
