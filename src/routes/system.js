import { Router } from 'express';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import {
  Branches, Departments, Positions, Users, Roles, Permissions, UserRoles,
  RolePermissions, UserPermissions, Employees
} from '../models/raw.js';
import { can } from '../middleware/auth.js';
import { nextId } from '../utils/id.js';
import { audit } from '../services/auditService.js';
import { escapeRegex } from '../utils/normalize.js';
import { idVariants } from '../utils/legacyId.js';
import { hydrateLegacyId, hydrateLegacyIds } from '../utils/legacySeedIdentity.js';
import { ensureOrganizationIds } from '../services/organizationService.js';

const router = Router();

function userLookupFilter(raw) {
  const value = String(raw ?? '').trim();
  const clauses = [];
  const variants = idVariants(value);
  if (variants.length) clauses.push({ id: { $in: variants } });
  if (mongoose.isValidObjectId(value)) clauses.push({ _id: new mongoose.Types.ObjectId(value) });
  return clauses.length === 1 ? clauses[0] : clauses.length ? { $or: clauses } : { _id: null };
}

function sameUser(a, b) {
  if (!a || !b) return false;
  if (a._id && b._id && String(a._id) === String(b._id)) return true;
  if (a.id !== undefined && a.id !== null && b.id !== undefined && b.id !== null) {
    return String(a.id) === String(b.id);
  }
  return false;
}

function organizationLookupFilter(raw) {
  const value = String(raw ?? '').trim();
  if (mongoose.isValidObjectId(value)) return { _id: new mongoose.Types.ObjectId(value) };
  const variants = idVariants(value);
  return variants.length ? { id: { $in: variants } } : { _id: null };
}

function organizationPublicRow(collection, row) {
  const hydrated = hydrateLegacyId(collection, row);
  return {
    ...hydrated,
    _id: hydrated?._id ? String(hydrated._id) : hydrated?._id,
    manage_id: hydrated?._id ? String(hydrated._id) : String(hydrated?.id ?? '')
  };
}

async function assertUniqueOrganization(Model, codeKey, nameKey, body, exceptMongoId = null) {
  const code = String(body?.[codeKey] || '').trim();
  const name = String(body?.[nameKey] || '').trim();
  if (!code || !name) {
    const err = new Error('Vui lòng nhập đầy đủ tên và mã.');
    err.status = 400;
    throw err;
  }
  const clauses = [
    { [codeKey]: new RegExp(`^${escapeRegex(code)}$`, 'i') },
    { [nameKey]: new RegExp(`^${escapeRegex(name)}$`, 'i') }
  ];
  const filter = { $or: clauses };
  if (exceptMongoId) filter._id = { $ne: exceptMongoId };
  const duplicate = await Model.findOne(filter).lean();
  if (duplicate) {
    const sameCode = String(duplicate?.[codeKey] || '').trim().toLowerCase() === code.toLowerCase();
    const err = new Error(sameCode ? 'Mã này đã tồn tại trong hệ thống.' : 'Tên này đã tồn tại trong hệ thống.');
    err.status = 409;
    throw err;
  }
  return { code: code.toUpperCase(), name };
}

async function assertUniqueUserFields({ username, email, exceptMongoId = null }) {
  const checks = [];
  if (username) checks.push({ username: String(username).trim() });
  if (email) checks.push({ email: String(email).trim() });
  if (!checks.length) return;
  const filter = { $or: checks };
  if (exceptMongoId) filter._id = { $ne: exceptMongoId };
  const duplicate = await Users.findOne(filter).lean();
  if (duplicate) {
    const err = new Error(duplicate.username === String(username).trim()
      ? 'Tên tài khoản đã tồn tại.'
      : 'Email đã được sử dụng bởi tài khoản khác.');
    err.status = 409;
    throw err;
  }
}

router.get('/organization', can('organization.view'), async (req, res, next) => {
  try {
    await ensureOrganizationIds();
    const [rawBranches, rawDepartments, rawPositions] = await Promise.all([
      Branches.find({}).sort({ id: 1, branch_name: 1 }).lean(),
      Departments.find({}).sort({ id: 1, department_name: 1 }).lean(),
      Positions.find({}).sort({ id: 1, position_name: 1 }).lean()
    ]);
    res.json({
      branches: rawBranches.map(row => organizationPublicRow('branches', row)),
      departments: rawDepartments.map(row => organizationPublicRow('departments', row)),
      positions: rawPositions.map(row => organizationPublicRow('positions', row))
    });
  } catch (error) { next(error); }
});

for (const config of [
  { pathName: 'branches', Model: Branches, collection: 'branches', codeKey: 'branch_code', nameKey: 'branch_name', employeeField: 'branch_id', label: 'chi nhánh' },
  { pathName: 'departments', Model: Departments, collection: 'departments', codeKey: 'department_code', nameKey: 'department_name', employeeField: 'department_id', label: 'phòng ban' },
  { pathName: 'positions', Model: Positions, collection: 'positions', codeKey: 'position_code', nameKey: 'position_name', employeeField: 'position_id', label: 'chức vụ' }
]) {
  const { pathName, Model, collection, codeKey, nameKey, employeeField, label } = config;

  router.post(`/organization/${pathName}`, can('organization.manage'), async (req, res, next) => {
    try {
      await ensureOrganizationIds();
      const normalized = await assertUniqueOrganization(Model, codeKey, nameKey, req.body);
      const id = await nextId(collection);
      const row = {
        id,
        company_id: 1,
        [codeKey]: normalized.code,
        [nameKey]: normalized.name,
        status: req.body.status === 'inactive' ? 'inactive' : 'active',
        created_at: new Date(),
        updated_at: new Date()
      };
      const created = await Model.create(row);
      await audit(req, {
        module: 'organization', action: 'create', recordType: pathName.slice(0, -1), recordId: id,
        description: `Tạo ${label}: ${row[nameKey]}`, newValues: row
      });
      res.status(201).json(organizationPublicRow(collection, created.toObject()));
    } catch (error) { next(error); }
  });

  router.put(`/organization/${pathName}/:id`, can('organization.manage'), async (req, res, next) => {
    try {
      await ensureOrganizationIds();
      const target = await Model.findOne(organizationLookupFilter(req.params.id));
      if (!target) return res.status(404).json({ message: `Không tìm thấy ${label}.` });
      const normalized = await assertUniqueOrganization(Model, codeKey, nameKey, req.body, target._id);
      const set = {
        [codeKey]: normalized.code,
        [nameKey]: normalized.name,
        status: req.body.status === 'inactive' ? 'inactive' : 'active',
        updated_at: new Date()
      };
      await Model.updateOne({ _id: target._id }, { $set: set });
      await audit(req, {
        module: 'organization', action: 'update', recordType: pathName.slice(0, -1), recordId: target.id ?? null,
        description: `Cập nhật ${label}: ${normalized.name}`,
        oldValues: { [codeKey]: target[codeKey], [nameKey]: target[nameKey], status: target.status },
        newValues: set
      });
      res.json({ ok: true });
    } catch (error) { next(error); }
  });

  router.delete(`/organization/${pathName}/:id`, can('organization.manage'), async (req, res, next) => {
    try {
      await ensureOrganizationIds();
      const target = await Model.findOne(organizationLookupFilter(req.params.id)).lean();
      if (!target) return res.status(404).json({ message: `Không tìm thấy ${label}.` });
      const publicRow = organizationPublicRow(collection, target);
      const relationId = publicRow.id;
      const inUse = await Employees.countDocuments({
        [employeeField]: { $in: idVariants(relationId) },
        $or: [{ deleted_at: null }, { deleted_at: { $exists: false } }]
      });
      if (inUse > 0) {
        return res.status(409).json({
          message: `Không thể xóa ${label} này vì đang được ${inUse} nhân viên sử dụng. Hãy chuyển nhân viên sang ${label} khác trước.`
        });
      }
      await Model.deleteOne({ _id: target._id });
      await audit(req, {
        module: 'organization', action: 'delete', recordType: pathName.slice(0, -1), recordId: relationId ?? null,
        description: `Xóa ${label}: ${target[nameKey]}`,
        oldValues: { [codeKey]: target[codeKey], [nameKey]: target[nameKey], status: target.status }
      });
      res.json({ ok: true });
    } catch (error) { next(error); }
  });
}

router.get('/users', can('user.view'), async (req, res, next) => {
  try {
    const rawUsers = await Users.find({}).sort({ id: 1, created_at: 1 }).lean();
    const users = hydrateLegacyIds('users', rawUsers);
    const userIds = users.flatMap(x => idVariants(x.id));
    const [links, rawRoles, rawEmployees] = await Promise.all([
      userIds.length ? UserRoles.find({ user_id: { $in: userIds } }).lean() : [],
      Roles.find({}).lean(),
      Employees.find({ $or: [{ deleted_at: null }, { deleted_at: { $exists: false } }] }).lean()
    ]);
    const roles = hydrateLegacyIds('roles', rawRoles);
    const employees = hydrateLegacyIds('employees', rawEmployees);
    const rm = new Map(roles.map(x => [Number(x.id), x]));
    const em = new Map(employees.map(x => [Number(x.id), x]));
    res.json({
      items: users.map(({ password_hash, ...u }) => ({
        ...u,
        _id: u._id ? String(u._id) : u._id,
        // Use Mongo _id for management actions so duplicate/migrated legacy ids
        // can never make the wrong account get edited.
        manage_id: u._id ? String(u._id) : u.id,
        employee_name: em.get(Number(u.employee_id))?.full_name || null,
        roles: links
          .filter(l => String(l.user_id) === String(u.id))
          .map(l => rm.get(Number(l.role_id)))
          .filter(Boolean)
      }))
    });
  } catch (error) { next(error); }
});

router.get('/users/employee-search', can('user.view'), async (req, res, next) => {
  try {
    const rx = new RegExp(escapeRegex(req.query.q || ''), 'i');
    const rows = await Employees.find({
      $and: [
        { $or: [{ deleted_at: null }, { deleted_at: { $exists: false } }] },
        { $or: [{ full_name: rx }, { employee_code: rx }, { phone: rx }] }
      ]
    }).limit(15).select({ password_hash: 0 }).lean();
    res.json({ items: hydrateLegacyIds('employees', rows).map(row => ({ ...row, _id: String(row._id) })) });
  } catch (error) { next(error); }
});

router.post('/users', can('user.manage'), async (req, res, next) => {
  try {
    const username = String(req.body.username || '').trim();
    const email = String(req.body.email || '').trim() || null;
    if (!username) return res.status(400).json({ message: 'Vui lòng nhập tên tài khoản.' });
    await assertUniqueUserFields({ username, email });

    const id = await nextId('users');
    const password = String(req.body.password || 'ChangeMe123!');
    if (password.length < 8) return res.status(400).json({ message: 'Mật khẩu phải có ít nhất 8 ký tự.' });
    const hash = await bcrypt.hash(password, 12);
    const row = {
      id,
      employee_id: req.body.employee_id ? Number(req.body.employee_id) : null,
      username,
      email,
      password_hash: hash,
      status: req.body.status || 'active',
      is_super_admin: req.body.is_super_admin ? 1 : 0,
      last_login_at: null,
      created_at: new Date(),
      updated_at: new Date()
    };
    await Users.create(row);
    if (req.body.role_ids?.length) {
      await UserRoles.insertMany(req.body.role_ids.map(r => ({ user_id: id, role_id: Number(r) })));
    }
    await audit(req, { module: 'users', action: 'create', recordType: 'user', recordId: id, description: `Tạo tài khoản đăng nhập: ${username}`, newValues: { ...row, password_hash: '***' } });
    res.status(201).json({ id });
  } catch (error) { next(error); }
});

router.put('/users/:id', can('user.manage'), async (req, res, next) => {
  try {
    const target = await Users.findOne(userLookupFilter(req.params.id));
    if (!target) return res.status(404).json({ message: 'Không tìm thấy tài khoản.' });

    const username = String(req.body.username || target.username || '').trim();
    const email = String(req.body.email || '').trim() || null;
    if (!username) return res.status(400).json({ message: 'Vui lòng nhập tên tài khoản.' });
    await assertUniqueUserFields({ username, email, exceptMongoId: target._id });

    const isSelf = sameUser(target, req.auth?.user);
    const requestedStatus = req.body.status || target.status || 'active';
    if (isSelf && requestedStatus !== 'active') {
      return res.status(400).json({ message: 'Không thể khóa hoặc ngưng chính tài khoản đang đăng nhập.' });
    }
    if (Number(target.is_super_admin) === 1 && requestedStatus !== 'active') {
      const activeAdmins = await Users.countDocuments({ is_super_admin: 1, status: 'active' });
      if (activeAdmins <= 1) return res.status(400).json({ message: 'Không thể ngưng Super Admin cuối cùng của hệ thống.' });
    }

    let legacyId = target.id;
    if (legacyId === undefined || legacyId === null || legacyId === '') {
      legacyId = await nextId('users');
    }

    const set = {
      id: legacyId,
      employee_id: req.body.employee_id ? Number(req.body.employee_id) : null,
      username,
      email,
      status: requestedStatus,
      updated_at: new Date()
    };
    if (req.body.password) {
      const password = String(req.body.password);
      if (password.length < 8) return res.status(400).json({ message: 'Mật khẩu mới phải có ít nhất 8 ký tự.' });
      set.password_hash = await bcrypt.hash(password, 12);
    }

    await Users.updateOne({ _id: target._id }, { $set: set });
    if (Array.isArray(req.body.role_ids)) {
      await UserRoles.deleteMany({ user_id: { $in: idVariants(legacyId) } });
      if (req.body.role_ids.length) {
        await UserRoles.insertMany(req.body.role_ids.map(r => ({ user_id: legacyId, role_id: Number(r) })));
      }
    }
    if (req.body.permission_overrides && typeof req.body.permission_overrides === 'object') {
      await UserPermissions.deleteMany({ user_id: { $in: idVariants(legacyId) } });
      const docs = Object.entries(req.body.permission_overrides)
        .filter(([, v]) => ['allow', 'deny'].includes(v))
        .map(([permission_id, access_mode]) => ({ user_id: legacyId, permission_id: Number(permission_id), access_mode, created_at: new Date() }));
      if (docs.length) await UserPermissions.insertMany(docs);
    }

    await audit(req, {
      module: 'users', action: 'update', recordType: 'user', recordId: legacyId,
      description: `Cập nhật tài khoản: ${username}`,
      oldValues: { username: target.username, email: target.email, employee_id: target.employee_id, status: target.status },
      newValues: { username, email, employee_id: set.employee_id, status: requestedStatus, password_changed: Boolean(req.body.password) }
    });
    res.json({ ok: true });
  } catch (error) { next(error); }
});

router.delete('/users/:id', can('user.manage'), async (req, res, next) => {
  try {
    const target = await Users.findOne(userLookupFilter(req.params.id));
    if (!target) return res.status(404).json({ message: 'Không tìm thấy tài khoản.' });
    if (sameUser(target, req.auth?.user)) {
      return res.status(400).json({ message: 'Không thể xóa tài khoản đang đăng nhập.' });
    }
    if (Number(target.is_super_admin) === 1) {
      const activeAdmins = await Users.countDocuments({ is_super_admin: 1, status: 'active' });
      if (activeAdmins <= 1) return res.status(400).json({ message: 'Không thể xóa Super Admin cuối cùng của hệ thống.' });
    }

    const legacyId = target.id;
    if (legacyId !== undefined && legacyId !== null && legacyId !== '') {
      const variants = idVariants(legacyId);
      await Promise.all([
        UserRoles.deleteMany({ user_id: { $in: variants } }),
        UserPermissions.deleteMany({ user_id: { $in: variants } })
      ]);
    }
    await Users.deleteOne({ _id: target._id });
    await audit(req, {
      module: 'users', action: 'delete', recordType: 'user', recordId: legacyId ?? null,
      description: `Xóa tài khoản đăng nhập: ${target.username}`,
      oldValues: { username: target.username, email: target.email, employee_id: target.employee_id, status: target.status }
    });
    res.json({ ok: true });
  } catch (error) { next(error); }
});

router.get('/roles', can('role.view'), async (req, res, next) => {
  try {
    const [rawRoles, rawPermissions, rp] = await Promise.all([
      Roles.find({}).sort({ id: 1, role_name: 1 }).lean(),
      Permissions.find({}).sort({ module: 1, id: 1 }).lean(),
      RolePermissions.find({}).lean()
    ]);
    const roles = hydrateLegacyIds('roles', rawRoles).map(row => ({ ...row, _id: row._id ? String(row._id) : row._id }));
    const permissions = hydrateLegacyIds('permissions', rawPermissions).map(row => ({ ...row, _id: row._id ? String(row._id) : row._id }));
    res.json({
      roles: roles.map(r => ({
        ...r,
        permission_ids: rp.filter(x => Number(x.role_id) === Number(r.id)).map(x => Number(x.permission_id)).filter(Number.isFinite)
      })),
      permissions
    });
  } catch (error) { next(error); }
});

router.post('/roles', can('role.manage'), async (req, res) => {
  const id = await nextId('roles');
  await Roles.create({ id, role_code: req.body.role_code, role_name: req.body.role_name, description: req.body.description || null, is_system: 0 });
  if (req.body.permission_ids?.length) await RolePermissions.insertMany(req.body.permission_ids.map(p => ({ role_id: id, permission_id: Number(p) })));
  res.status(201).json({ id });
});

router.put('/roles/:id', can('role.manage'), async (req, res) => {
  const id = Number(req.params.id);
  await Roles.updateOne({ id }, { $set: { role_name: req.body.role_name, description: req.body.description || null } });
  if (Array.isArray(req.body.permission_ids)) {
    await RolePermissions.deleteMany({ role_id: id });
    if (req.body.permission_ids.length) await RolePermissions.insertMany(req.body.permission_ids.map(p => ({ role_id: id, permission_id: Number(p) })));
  }
  res.json({ ok: true });
});

export default router;
