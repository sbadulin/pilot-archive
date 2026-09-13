import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectelUrl } from '../functions/api/_lib/selectel.ts';
// Public AWS documentation test vector, not credentials.
const env = { SELECTEL_S3_ENDPOINT: 'https://s3.amazonaws.com', SELECTEL_S3_BUCKET: 'examplebucket', SELECTEL_S3_REGION: 'us-east-1', SELECTEL_S3_ACCESS_KEY: 'AKIAIOSFODNN7EXAMPLE', SELECTEL_S3_SECRET_KEY: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' };
test('presigned URL matches the published AWS SigV4 reference vector', async () => {
  const url = new URL((await selectelUrl(env, 'test.txt', 'GET', 86400, undefined, new Date('2013-05-24T00:00:00Z')))!);
  assert.equal(url.host, 'examplebucket.s3.amazonaws.com');
  assert.equal(url.searchParams.get('X-Amz-Signature'), 'aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404');
});
test('object names are RFC3986 encoded and signing lifetime is bounded', async () => {
  const url = await selectelUrl(env, "pending/лист !'().pdf", 'PUT');
  assert.ok(url?.includes('%20%21%27%28%29.pdf'));
  await assert.rejects(() => selectelUrl(env, 'test', 'PUT', 0));
});
