import mongoose from 'mongoose';
import { connectDb } from '../src/config/db.js';
import { Users, UserRoles, Roles, UserPermissions } from '../src/models/raw.js';
import { idVariants } from '../src/utils/legacyId.js';

await connectDb();
const login = process.argv[2] || 'admin';
const user = await Users.findOne({ $or: [{ username: login }, { email: login }] }).lean();
console.log('\n=== TH79 AUTH DIAGNOSTIC ===');
if (!user) {
  console.error(`❌ Không tìm thấy tài khoản: ${login}`);
  await mongoose.disconnect();
  process.exit(1);
}
console.log({ username: user.username, status: user.status, legacyId: user.id ?? null, mongoId: String(user._id), isSuperAdmin: user.is_super_admin });
if (Number(user.is_super_admin) === 1) {
  console.log('✅ Super Admin có thể đăng nhập ngay cả khi legacy id đang thiếu ở V6.');
} else if (user.id == null) {
  console.warn('⚠️ Tài khoản thường đang thiếu legacy numeric id. Hãy chạy: npm run repair:legacy-ids -- --apply');
} else {
  const links = await UserRoles.find({ user_id: { $in: idVariants(user.id) } }).lean();
  const roles = links.length ? await Roles.find({ id: { $in: links.flatMap(x => idVariants(x.role_id)) } }).lean() : [];
  const overrides = await UserPermissions.countDocuments({ user_id: { $in: idVariants(user.id) } });
  console.log({ roleLinks: links.length, roles: roles.map(r => r.role_code), permissionOverrides: overrides });
  console.log('✅ Dữ liệu liên kết đăng nhập đã được đọc.');
}
await mongoose.disconnect();
