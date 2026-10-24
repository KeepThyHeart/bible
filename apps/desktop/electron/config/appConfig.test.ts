// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { resolveAppConfig, toRendererAppConfig, isRemoteSemanticConfigured } from './appConfig';

const KEYS = ['BIBLE_REMOTE_SEMANTIC_URL', 'BIBLE_REMOTE_SEMANTIC_API_KEY'];
afterEach(() => { for (const k of KEYS) delete process.env[k]; });

describe('appConfig remoteSemantic (task 0190)', () => {
  it('is empty by default', () => {
    const c = resolveAppConfig();
    expect(c.remoteSemantic).toEqual({ url: '', apiKey: '' });
    expect(isRemoteSemanticConfigured(c)).toBe(false);
  });

  it('reads the url and key from the environment', () => {
    process.env.BIBLE_REMOTE_SEMANTIC_URL = ' https://search.example.org/ ';
    process.env.BIBLE_REMOTE_SEMANTIC_API_KEY = 'k-123';
    const c = resolveAppConfig();
    expect(c.remoteSemantic).toEqual({ url: 'https://search.example.org/', apiKey: 'k-123' });
    expect(isRemoteSemanticConfigured(c)).toBe(true);
  });

  it('ignores a url that is not http(s), together with its key', () => {
    for (const bad of ['ftp://x.example', 'file:///etc/passwd', 'search.example.org', 'javascript:alert(1)', 'https://']) {
      process.env.BIBLE_REMOTE_SEMANTIC_URL = bad;
      process.env.BIBLE_REMOTE_SEMANTIC_API_KEY = 'k';
      expect(resolveAppConfig().remoteSemantic).toEqual({ url: '', apiKey: '' });
    }
  });

  it('accepts a localhost http url (dev / e2e stub)', () => {
    process.env.BIBLE_REMOTE_SEMANTIC_URL = 'http://127.0.0.1:8765';
    expect(resolveAppConfig().remoteSemantic.url).toBe('http://127.0.0.1:8765');
  });
});

describe('the API key does not cross the preload bridge', () => {
  it('toRendererAppConfig blanks url and key and keeps the rest', () => {
    process.env.BIBLE_REMOTE_SEMANTIC_URL = 'https://search.example.org';
    process.env.BIBLE_REMOTE_SEMANTIC_API_KEY = 'secret-key';
    const full = resolveAppConfig();
    const forRenderer = toRendererAppConfig(full);
    expect(JSON.stringify(forRenderer)).not.toContain('secret-key');
    expect(JSON.stringify(forRenderer)).not.toContain('search.example.org');
    expect(forRenderer.productName).toBe(full.productName);
  });

  it('the preload exposes appConfig only through toRendererAppConfig', () => {
    const src = readFileSync(resolve(__dirname, '../preload.ts'), 'utf8');
    expect(src).toMatch(/appConfig:\s*toRendererAppConfig\(APP_CONFIG\)/);
    expect(src).not.toMatch(/appConfig:\s*APP_CONFIG\b/);
  });

  it('the remote-search defines are injected into the main bundle only', () => {
    const src = readFileSync(resolve(__dirname, '../../electron.vite.config.ts'), 'utf8');
    const base = src.slice(src.indexOf('const APP_CONFIG_DEFINES'), src.indexOf('const MAIN_ONLY_DEFINES'));
    expect(base).not.toContain('REMOTE_SEMANTIC');
    expect(src.match(/\.\.\.MAIN_ONLY_DEFINES/g)).toHaveLength(1);
  });
});
