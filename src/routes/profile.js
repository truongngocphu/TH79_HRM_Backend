import { Router } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { Users } from '../models/raw.js';
import { env } from '../config/env.js';
import { audit } from '../services/auditService.js';
import {
  cloudinaryAssetFields,
  cloudinaryFolder,
  destroyCloudinaryAsset,
  sanitizeAssetPart,
  uploadBuffer
} from '../services/cloudinaryService.js';

const router = Router();
const legacyDir = path.resolve(process.cwd(), env.uploadDir);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^image\/(png|jpeg|webp)$/.test(file.mimetype))
});

const userFilter = authUser => authUser?._id ? { _id: authUser._id } : { id: Number(authUser?.id) };

router.post('/avatar', upload.single('avatar'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'Chưa chọn ảnh JPG, PNG hoặc WEBP.' });

    const user = await Users.findOne(userFilter(req.auth.user)).lean();
    if (!user) return res.status(404).json({ message: 'Không tìm thấy tài khoản.' });

    const userKey = sanitizeAssetPart(user.id ?? user._id, 'user');
    const result = await uploadBuffer(req.file.buffer, {
      resourceType: 'image',
      deliveryType: 'upload',
      folder: cloudinaryFolder('avatars'),
      publicId: `user-${userKey}-${Date.now()}`,
      context: `user_id=${userKey}|kind=avatar`,
      tags: ['th79-hrm', 'avatar']
    });

    if (user.avatar_cloudinary_public_id) {
      await destroyCloudinaryAsset({
        publicId: user.avatar_cloudinary_public_id,
        resourceType: user.avatar_cloudinary_resource_type || 'image',
        deliveryType: user.avatar_cloudinary_delivery_type || 'upload'
      });
    }

    const cloud = cloudinaryAssetFields(result, { deliveryType: 'upload' });
    await Users.updateOne(userFilter(user), {
      $set: {
        avatar_path: result.secure_url,
        avatar_storage_provider: 'cloudinary',
        avatar_cloudinary_public_id: cloud.cloudinary_public_id,
        avatar_cloudinary_asset_id: cloud.cloudinary_asset_id,
        avatar_cloudinary_secure_url: cloud.cloudinary_secure_url,
        avatar_cloudinary_resource_type: cloud.cloudinary_resource_type,
        avatar_cloudinary_delivery_type: cloud.cloudinary_delivery_type,
        avatar_cloudinary_format: cloud.cloudinary_format,
        avatar_cloudinary_version: cloud.cloudinary_version,
        updated_at: new Date()
      }
    });

    await audit(req, {
      module: 'profile',
      action: 'update',
      recordType: 'user_avatar',
      recordId: user.id ?? String(user._id),
      description: 'Cập nhật ảnh đại diện tài khoản lên Cloudinary'
    });

    return res.json({
      avatarUrl: result.secure_url,
      avatarVersion: result.version,
      storageProvider: 'cloudinary'
    });
  } catch (error) { next(error); }
});

// Endpoint ổn định cho avatar. Dùng được với tài khoản đã migrate sang Cloudinary.
router.get('/avatar', async (req, res, next) => {
  try {
    const user = await Users.findOne(userFilter(req.auth.user)).lean();
    if (!user) return res.status(404).end();

    const cloudUrl = user.avatar_cloudinary_secure_url || (/^https?:\/\//i.test(String(user.avatar_path || '')) ? user.avatar_path : null);
    if (cloudUrl) return res.redirect(302, cloudUrl);

    // Chỉ đọc file local cũ để tương thích trong lúc migrate; upload mới không ghi local nữa.
    if (user.avatar_path) {
      const p = path.join(legacyDir, path.basename(user.avatar_path));
      if (fs.existsSync(p)) return res.sendFile(p);
    }

    return res.status(404).end();
  } catch (error) { next(error); }
});

// Tương thích URL cũ /api/profile/avatar/user_1.png, tránh phá bookmark/cache cũ.
router.get('/avatar/:name', async (req, res, next) => {
  try {
    const user = await Users.findOne(userFilter(req.auth.user)).lean();
    if (!user) return res.status(404).end();

    const cloudUrl = user.avatar_cloudinary_secure_url || (/^https?:\/\//i.test(String(user.avatar_path || '')) ? user.avatar_path : null);
    if (cloudUrl) return res.redirect(302, cloudUrl);

    const p = path.join(legacyDir, path.basename(req.params.name));
    if (fs.existsSync(p)) return res.sendFile(p);
    return res.status(404).end();
  } catch (error) { next(error); }
});

router.delete('/avatar', async (req, res, next) => {
  try {
    const user = await Users.findOne(userFilter(req.auth.user)).lean();
    if (!user) return res.status(404).json({ message: 'Không tìm thấy tài khoản.' });

    if (user.avatar_cloudinary_public_id) {
      await destroyCloudinaryAsset({
        publicId: user.avatar_cloudinary_public_id,
        resourceType: user.avatar_cloudinary_resource_type || 'image',
        deliveryType: user.avatar_cloudinary_delivery_type || 'upload'
      });
    }

    await Users.updateOne(userFilter(user), {
      $set: {
        avatar_path: null,
        avatar_storage_provider: null,
        avatar_cloudinary_public_id: null,
        avatar_cloudinary_asset_id: null,
        avatar_cloudinary_secure_url: null,
        avatar_cloudinary_resource_type: null,
        avatar_cloudinary_delivery_type: null,
        avatar_cloudinary_format: null,
        avatar_cloudinary_version: null,
        updated_at: new Date()
      }
    });

    return res.json({ ok: true });
  } catch (error) { next(error); }
});

export default router;
