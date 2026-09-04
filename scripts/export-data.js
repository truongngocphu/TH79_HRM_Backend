import { MongoClient } from 'mongodb';
import fs from 'fs';
import path from 'path';

// Script export toàn bộ dữ liệu MongoDB local ra các file JSON an toàn
const LOCAL_URI = process.env.LOCAL_MONGO_URI || 'mongodb://127.0.0.1:27017/hrm_th79';
const BACKUP_DIR = path.resolve(process.cwd(), 'data-backup');

async function exportDatabase() {
  console.log(`\n🔌 Kết nối MongoDB Local: ${LOCAL_URI}`);
  const client = new MongoClient(LOCAL_URI);

  try {
    await client.connect();
    console.log('✅ Kết nối thành công!');

    const db = client.db();
    const collections = await db.listCollections().toArray();

    if (!fs.existsSync(BACKUP_DIR)) {
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
    }

    console.log(`\n📦 Tìm thấy ${collections.length} collection(s). Bắt đầu xuất ra file JSON...\n`);

    for (const { name } of collections) {
      if (name.startsWith('system.')) continue;

      const docs = await db.collection(name).find({}).toArray();
      const filePath = path.join(BACKUP_DIR, `${name}.json`);

      fs.writeFileSync(filePath, JSON.stringify(docs, null, 2), 'utf-8');
      console.log(`  └─ 📄 '${name}.json' (${docs.length} bản ghi) -> ${filePath}`);
    }

    // Ghi thêm 1 file nén tổng hợp duy nhất db-full-backup.json để dễ copy
    const fullBackupPath = path.join(BACKUP_DIR, 'db-full-backup.json');
    const fullData = {};
    for (const { name } of collections) {
      if (name.startsWith('system.')) continue;
      fullData[name] = await db.collection(name).find({}).toArray();
    }
    fs.writeFileSync(fullBackupPath, JSON.stringify(fullData, null, 2), 'utf-8');

    console.log('\n======================================================');
    console.log(`🎉 ĐÃ EXPORT THÀNH CÔNG DỮ LIỆU RA THƯ MỤC:`);
    console.log(`👉 ${BACKUP_DIR}`);
    console.log(`📄 File tổng hợp: ${fullBackupPath}`);
    console.log('======================================================\n');

  } catch (err) {
    console.error('❌ Lỗi khi export dữ liệu:', err.message);
  } finally {
    await client.close();
  }
}

exportDatabase();
