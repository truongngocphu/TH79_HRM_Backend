import { MongoClient } from 'mongodb';
import fs from 'fs';
import path from 'path';

// Script import dữ liệu từ file JSON vào MongoDB (Dùng trên VPS hoặc bất kỳ đâu)
const TARGET_URI = process.argv[2] || process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/hrm_th79';
const BACKUP_FILE = path.resolve(process.cwd(), 'data-backup', 'db-full-backup.json');

async function importDatabase() {
  if (!fs.existsSync(BACKUP_FILE)) {
    console.error(`\n❌ Không tìm thấy file backup tại: ${BACKUP_FILE}`);
    console.error('Vui lòng đảm bảo thư mục data-backup có chứa file db-full-backup.json!\n');
    process.exit(1);
  }

  console.log(`\n🔌 Kết nối MongoDB Target: ${TARGET_URI}`);
  console.log(`📄 Đọc file dữ liệu: ${BACKUP_FILE}\n`);

  const client = new MongoClient(TARGET_URI);

  try {
    await client.connect();
    console.log('✅ Kết nối thành công!');

    const db = client.db();
    const fullData = JSON.parse(fs.readFileSync(BACKUP_FILE, 'utf-8'));

    for (const [collectionName, docs] of Object.entries(fullData)) {
      console.log(`🔄 Đang nạp collection '${collectionName}' (${docs.length} bản ghi)...`);
      const col = db.collection(collectionName);

      await col.deleteMany({});
      if (docs.length > 0) {
        await col.insertMany(docs);
      }
      console.log(`   └─ ✅ Hoàn tất '${collectionName}'!`);
    }

    console.log('\n🎉 ĐÃ IMPORT THÀNH CÔNG TẤT CẢ DỮ LIỆU VÀO MONGODB!\n');

  } catch (err) {
    console.error('❌ Lỗi khi import dữ liệu:', err.message);
  } finally {
    await client.close();
  }
}

importDatabase();
