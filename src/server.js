import app from './app.js';
import { connectDb } from './config/db.js';
import { env } from './config/env.js';
import { ensureOrganizationIds } from './services/organizationService.js';

try {
  await connectDb();
  await ensureOrganizationIds({ force: true });
  app.listen(env.port, () => console.log(`TH79 HRM API: http://localhost:${env.port}`));
} catch (error) {
  console.error('Không thể khởi động API:', error);
  process.exit(1);
}
