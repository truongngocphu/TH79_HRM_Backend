import mongoose from 'mongoose';
import { Permissions, RolePermissions, Roles, UserPermissions, UserRoles, Users } from '../models/raw.js';
import { idVariants } from '../utils/legacyId.js';

const variantsOfMany = values => [...new Set(values.flatMap(idVariants))];

function isUserDocument(value) {
  return Boolean(value && typeof value === 'object' && (value._id || value.username || value.email));
}

async function resolveUser(userOrId) {
  if (isUserDocument(userOrId)) return userOrId;
  const strId = String(userOrId || '').trim();
  if (!strId) return null;

  const clauses = [];
  if (mongoose.isValidObjectId(strId)) {
    try {
      clauses.push({ _id: new mongoose.Types.ObjectId(strId) });
    } catch {}
  }
  clauses.push({ _id: strId });

  const variants = idVariants(userOrId);
  if (variants.length) clauses.push({ id: { $in: variants } });
  clauses.push({ username: strId }, { email: strId });

  const activeUser = await Users.findOne({
    $or: clauses,
    status: { $in: ['active', '1', 1, true, undefined, null] }
  }).lean();

  if (activeUser) return activeUser;
  return Users.findOne({ $or: clauses }).lean();
}

export async function permissionSnapshot(userOrId) {
  const user = await resolveUser(userOrId);
  if (!user) return null;

  // Super Admin must remain usable even if an early MySQL -> Mongo migration
  // accidentally dropped the legacy numeric `id` field.
  if (Number(user.is_super_admin) === 1) {
    return { user, roles: ['ADMIN'], permissions: ['*'], isSuperAdmin: true };
  }

  const legacyUserId = user.id;
  if (legacyUserId === null || legacyUserId === undefined || legacyUserId === '') {
    // Do not crash/login-loop. This account needs the legacy-ID repair before
    // role links (user_roles.user_id) can be resolved reliably.
    return { user, roles: [], permissions: [], isSuperAdmin: false, legacyIdMissing: true };
  }

  const roleLinks = await UserRoles.find({ user_id: { $in: idVariants(legacyUserId) } }).lean();
  const roleIds = [...new Set(roleLinks.map(x => Number(x.role_id)).filter(Number.isFinite))];
  const roleVariants = variantsOfMany(roleIds);

  const [roles, rp, overrides] = await Promise.all([
    roleIds.length ? Roles.find({ id: { $in: roleVariants } }).lean() : [],
    roleIds.length ? RolePermissions.find({ role_id: { $in: roleVariants } }).lean() : [],
    UserPermissions.find({ user_id: { $in: idVariants(legacyUserId) } }).lean()
  ]);

  const permissionIds = [...new Set(rp.map(x => Number(x.permission_id)).filter(Number.isFinite))];
  const allowIds = new Set(
    overrides
      .filter(x => ['allow', '1', 1, true].includes(x.access_mode ?? x.effect ?? x.is_allowed))
      .map(x => Number(x.permission_id))
      .filter(Number.isFinite)
  );
  const denyIds = new Set(
    overrides
      .filter(x => ['deny', '0', 0, false].includes(x.access_mode ?? x.effect ?? x.is_allowed))
      .map(x => Number(x.permission_id))
      .filter(Number.isFinite)
  );

  const allIds = [...new Set([...permissionIds, ...allowIds])].filter(id => !denyIds.has(id));
  const allPermissions = allIds.length
    ? await Permissions.find({ id: { $in: variantsOfMany(allIds) } }).lean()
    : [];

  return {
    user,
    roles: roles.map(x => x.role_code),
    permissions: allPermissions.map(x => x.permission_code),
    isSuperAdmin: false,
    legacyIdMissing: false
  };
}

export function hasPermission(snapshot, permission) {
  return Boolean(
    snapshot?.isSuperAdmin ||
    snapshot?.permissions?.includes('*') ||
    snapshot?.permissions?.includes(permission)
  );
}
