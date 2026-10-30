import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function findRoot() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [here, path.resolve(here, '..'), process.cwd()];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'public', 'index.html'))) return dir;
  }
  return here;
}

export const ROOT = findRoot();

const envPath = path.join(ROOT, '.env');
if (fs.existsSync(envPath)) process.loadEnvFile(envPath);

const env = process.env;

export const config = {
  port: Number(env.PORT) || 3000,
  adminEmail: (env.ADMIN_EMAIL || 'admin@example.com').trim().toLowerCase(),
  adminPassword: env.ADMIN_PASSWORD || 'admin123',
  dataDir: path.resolve(env.VERCEL ? '/tmp' : ROOT, env.DATA_DIR || 'data'),
  secureCookies: env.SECURE_COOKIES === 'true' || env.VERCEL === '1',
  databaseUrl: (env.DATABASE_URL || '').trim(),
  supabaseUrl: (env.SUPABASE_URL || '').trim().replace(/\/$/, ''),
  supabaseServiceKey: (env.SUPABASE_SERVICE_ROLE_KEY || '').trim(),
};

export const uploadsDir = path.join(config.dataDir, 'uploads');
