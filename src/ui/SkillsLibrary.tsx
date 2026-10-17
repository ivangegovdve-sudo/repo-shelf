import { useDeferredValue, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useShelf } from '../store';
import { filterSkills, groupSkills, type SkillEntry } from '../skills';
import { subCategory } from '../taxonomy';

const PAGE_SIZE = 40;
const SOURCE_PAGE_SIZE = 8;
const indexDate = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' });

/** Source links come from the public index; keep unexpected URL schemes out of the interface. */
function sourceHref(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'github.com' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function FolderIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M3 7V5.5A1.5 1.5 0 0 1 4.5 4H10l2 3h7.5A1.5 1.5 0 0 1 21 8.5v10A1.5 1.5 0 0 1 19.5 20h-15A1.5 1.5 0 0 1 3 18.5V7Z" />
      <path d="M3 9h18" />
    </svg>
  );
}

function SourceLinkIcon() {
  return <svg width="11" height="11" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M5 15 15 5M5 5h10v10" /></svg>;
}

function sourceSectionId(skill: SkillEntry): string {
  return `skill-sources-${encodeURIComponent(skill.id)}`;
}

function SkillSources({ skill, onClose }: { skill: SkillEntry; onClose: () => void }) {
  const [limit, setLimit] = useState(SOURCE_PAGE_SIZE);
  return (
    <section id={sourceSectionId(skill)} className="skill-sources" aria-label={`${skill.name} source locations`}>
      <div className="skill-sources-heading">
        <div>
          <h3>Source locations</h3>
          <p>{skill.occurrenceCount.toLocaleString()} {skill.occurrenceCount === 1 ? 'location' : 'locations'} across {skill.sourceCount.toLocaleString()} {skill.sourceCount === 1 ? 'repository' : 'repositories'}</p>
        </div>
        <button className="skill-source-close" type="button" onClick={onClose} aria-label={`Close ${skill.name} sources`}>×</button>
      </div>
      <ul className="skill-source-list">
        {skill.locations.slice(0, limit).map((location, i) => {
          const href = sourceHref(location.sourceUrl);
          return (
            <li key={`${location.sourceSlug}:${location.path}:${i}`}>
              <span className="skill-source-number" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
              <span className="skill-source-location">
                <strong>{location.sourceSlug}</strong>
                <span>{location.path}</span>
              </span>
              {href ? <a href={href} target="_blank" rel="noopener noreferrer" aria-label={`Read ${skill.name} at ${location.sourceSlug}, ${location.path}`}>Read skill <SourceLinkIcon /></a> : <span className="skill-source-unavailable">Link unavailable</span>}
            </li>
          );
        })}
      </ul>
      {limit < skill.locations.length && <button className="btn small skill-more-sources" type="button" onClick={() => setLimit((count) => count + SOURCE_PAGE_SIZE)}>
        Show {Math.min(SOURCE_PAGE_SIZE, skill.locations.length - limit)} more locations <span aria-hidden="true">↓</span>
      </button>}
    </section>
  );
}

export function SkillsLibrary() {
  const skills = useShelf((s) => s.skills);
  const meta = useShelf((s) => s.skillsMeta);
  const loading = useShelf((s) => s.skillsLoading);
  const error = useShelf((s) => s.skillsError);
  const query = useShelf((s) => s.skillQuery);
  const category = useShelf((s) => s.skillCategory);
  const selectedId = useShelf((s) => s.selectedSkillId);
  const setQuery = useShelf((s) => s.setSkillQuery);
  const setCategory = useShelf((s) => s.setSkillCategory);
  const selectSkill = useShelf((s) => s.selectSkill);
  const loadSkills = useShelf((s) => s.loadSkills);
  const deferredQuery = useDeferredValue(query);
  const [page, setPage] = useState(1);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const resultsHeading = useRef<HTMLHeadingElement>(null);
  const titleButtons = useRef(new Map<string, HTMLButtonElement>());
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const groups = useMemo(() => groupSkills(skills), [skills]);
  const sorted = useMemo(() => [...skills].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)), [skills]);
  const filtered = useMemo(() => filterSkills(sorted, { query: deferredQuery, category }), [sorted, deferredQuery, category]);
  const sources = useMemo(() => {
    const slugs = new Set<string>();
    for (const skill of skills) for (const location of skill.locations) slugs.add(location.sourceSlug.toLowerCase());
    return slugs.size;
  }, [skills]);
  const largestFolder = Math.max(1, ...groups.map((group) => group.count));
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const first = (currentPage - 1) * PAGE_SIZE;
  const visible = filtered.slice(first, first + PAGE_SIZE);
  const categoryLabel = category === 'all' ? 'All skills' : subCategory(category).label;
  const generated = meta?.generatedAt && Number.isFinite(Date.parse(meta.generatedAt)) ? indexDate.format(new Date(meta.generatedAt)) : null;

  useEffect(() => setPage(1), [deferredQuery, category]);

  useEffect(() => () => {
    if (copyTimer.current) clearTimeout(copyTimer.current);
  }, []);

  const reset = () => {
    setQuery('');
    setCategory('all');
    selectSkill(null);
    setPage(1);
  };
  const changePage = (next: number) => {
    setPage(next);
    resultsHeading.current?.scrollIntoView({ block: 'start' });
  };
  const closeSources = (id: string) => {
    selectSkill(null);
    titleButtons.current.get(id)?.focus({ preventScroll: true });
  };
  const copySourceLink = async (skill: SkillEntry) => {
    const href = sourceHref(skill.locations[0]?.sourceUrl);
    if (!href) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(href);
      } else {
        const input = document.createElement('textarea');
        try {
          input.value = href;
          input.setAttribute('readonly', '');
          input.style.position = 'fixed';
          input.style.opacity = '0';
          document.body.appendChild(input);
          input.select();
          if (!document.execCommand('copy')) throw new Error('copy failed');
        } finally {
          input.remove();
        }
      }
      setCopiedId(skill.id);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopiedId(null), 1800);
    } catch {
      setCopiedId(null);
    }
  };

  return (
    <section className="skills-library" aria-label="Skills library">
      <div className="skills-library-inner">
        <header className="skills-library-header">
          <div>
            <h1><FolderIcon size={25} /> Skills <span className="skills-total">{skills.length.toLocaleString()}</span></h1>
            <p>{groups.length.toLocaleString()} folders of reusable instructions from {sources.toLocaleString()} public {sources === 1 ? 'repository' : 'repositories'}.</p>
          </div>
          <div className="skills-index-meta">
            {loading ? <span role="status">Loading skills…</span> : generated && <span>Index updated {generated}</span>}
            {meta && <span>{meta.scannedRepos.toLocaleString()} / {meta.totalRepos.toLocaleString()} repositories checked</span>}
            {meta && (meta.partialSources > 0 || meta.unavailableSources > 0) && <span>{meta.partialSources + meta.unavailableSources} source{meta.partialSources + meta.unavailableSources === 1 ? '' : 's'} incomplete</span>}
          </div>
        </header>

        {error && <div className="skills-load-error" role="alert"><span><strong>{skills.length ? 'Showing the saved skills index.' : 'Skills are unavailable right now.'}</strong> {error}</span><button className="btn small" type="button" disabled={loading} onClick={() => void loadSkills()}>Retry skills</button></div>}

        <div className="skills-searchbar">
          <div className="skills-search">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => {
              if (e.key === 'Escape' && query) {
                e.stopPropagation();
                setQuery('');
              }
            }} placeholder="Search skills and sources" aria-label="Search skills" />
          </div>
          {(query || category !== 'all') && <button className="link skills-reset" type="button" onClick={reset}>Reset skill filters</button>}
        </div>

        {loading && !skills.length ? (
          <div className="skills-loading" role="status">
            <div className="skills-folder-skeletons" aria-hidden="true">{Array.from({ length: 5 }, (_, i) => <i key={i} />)}</div>
            <p>Opening the skills folders…</p>
          </div>
        ) : skills.length > 0 ? (
          <>
            <section className="skills-folder-shelf" aria-labelledby="skills-folders-heading">
              <div className="skills-shelf-caption">
                <h2 id="skills-folders-heading">Filed by purpose</h2>
                <button className={`skills-all-folders ${category === 'all' ? 'on' : ''}`} type="button" aria-pressed={category === 'all'} onClick={() => { setCategory('all'); selectSkill(null); }}>All folders</button>
              </div>
              <div className="skills-folder-scroll">
                <ul className="skills-folder-track" aria-label="Skill folders">
                  {groups.map((group, i) => {
                    const purpose = subCategory(group.id);
                    const ratio = group.count / largestFolder;
                    const style = {
                      '--folder-accent': purpose.color,
                      '--folder-depth': `${6 + Math.round(ratio * 24)}px`,
                      '--folder-width': `${126 + Math.round(ratio * 26)}px`,
                    } as CSSProperties;
                    return (
                      <li key={group.id}>
                        <button type="button" className="skill-folder" style={style} aria-label={`${purpose.label}, ${group.count.toLocaleString()} ${group.count === 1 ? 'skill' : 'skills'}`} aria-pressed={category === group.id} aria-controls="skills-results" data-category={group.id} data-skill-count={group.count} onClick={() => { setCategory(group.id); selectSkill(null); setPage(1); }}>
                          <span className="skill-folder-back" aria-hidden="true" />
                          <span className="skill-folder-paper" aria-hidden="true" />
                          <span className="skill-folder-tab" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
                          <span className="skill-folder-front">
                            <span className="skill-folder-eyebrow">SKILLS</span>
                            <strong>{purpose.label}</strong>
                            <span className="skill-folder-count"><b>{group.count.toLocaleString()}</b> {group.count === 1 ? 'skill' : 'skills'}</span>
                            <span className="skill-folder-rule" aria-hidden="true"><FolderIcon size={15} /><i /></span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </section>

            <section id="skills-results" className="skills-results" aria-labelledby="skills-results-heading" aria-busy={deferredQuery !== query}>
              <header className="skills-results-header">
                <h2 id="skills-results-heading" ref={resultsHeading}>{categoryLabel}<span>{filtered.length.toLocaleString()}</span></h2>
                <span className="skills-results-count" role="status">{deferredQuery !== query ? 'Searching…' : filtered.length ? `${(first + 1).toLocaleString()}–${Math.min(first + PAGE_SIZE, filtered.length).toLocaleString()} of ${filtered.length.toLocaleString()} skills` : 'No matches'}</span>
              </header>
              {filtered.length === 0 ? <div className="skills-empty-results">
                <FolderIcon size={34} />
                <h3>No matching skills</h3>
                <p>Try another term or look in all folders.</p>
                <button className="btn" type="button" onClick={reset}>Show all skills</button>
              </div> : <>
                <ul className="skills-entry-list" aria-label={`${categoryLabel} list`}>
                  {visible.map((skill) => {
                    const purpose = subCategory(skill.categoryId);
                    const firstSource = skill.locations[0];
                    const href = sourceHref(firstSource?.sourceUrl);
                    const selected = selectedId === skill.id;
                    return (
                      <li className={`skill-entry ${selected ? 'selected' : ''}`} key={skill.id} data-skill-id={skill.id}>
                        <div className="skill-entry-row">
                          <span className="skill-entry-icon" style={{ '--skill-color': purpose.color } as CSSProperties} aria-hidden="true"><FolderIcon size={21} /></span>
                          <div className="skill-entry-copy">
                            <button className="skill-entry-name" type="button" ref={(node) => {
                              if (node) titleButtons.current.set(skill.id, node);
                              else titleButtons.current.delete(skill.id);
                            }} aria-expanded={selected} aria-controls={selected ? sourceSectionId(skill) : undefined} onClick={() => selectSkill(selected ? null : skill.id)}>{skill.name}</button>
                            <p>{skill.description || 'Open the source SKILL.md for the full instructions.'}</p>
                            <div className="skill-entry-meta"><span>{purpose.label}</span>{skill.template && <span>Template</span>}<span>{skill.sourceCount === 1 ? firstSource?.sourceSlug ?? 'Source unavailable' : `${skill.sourceCount.toLocaleString()} repositories`}</span>{skill.occurrenceCount > 1 && <span>{skill.occurrenceCount.toLocaleString()} locations</span>}</div>
                          </div>
                          <div className="skill-entry-actions">
                            {href && <a href={href} target="_blank" rel="noopener noreferrer" aria-label={`View ${skill.name} source on GitHub`}>View source <SourceLinkIcon /></a>}
                            {href && <button type="button" onClick={() => void copySourceLink(skill)} aria-label={`Copy ${skill.name} source link`}>{copiedId === skill.id ? 'Copied' : 'Copy link'}</button>}
                            <button type="button" aria-expanded={selected} aria-controls={selected ? sourceSectionId(skill) : undefined} aria-label={`${selected ? 'Hide' : 'Show'} ${skill.name} source locations`} onClick={() => selectSkill(selected ? null : skill.id)}>{selected ? 'Hide locations' : 'Source locations'} <span aria-hidden="true">{selected ? '−' : '+'}</span></button>
                          </div>
                        </div>
                        {selected && <SkillSources key={skill.id} skill={skill} onClose={() => closeSources(skill.id)} />}
                      </li>
                    );
                  })}
                </ul>
                {totalPages > 1 && <nav className="skills-pagination" aria-label="Skills pagination">
                  <button className="btn" type="button" disabled={currentPage <= 1} onClick={() => changePage(currentPage - 1)}>← Previous</button>
                  <span>Page {currentPage.toLocaleString()} of {totalPages.toLocaleString()}</span>
                  <button className="btn" type="button" disabled={currentPage >= totalPages} onClick={() => changePage(currentPage + 1)}>Next →</button>
                </nav>}
              </>}
            </section>
          </>
        ) : !error && <div className="skills-empty-results skills-first-empty"><FolderIcon size={40} /><h2>No skills indexed yet</h2><p>Discovered SKILL.md files will be filed here by purpose.</p></div>}
      </div>
    </section>
  );
}
