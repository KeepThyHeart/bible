import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { SiteConfig } from '../SiteConfig';

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'siteconfig-test-'));
}

describe('SiteConfig', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  // ── Unified config loading ──────────────────────────────────────

  describe('unified site-config.json', () => {
    it('loads auth config', () => {
      writeFileSync(join(tempDir, 'site-config.json'), JSON.stringify({
        auth: { enabled: false, passwordHash: 'abc:def' },
      }));
      const config = new SiteConfig(tempDir);
      expect(config.auth.enabled).toBe(false);
      expect(config.auth.passwordHash).toBe('abc:def');
    });

    it('loads features', () => {
      writeFileSync(join(tempDir, 'site-config.json'), JSON.stringify({
        features: { tagGraph: true, semanticSearch: true },
      }));
      const config = new SiteConfig(tempDir);
      expect(config.features.tagGraph).toBe(true);
      expect(config.features.semanticSearch).toBe(true);
    });

    it('caches translations in the browser unless told not to', () => {
      // Off means the client never pulls a lite copy of a translation. Worth
      // having for a metered deployment, and what the e2e fixture sets.
      writeFileSync(join(tempDir, 'site-config.json'), JSON.stringify({}));
      expect(new SiteConfig(tempDir).features.offlineAutoDownload).toBe(true);
      expect(new SiteConfig(tempDir).getClientConfig().offlineAutoDownload).toBeUndefined();

      writeFileSync(join(tempDir, 'site-config.json'), JSON.stringify({
        features: { offlineAutoDownload: false },
      }));
      expect(new SiteConfig(tempDir).features.offlineAutoDownload).toBe(false);
      expect(new SiteConfig(tempDir).getClientConfig().offlineAutoDownload).toBe(false);
    });

    it('loads modules', () => {
      const modules = {
        about: 'Test app',
        bibles: { modules: { KJV: { active: true } }, sections: [] },
      };
      writeFileSync(join(tempDir, 'site-config.json'), JSON.stringify({ modules }));
      const config = new SiteConfig(tempDir);
      expect(config.modules?.about).toBe('Test app');
      expect(config.modules?.bibles?.modules.KJV.active).toBe(true);
    });

    it('falls back to settings.json for modules when the unified config omits them', () => {
      // A partial site-config.json (auth only) must not blank out module visibility.
      writeFileSync(join(tempDir, 'site-config.json'), JSON.stringify({
        auth: { passwordHash: 'abc:def' },
      }));
      writeFileSync(join(tempDir, 'settings.json'), JSON.stringify({
        about: 'Legacy about',
        bibles: { modules: { KJV: { active: true } }, sections: [] },
      }));
      const config = new SiteConfig(tempDir);
      expect(config.modules?.about).toBe('Legacy about');
      expect(config.modules?.bibles?.modules.KJV.active).toBe(true);
      // Unified auth still wins.
      expect(config.auth.passwordHash).toBe('abc:def');
    });

    it('prefers unified modules over settings.json when both exist', () => {
      writeFileSync(join(tempDir, 'site-config.json'), JSON.stringify({
        modules: { about: 'Unified about', bibles: { modules: {}, sections: [] } },
      }));
      writeFileSync(join(tempDir, 'settings.json'), JSON.stringify({
        about: 'Legacy about',
        bibles: { modules: { KJV: { active: true } }, sections: [] },
      }));
      const config = new SiteConfig(tempDir);
      expect(config.modules?.about).toBe('Unified about');
      expect(config.modules?.bibles?.modules.KJV).toBeUndefined();
    });

    it('loads commentary popularity', () => {
      writeFileSync(join(tempDir, 'site-config.json'), JSON.stringify({
        commentaryPopularity: { MHC: 0, Barnes: 1 },
      }));
      const config = new SiteConfig(tempDir);
      expect(config.commentaryPopularity).toEqual({ MHC: 0, Barnes: 1 });
    });

    it('loads offline config', () => {
      writeFileSync(join(tempDir, 'site-config.json'), JSON.stringify({
        offline: { staleDays: 30 },
      }));
      const config = new SiteConfig(tempDir);
      expect(config.offline.staleDays).toBe(30);
    });

    it('loads search config', () => {
      writeFileSync(join(tempDir, 'site-config.json'), JSON.stringify({
        search: { hybrid: true, minScore: 0.3, pipelineConfigPath: 'custom.json' },
      }));
      const config = new SiteConfig(tempDir);
      expect(config.search.hybrid).toBe(true);
      expect(config.search.minScore).toBe(0.3);
      expect(config.search.pipelineConfigPath).toBe('custom.json');
    });

    it('loads UI config', () => {
      writeFileSync(join(tempDir, 'site-config.json'), JSON.stringify({
        ui: { defaultTheme: 'dark', visibleThemes: ['light', 'dark'] },
      }));
      const config = new SiteConfig(tempDir);
      expect(config.ui.defaultTheme).toBe('dark');
      expect(config.ui.visibleThemes).toEqual(['light', 'dark']);
    });

    it('loads repoUrl', () => {
      writeFileSync(join(tempDir, 'site-config.json'), JSON.stringify({
        repoUrl: 'https://github.com/example/bible',
      }));
      const config = new SiteConfig(tempDir);
      expect(config.repoUrl).toBe('https://github.com/example/bible');
    });

    it('loads docsUrl', () => {
      writeFileSync(join(tempDir, 'site-config.json'), JSON.stringify({
        docsUrl: 'https://docs.example.com/',
      }));
      const config = new SiteConfig(tempDir);
      expect(config.docsUrl).toBe('https://docs.example.com/');
    });
  });

  // ── Defaults ────────────────────────────────────────────────────

  describe('defaults', () => {
    it('returns sensible defaults with empty config', () => {
      writeFileSync(join(tempDir, 'site-config.json'), '{}');
      const config = new SiteConfig(tempDir);
      expect(config.auth.enabled).toBe(true);
      expect(config.auth.passwordHash).toBeUndefined();
      expect(config.features.tagGraph).toBe(false);
      expect(config.features.semanticSearch).toBe(false);
      expect(config.modules).toBeNull();
      expect(config.commentaryPopularity).toBeUndefined();
      expect(config.offline.staleDays).toBe(15);
      expect(config.search.hybrid).toBe(false);
      expect(config.search.minScore).toBe(0.15);
      expect(config.search.pipelineConfigPath).toBe('search-pipeline.json');
      expect(config.repoUrl).toBe('');
    });
  });

  // ── Legacy fallback ─────────────────────────────────────────────

  describe('legacy fallback', () => {
    it('loads from server-config.json when site-config.json missing', () => {
      writeFileSync(join(tempDir, 'server-config.json'), JSON.stringify({
        noAuth: true,
        showTagGraph: true,
        repoUrl: 'https://example.com',
        staleDays: 20,
        sitePasswordHash: 'legacy:hash',
      }));
      const config = new SiteConfig(tempDir);
      expect(config.auth.enabled).toBe(false);
      expect(config.auth.passwordHash).toBe('legacy:hash');
      expect(config.features.tagGraph).toBe(true);
      expect(config.repoUrl).toBe('https://example.com');
      expect(config.offline.staleDays).toBe(20);
    });

    it('loads from settings.json when site-config.json missing', () => {
      writeFileSync(join(tempDir, 'settings.json'), JSON.stringify({
        about: 'Legacy about',
        bibles: { modules: { ASV: { active: true } }, sections: [] },
      }));
      const config = new SiteConfig(tempDir);
      expect(config.modules?.about).toBe('Legacy about');
      expect(config.modules?.bibles?.modules.ASV.active).toBe(true);
    });

    it('returns null modules when no config files exist', () => {
      const config = new SiteConfig(tempDir);
      expect(config.modules).toBeNull();
      expect(config.auth.enabled).toBe(true);
    });
  });

  // ── getClientConfig ─────────────────────────────────────────────

  describe('getClientConfig', () => {
    it('excludes password hash from client config', () => {
      writeFileSync(join(tempDir, 'site-config.json'), JSON.stringify({
        auth: { enabled: true, passwordHash: 'secret:hash', password: 'plain' },
        features: { tagGraph: true },
        repoUrl: 'https://example.com',
      }));
      const config = new SiteConfig(tempDir);
      const client = config.getClientConfig();
      expect(client.showTagGraph).toBe(true);
      expect(client.repoUrl).toBe('https://example.com');
      expect(client).not.toHaveProperty('auth');
      expect(client).not.toHaveProperty('passwordHash');
    });

    it('sends docsUrl only when one is configured', () => {
      // Absent means "no docs site" — the Help dialog must render nothing
      // rather than a dead link, so the key has to be missing, not empty.
      writeFileSync(join(tempDir, 'site-config.json'), JSON.stringify({
        docsUrl: 'https://docs.example.com/',
      }));
      expect(new SiteConfig(tempDir).getClientConfig().docsUrl).toBe('https://docs.example.com/');

      writeFileSync(join(tempDir, 'site-config.json'), JSON.stringify({ docsUrl: '' }));
      expect(new SiteConfig(tempDir).getClientConfig()).not.toHaveProperty('docsUrl');

      writeFileSync(join(tempDir, 'site-config.json'), '{}');
      expect(new SiteConfig(tempDir).getClientConfig()).not.toHaveProperty('docsUrl');
    });

    it('includes commentary popularity when configured', () => {
      writeFileSync(join(tempDir, 'site-config.json'), JSON.stringify({
        commentaryPopularity: { MHC: 0 },
      }));
      const config = new SiteConfig(tempDir);
      const client = config.getClientConfig();
      expect(client.commentaryPopularity).toEqual({ MHC: 0 });
    });

    it('omits staleDays when default', () => {
      writeFileSync(join(tempDir, 'site-config.json'), JSON.stringify({
        offline: { staleDays: 15 },
      }));
      const config = new SiteConfig(tempDir);
      const client = config.getClientConfig();
      expect(client).not.toHaveProperty('staleDays');
    });

    it('includes staleDays when non-default', () => {
      writeFileSync(join(tempDir, 'site-config.json'), JSON.stringify({
        offline: { staleDays: 30 },
      }));
      const config = new SiteConfig(tempDir);
      const client = config.getClientConfig();
      expect(client.staleDays).toBe(30);
    });

    it('includes UI config when present', () => {
      writeFileSync(join(tempDir, 'site-config.json'), JSON.stringify({
        ui: { visibleThemes: ['light', 'dark'] },
      }));
      const config = new SiteConfig(tempDir);
      const client = config.getClientConfig();
      expect(client.ui).toEqual({ visibleThemes: ['light', 'dark'] });
    });
  });

  // ── persistAuth ─────────────────────────────────────────────────

  describe('persistAuth', () => {
    it('writes hash to site-config.json and removes password', () => {
      writeFileSync(join(tempDir, 'site-config.json'), JSON.stringify({
        auth: { password: 'plain' },
        repoUrl: 'keep-this',
      }));
      const config = new SiteConfig(tempDir);
      config.persistAuth('new:hash');

      const saved = JSON.parse(readFileSync(join(tempDir, 'site-config.json'), 'utf-8'));
      expect(saved.auth.passwordHash).toBe('new:hash');
      expect(saved.auth.password).toBeUndefined();
      expect(saved.repoUrl).toBe('keep-this');
    });

    it('writes hash to legacy server-config.json', () => {
      writeFileSync(join(tempDir, 'server-config.json'), JSON.stringify({
        sitePassword: 'plain',
        showTagGraph: true,
      }));
      const config = new SiteConfig(tempDir);
      config.persistAuth('legacy:newhash');

      const saved = JSON.parse(readFileSync(join(tempDir, 'server-config.json'), 'utf-8'));
      expect(saved.sitePasswordHash).toBe('legacy:newhash');
      expect(saved.sitePassword).toBeUndefined();
      expect(saved.showTagGraph).toBe(true);
    });
  });

  // ── getSearchPipelineConfig ─────────────────────────────────────

  describe('getSearchPipelineConfig', () => {
    it('loads pipeline config from referenced path', () => {
      writeFileSync(join(tempDir, 'site-config.json'), JSON.stringify({
        search: { mode: 'server', pipelineConfigPath: 'search-pipeline.json' },
      }));
      writeFileSync(join(tempDir, 'search-pipeline.json'), JSON.stringify({
        embedder: { provider: 'local-onnx' },
        hybrid: true,
      }));
      const config = new SiteConfig(tempDir);
      const pipeline = config.getSearchPipelineConfig();
      expect(pipeline).not.toBeNull();
      expect(pipeline!.embedder.provider).toBe('local-onnx');
    });

    it('returns null when pipeline config missing', () => {
      writeFileSync(join(tempDir, 'site-config.json'), '{}');
      const config = new SiteConfig(tempDir);
      const pipeline = config.getSearchPipelineConfig();
      expect(pipeline).toBeNull();
    });
  });

  // ── Invalid/corrupt files ───────────────────────────────────────

  describe('error handling', () => {
    it('handles malformed site-config.json gracefully', () => {
      writeFileSync(join(tempDir, 'site-config.json'), '{invalid json');
      const config = new SiteConfig(tempDir);
      // Should fall back to defaults rather than crash
      expect(config.auth.enabled).toBe(true);
      expect(config.modules).toBeNull();
    });

    it('handles malformed server-config.json gracefully', () => {
      writeFileSync(join(tempDir, 'server-config.json'), '{bad json');
      const config = new SiteConfig(tempDir);
      expect(config.auth.enabled).toBe(true);
    });
  });
});
