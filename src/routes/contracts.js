import { Router } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { EmployeeContracts, EmployeeContractFiles, ContractTypes, Employees } from '../models/raw.js';
import { can } from '../middleware/auth.js';
import { nextId } from '../utils/id.js';
import { audit } from '../services/auditService.js';
import { env } from '../config/env.js';
import { enrichEmployees } from '../services/employeeService.js';
import {
  cloudinaryAssetFields,
  cloudinaryFolder,
  destroyCloudinaryAsset,
  privateAssetUrl,
  sanitizeAssetPart,
  uploadBuffer
} from '../services/cloudinaryService.js';

const router = Router();
const legacyDir = path.resolve(process.cwd(), env.uploadDir);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^(image\/(png|jpeg|webp)|application\/pdf)$/.test(file.mimetype))
});

router.get('/types', can('contract.view'), async (req, res) => res.json({ items: await ContractTypes.find({ status: 'active' }).sort({ id: 1 }).lean() }));

router.get('/', can('contract.view'), async (req, res) => {
  const rows = await EmployeeContracts.find({}).sort({ id: -1 }).lean();
  const emps = await enrichEmployees(await Employees.find({ id: { $in: rows.map(x => x.employee_id) } }).lean());
  const types = await ContractTypes.find({}).lean();
  const em = new Map(emps.map(x => [Number(x.id), x]));
  const tm = new Map(types.map(x => [Number(x.id), x]));
  res.json({ items: rows.map(x => ({ ...x, employee: em.get(Number(x.employee_id)), contract_type_name: tm.get(Number(x.contract_type_id))?.contract_type_name })) });
});

router.post('/', can('contract.manage'), async (req, res) => {
  const id = await nextId('employee_contracts');
  const row = {
    id,
    company_id: 1,
    employee_id: Number(req.body.employee_id),
    contract_type_id: Number(req.body.contract_type_id),
    contract_no: req.body.contract_no || null,
    start_date: req.body.start_date || null,
    end_date: req.body.end_date || null,
    signed_date: req.body.signed_date || null,
    base_salary: Number(req.body.base_salary || 0),
    allowance_amount: Number(req.body.allowance_amount || 0),
    status: req.body.status || 'active',
    note: req.body.note || null,
    created_at: new Date(),
    updated_at: new Date()
  };
  await EmployeeContracts.create(row);
  await audit(req, { module: 'contracts', action: 'create', recordType: 'contract', recordId: id, employeeId: row.employee_id, description: 'Tạo hợp đồng nhân viên', newValues: row });
  res.status(201).json({ id });
});

router.post('/:id/files', can('contract.upload'), upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'Chưa chọn PDF hoặc ảnh hợp đồng.' });
    const contract = await EmployeeContracts.findOne({ id: Number(req.params.id) }).lean();
    if (!contract) return res.status(404).json({ message: 'Không tìm thấy hợp đồng.' });

    const id = await nextId('employee_contract_files');
    const originalBase = sanitizeAssetPart(path.parse(req.file.originalname).name, 'contract');
    const result = await uploadBuffer(req.file.buffer, {
      resourceType: 'image',
      deliveryType: 'authenticated',
      folder: cloudinaryFolder('contracts', `employee-${contract.employee_id}`),
      publicId: `contract-${contract.id}-${id}-${originalBase}-${Date.now()}`,
      context: `employee_id=${contract.employee_id}|contract_id=${contract.id}|file_id=${id}`,
      tags: ['th79-hrm', 'contract']
    });

    const cloud = cloudinaryAssetFields(result, { deliveryType: 'authenticated' });
    await EmployeeContractFiles.create({
      id,
      employee_contract_id: contract.id,
      original_name: req.file.originalname,
      file_path: null,
      mime_type: req.file.mimetype,
      file_size: req.file.size,
      ...cloud,
      uploaded_by: req.auth.user.id,
      created_at: new Date()
    });

    await audit(req, { module: 'contracts', action: 'upload', recordType: 'contract_file', recordId: id, employeeId: contract.employee_id, description: `Tải file hợp đồng lên Cloudinary: ${req.file.originalname}` });
    return res.status(201).json({ id, storageProvider: 'cloudinary', protected: true });
  } catch (error) { next(error); }
});

router.get('/files/:id', can('contract.view'), async (req, res, next) => {
  try {
    const file = await EmployeeContractFiles.findOne({ id: Number(req.params.id) }).lean();
    if (!file) return res.status(404).end();

    if (file.storage_provider === 'cloudinary' && file.cloudinary_public_id) {
      const url = privateAssetUrl({
        publicId: file.cloudinary_public_id,
        format: file.cloudinary_format || path.extname(file.original_name || '').slice(1),
        resourceType: file.cloudinary_resource_type || 'image',
        deliveryType: file.cloudinary_delivery_type || 'authenticated'
      }, { attachment: String(req.query.download || '') === '1' });
      return res.redirect(302, url);
    }

    if (file.file_path) {
      const p = path.join(legacyDir, path.basename(file.file_path));
      if (fs.existsSync(p)) {
        res.type(file.mime_type || 'application/octet-stream');
        return res.sendFile(p);
      }
    }

    if (file.cloudinary_secure_url) return res.redirect(302, file.cloudinary_secure_url);
    return res.status(404).json({ message: 'File hợp đồng chưa được migrate lên Cloudinary hoặc file nguồn không còn tồn tại.' });
  } catch (error) { next(error); }
});

router.delete('/files/:id', can('contract.upload'), async (req, res, next) => {
  try {
    const file = await EmployeeContractFiles.findOne({ id: Number(req.params.id) }).lean();
    if (!file) return res.status(404).json({ message: 'Không tìm thấy file hợp đồng.' });

    if (file.storage_provider === 'cloudinary' && file.cloudinary_public_id) {
      await destroyCloudinaryAsset({
        publicId: file.cloudinary_public_id,
        resourceType: file.cloudinary_resource_type || 'image',
        deliveryType: file.cloudinary_delivery_type || 'authenticated'
      });
    } else if (file.file_path) {
      const p = path.join(legacyDir, path.basename(file.file_path));
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }

    await EmployeeContractFiles.deleteOne({ id: file.id });
    return res.json({ ok: true });
  } catch (error) { next(error); }
});

export default router;
