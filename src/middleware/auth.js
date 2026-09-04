import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { permissionSnapshot, hasPermission } from '../services/permissionService.js';

export async function requireAuth(req, res, next) {
  try {
    const token = req.cookies?.th79_token || (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null);
    if (!token) return res.status(401).json({ message: 'Vui lòng đăng nhập.' });

    const payload = jwt.verify(token, env.jwtSecret);
    const snapshot = await permissionSnapshot(payload.uid);
    const isActive = ['active', '1', 1, true].includes(snapshot?.user?.status) || snapshot?.user?.status === undefined;
    if (!snapshot?.user || !isActive) {
      return res.status(401).json({ message: 'Tài khoản không còn hoạt động hoặc dữ liệu tài khoản chưa hoàn chỉnh.' });
    }

    req.auth = snapshot;
    next();
  } catch (error) {
    return res.status(401).json({ message: 'Phiên đăng nhập đã hết hạn hoặc không hợp lệ.' });
  }
}

export const can = permission => (req, res, next) => hasPermission(req.auth, permission)
  ? next()
  : res.status(403).json({ message: 'Bạn không có quyền thực hiện thao tác này.' });

export const anyPermission = (...permissions) => (req, res, next) => permissions.some(p => hasPermission(req.auth, p))
  ? next()
  : res.status(403).json({ message: 'Bạn không có quyền truy cập.' });
