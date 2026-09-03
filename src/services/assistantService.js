import { Employees, Users } from '../models/raw.js';
import { enrichEmployees } from './employeeService.js';
import { analyticsSnapshot, anomalyList } from './analyticsService.js';
import { notificationFeed } from './notificationService.js';
import { escapeRegex, normalizeText } from '../utils/normalize.js';

function cleanEmployeeTerm(query = '') {
  return String(query)
    .trim()
    .replace(/^(tìm|tim|tra cứu|tra cuu|xem|mở|mo)\s+/i, '')
    .replace(/^(nhân viên|nhan vien|hồ sơ nhân viên|ho so nhan vien|hồ sơ|ho so)\s+/i, '')
    .trim();
}

function employeeMatchScore(employee, term) {
  const t = normalizeText(term);
  if (!t) return -1;
  const name = normalizeText(employee.full_name);
  const code = normalizeText(employee.employee_code);
  const phone = normalizeText(employee.phone);
  const email = normalizeText(employee.email);

  if (name === t || code === t || phone === t || email === t) return 100;
  if (name.startsWith(t)) return 90;
  if (name.includes(t)) return 80;
  if (code.includes(t) || phone.includes(t) || email.includes(t)) return 75;

  const words = t.split(/\s+/).filter(Boolean);
  if (words.length > 1 && words.every(w => name.includes(w))) return 70;
  return -1;
}

export async function assistantQuery(query = '') {
  const q = String(query).trim();
  const n = normalizeText(q);

  if (!q) {
    return { type: 'message', message: 'Bạn có thể hỏi tên nhân viên, mã nhân viên, số điện thoại, chi nhánh, hồ sơ còn thiếu hoặc cảnh báo hôm nay.' };
  }

  if (/tong quan|analytics|bao cao nhanh/.test(n)) {
    return { type: 'analytics', data: await analyticsSnapshot(), message: 'Đây là tổng quan nhân sự hiện tại.' };
  }
  if (/canh bao|hom nay|can lam gi|sap het/.test(n)) {
    return { type: 'notifications', data: await notificationFeed(12), message: 'Các việc HR cần ưu tiên:' };
  }
  if (/bat thuong|trung du lieu|data quality/.test(n)) {
    return { type: 'anomalies', data: (await anomalyList()).slice(0, 12), message: 'Các điểm dữ liệu cần kiểm tra:' };
  }

  const term = cleanEmployeeTerm(q);

  // Employee dataset is small. Scoring in application code gives reliable
  // accent-insensitive exact/fuzzy matching and avoids regex/query-casting
  // surprises in a database migrated from MySQL.
  if (term.length >= 2) {
    const all = await Employees.find({
      $or: [{ deleted_at: null }, { deleted_at: { $exists: false } }]
    }).lean();

    const ranked = all
      .map(employee => ({ employee, score: employeeMatchScore(employee, term) }))
      .filter(x => x.score >= 0)
      .sort((a, b) => b.score - a.score || Number(a.employee.id) - Number(b.employee.id));

    if (ranked.length) {
      const best = ranked[0].score;
      // Exact match should return the exact employee only, not arbitrary rows.
      const selected = best >= 100
        ? ranked.filter(x => x.score === best).slice(0, 3)
        : ranked.slice(0, 8);
      const rows = selected.map(x => x.employee);
      return {
        type: 'employees',
        data: await enrichEmployees(rows),
        message: rows.length === 1 ? `Đã tìm thấy ${rows[0].full_name}.` : `Tìm thấy ${rows.length} nhân viên phù hợp.`
      };
    }
  }

  const regex = new RegExp(escapeRegex(term || q), 'i');
  const users = await Users.find({ $or: [{ username: regex }, { email: regex }] }).limit(5).lean();
  if (users.length) {
    return {
      type: 'users',
      data: users.map(({ password_hash, ...safe }) => safe),
      message: `Tìm thấy ${users.length} tài khoản.`
    };
  }

  return { type: 'message', message: 'Chưa tìm thấy kết quả. Hãy thử tên, mã nhân viên, số điện thoại hoặc email.' };
}
