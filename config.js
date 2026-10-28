import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.dirname(fileURLToPath(import.meta.url));

const envPath = path.join(ROOT, '.env');
if (fs.existsSync(envPath)) process.loadEnvFile(envPath);

const env = process.env;

export const config = {
  port: Number(env.PORT) || 3000,
  adminEmail: (env.ADMIN_EMAIL || 'admin@example.com').trim().toLowerCase(),
  adminPassword: env.ADMIN_PASSWORD || 'admin123',
  dataDir: path.resolve(ROOT, env.DATA_DIR || 'data'),
  secureCookies: env.SECURE_COOKIES === 'true',
};

export const uploadsDir = path.join(config.dataDir, 'uploads');
