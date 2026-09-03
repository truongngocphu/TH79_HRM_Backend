import dotenv from 'dotenv';
dotenv.config();

const csv = value => String(value || '')
  .split(',')
  .map(v => v.trim())
  .filter(Boolean);

const nodeEnv = process.env.NODE_ENV || 'development';
const jwtSecret = process.env.JWT_SECRET || 'dev-only-change-me';
const clientUrls = csv(process.env.CLIENT_URLS || process.env.CLIENT_URL || 'http://localhost:5173');
const cookieSecure = String(process.env.COOKIE_SECURE || (nodeEnv === 'production' ? 'true' : 'false')) === 'true';
const cookieSameSite = String(process.env.COOKIE_SAME_SITE || (nodeEnv === 'production' ? 'none' : 'lax')).toLowerCase();

const cloudinaryCloudName = String(process.env.CLOUDINARY_CLOUD_NAME || '').trim();
const cloudinaryApiKey = String(process.env.CLOUDINARY_API_KEY || '').trim();
const cloudinaryApiSecret = String(process.env.CLOUDINARY_API_SECRET || '').trim();
const cloudinaryUrl = String(process.env.CLOUDINARY_URL || '').trim();
const validCloudinaryValue = value => Boolean(value && !/^(YOUR_|CHANGE_ME)/i.test(value));
const cloudinaryConfigured = validCloudinaryValue(cloudinaryUrl) || (validCloudinaryValue(cloudinaryCloudName) && validCloudinaryValue(cloudinaryApiKey) && validCloudinaryValue(cloudinaryApiSecret));

if (nodeEnv === 'production' && (!process.env.JWT_SECRET || jwtSecret.length < 32)) {
  throw new Error('JWT_SECRET production phải được khai báo và dài ít nhất 32 ký tự.');
}
if (cookieSameSite === 'none' && !cookieSecure) {
  throw new Error('COOKIE_SAME_SITE=none yêu cầu COOKIE_SECURE=true.');
}

export const env = {
  nodeEnv,
  port: Number(process.env.PORT || 5000),
  mongoUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/hrm_th79',
  jwtSecret,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '12h',
  clientUrls,
  clientUrl: clientUrls[0] || 'http://localhost:5173',
  cookieSecure,
  cookieSameSite: ['lax', 'strict', 'none'].includes(cookieSameSite) ? cookieSameSite : 'lax',
  cookieDomain: String(process.env.COOKIE_DOMAIN || '').trim() || undefined,
  uploadDir: process.env.UPLOAD_DIR || 'uploads',
  trustProxy: Number(process.env.TRUST_PROXY || 1),
  cloudinaryUrl,
  cloudinaryCloudName,
  cloudinaryApiKey,
  cloudinaryApiSecret,
  cloudinaryConfigured,
  cloudinaryFolder: String(process.env.CLOUDINARY_FOLDER || 'th79-hrm').trim() || 'th79-hrm',
  cloudinarySignedUrlTtl: Math.max(60, Number(process.env.CLOUDINARY_SIGNED_URL_TTL || 300))
};
