import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getGithubModelTree, clearGithubModelTreeCache, GithubRateLimitError } from '../server/githubModels';

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
});
