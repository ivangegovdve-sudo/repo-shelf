import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApp, type AppHandle } from '../../server/app';
import { saveConfig } from '../../server/config';
import { GitHubEnricher } from '../../server/github';
import type { Runner } from '../../server/git';
import type { SkillsIndex } from '../../src/skills';
import { makeTempRoot, rm } from './helpers';

const generatedAt = '2026-10-17T08:00:00Z';
const index: SkillsIndex = {
  schemaVersion: 1,
  generatedAt,
  totalRepos: 1,
  scannedRepos: 1,
  sources: [{
    sourceSlug: 'public-owner/toolkit',
    repoIds: ['public-toolkit'],
    defaultBranch: 'main',
    commitSha: 'a'.repeat(40),
    scannedAt: generatedAt,
    status: 'complete',
    skills: [{
      path: 'skills/review/SKILL.md',
      name: 'review-code',
      description: 'Review repository changes.',
      categoryId: 'developer-tools',
      sourceUrl: `https://github.com/public-owner/toolkit/blob/${'a'.repeat(40)}/skills/review/SKILL.md`,
      metadata: 'manifest',
    }],
  }],
};

const noGh: Runner = async () => ({ code: 1, stdout: '', stderr: 'not logged in' });
let tmp: string;
let skillsFile: string;
let handle: AppHandle | undefined;
let server: Server | undefined;
let base: string;

beforeEach(async () => {
  tmp = await makeTempRoot('repo-shelf-skills-api-');
  const configFile = path.join(tmp, 'shelf.config.json');
  const cacheDir = path.join(tmp, '.cache');
  skillsFile = path.join(tmp, 'skills.public.json');
  saveConfig(configFile, { shelves: [], staleAfterDays: 90, githubCacheHours: 24 });
  handle = await createApp({
    configFile,
    cacheDir,
    skillsFile,
    runner: noGh,
    enricher: new GitHubEnricher(path.join(cacheDir, 'github.json'), noGh),
  });
  await new Promise<void>((resolve) => {
    server = handle!.app.listen(0, '127.0.0.1', () => resolve());
  });
  base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
});

afterEach(async () => {
  handle?.close();
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  handle = undefined;
  server = undefined;
  if (tmp) rm(tmp);
});

describe('GET /api/skills', () => {
  it('serves the configured schema-1 public index with its source and skill metadata intact', async () => {
    fs.writeFileSync(skillsFile, JSON.stringify(index));
    const response = await fetch(`${base}/api/skills`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/^application\/json/);
    expect(await response.json()).toEqual(index);
  });

  it('returns a clean JSON 404 when the configured index has not been built', async () => {
    const response = await fetch(`${base}/api/skills`);
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toMatch(/^application\/json/);
    expect(await response.json()).toEqual({
      error: 'No public skills index has been built yet.',
      code: 'skills_missing',
    });
  });

  it('rejects malformed file JSON without exposing parser details or the local file path', async () => {
    fs.writeFileSync(skillsFile, '{"schemaVersion":1,"sources":[PARSER_SECRET_SENTINEL');
    const response = await fetch(`${base}/api/skills`);
    expect(response.status).toBe(500);
    expect(response.headers.get('content-type')).toMatch(/^application\/json/);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({
      error: 'The public skills index could not be read.',
      code: 'skills_unavailable',
    });
    expect(text).not.toContain('PARSER_SECRET_SENTINEL');
    expect(text).not.toContain(skillsFile);
    expect(text).not.toMatch(/SyntaxError|Unexpected token|position \d|line \d|column \d/);
  });

  it.each([
    null,
    { ...index, schemaVersion: 2 },
    { ...index, sources: {} },
  ])('rejects an unsupported index envelope instead of serving it as a valid index: %j', async (invalid) => {
    fs.writeFileSync(skillsFile, JSON.stringify(invalid));
    const response = await fetch(`${base}/api/skills`);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: 'The public skills index is invalid.',
      code: 'skills_unavailable',
    });
  });
});
