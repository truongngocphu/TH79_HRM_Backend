import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { connectDb } from '../src/config/db.js';
import { Users } from '../src/models/raw.js';

const login = process.argv[2] || 'admin';
const password = process.argv[3] || 'Admin@123456';

await connectDb();
const hash = await bcrypt.hash(password, 12);

// Tìm tài khoản theo username hoặc email (hoặc không phân biệt hoa thường)
const filter = {
  $or: [
    { username: new RegExp(`^${login}$`, 'i') },
    { email: new RegExp(`^${login}$`, 'i') },
    { username: 'admin' }
  ]
};

let user = await Users.findOne(filter).lean();

if (!user) {
  console.log(`⚠️ Không tìm thấy tài khoản '${login}'. Đang khởi tạo tài khoản Admin mới...`);
  const newUser = await Users.create({
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
  console.log(`\n✅ ĐÃ TẠO MỚI TÀI KHOẢN ADMIN:`);
  console.log(`👉 Username : admin`);
  console.log(`👉 Email    : admin@daututh79.com`);
  console.log(`👉 Mật khẩu : ${password}\n`);
} else {
  await Users.updateMany(filter, {
    $set: {
      password_hash: hash,
      status: 'active',
      is_super_admin: 1,
      updated_at: new Date()
    }
  });

  const updatedUsers = await Users.find(filter).lean();
  console.log(`\n✅ ĐÃ ĐẶT LẠI MẬT KHẨU THÀNH CÔNG CHO ${updatedUsers.length} TÀI KHOẢN:`);
  for (const u of updatedUsers) {
    console.log(`👉 Username : ${u.username}`);
    console.log(`👉 Email    : ${u.email}`);
    console.log(`👉 Mật khẩu : ${password}`);
  }
  console.log('');
}

await mongoose.disconnect();
