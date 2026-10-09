import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { Status } from '@engramweave/contracts';

export interface Connection { base: string; token: string; vault: string }
export interface Transport { (url: string, options: { method: string; headers: Record<string, string>; body?: string }): Promise<{ status: number; json: unknown }> }
const key = (value: string) => path.resolve(value).replaceAll('\\', '/').replace(/\/$/, '').toLowerCase();
const contains = (root: string, child: string) => key(root) === key(child) || key(child).startsWith(`${key(root)}/`);
async function readLocalFile(filename: string, limit: number) {
  const info = await lstat(filename);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > limit || key(await realpath(filename)) !== key(filename)) throw new Error('Local Core configuration or token file is unsafe');
  const bytes = await readFile(filename);
  if (bytes.length > limit) throw new Error('Local Core configuration exceeds its bound');
  return bytes.toString('utf8');
}
export async function readConnection(configPath: string, vaultPath: string): Promise<Connection> {
  if (!path.isAbsolute(configPath)) throw new Error('Select an absolute Core config.json path');
  const config = JSON.parse(await readLocalFile(configPath, 16_384));
  if (config.config_version !== 1 || config.host !== '127.0.0.1' || !Number.isInteger(config.port) || config.port < 1 || config.port > 65535
    || typeof config.vault_path !== 'string' || !path.isAbsolute(config.vault_path) || typeof config.data_dir !== 'string' || !path.isAbsolute(config.data_dir)) throw new Error('Core configuration is invalid');
  const vault = await realpath(vaultPath);
  if (key(await realpath(config.vault_path)) !== key(vault)) throw new Error('This Obsidian Vault does not match the configured Core Vault');
  const data = await realpath(config.data_dir);
  if (contains(vault, data)) throw new Error('Core runtime data and credentials must be outside the Vault');
  const token = await readLocalFile(path.join(data, 'token'), 1024);
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('Core authentication token is unavailable or invalid; start Core first');
  return { base: `http://127.0.0.1:${config.port}`, token, vault };
}
export class CoreClient {
  private connection: Connection | null = null;
  constructor(private readonly transport: Transport, private readonly load: () => Promise<Connection>) {}
  disconnect() { this.connection = null; }
  async connect() {
    const candidate = await this.load();
    const response = await this.transport(`${candidate.base}/v1/status`, { method: 'GET', headers: { authorization: `Bearer ${candidate.token}` } });
    const status = response.json as Status;
    if (response.status !== 200 || status.api_version !== '1' || status.status !== 'ready' || typeof status.vault_path !== 'string'
      || key(status.vault_path) !== key(candidate.vault)) throw new Error('Core is unavailable or attached to a different Vault');
    this.connection = candidate; return status;
  }
  async request<T>(route: string, body?: unknown): Promise<T> {
    if (!/^\/v1\/[a-z0-9/?=&_.%-]+$/i.test(route)) throw new Error('Invalid Core route');
    if (!this.connection) await this.connect();
    const connection = this.connection!;
    let response;
    try { response = await this.transport(`${connection.base}${route}`, { method: body === undefined ? 'GET' : 'POST',
      headers: { authorization: `Bearer ${connection.token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); }
    catch { this.disconnect(); throw new Error('Core connection was interrupted; no operation is automatically repeated'); }
    if (response.status < 200 || response.status >= 300) {
      if ([401,503].includes(response.status)) this.disconnect();
      const error = (response.json as { error?: { code?: string; message?: string } })?.error;
      throw new Error(`${error?.code ?? `HTTP ${response.status}`}: ${error?.message ?? 'Core request failed'}`);
    }
    return response.json as T;
  }
}
