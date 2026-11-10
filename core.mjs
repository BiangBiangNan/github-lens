// Pure, dependency-free helpers shared by the extension UI and Node tests.
export const LANGUAGES = Object.freeze(['Python', 'TypeScript', 'JavaScript', 'Go', 'Rust', 'Java', 'C++', 'C', 'C#', 'Swift', 'Kotlin', 'Ruby', 'PHP', 'Shell', 'Jupyter Notebook', 'Dart', 'HTML', 'CSS', 'Vue', 'Svelte', 'Scala', 'Elixir', 'Erlang', 'Haskell', 'Lua', 'Perl', 'R', 'Julia', 'Objective-C', 'PowerShell', 'Dockerfile', 'Assembly', 'Zig', 'Clojure', 'F#', 'OCaml', 'MATLAB', 'Fortran', 'SQL', 'SCSS']);
export const LICENSES = Object.freeze(['mit', 'apache-2.0', 'gpl-3.0', 'gpl-2.0', 'agpl-3.0', 'lgpl-3.0', 'lgpl-2.1', 'bsd-2-clause', 'bsd-3-clause', 'mpl-2.0', 'unlicense', 'isc', 'cc0-1.0', 'epl-2.0', 'bsl-1.0']);
const absent = value => value === undefined || value === null || value === '';
function integerFilter(value, name) {
  if (typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value)) value = Number(value);
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${name} 必须是非负安全整数`);
  return value;
}

export function buildQuery(options = {}, now = new Date()) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('查询参数必须是对象');
  const { keyword = '', language, minStars, updatedWithin, license, includeForks = false, includeArchived = false } = options;
  if (typeof keyword !== 'string' || keyword.length > 1000) throw new TypeError('keyword 必须是不超过 1000 字符的字符串');
  if (typeof includeForks !== 'boolean' || typeof includeArchived !== 'boolean') throw new TypeError('includeForks/includeArchived 必须为 boolean');
  const filters = [];
  if (!absent(language)) {
    if (typeof language !== 'string' || !LANGUAGES.includes(language)) throw new TypeError('不支持的 language');
    filters.push(`language:"${language}"`);
  }
  if (!absent(minStars)) filters.push(`stars:>=${integerFilter(minStars, 'minStars')}`);
  if (!absent(updatedWithin)) {
    const days = integerFilter(updatedWithin, 'updatedWithin');
    if (![7, 30, 90, 365].includes(days)) throw new TypeError('updatedWithin 仅支持 7/30/90/365 天');
    const date = new Date(now);
    if (!Number.isFinite(date.getTime())) throw new TypeError('now 日期无效');
    date.setUTCDate(date.getUTCDate() - days);
    filters.push(`pushed:>=${date.toISOString().slice(0, 10)}`);
  }
  if (!absent(license)) {
    if (typeof license !== 'string' || !LICENSES.includes(license)) throw new TypeError('不支持的 license');
    filters.push(`license:${license}`);
  }
  if (!keyword.trim() && !filters.length) throw new TypeError('空 keyword 至少需要一个有效筛选条件');
  if (!includeForks) filters.push('fork:false');
  if (!includeArchived) filters.push('archived:false');
  // Do not parse, rewrite, escape, or trim user-authored advanced GitHub syntax.
  return keyword ? `${keyword} ${filters.join(' ')}`.trimEnd() : filters.join(' ');
}

export function safeRepoUrl(fullName) {
  if (typeof fullName !== 'string') return null;
  const parts = fullName.split('/');
  if (parts.length !== 2 || parts.some(part => !/^[A-Za-z0-9_.-]+$/.test(part) || part === '.' || part === '..')) return null;
  return `https://github.com/${parts.map(part => encodeURIComponent(part)).join('/')}`;
}

export function formatNumber(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return '—';
  const number = Math.floor(value);
  if (number >= 100000000) return `${Number((number / 100000000).toFixed(1))}亿`;
  if (number >= 10000) return `${Number((number / 10000).toFixed(1))}万`;
  return number.toLocaleString('zh-CN');
}

export function relativeDate(value, now = new Date()) {
  if (value === null || value === undefined || value === '') return '未知';
  const timestamp = new Date(value).getTime();
  const current = new Date(now).getTime();
  if (!Number.isFinite(timestamp) || !Number.isFinite(current)) return '未知';
  const seconds = Math.max(0, (current - timestamp) / 1000);
  if (seconds < 60) return '刚刚';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}分钟前`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}小时前`;
  if (seconds < 2592000) return `${Math.floor(seconds / 86400)}天前`;
  if (seconds < 31536000) return `${Math.floor(seconds / 2592000)}个月前`;
  return `${Math.floor(seconds / 31536000)}年前`;
}

const text = value => typeof value === 'string' ? value : '';
const count = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.min(Math.floor(value), Number.MAX_SAFE_INTEGER) : 0;
export function normalizeRepo(input) {
  const repo = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const fullName = text(repo.full_name);
  let license = typeof repo.license === 'string' ? repo.license : text(repo.license?.spdx_id) || text(repo.license?.name);
  if (!license || license.toUpperCase() === 'NOASSERTION') license = null;
  const updated = text(repo.updated_at);
  return {
    id: Number.isSafeInteger(repo.id) && repo.id > 0 ? repo.id : null,
    full_name: fullName,
    description: text(repo.description),
    // Never propagate attacker-controlled html_url from an import/API object.
    html_url: safeRepoUrl(fullName) || '',
    language: text(repo.language) || null,
    stars: count(repo.stargazers_count ?? repo.stars),
    forks: count(repo.forks_count ?? repo.forks),
    topics: Array.isArray(repo.topics) ? [...new Set(repo.topics.filter(topic => typeof topic === 'string' && topic.length > 0 && topic.length <= 100))].slice(0, 100) : [],
    updated_at: updated && Number.isFinite(Date.parse(updated)) ? updated : '',
    license,
    archived: repo.archived === true,
  };
}
