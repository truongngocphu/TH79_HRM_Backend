import mongoose from 'mongoose';
import { connectDb } from '../src/config/db.js';
import { Users } from '../src/models/raw.js';

await connectDb();
const users = await Users.find({}).lean();
console.log(`\n📋 Danh sách ${users.length} tài khoản trong Database:`);
users.forEach(u => {
  console.log(`- Username: ${u.username} | Email: ${u.email} | Status: ${u.status} | SuperAdmin: ${u.is_super_admin}`);
});
await mongoose.disconnect();
