import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { CoreClient, readConnection } from '../src/connection';
import { knowledgeFilename } from '../src/workflow';

async function fixture() {
  const root = await mkdtemp(path.resolve('.local/test-'));
  const vault = path.join(root, 'vault'); const data = path.join(root, 'data');
  await mkdir(vault); await mkdir(data); await writeFile(path.join(data, 'token'), 'a'.repeat(64));
  const config = { config_version: 1, vault_path: vault, data_dir: data, host: '127.0.0.1', port: 43127 };
  const filename = path.join(root, 'config.json'); await writeFile(filename, JSON.stringify(config));
  return { root, vault, data, config, filename, async close() {
    const relative = path.relative(path.resolve('.local'), root);
    if (relative.startsWith('..') || path.isAbsolute(relative) || relative === '') throw new Error('Unsafe test cleanup');
    await rm(root, { recursive: true, force: true });
  } };
}
it('reads the local token without storing it in plugin data and rejects another Vault, remote hosts and in-Vault runtime data', async () => {
  await mkdir('.local', { recursive: true }); const f = await fixture();
  try {
    const connected = await readConnection(f.filename, f.vault);
    expect(connected.base).toBe('http://127.0.0.1:43127'); expect(connected.token).toBe('a'.repeat(64));
    const other = path.join(f.root, 'other'); await mkdir(other);
    await expect(readConnection(f.filename, other)).rejects.toThrow('does not match');
    await writeFile(f.filename, JSON.stringify({ ...f.config, host: 'example.com' }));
    await expect(readConnection(f.filename, f.vault)).rejects.toThrow('invalid');
    const inside = path.join(f.vault, 'private'); await mkdir(inside);
    await writeFile(f.filename, JSON.stringify({ ...f.config, data_dir: inside }));
    await expect(readConnection(f.filename, f.vault)).rejects.toThrow('outside');
  } finally { await f.close(); }
});
it('checks the authenticated Core Vault and refuses a mismatched server before sending a mutation', async () => {
  const transport = vi.fn().mockResolvedValue({ status: 200, json: { api_version: '1', status: 'ready', vault_path: 'D:\\Other' } });
  const client = new CoreClient(transport, async () => ({ base: 'http://127.0.0.1:43127', token: 'a'.repeat(64), vault: 'D:\\Vault' }));
  await expect(client.request('/v1/draft-publications', {})).rejects.toThrow('different Vault');
  expect(transport).toHaveBeenCalledTimes(1); expect(transport.mock.calls[0]![1].method).toBe('GET');
});
it('does not automatically retry an uncertain publication and keeps origin/credentials out of URL and body', async () => {
  const transport = vi.fn().mockResolvedValueOnce({ status: 200, json: { api_version: '1', status: 'ready', vault_path: 'D:\\Vault' } }).mockRejectedValueOnce(new Error('Lost response'));
  const client = new CoreClient(transport, async () => ({ base: 'http://127.0.0.1:43127', token: 'b'.repeat(64), vault: 'D:\\Vault' }));
  await expect(client.request('/v1/draft-publications', { request_id: 'approval-id' })).rejects.toThrow('no operation is automatically repeated');
  expect(transport).toHaveBeenCalledTimes(2);
  const [url, request] = transport.mock.calls[1]!;
  expect(url).toBe('http://127.0.0.1:43127/v1/draft-publications');
  expect(request.headers).toEqual({ authorization: `Bearer ${'b'.repeat(64)}`, 'content-type': 'application/json' });
  expect(request.body).toBe('{"request_id":"approval-id"}');
});
it('chooses a legal Knowledge filename for punctuation and reserved Windows names', () => {
  expect(knowledgeFilename('A/B: C?')).toBe('40_Knowledge/A-B- C-.md');
  expect(knowledgeFilename('NUL')).toBe('40_Knowledge/Knowledge-NUL.md');
  expect(knowledgeFilename('../')).toBe('40_Knowledge/-.md');
});
