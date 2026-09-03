import { Router } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { EmployeeDocuments, EmployeeDocumentFiles, EmployeeDocumentReviews } from '../models/raw.js';
import { can, anyPermission } from '../middleware/auth.js';
import { nextId } from '../utils/id.js';
import { idVariants } from '../utils/legacyId.js';
import { hydrateLegacyId } from '../utils/legacySeedIdentity.js';
import { audit } from '../services/auditService.js';
import { env } from '../config/env.js';
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
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /^(image\/(png|jpeg|webp)|application\/pdf)$/.test(file.mimetype);
    if (allowed) return cb(null, true);
    const error = new Error('Chỉ hỗ trợ PDF, PNG, JPG/JPEG hoặc WEBP.');
    error.status = 415;
    return cb(error);
  }
});

router.post('/upload', can('document.upload'), upload.single('file'), async (req, res, next) => {
  try {
    const employeeId = Number(req.body.employee_id);
    const typeId = Number(req.body.document_type_id);
    if (!employeeId || !typeId || !req.file) {
      return res.status(400).json({ message: 'Thiếu nhân viên, loại hồ sơ hoặc tệp PDF/ảnh.' });
    }

    let rawDoc = await EmployeeDocuments.findOne({
      employee_id: { $in: idVariants(employeeId) },
      document_type_id: { $in: idVariants(typeId) }
    }).lean();
    let doc;
    if (!rawDoc) {
      doc = {
        id: await nextId('employee_documents'),
        employee_id: employeeId,
        document_type_id: typeId,
        document_status: 'uploaded',
        issued_date: null,
        expiry_date: req.body.expiry_date || null,
        note: req.body.note || null,
        created_at: new Date(),
        updated_at: new Date()
      };
      await EmployeeDocuments.create(doc);
    } else {
      // Một số bản migrate cũ mất cột id. Khôi phục ID ổn định trước khi tạo
      // employee_document_files để file Cloudinary luôn liên kết đúng hồ sơ.
      doc = hydrateLegacyId('employee_documents', rawDoc);
      if (!Number.isFinite(Number(doc.id))) doc.id = await nextId('employee_documents');
      if (rawDoc.id === null || rawDoc.id === undefined || rawDoc.id === '') {
        await EmployeeDocuments.updateOne({ _id: rawDoc._id }, { $set: { id: Number(doc.id), updated_at: new Date() } });
      }
    }

    const id = await nextId('employee_document_files');
    const originalBase = sanitizeAssetPart(path.parse(req.file.originalname).name, 'document');
    const result = await uploadBuffer(req.file.buffer, {
      resourceType: 'image', // Cloudinary hỗ trợ PDF dưới resource_type=image, ảnh scan cũng dùng image.
      deliveryType: 'authenticated',
      folder: cloudinaryFolder('employee-documents', `employee-${employeeId}`),
      publicId: `doc-${typeId}-${id}-${originalBase}-${Date.now()}`,
      context: `employee_id=${employeeId}|document_type_id=${typeId}|file_id=${id}`,
      tags: ['th79-hrm', 'employee-document']
    });

    const cloud = cloudinaryAssetFields(result, { deliveryType: 'authenticated' });
    await EmployeeDocumentFiles.create({
      id,
      employee_document_id: doc.id,
      original_name: req.file.originalname,
      file_path: null,
      mime_type: req.file.mimetype,
      file_size: req.file.size,
      ...cloud,
      uploaded_by: req.auth.user.id,
      created_at: new Date()
    });

    await EmployeeDocuments.updateOne({ id: doc.id }, {
      $set: {
        document_status: 'uploaded',
        note: req.body.note ?? doc.note ?? null,
        expiry_date: req.body.expiry_date ?? doc.expiry_date ?? null,
        updated_at: new Date()
      }
    });

    await audit(req, {
      module: 'documents',
      action: 'upload',
      recordType: 'employee_document_file',
      recordId: id,
      employeeId,
      description: `Tải hồ sơ nhân viên lên Cloudinary: ${req.file.originalname}`
    });

    return res.status(201).json({
      ok: true,
      id,
      employeeDocumentId: Number(doc.id),
      storageProvider: 'cloudinary',
      protected: true,
      message: 'Tải hồ sơ lên Cloudinary thành công.'
    });
  } catch (error) { next(error); }
});

router.get('/file/:id', anyPermission('document.view', 'employee.view'), async (req, res, next) => {
  try {
    const file = await EmployeeDocumentFiles.findOne({ id: Number(req.params.id) }).lean();
    if (!file) return res.status(404).json({ message: 'Không tìm thấy tệp.' });

    if (file.storage_provider === 'cloudinary' && file.cloudinary_public_id) {
      const url = privateAssetUrl({
        publicId: file.cloudinary_public_id,
        format: file.cloudinary_format || path.extname(file.original_name || '').slice(1),
        resourceType: file.cloudinary_resource_type || 'image',
        deliveryType: file.cloudinary_delivery_type || 'authenticated'
      }, { attachment: String(req.query.download || '') === '1' });
      return res.redirect(302, url);
    }

    // Chỉ giữ khả năng đọc dữ liệu local cũ trong thời gian migrate.
    if (file.file_path) {
      const p = path.join(legacyDir, path.basename(file.file_path));
      if (fs.existsSync(p)) {
        res.type(file.mime_type || 'application/octet-stream');
        if (String(req.query.download || '') === '1') res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.original_name || path.basename(p))}"`);
        return res.sendFile(p);
      }
    }

    if (file.cloudinary_secure_url) return res.redirect(302, file.cloudinary_secure_url);
    return res.status(404).json({ message: 'Tệp chưa được migrate lên Cloudinary hoặc file nguồn không còn tồn tại.' });
  } catch (error) { next(error); }
});

router.post('/review', can('document.view'), async (req, res) => {
  const docId = Number(req.body.employee_document_id);
  const status = String(req.body.status || 'pending');
  await EmployeeDocuments.updateOne({ id: docId }, { $set: { verification_status: status, updated_at: new Date() } });
  await EmployeeDocumentReviews.create({
    id: await nextId('employee_document_reviews'),
    employee_document_id: docId,
    review_status: status,
    note: req.body.note || null,
    reviewed_by: req.auth.user.id,
    reviewed_at: new Date(),
    created_at: new Date()
  });
  await audit(req, { module: 'documents', action: 'review', recordType: 'employee_document', recordId: docId, description: `Xác minh hồ sơ: ${status}` });
  res.json({ ok: true });
});

router.delete('/file/:id', can('document.delete'), async (req, res, next) => {
  try {
    const file = await EmployeeDocumentFiles.findOne({ id: Number(req.params.id) }).lean();
    if (!file) return res.status(404).json({ message: 'Không tìm thấy tệp.' });

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

    await EmployeeDocumentFiles.deleteOne({ id: file.id });
    await audit(req, { module: 'documents', action: 'delete', recordType: 'employee_document_file', recordId: file.id, description: 'Xóa tệp hồ sơ nhân viên' });
    return res.json({ ok: true });
  } catch (error) { next(error); }
});

export default router;
