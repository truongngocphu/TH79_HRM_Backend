import { v2 as cloudinary } from 'cloudinary';
import { env } from '../config/env.js';

function resolveCloudinaryConfig() {
  if (env.cloudinaryUrl) {
    try {
      const parsed = new URL(env.cloudinaryUrl);
      return {
        cloud_name: parsed.hostname,
        api_key: decodeURIComponent(parsed.username),
        api_secret: decodeURIComponent(parsed.password),
        secure: true
      };
    } catch {
      return null;
    }
  }

  if (env.cloudinaryCloudName && env.cloudinaryApiKey && env.cloudinaryApiSecret) {
    return {
      cloud_name: env.cloudinaryCloudName,
      api_key: env.cloudinaryApiKey,
      api_secret: env.cloudinaryApiSecret,
      secure: true
    };
  }
  return null;
}

const resolvedConfig = resolveCloudinaryConfig();
if (resolvedConfig) cloudinary.config(resolvedConfig);

function storageError(message = 'Cloudinary chưa được cấu hình trên backend.') {
  const error = new Error(message);
  error.status = 503;
  return error;
}

export function ensureCloudinary() {
  if (!env.cloudinaryConfigured) {
    throw storageError('Cloudinary chưa được cấu hình. Hãy khai báo CLOUDINARY_URL hoặc CLOUDINARY_CLOUD_NAME/CLOUDINARY_API_KEY/CLOUDINARY_API_SECRET trong file .env của backend.');
  }
}

export function sanitizeAssetPart(value, fallback = 'file') {
  const clean = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return clean || fallback;
}

export function cloudinaryFolder(...parts) {
  return [env.cloudinaryFolder, ...parts]
    .map(x => String(x || '').trim().replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/');
}

export function uploadBuffer(buffer, options = {}) {
  ensureCloudinary();
  if (!buffer?.length) throw storageError('Tệp tải lên không có dữ liệu.');

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream({
      resource_type: options.resourceType || 'image',
      type: options.deliveryType || 'upload',
      folder: options.folder,
      public_id: options.publicId,
      overwrite: options.overwrite ?? false,
      invalidate: true,
      use_filename: false,
      unique_filename: true,
      context: options.context,
      tags: options.tags
    }, (error, result) => {
      if (error) {
        const wrapped = new Error(`Cloudinary upload thất bại: ${error.message || 'Không rõ nguyên nhân'}`);
        const code = Number(error.http_code || error.status || 0);
        wrapped.status = code >= 400 && code < 500 ? code : 502;
        wrapped.cause = error;
        return reject(wrapped);
      }
      resolve(result);
    });
    stream.end(buffer);
  });
}

export async function destroyCloudinaryAsset(asset = {}) {
  if (!env.cloudinaryConfigured || !asset.publicId) return;
  try {
    await cloudinary.uploader.destroy(asset.publicId, {
      resource_type: asset.resourceType || 'image',
      type: asset.deliveryType || 'upload',
      invalidate: true
    });
  } catch (error) {
    console.warn('Không thể xóa asset Cloudinary:', error?.message || error);
  }
}

export function privateAssetUrl(asset = {}, options = {}) {
  ensureCloudinary();
  if (!asset.publicId) throw storageError('Hồ sơ Cloudinary thiếu public_id.');

  const format = String(asset.format || '').replace(/^\./, '');
  if (!format) throw storageError('Hồ sơ Cloudinary thiếu định dạng file.');

  return cloudinary.utils.private_download_url(asset.publicId, format, {
    resource_type: asset.resourceType || 'image',
    type: asset.deliveryType || 'authenticated',
    expires_at: Math.floor(Date.now() / 1000) + Number(options.ttl || env.cloudinarySignedUrlTtl),
    attachment: Boolean(options.attachment)
  });
}

export function cloudinaryAssetFields(result, { deliveryType = 'upload' } = {}) {
  return {
    storage_provider: 'cloudinary',
    cloudinary_public_id: result.public_id,
    cloudinary_asset_id: result.asset_id || null,
    cloudinary_secure_url: result.secure_url || null,
    cloudinary_resource_type: result.resource_type || 'image',
    cloudinary_delivery_type: result.type || deliveryType,
    cloudinary_format: result.format || null,
    cloudinary_version: result.version || null
  };
}

export async function cloudinaryStatus() {
  if (!env.cloudinaryConfigured) return { provider: 'cloudinary', configured: false, connected: false };
  try {
    const result = await cloudinary.api.ping();
    return { provider: 'cloudinary', configured: true, connected: result?.status === 'ok' || Boolean(result) };
  } catch (error) {
    return { provider: 'cloudinary', configured: true, connected: false, message: error?.message || 'Không kết nối được Cloudinary.' };
  }
}
