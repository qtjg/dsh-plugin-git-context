import { describe, expect, it } from 'vitest'
import { buildGitArgs } from '../src/index.ts'

describe('buildGitArgs', () => {
  it('builds a branch-aware short status request', () => {
    expect(buildGitArgs({ operation: 'status' }, 20)).toEqual(['status', '--short', '--branch'])
  })

  it('builds a path-scoped colorless diff request', () => {
    expect(buildGitArgs({ operation: 'diff', path: 'src/index.ts' }, 20)).toEqual([
      'diff', '--no-ext-diff', '--no-color', '--', 'src/index.ts',
    ])
  })

  it('defaults log output to the configured entry cap', () => {
    expect(buildGitArgs({ operation: 'log' }, 20)).toEqual([
      'log', '--no-decorate', '--no-color', '--format=%h %s', '-n', '20',
    ])
  })

  it('rejects a path on status instead of silently ignoring it', () => {
    expect(() => buildGitArgs({ operation: 'status', path: 'src/index.ts' }, 20))
      .toThrow('path is supported only for diff')
  })

  it('rejects a zero or over-cap log limit', () => {
    expect(() => buildGitArgs({ operation: 'log', limit: 0 }, 20))
      .toThrow('limit must be an integer from 1 to 20')
    expect(() => buildGitArgs({ operation: 'log', limit: 21 }, 20))
      .toThrow('limit must be an integer from 1 to 20')
  })

  it('rejects an empty diff path', () => {
    expect(() => buildGitArgs({ operation: 'diff', path: '   ' }, 20))
      .toThrow('path must be a non-empty string')
  })
})
