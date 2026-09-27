import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LocalStorage, createStorageDriver, objectKeyFor } from '../src';

describe('local storage driver', () => {
  let dir: string;
  let storage: LocalStorage;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'edupro-storage-'));
    storage = createStorageDriver({
      driver: 'local',
      localDir: dir,
      urlTtlSeconds: 60,
      apiBaseUrl: 'http://api',
      signingSecret: 'secret-secret-secret',
    }) as LocalStorage;
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  it('writes, reads, heads and removes an object', async () => {
    const key = objectKeyFor('7', 'txt', 'abc');
    expect(key).toMatch(/^school-7\/\d{4}\/\d{2}\/abc\.txt$/);
    await storage.write(key, Buffer.from('hello'), 'text/plain');
    expect((await storage.read(key)).toString()).toBe('hello');
    expect(await storage.head(key)).toEqual({ sizeBytes: 5 });
    await storage.remove(key);
    expect(await storage.head(key)).toBeNull();
  });

  it('refuses keys that escape the directory', async () => {
    await expect(storage.write('../escape.txt', Buffer.from('x'), 'text/plain')).rejects.toThrow(
      /escapes/,
    );
  });

  it('signs and verifies tokens with operation and expiry checks', async () => {
    const put = await storage.createUploadUrl('school-7/a.pdf', 'application/pdf', 10, '1', '7');
    const token = new URL(put.url).searchParams.get('token')!;
    expect(storage.verify(token, 'put')?.key).toBe('school-7/a.pdf');
    expect(storage.verify(token, 'get')).toBeNull();
    expect(storage.verify(`${token}x`, 'put')).toBeNull();
    const expired = storage.sign({ op: 'get', fileId: '1', schoolId: '7', key: 'k', exp: 1 });
    expect(storage.verify(expired, 'get')).toBeNull();
  });
});
