import fs from 'fs';
import path from 'path';
import { connectDb } from '../src/config/db.js';
import { env } from '../src/config/env.js';
import {
  Users,
  EmployeeDocuments,
  EmployeeDocumentFiles,
  EmployeeContracts,
  EmployeeContractFiles
} from '../src/models/raw.js';
import {
  cloudinaryAssetFields,
  cloudinaryFolder,
  sanitizeAssetPart,
  uploadBuffer
} from '../src/services/cloudinaryService.js';

const legacyDir = path.resolve(process.cwd(), env.uploadDir);
const deleteLocal = String(process.env.DELETE_LOCAL_AFTER_CLOUDINARY || 'false') === 'true';

function localPath(value) {
  if (!value || /^https?:\/\//i.test(String(value))) return null;
  return path.join(legacyDir, path.basename(String(value)));
}

function isSupported(mime = '', fileName = '') {
  return /^image\/(png|jpeg|webp)$/i.test(mime) || mime === 'application/pdf' || /\.(png|jpe?g|webp|pdf)$/i.test(fileName);
}

async function migrateAvatars() {
  const rows = await Users.find({ avatar_path: { $nin: [null, ''] }, avatar_storage_provider: { $ne: 'cloudinary' } }).lean();
  let ok = 0, skipped = 0;
  for (const user of rows) {
    const p = localPath(user.avatar_path);
    if (!p || !fs.existsSync(p)) { console.warn(`Avatar bỏ qua: user ${user.id ?? user._id} - không thấy ${p || user.avatar_path}`); skipped++; continue; }
    const buffer = fs.readFileSync(p);
    const key = sanitizeAssetPart(user.id ?? user._id, 'user');
    const result = await uploadBuffer(buffer, {
      resourceType: 'image', deliveryType: 'upload', folder: cloudinaryFolder('avatars'),
      publicId: `user-${key}-${Date.now()}`, tags: ['th79-hrm', 'avatar', 'migrated']
    });
    const cloud = cloudinaryAssetFields(result, { deliveryType: 'upload' });
    await Users.updateOne({ _id: user._id }, { $set: {
      avatar_path: result.secure_url,
      avatar_storage_provider: 'cloudinary',
      avatar_cloudinary_public_id: cloud.cloudinary_public_id,
      avatar_cloudinary_asset_id: cloud.cloudinary_asset_id,
      avatar_cloudinary_secure_url: cloud.cloudinary_secure_url,
      avatar_cloudinary_resource_type: cloud.cloudinary_resource_type,
      avatar_cloudinary_delivery_type: cloud.cloudinary_delivery_type,
      avatar_cloudinary_format: cloud.cloudinary_format,
      avatar_cloudinary_version: cloud.cloudinary_version,
      updated_at: new Date()
    }});
    if (deleteLocal) fs.unlinkSync(p);
    ok++;
  }
  return { ok, skipped };
}

async function migrateDocuments() {
  const rows = await EmployeeDocumentFiles.find({ storage_provider: { $ne: 'cloudinary' }, file_path: { $nin: [null, ''] } }).lean();
  let ok = 0, skipped = 0;
  for (const file of rows) {
    const p = localPath(file.file_path);
    if (!p || !fs.existsSync(p) || !isSupported(file.mime_type, file.original_name)) { console.warn(`Hồ sơ bỏ qua: file ${file.id} - nguồn không tồn tại/không hỗ trợ`); skipped++; continue; }
    const doc = await EmployeeDocuments.findOne({ id: file.employee_document_id }).lean();
    if (!doc) { skipped++; continue; }
    const buffer = fs.readFileSync(p);
    const base = sanitizeAssetPart(path.parse(file.original_name || path.basename(p)).name, 'document');
    const result = await uploadBuffer(buffer, {
      resourceType: 'image', deliveryType: 'authenticated',
      folder: cloudinaryFolder('employee-documents', `employee-${doc.employee_id}`),
      publicId: `doc-${doc.document_type_id}-${file.id}-${base}-${Date.now()}`,
      tags: ['th79-hrm', 'employee-document', 'migrated']
    });
    const cloud = cloudinaryAssetFields(result, { deliveryType: 'authenticated' });
    await EmployeeDocumentFiles.updateOne({ _id: file._id }, { $set: { file_path: null, ...cloud } });
    if (deleteLocal) fs.unlinkSync(p);
    ok++;
  }
  return { ok, skipped };
}

async function migrateContracts() {
  const rows = await EmployeeContractFiles.find({ storage_provider: { $ne: 'cloudinary' }, file_path: { $nin: [null, ''] } }).lean();
  let ok = 0, skipped = 0;
  for (const file of rows) {
    const p = localPath(file.file_path);
    if (!p || !fs.existsSync(p) || !isSupported(file.mime_type, file.original_name)) { console.warn(`Hợp đồng bỏ qua: file ${file.id} - nguồn không tồn tại/không hỗ trợ`); skipped++; continue; }
    const contract = await EmployeeContracts.findOne({ id: file.employee_contract_id }).lean();
    if (!contract) { skipped++; continue; }
    const buffer = fs.readFileSync(p);
    const base = sanitizeAssetPart(path.parse(file.original_name || path.basename(p)).name, 'contract');
    const result = await uploadBuffer(buffer, {
      resourceType: 'image', deliveryType: 'authenticated',
      folder: cloudinaryFolder('contracts', `employee-${contract.employee_id}`),
      publicId: `contract-${contract.id}-${file.id}-${base}-${Date.now()}`,
      tags: ['th79-hrm', 'contract', 'migrated']
    });
    const cloud = cloudinaryAssetFields(result, { deliveryType: 'authenticated' });
    await EmployeeContractFiles.updateOne({ _id: file._id }, { $set: { file_path: null, ...cloud } });
    if (deleteLocal) fs.unlinkSync(p);
    ok++;
  }
  return { ok, skipped };
}

try {
  if (!env.cloudinaryConfigured) throw new Error('Cloudinary chưa cấu hình trong .env.');
  await connectDb();
  console.log(`Nguồn local: ${legacyDir}`);
  console.log('Bắt đầu migrate lên Cloudinary...');
  console.log('Avatar:', await migrateAvatars());
  console.log('Hồ sơ:', await migrateDocuments());
  console.log('Hợp đồng:', await migrateContracts());
  console.log('Hoàn tất. File local chỉ bị xóa khi DELETE_LOCAL_AFTER_CLOUDINARY=true.');
  process.exit(0);
} catch (error) {
  console.error('Migrate Cloudinary thất bại:', error);
  process.exit(1);
}
