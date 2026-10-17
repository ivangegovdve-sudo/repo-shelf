import { describe, expect, it } from 'vitest';
import {
  compileSkills, filterSkills, groupSkills, inferSkillCategory, parseSkillFrontmatter,
  skillNameFromPath, skillsMeta, type SkillLocation, type SkillSource, type SkillsIndex,
} from '../src/skills';

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

function location(path: string, over: Partial<SkillLocation> = {}): SkillLocation {
  return {
    path, name: skillNameFromPath(path), description: 'A reusable workflow.', categoryId: 'developer-tools',
    sourceUrl: '', metadata: 'path', ...over,
  };
}

function source(sourceSlug: string, skills: SkillLocation[], over: Partial<SkillSource> = {}): SkillSource {
  return {
    sourceSlug, repoIds: [`book:${sourceSlug}`], sourceCategoryId: 'developer-tools', defaultBranch: 'main',
    commitSha: 'c'.repeat(40), scannedAt: '2026-10-17T00:00:00Z', status: 'complete', skills, ...over,
  };
}

function index(sources: SkillSource[], over: Partial<SkillsIndex> = {}): SkillsIndex {
  return { schemaVersion: 1, generatedAt: '2026-10-17T00:00:00Z', totalRepos: sources.length, scannedRepos: sources.length, sources, ...over };
}

describe('bounded skill frontmatter', () => {
  it('reads plain and quoted scalar metadata without retaining the Markdown body', () => {
    const parsed = parseSkillFrontmatter(`---
name: 'Don''t lose context' # YAML comment
description: "Read \\"quoted\\" docs: safely" # comment
category: Knowledge & Memory
tags: [research, "pdf, files", 'reader']
---
# Instructions
DO NOT STORE THIS BODY
`);
    expect(parsed).toEqual({ name: "Don't lose context", description: 'Read "quoted" docs: safely', category: 'Knowledge & Memory', tags: ['research', 'pdf, files', 'reader'] });
    expect(JSON.stringify(parsed)).not.toContain('DO NOT STORE THIS BODY');
  });

  it('supports common folded/literal descriptions while preserving literal hashes and quotes', () => {
    expect(parseSkillFrontmatter(`---
name: folded
description: >-
  Analyze audio and
  preserve # literal content.
category: voice-audio
---
body`)).toEqual({ name: 'folded', description: 'Analyze audio and preserve # literal content.', category: 'voice-audio' });
    expect(parseSkillFrontmatter(`---
description: |
  "Quoted" first line.
  Second line: a value.
---`)).toEqual({ description: '"Quoted" first line. Second line: a value.' });
  });

  it('handles UTF-8 BOM, CRLF, a YAML end marker and simple block tag lists', () => {
    const manifest = '\uFEFF---\r\nname: Voice toolkit\r\ntags:\r\n  - audio\r\n  - "speech"\r\n  - audio\r\n...\r\nmarkdown';
    expect(parseSkillFrontmatter(manifest)).toEqual({ name: 'Voice toolkit', tags: ['audio', 'speech'] });
  });

  it('ignores nested metadata, YAML objects, anchors and executable tags instead of interpreting them', () => {
    const parsed = parseSkillFrontmatter(`---
name: !unsafe something
description: &anchor something
category: { malicious: object }
metadata:
  name: nested name must not replace the public title
__proto__: polluted
constructor: dangerous
tags: [safe, *anchor, !executable, {object}]
---`);
    expect(parsed).toEqual({ tags: ['safe'] });
    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('requires a complete bounded opening frontmatter block', () => {
    expect(parseSkillFrontmatter('# No frontmatter\nname: body text')).toEqual({});
    expect(parseSkillFrontmatter('---\nname: unterminated')).toEqual({});
    expect(parseSkillFrontmatter(`---\ndescription: ${'x'.repeat(20_000)}\n---`)).toEqual({});
    expect(parseSkillFrontmatter(`---\n${'ignored: value\n'.repeat(300)}name: too late\n---`)).toEqual({});
  });

  it('bounds public metadata fields and strips control characters', () => {
    const parsed = parseSkillFrontmatter(`---\nname: ${'n'.repeat(200)}\ndescription: ${'d'.repeat(2000)}\ncategory: Voice\u0000 Audio\n---`);
    expect(parsed.name).toHaveLength(160);
    expect(parsed.description).toHaveLength(1200);
    expect(parsed.category).toBe('Voice Audio');
  });
});

describe('skill categories', () => {
  it('honors a recognized declared category before inferred text or source category', () => {
    expect(inferSkillCategory({ name: 'browser testing', category: 'Voice & Audio' }, 'developer-tools')).toBe('voice-audio');
    expect(inferSkillCategory({ name: 'voice', categoryId: 'security-privacy' })).toBe('security-privacy');
  });

  it('uses skill purpose or path before the collection category, without treating every agent as one category', () => {
    expect(inferSkillCategory('skills/audio-agent/SKILL.md', 'agents-assistants')).toBe('voice-audio');
    expect(inferSkillCategory('skills/postgres-database/SKILL.md', 'agents-assistants')).toBe('data-infrastructure');
    expect(inferSkillCategory({ name: 'A general assistant', tags: ['pdf'] })).toBe('knowledge-memory');
    expect(inferSkillCategory({ name: 'security-review', description: 'Agent helpers for authentication.' })).toBe('security-privacy');
  });

  it('falls back to a known source subcategory or broad category, and otherwise Other', () => {
    expect(inferSkillCategory({ name: 'quux', description: 'A specialized routine.' }, 'knowledge-memory')).toBe('knowledge-memory');
    expect(inferSkillCategory('quux', 'engineering')).toBe('developer-tools');
    expect(inferSkillCategory('quux', 'unknown')).toBe('unshelved');
    expect(inferSkillCategory('quux')).toBe('unshelved');
  });

  it('derives readable path titles and repeats inference without regex state changes', () => {
    expect(skillNameFromPath('plugins/my-pdf-reader/SKILL.md')).toBe('My PDF Reader');
    expect(skillNameFromPath('SKILL.md')).toBe('Skill');
    expect([1, 2, 3].map(() => inferSkillCategory('skills/video-editor/SKILL.md'))).toEqual(['video-creative', 'video-creative', 'video-creative']);
  });
});

describe('compiling skill copies and provenance', () => {
  it('deduplicates identical blobs globally while retaining all distinct source paths and source books', () => {
    const data = index([
      source('first/collection', [location('skills/pdf/SKILL.md', { blobSha: SHA_A }), location('.agents/pdf/SKILL.md', { blobSha: SHA_A })]),
      source('second/collection', [location('shared/pdf/SKILL.md', { blobSha: SHA_A })], { repoIds: ['fork-book', 'upstream-book'] }),
    ]);
    const entries = compileSkills(data);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ id: `blob:${SHA_A}`, sourceCount: 2, occurrenceCount: 3 });
    expect(entries[0].locations.map((item) => `${item.sourceSlug}:${item.path}`)).toEqual([
      'first/collection:.agents/pdf/SKILL.md', 'first/collection:skills/pdf/SKILL.md', 'second/collection:shared/pdf/SKILL.md',
    ]);
    expect(entries[0].locations.at(-1)!.repoIds).toEqual(['fork-book', 'upstream-book']);
    expect(data.sources[0].skills).toHaveLength(2);
  });

  it('keeps different contents with the same name separate and does not guess equivalence without hashes', () => {
    const entries = compileSkills(index([source('owner/repo', [
      location('one/SKILL.md', { name: 'Same name', blobSha: SHA_A }),
      location('two/SKILL.md', { name: 'Same name', blobSha: SHA_B }),
      location('three/SKILL.md', { name: 'Same name' }),
      location('four/SKILL.md', { name: 'Same name' }),
    ])]));
    expect(entries).toHaveLength(4);
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(4);
    expect(entries.every((entry) => entry.occurrenceCount === 1)).toBe(true);
  });

  it('prefers manifest metadata for a shared card and only labels exclusively templated copies as templates', () => {
    const entries = compileSkills(index([
      source('first/repo', [location('templates/pdf/SKILL.md', { blobSha: SHA_A, template: true, name: 'Fallback name' })]),
      source('second/repo', [location('actual/SKILL.md', { blobSha: SHA_A, name: 'Manifest title', description: 'A useful reader.', categoryId: 'knowledge-memory', metadata: 'manifest' })]),
    ]));
    expect(entries[0]).toMatchObject({ name: 'Manifest title', description: 'A useful reader.', categoryId: 'knowledge-memory' });
    expect(entries[0].template).toBeUndefined();
    const template = compileSkills(index([source('owner/repo', [location('template/SKILL.md', { template: true })])]))[0];
    expect(template.template).toBe(true);
  });

  it('coalesces repeated scans of one physical path, choosing newer content and merging source-book references', () => {
    const entries = compileSkills(index([
      source('Owner/Repo', [location('skill/SKILL.md', { blobSha: SHA_A })], { repoIds: ['old-book'], scannedAt: '2026-10-01T00:00:00Z' }),
      source('owner/repo', [location('skill/SKILL.md', { blobSha: SHA_B })], { repoIds: ['new-book'], scannedAt: '2026-10-17T00:00:00Z' }),
    ]));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ id: `blob:${SHA_B}`, sourceCount: 1, occurrenceCount: 1 });
    expect(entries[0].locations[0].repoIds).toEqual(['new-book', 'old-book']);
  });

  it('validates actual SKILL.md paths and derives safe links instead of exposing malicious URLs', () => {
    const entries = compileSkills(index([
      source('owner/repo', [
        location('skills/my reader/SKILL.md', { sourceUrl: 'javascript:alert(1)', blobSha: 'invalid-hash' }),
        location('../private/SKILL.md'), location('/absolute/SKILL.md'), location('folder/README.md'), location('folder\\SKILL.md'),
      ]),
      source('owner/repo/invalid', [location('SKILL.md')]),
    ]));
    expect(entries).toHaveLength(1);
    expect(entries[0].locations[0].sourceUrl).toBe(`https://github.com/owner/repo/blob/${'c'.repeat(40)}/skills/my%20reader/SKILL.md`);
    expect(entries[0].locations[0].blobSha).toBeUndefined();
  });

  it('keeps cached skills from partial/unavailable sources without claiming a complete scan', () => {
    const data = index([
      source('complete/repo', []),
      source('partial/repo', [location('known/SKILL.md')], { status: 'partial' }),
      source('offline/repo', [location('cached/SKILL.md')], { status: 'unavailable' }),
    ], { totalRepos: 10, scannedRepos: 2 });
    const entries = compileSkills(data);
    expect(entries).toHaveLength(2);
    expect(skillsMeta(data, entries)).toEqual({ generatedAt: data.generatedAt, totalRepos: 10, scannedRepos: 2, sourceCount: 3, completeSources: 1, partialSources: 1, unavailableSources: 1, skillCount: 2 });
    expect(skillsMeta(index([], { totalRepos: 2, scannedRepos: 8 }), [])).toMatchObject({ totalRepos: 2, scannedRepos: 2, sourceCount: 0, skillCount: 0 });
  });
});

describe('skill browsing', () => {
  const entries = compileSkills(index([
    source('audio/collection', [location('voice/transcribe/SKILL.md', { name: 'Transcribe', description: 'Turn recordings into text.', categoryId: 'voice-audio', blobSha: SHA_A })]),
    source('web/collection', [location('browser/check/SKILL.md', { name: 'Browser Check', description: 'Check a website.', categoryId: 'web-automation', blobSha: SHA_B })]),
  ]));

  it('searches names, descriptions, source slugs and alias paths with AND terms, case-insensitively', () => {
    expect(filterSkills(entries, { query: 'RECORDINGS audio/collection' }).map((entry) => entry.name)).toEqual(['Transcribe']);
    expect(filterSkills(entries, { query: 'browser/check' }).map((entry) => entry.name)).toEqual(['Browser Check']);
    expect(filterSkills(entries, { query: 'browser recordings' })).toEqual([]);
    expect(filterSkills(entries, { query: '   ' })).toEqual(entries);
  });

  it('intersects skill categories with search without altering the compiled entries', () => {
    expect(filterSkills(entries, { category: 'voice-audio' }).map((entry) => entry.name)).toEqual(['Transcribe']);
    expect(filterSkills(entries, { category: 'voice-audio', query: 'browser' })).toEqual([]);
    expect(filterSkills(entries, { category: 'all' })).toEqual(entries);
    expect(filterSkills(entries, { category: 'unknown' })).toEqual([]);
    expect(entries).toHaveLength(2);
  });

  it('groups cards once per category in the established category order, with no empty groups', () => {
    expect(groupSkills(entries).map((group) => ({ id: group.id, count: group.count, names: group.skills.map((skill) => skill.name) }))).toEqual([
      { id: 'voice-audio', count: 1, names: ['Transcribe'] },
      { id: 'web-automation', count: 1, names: ['Browser Check'] },
    ]);
    expect(groupSkills([])).toEqual([]);
  });
});
