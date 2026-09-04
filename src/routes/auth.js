import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Users } from '../models/raw.js';
import { env } from '../config/env.js';
import { permissionSnapshot } from '../services/permissionService.js';
import { audit } from '../services/auditService.js';
import { requireAuth } from '../middleware/auth.js';
import { idVariants } from '../utils/legacyId.js';

const router = Router();

function authSubject(user) {
  if (user?.id !== null && user?.id !== undefined && user?.id !== '') return user.id;
  return user?._id ? String(user._id) : null;
}

function safeAuth(auth) {
  if (!auth?.user) return null;
  const { password_hash, ...user } = auth.user;
  return {
    ...user,
    _id: user?._id ? String(user._id) : user?._id,
    roles: auth.roles || [],
    permissions: auth.permissions || [],
    isSuperAdmin: Boolean(auth.isSuperAdmin),
    legacyIdMissing: Boolean(auth.legacyIdMissing)
  };
}

router.post('/login', async (req, res, next) => {
  try {
    const login = String(req.body?.login || '').trim();
    const password = String(req.body?.password || '');
    if (!login || !password) return res.status(400).json({ message: 'Vui lòng nhập tài khoản và mật khẩu.' });

    const loginRegex = new RegExp(`^${login.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&')}$`, 'i');
    const user = await Users.findOne({
      $or: [{ username: loginRegex }, { email: loginRegex }],
      $or: [{ status: { $in: ['active', '1', 1, true] } }, { status: { $exists: false } }]
    }).lean();

    let ok = false;
    if (user?.password_hash) {
      let hash = String(user.password_hash);
      // PHP bcrypt hashes use $2y$; bcryptjs understands the equivalent $2b$ form.
      if (hash.startsWith('$2y$')) hash = '$2b$' + hash.slice(4);
      try { ok = await bcrypt.compare(password, hash); } catch { ok = false; }
    }

    if (!ok) {
      req.auth = null;
      await audit(req, { module: 'auth', action: 'login_failed', description: 'Đăng nhập thất bại', newValues: { login } });
      return res.status(401).json({ message: 'Tài khoản hoặc mật khẩu không đúng.' });
    }

    // Update by legacy ID when present, otherwise by Mongo _id. This avoids an
    // empty legacy-id filter on databases created by the earliest converter.
    if (user.id !== null && user.id !== undefined && user.id !== '') {
      await Users.updateOne({ id: { $in: idVariants(user.id) } }, { $set: { last_login_at: new Date(), updated_at: new Date() } });
    } else {
      await Users.updateOne({ _id: user._id }, { $set: { last_login_at: new Date(), updated_at: new Date() } });
    }

    const snapshot = await permissionSnapshot(user);
    if (!snapshot?.user) {
      return res.status(500).json({ message: 'Không thể tạo phiên đăng nhập. Hãy chạy kiểm tra dữ liệu tài khoản.' });
    }

    const uid = authSubject(user);
    if (!uid) return res.status(500).json({ message: 'Tài khoản thiếu định danh đăng nhập.' });

    const token = jwt.sign({ uid }, env.jwtSecret, { expiresIn: env.jwtExpiresIn });
    res.cookie('th79_token', token, {
      httpOnly: true,
      sameSite: env.cookieSameSite,
      secure: env.cookieSecure,
      domain: env.cookieDomain,
      maxAge: 12 * 60 * 60 * 1000
    });

    req.auth = snapshot;
    await audit(req, {
      module: 'auth', action: 'login', recordType: 'user', recordId: user.id ?? null,
      description: 'Đăng nhập hệ thống thành công'
    });

    return res.json({ user: safeAuth(snapshot) });
  } catch (error) { next(error); }
});

router.post('/logout', requireAuth, async (req, res) => {
  await audit(req, {
    module: 'auth', action: 'logout', recordType: 'user', recordId: req.auth?.user?.id ?? null,
    description: 'Đăng xuất khỏi hệ thống'
  });
  res.clearCookie('th79_token', { httpOnly: true, sameSite: env.cookieSameSite, secure: env.cookieSecure, domain: env.cookieDomain });
  res.json({ ok: true });
});


// Public bootstrap endpoint for the React app.
// Unlike /me, an anonymous browser receives HTTP 200 instead of 401. This
// prevents a harmless pre-login session check from appearing as a console
// error while still keeping every protected API behind requireAuth.
router.get('/session', async (req, res) => {
  const token = req.cookies?.th79_token || (
    req.headers.authorization?.startsWith('Bearer ')
      ? req.headers.authorization.slice(7)
      : null
  );

  if (!token) {
    return res.json({ authenticated: false, user: null });
  }

  try {
    const payload = jwt.verify(token, env.jwtSecret);
    const snapshot = await permissionSnapshot(payload.uid);

    const isActive = ['active', '1', 1, true].includes(snapshot?.user?.status) || snapshot?.user?.status === undefined;
    if (!snapshot?.user || !isActive) {
      res.clearCookie('th79_token', {
        httpOnly: true,
        sameSite: env.cookieSameSite,
        secure: env.cookieSecure,
        domain: env.cookieDomain
      });
      return res.json({ authenticated: false, user: null });
    }

    return res.json({ authenticated: true, user: safeAuth(snapshot) });
  } catch {
    res.clearCookie('th79_token', {
      httpOnly: true,
      sameSite: env.cookieSameSite,
      secure: env.cookieSecure,
      domain: env.cookieDomain
    });
    return res.json({ authenticated: false, user: null });
  }
});

router.get('/me', requireAuth, (req, res) => res.json({ user: safeAuth(req.auth) }));


export default router;
