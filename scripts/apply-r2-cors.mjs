import { GetBucketCorsCommand, PutBucketCorsCommand, S3Client } from '@aws-sdk/client-s3';
import { env } from '../server/config/env.js';
import { buildR2CorsOrigins, buildR2CorsRules } from '../server/lib/r2-cors.js';

const dryRun = process.argv.includes('--dry-run');

const extraOrigins = String(process.env.R2_CORS_ORIGINS || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const origins = buildR2CorsOrigins({
    appBaseUrl: env.appBaseUrl,
    extra: extraOrigins
});
const rules = buildR2CorsRules(origins);

console.info('Origenes CORS de R2:');
for (const origin of origins) {
    console.info(`  - ${origin}`);
}

if (dryRun) {
    console.info(JSON.stringify(rules, null, 2));
    process.exit(0);
}

if (!env.r2.accountId || !env.r2.accessKeyId || !env.r2.secretAccessKey || !env.r2.bucket) {
    console.error('Faltan R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY o R2_BUCKET.');
    console.error('Carga el .env o ejecuta `npx vercel env pull .env` y vuelve a intentar.');
    process.exit(1);
}

const client = new S3Client({
    region: 'auto',
    endpoint: env.r2.endpoint,
    credentials: {
        accessKeyId: env.r2.accessKeyId,
        secretAccessKey: env.r2.secretAccessKey
    }
});

await client.send(new PutBucketCorsCommand({
    Bucket: env.r2.bucket,
    CORSConfiguration: { CORSRules: rules }
}));

const current = await client.send(new GetBucketCorsCommand({
    Bucket: env.r2.bucket
}));

console.info(`CORS aplicado en el bucket ${env.r2.bucket}.`);
console.info(JSON.stringify(current.CORSRules || [], null, 2));
