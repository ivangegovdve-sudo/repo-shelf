/** Shared by catalog generation, filters, wall spines and open-book covers. */
export const TOP_CATEGORIES = [
  { id: 'intelligence', label: 'AI & Knowledge' },
  { id: 'creative', label: 'Creative & Media' },
  { id: 'engineering', label: 'Software & Systems' },
  { id: 'trust-finance', label: 'Security & Finance' },
  { id: 'devices', label: 'Mobile & Devices' },
  { id: 'explore', label: 'Other & Exploration' },
] as const;

export const SUB_CATEGORIES = [
  { id: 'agents-assistants', label: 'Agents & Assistants', top: 'intelligence', color: '#ae5143' },
  { id: 'models-learning', label: 'Models & Learning', top: 'intelligence', color: '#7764c3' },
  { id: 'knowledge-memory', label: 'Knowledge & Memory', top: 'intelligence', color: '#427fb2' },
  { id: 'voice-audio', label: 'Voice & Audio', top: 'creative', color: '#c26786' },
  { id: 'video-creative', label: 'Video & Creative', top: 'creative', color: '#b08436' },
  { id: 'mcp-integrations', label: 'MCP & Integrations', top: 'engineering', color: '#278a88' },
  { id: 'web-automation', label: 'Web & Automation', top: 'engineering', color: '#5071bc' },
  { id: 'developer-tools', label: 'Developer Tools', top: 'engineering', color: '#658344' },
  { id: 'data-infrastructure', label: 'Data & Infrastructure', top: 'engineering', color: '#5b7f90' },
  { id: 'security-privacy', label: 'Security & Privacy', top: 'trust-finance', color: '#8d617e' },
  { id: 'finance-trading', label: 'Finance & Trading', top: 'trust-finance', color: '#35966b' },
  { id: 'mobile-devices', label: 'Mobile & Devices', top: 'devices', color: '#b96f35' },
  { id: 'unshelved', label: 'Other & Exploration', top: 'explore', color: '#807566' },
] as const;

export function subCategory(id: string | undefined) {
  return SUB_CATEGORIES.find((s) => s.id === id) ?? SUB_CATEGORIES[SUB_CATEGORIES.length - 1];
}

/** OR within each selection, AND across category, color, edition and search. */
export function matchesTaxonomy(shelfId: string, subId: string | undefined, categories: readonly string[], subs: readonly string[]): boolean {
  return (!categories.length || categories.includes(shelfId)) && (!subs.length || Boolean(subId && subs.includes(subId)));
}
