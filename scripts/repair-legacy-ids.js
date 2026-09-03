import mongoose from 'mongoose';
import { connectDb } from '../src/config/db.js';
import { rawModel } from '../src/models/raw.js';

const apply = process.argv.includes('--apply');
const numericKeys = new Set([
  'id','company_id','branch_id','department_id','position_id','contract_status_id',
  'employee_id','user_id','role_id','permission_id','document_type_id',
  'employee_document_id','employee_contract_id','contract_type_id','owner_user_id',
  'case_id','completed_by','uploaded_by','reviewed_by','approved_by','parent_id',
  'candidate_id','job_id','course_id','payroll_period_id','record_id'
]);

await connectDb();
const db = mongoose.connection.db;
const collections = await db.listCollections().toArray();
let scanned = 0, changedDocs = 0, changedFields = 0;

for (const { name } of collections) {
  if (name.startsWith('system.')) continue;
  const col = db.collection(name);
  const cursor = col.find({});
  while (await cursor.hasNext()) {
    const doc = await cursor.next();
    scanned++;
    const set = {};
    for (const key of numericKeys) {
      const value = doc[key];
      if (typeof value !== 'string') continue;
      const text = value.trim();
      if (!/^-?\d+$/.test(text)) continue;
      const num = Number(text);
      if (!Number.isSafeInteger(num)) continue;
      set[key] = num;
      changedFields++;
    }
    if (Object.keys(set).length) {
      changedDocs++;
      if (apply) await col.updateOne({ _id: doc._id }, { $set: set });
    }
  }
}

console.log(`Scanned: ${scanned}`);
console.log(`Documents needing normalization: ${changedDocs}`);
console.log(`Legacy ID fields needing normalization: ${changedFields}`);
console.log(apply ? '✅ Đã chuẩn hóa kiểu dữ liệu ID.' : 'ℹ️ Dry-run. Dùng --apply nếu muốn ghi thay đổi.');
await mongoose.disconnect();
