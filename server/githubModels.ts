// Browse the public SWMM5 model library on GitHub.
//
// The repo tree is fetched once via the git/trees?recursive=1 endpoint (a
// single API call for the whole 3,800+ file tree) and cached in memory, so
// the server stays comfortably inside GitHub's 60 req/hr unauthenticated
// rate limit no matter how many visitors browse the library. File contents
// are downloaded by the browser directly from raw.githubusercontent.com
// (CORS-enabled, not subject to the API rate limit).

export const GITHUB_MODELS_REPO = {
  owner: 'SWMMBobSWMM6',
  repo: '1729-SWMM5-Models-2030',
  branch: 'master',
};

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

const TREE_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

let cachedTree: GithubModelTree | null = null;
let cachedAt = 0;
let inflight: Promise<GithubModelTree> | null = null;

export class GithubRateLimitError extends Error {
  resetAt?: string;
  constructor(message: string, resetAt?: string) {
    super(message);
    this.name = 'GithubRateLimitError';
    this.resetAt = resetAt;
  }
}

async function fetchTree(fetchImpl: typeof fetch): Promise<GithubModelTree> {
  const { owner, repo, branch } = GITHUB_MODELS_REPO;
  const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;
  const res = await fetchImpl(url, {
    headers: {
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'BatchSWMM56',
    },
  });

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

  const data = await res.json() as {
    truncated?: boolean;
    tree?: { path: string; type: string; size?: number }[];
  };

  const files: GithubModelFile[] = (data.tree || [])
    .filter(e => e.type === 'blob' && e.path.toLowerCase().endsWith('.inp'))
    .map(e => ({ path: e.path, size: e.size ?? 0 }));

  return {
    repo: `${owner}/${repo}`,
    branch,
    truncated: !!data.truncated,
    files,
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Returns the cached .inp file tree for the model library, fetching it from
 * GitHub at most once per TTL. Concurrent callers share one in-flight fetch.
 * On refresh failure a stale cache (if any) is served rather than erroring.
 */
export async function getGithubModelTree(fetchImpl: typeof fetch = fetch): Promise<GithubModelTree> {
  const now = Date.now();
  if (cachedTree && now - cachedAt < TREE_CACHE_TTL_MS) {
    return cachedTree;
  }
  if (!inflight) {
    inflight = fetchTree(fetchImpl)
      .then(tree => {
        cachedTree = tree;
        cachedAt = Date.now();
        return tree;
      })
      .finally(() => {
        inflight = null;
      });
  }
  try {
    return await inflight;
  } catch (err) {
    if (cachedTree) {
      // Serve stale data instead of failing the browse UI.
      return cachedTree;
    }
    throw err;
  }
}

/** Test hook: clear the module-level cache. */
export function clearGithubModelTreeCache(): void {
  cachedTree = null;
  cachedAt = 0;
  inflight = null;
}
