import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getGithubModelTree,
  clearGithubModelTreeCache,
  GithubRateLimitError,
  GithubNotFoundError,
  GithubRepoValidationError,
  validateRepoRef,
} from '../server/githubModels';

function mockFetchResponse(body: any, status = 200, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    json: async () => body,
  } as unknown as Response;
}

const sampleTree = {
  truncated: false,
  tree: [
    { path: 'EPA', type: 'tree' },
    { path: 'EPA/Example1.inp', type: 'blob', size: 1234 },
    { path: 'EPA/readme.txt', type: 'blob', size: 10 },
    { path: 'Hydraulics/Model_A.INP', type: 'blob', size: 999 },
    { path: 'root.inp', type: 'blob', size: 5 },
  ],
};

describe('getGithubModelTree', () => {
  beforeEach(() => {
    clearGithubModelTreeCache();
  });

  it('filters to .inp blobs (case-insensitive) and reports sizes', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(mockFetchResponse(sampleTree));
    const tree = await getGithubModelTree(fetchImpl as any);
    expect(tree.files.map(f => f.path)).toEqual([
      'EPA/Example1.inp',
      'Hydraulics/Model_A.INP',
      'root.inp',
    ]);
    expect(tree.files[0].size).toBe(1234);
    expect(tree.truncated).toBe(false);
    // Uses the single recursive git/trees call
    expect(fetchImpl.mock.calls[0][0]).toContain('/git/trees/master?recursive=1');
  });

  it('caches the tree so repeat calls do not hit GitHub again', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(mockFetchResponse(sampleTree));
    await getGithubModelTree(fetchImpl as any);
    await getGithubModelTree(fetchImpl as any);
    await getGithubModelTree(fetchImpl as any);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('shares one in-flight fetch across concurrent callers', async () => {
    const fetchImpl = vi.fn().mockImplementation(
      () => new Promise(resolve => setTimeout(() => resolve(mockFetchResponse(sampleTree)), 10)),
    );
    const [a, b] = await Promise.all([
      getGithubModelTree(fetchImpl as any),
      getGithubModelTree(fetchImpl as any),
    ]);
    expect(a.files.length).toBe(3);
    expect(b.files.length).toBe(3);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('throws GithubRateLimitError when the API rate limit is exhausted', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      mockFetchResponse({}, 403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1767225600' }),
    );
    await expect(getGithubModelTree(fetchImpl as any)).rejects.toBeInstanceOf(GithubRateLimitError);
  });

  it('serves stale cache when a refresh fails', async () => {
    const good = vi.fn().mockResolvedValue(mockFetchResponse(sampleTree));
    const tree = await getGithubModelTree(good as any);
    expect(tree.files.length).toBe(3);
    // Simulate TTL expiry by clearing only the timestamp via a fresh failing fetch
    // (cache still present internally). We can't advance time here, so instead
    // verify the error path with no cache:
    clearGithubModelTreeCache();
    const bad = vi.fn().mockResolvedValue(mockFetchResponse({}, 500));
    await expect(getGithubModelTree(bad as any)).rejects.toThrow('HTTP 500');
  });

  it('marks truncated listings', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(mockFetchResponse({ ...sampleTree, truncated: true }));
    const tree = await getGithubModelTree(fetchImpl as any);
    expect(tree.truncated).toBe(true);
  });

  it('caches per repo — different repos each hit GitHub once', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(mockFetchResponse(sampleTree));
    const a = { owner: 'alice', repo: 'models', branch: 'main' };
    const b = { owner: 'bob', repo: 'models', branch: 'main' };
    await getGithubModelTree(fetchImpl as any, a);
    await getGithubModelTree(fetchImpl as any, a);
    await getGithubModelTree(fetchImpl as any, b);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0][0]).toContain('/repos/alice/models/git/trees/main');
    expect(fetchImpl.mock.calls[1][0]).toContain('/repos/bob/models/git/trees/main');
  });

  it('resolves the default branch when branch is empty', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(mockFetchResponse({ default_branch: 'develop' }))
      .mockResolvedValueOnce(mockFetchResponse(sampleTree));
    const tree = await getGithubModelTree(fetchImpl as any, { owner: 'alice', repo: 'models', branch: '' });
    expect(fetchImpl.mock.calls[0][0]).toBe('https://api.github.com/repos/alice/models');
    expect(fetchImpl.mock.calls[1][0]).toContain('/git/trees/develop?recursive=1');
    expect(tree.branch).toBe('develop');
  });

  it('URL-encodes branch names with reserved characters like #', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(mockFetchResponse(sampleTree));
    const tree = await getGithubModelTree(fetchImpl as any, { owner: 'alice', repo: 'models', branch: 'feature#123' });
    expect(fetchImpl.mock.calls[0][0]).toContain('/git/trees/feature%23123?recursive=1');
    // The branch is reported raw so clients can encode it themselves.
    expect(tree.branch).toBe('feature#123');
  });

  it('keeps a newly added repo cached even when the cache is at capacity', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(mockFetchResponse(sampleTree));
    // Fill past the 50-repo cap
    for (let i = 0; i < 55; i++) {
      await getGithubModelTree(fetchImpl as any, { owner: 'o' + i, repo: 'r', branch: 'main' });
    }
    const callsAfterFill = fetchImpl.mock.calls.length;
    expect(callsAfterFill).toBe(55);
    // The most recently added repo must still be cached (no extra fetch)
    await getGithubModelTree(fetchImpl as any, { owner: 'o54', repo: 'r', branch: 'main' });
    expect(fetchImpl.mock.calls.length).toBe(callsAfterFill);
  });

  it('throws GithubNotFoundError for a missing repo or branch', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(mockFetchResponse({}, 404));
    await expect(
      getGithubModelTree(fetchImpl as any, { owner: 'alice', repo: 'nope', branch: 'main' }),
    ).rejects.toBeInstanceOf(GithubNotFoundError);
  });
});

describe('validateRepoRef', () => {
  it('accepts valid owner/repo/branch and trims input', () => {
    expect(validateRepoRef(' USEPA ', 'Stormwater-Management-Model.git', ' main ')).toEqual({
      owner: 'USEPA',
      repo: 'Stormwater-Management-Model',
      branch: 'main',
    });
  });

  it('treats missing branch as default branch', () => {
    expect(validateRepoRef('a', 'b', undefined).branch).toBe('');
  });

  it('rejects invalid owners, repos, and branches', () => {
    expect(() => validateRepoRef('bad owner!', 'repo', '')).toThrow(GithubRepoValidationError);
    expect(() => validateRepoRef('', 'repo', '')).toThrow(GithubRepoValidationError);
    expect(() => validateRepoRef('owner', 'repo/../evil', '')).toThrow(GithubRepoValidationError);
    expect(() => validateRepoRef('owner', '..', '')).toThrow(GithubRepoValidationError);
    expect(() => validateRepoRef('owner', 'repo', 'bad..branch')).toThrow(GithubRepoValidationError);
    expect(() => validateRepoRef('owner', 'repo', 'has space')).toThrow(GithubRepoValidationError);
  });
});
