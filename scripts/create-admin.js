import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { connectDb } from '../src/config/db.js';
import { Users } from '../src/models/raw.js';
import { nextId } from '../src/utils/id.js';

async function createOrUpdateAdmin() {
  const username = process.argv[2] || 'admin';
  const password = process.argv[3] || 'Admin@123456';
  const email = process.argv[4] || 'admin@th79.vn';

  await connectDb();

  const hash = await bcrypt.hash(password, 12);
  const existing = await Users.findOne({ username }).lean();

  if (existing) {
    await Users.updateOne(
      { _id: existing._id },
      {
        $set: {
          password_hash: hash,
          status: 'active',
          is_super_admin: 1,
          updated_at: new Date()
        }
      }
    );
    console.log(`✅ Đã cập nhật tài khoản Super Admin '${username}' thành công.`);
  } else {
    const id = await nextId('users');
    await Users.create({
      id,
      username,
      email,
      password_hash: hash,
      status: 'active',
      is_super_admin: 1,
      created_at: new Date(),
      updated_at: new Date()
    });
    console.log(`✅ Đã tạo mới tài khoản Super Admin '${username}' thành công.`);
  }

  await mongoose.disconnect();
}

createOrUpdateAdmin().catch((err) => {
  console.error('❌ Lỗi khi khởi tạo Super Admin:', err);
  process.exit(1);
});
