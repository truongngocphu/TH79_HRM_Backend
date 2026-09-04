import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { connectDb } from '../src/config/db.js';

const login = (process.argv[2] || 'admin').trim();
const password = process.argv[3] || 'Admin@123456';

await connectDb();

const db = mongoose.connection.db;
const usersCol = db.collection('users');

const hash = await bcrypt.hash(password, 10);

console.log(`🔍 Đang quét tài khoản '${login}' trong Database '${db.databaseName}'...`);

const filter = {
  $or: [
    { username: login },
    { username: 'admin' },
    { email: login },
    { email: 'admin@daututh79.com' },
    { is_super_admin: 1 },
    { is_super_admin: '1' }
  ]
};

const result = await usersCol.updateMany(filter, {
  $set: {
    password_hash: hash,
    status: 'active',
    is_super_admin: 1,
    updated_at: new Date()
  }
});

const matchedCount = result.matchedCount || result.modifiedCount || 0;

if (matchedCount === 0) {
  console.log(`⚠️ Không tìm thấy user phù hợp. Đang tạo mới tài khoản admin...`);
  await usersCol.insertOne({
    id: 1,
    username: 'admin',
    email: 'admin@daututh79.com',
    full_name: 'Quản trị hệ thống',
    password_hash: hash,
    status: 'active',
    is_super_admin: 1,
    created_at: new Date(),
    updated_at: new Date()
  });
  console.log(`✅ Đã tạo mới thành công tài khoản 'admin' với mật khẩu: ${password}`);
} else {
  console.log(`✅ Đã đặt lại mật khẩu cho ${matchedCount} tài khoản Admin trong DB!`);
  const updatedUsers = await usersCol.find(filter).toArray();
  console.log('\n📋 DANH SÁCH TÀI KHOẢN ĐĂNG NHẬP CHUẨN:');
  updatedUsers.forEach(u => {
    console.log(`  👉 Username : "${u.username}"`);
    console.log(`  👉 Email    : "${u.email}"`);
    console.log(`  👉 Mật khẩu : "${password}"`);
    console.log(`  -----------------------------------`);
  });
}

console.log('\n✨ XONG! Bây giờ bạn hãy gõ lệnh: pm2 restart th79hrm\n');
await mongoose.disconnect();
