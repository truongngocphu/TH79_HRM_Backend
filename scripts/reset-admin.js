import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { connectDb } from '../src/config/db.js';
import { Users } from '../src/models/raw.js';

const login = process.argv[2] || 'admin';
const password = process.argv[3] || 'Admin@123456';

await connectDb();
const hash = await bcrypt.hash(password, 12);

const filter = {
  $or: [
    { username: new RegExp(`^${login}$`, 'i') },
    { email: new RegExp(`^${login}$`, 'i') },
    { is_super_admin: 1 },
    { username: 'admin' }
  ]
};

const count = await Users.countDocuments(filter);

if (count === 0) {
  console.log(`⚠️ Chưa có tài khoản admin. Đang khởi tạo tài khoản mới...`);
  await Users.create({
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
  console.log(`\n✅ TẠO MỚI TÀI KHOẢN ADMIN THÀNH CÔNG!`);
} else {
  await Users.updateMany(filter, {
    $set: {
      password_hash: hash,
      status: 'active',
      is_super_admin: 1,
      updated_at: new Date()
    }
  });
  console.log(`\n✅ ĐÃ CẬP NHẬT MẬT KHẨU CHO ${count} TÀI KHOẢN ADMIN TRONG DB!`);
}

console.log(`-------------------------------------------`);
console.log(`👉 Tên đăng nhập : admin`);
console.log(`👉 Mật khẩu mới  : ${password}`);
console.log(`-------------------------------------------\n`);

await mongoose.disconnect();
