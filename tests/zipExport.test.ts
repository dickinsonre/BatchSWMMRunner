import { describe, it, expect, vi } from 'vitest';
import { buildResultsZip, needsContentFetch } from '../client/src/lib/zipExport';
import type { ProcessResult } from '../client/src/components/ResultsDisplay';

function result(partial: Partial<ProcessResult> & { fileName: string }): ProcessResult {
  return {
    id: partial.fileName,
    filePath: partial.fileName,
    status: 'success',
    ...partial,
  } as ProcessResult;
}

describe('needsContentFetch', () => {
  it('is true only when text is deferred server-side and not yet loaded', () => {
    expect(needsContentFetch(result({ fileName: 'a.inp', hasReport: true }))).toBe(true);
    expect(needsContentFetch(result({ fileName: 'a.inp', hasInp: true }))).toBe(true);
    expect(needsContentFetch(result({ fileName: 'a.inp', hasReport: true, reportContent: 'x' }))).toBe(false);
    expect(needsContentFetch(result({ fileName: 'a.inp' }))).toBe(false);
  });
});

describe('buildResultsZip', () => {
  it('adds rpt and inp entries with correct contents', async () => {
    const { zip, fileCount } = await buildResultsZip([
      result({ fileName: 'model.inp', reportContent: 'RPT-A', inpContent: 'INP-A' }),
      result({ fileName: 'other.inp', reportContent: 'RPT-B' }),
    ]);
    expect(fileCount).toBe(3);
    expect(Object.keys(zip.files).sort()).toEqual(['model.inp', 'model.rpt', 'other.rpt']);
    expect(await zip.file('model.rpt')!.async('string')).toBe('RPT-A');
    expect(await zip.file('model.inp')!.async('string')).toBe('INP-A');
    expect(await zip.file('other.rpt')!.async('string')).toBe('RPT-B');
  });

  it('de-duplicates repeated file names', async () => {
    const { zip, fileCount } = await buildResultsZip([
      result({ id: '1', fileName: 'dup.inp', reportContent: 'first', inpContent: 'inp1' }),
      result({ id: '2', fileName: 'dup.inp', reportContent: 'second', inpContent: 'inp2' }),
      result({ id: '3', fileName: 'dup.inp', reportContent: 'third' }),
    ]);
    expect(fileCount).toBe(5);
    expect(Object.keys(zip.files).sort()).toEqual([
      'dup-2.inp', 'dup-2.rpt', 'dup-3.rpt', 'dup.inp', 'dup.rpt',
    ]);
    expect(await zip.file('dup.rpt')!.async('string')).toBe('first');
    expect(await zip.file('dup-2.rpt')!.async('string')).toBe('second');
    expect(await zip.file('dup-3.rpt')!.async('string')).toBe('third');
  });

  it('skips results without content and reports zero files for an empty batch', async () => {
    const { fileCount } = await buildResultsZip([
      result({ fileName: 'failed.inp', status: 'failed' }),
    ]);
    expect(fileCount).toBe(0);
  });

  it('fetches deferred server-side content before zipping', async () => {
    const light = [
      result({ fileName: 'deferred.inp', hasReport: true, hasInp: true }),
    ];
    const loadAll = vi.fn(async () => [
      result({ fileName: 'deferred.inp', reportContent: 'FULL-RPT', inpContent: 'FULL-INP' }),
    ]);
    const { zip, fileCount } = await buildResultsZip(light, loadAll);
    expect(loadAll).toHaveBeenCalledTimes(1);
    expect(fileCount).toBe(2);
    expect(await zip.file('deferred.rpt')!.async('string')).toBe('FULL-RPT');
    expect(await zip.file('deferred.inp')!.async('string')).toBe('FULL-INP');
  });

  it('does not call the loader when all content is already local', async () => {
    const loadAll = vi.fn(async () => []);
    const { fileCount } = await buildResultsZip(
      [result({ fileName: 'local.inp', reportContent: 'r' })],
      loadAll,
    );
    expect(loadAll).not.toHaveBeenCalled();
    expect(fileCount).toBe(1);
  });
});
