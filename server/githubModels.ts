// Browse public SWMM model repositories on GitHub.
//
// Each repo's tree is fetched via the git/trees?recursive=1 endpoint (a
// single API call for the whole file tree) and cached in memory per repo,
// so the server stays comfortably inside GitHub's 60 req/hr unauthenticated
// rate limit no matter how many visitors browse. File contents are
// downloaded by the browser directly from raw.githubusercontent.com
// (CORS-enabled, not subject to the API rate limit).

export const GITHUB_MODELS_REPO = {
  owner: 'SWMMBobSWMM6',
  repo: '1729-SWMM5-Models-2030',
  branch: 'master',
};

export interface GithubRepoRef {
  owner: string;
  repo: string;
  /** Branch (or tag) name. Empty string means "use the repo's default branch". */
  branch: string;
}

export interface GithubModelFile {
  /** Path within the repo, e.g. "EPA/Example1.inp" */
  path: string;
  /** Size in bytes as reported by the git tree */
  size: number;
}

export interface GithubModelTree {
  repo: string;
  branch: string;
  /** True when GitHub truncated the recursive tree listing */
  truncated: boolean;
  files: GithubModelFile[];
  fetchedAt: string;
}

// GitHub naming rules (slightly relaxed): owners are alphanumeric with
// hyphens; repo names allow ., _, -. Branch names exclude characters that
// are invalid in git refs or would break the URL path.
const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;
const BRANCH_RE = /^[^\s~^:?*[\\\x00-\x1f]{1,250}$/;

/**
 * Validates raw owner/repo/branch strings from the client. Returns a
 * normalized ref or throws a GithubRepoValidationError with a user-facing
 * message. An empty/omitted branch means "default branch".
 */
export function validateRepoRef(owner: unknown, repo: unknown, branch: unknown): GithubRepoRef {
  const o = typeof owner === 'string' ? owner.trim() : '';
  const r = typeof repo === 'string' ? repo.trim().replace(/\.git$/i, '') : '';
  const b = typeof branch === 'string' ? branch.trim() : '';
  if (!OWNER_RE.test(o)) {
    throw new GithubRepoValidationError('Invalid GitHub owner — use the account name, e.g. "USEPA".');
  }
  if (!REPO_RE.test(r) || r === '.' || r === '..') {
    throw new GithubRepoValidationError('Invalid GitHub repository name.');
  }
  if (b && (!BRANCH_RE.test(b) || b.startsWith('/') || b.endsWith('/') || b.includes('..'))) {
    throw new GithubRepoValidationError('Invalid branch name.');
  }
  return { owner: o, repo: r, branch: b };
}

export class GithubRepoValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GithubRepoValidationError';
  }
}

export class GithubNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GithubNotFoundError';
  }
}

export class GithubRateLimitError extends Error {
  resetAt?: string;
  constructor(message: string, resetAt?: string) {
    super(message);
    this.name = 'GithubRateLimitError';
    this.resetAt = resetAt;
  }
}

const TREE_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const MAX_CACHED_REPOS = 50;

interface CacheEntry {
  tree: GithubModelTree | null;
  cachedAt: number;
  inflight: Promise<GithubModelTree> | null;
}

const cache = new Map<string, CacheEntry>();

const GITHUB_HEADERS = {
  'Accept': 'application/vnd.github+json',
  'User-Agent': 'BatchSWMM56',
};

function checkGithubErrors(res: Response, what: string): void {
  if (res.status === 404) {
    throw new GithubNotFoundError(`GitHub ${what} not found — check the owner/repo (and branch) and make sure the repository is public.`);
  }
  if (res.status === 403 || res.status === 429) {
    const remaining = res.headers.get('x-ratelimit-remaining');
    const reset = res.headers.get('x-ratelimit-reset');
    const resetAt = reset ? new Date(parseInt(reset, 10) * 1000).toISOString() : undefined;
    if (remaining === '0') {
      throw new GithubRateLimitError('GitHub API rate limit reached', resetAt);
    }
    throw new Error(`GitHub API request forbidden (HTTP ${res.status})`);
  }
  if (!res.ok) {
    throw new Error(`GitHub API request failed (HTTP ${res.status})`);
  }
}

async function resolveDefaultBranch(ref: GithubRepoRef, fetchImpl: typeof fetch): Promise<string> {
  const res = await fetchImpl(`https://api.github.com/repos/${ref.owner}/${ref.repo}`, { headers: GITHUB_HEADERS });
  checkGithubErrors(res, 'repository');
  const data = await res.json() as { default_branch?: string };
  return data.default_branch || 'main';
}

async function fetchTree(ref: GithubRepoRef, fetchImpl: typeof fetch): Promise<GithubModelTree> {
  const branch = ref.branch || await resolveDefaultBranch(ref, fetchImpl);
  const url = `https://api.github.com/repos/${ref.owner}/${ref.repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`;
  const res = await fetchImpl(url, { headers: GITHUB_HEADERS });
  checkGithubErrors(res, 'branch');

  const data = await res.json() as {
    truncated?: boolean;
    tree?: { path: string; type: string; size?: number }[];
  };

  const files: GithubModelFile[] = (data.tree || [])
    .filter(e => e.type === 'blob' && e.path.toLowerCase().endsWith('.inp'))
    .map(e => ({ path: e.path, size: e.size ?? 0 }));

  return {
    repo: `${ref.owner}/${ref.repo}`,
    branch,
    truncated: !!data.truncated,
    files,
    fetchedAt: new Date().toISOString(),
  };
}

function cacheKey(ref: GithubRepoRef): string {
  return `${ref.owner.toLowerCase()}/${ref.repo.toLowerCase()}@${ref.branch}`;
}

function evictIfNeeded(): void {
  while (cache.size > MAX_CACHED_REPOS) {
    // Evict the oldest entry that has no in-flight fetch.
    let oldestKey: string | null = null;
    let oldestAt = Infinity;
    for (const [k, e] of cache) {
      if (e.inflight) continue;
      if (e.cachedAt < oldestAt) {
        oldestAt = e.cachedAt;
        oldestKey = k;
      }
    }
    if (!oldestKey) break;
    cache.delete(oldestKey);
  }
}

/**
 * Returns the cached .inp file tree for a repo, fetching it from GitHub at
 * most once per TTL per repo. Concurrent callers share one in-flight fetch.
 * On refresh failure a stale cache (if any) is served rather than erroring.
 * Defaults to the built-in model library.
 */
export async function getGithubModelTree(
  fetchImpl: typeof fetch = fetch,
  repoRef: GithubRepoRef = GITHUB_MODELS_REPO,
): Promise<GithubModelTree> {
  const key = cacheKey(repoRef);
  let entry = cache.get(key);
  if (!entry) {
    entry = { tree: null, cachedAt: 0, inflight: null };
    cache.set(key, entry);
  }

  const now = Date.now();
  if (entry.tree && now - entry.cachedAt < TREE_CACHE_TTL_MS) {
    return entry.tree;
  }
  let pending = entry.inflight;
  if (!pending) {
    const e = entry;
    pending = fetchTree(repoRef, fetchImpl)
      .then(tree => {
        e.tree = tree;
        e.cachedAt = Date.now();
        return tree;
      })
      .finally(() => {
        e.inflight = null;
      });
    entry.inflight = pending;
    // Evict only after this entry is marked in-flight so the newly added
    // repo is never dropped before its fetch completes.
    evictIfNeeded();
  }
  try {
    return await pending;
  } catch (err) {
    const stale = entry.tree;
    if (stale) {
      // Serve stale data instead of failing the browse UI.
      return stale;
    }
    throw err;
  }
}

/** Test hook: clear the module-level cache. */
export function clearGithubModelTreeCache(): void {
  cache.clear();
}
