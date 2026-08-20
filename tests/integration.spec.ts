import { execFile as execFileCallback } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as GitContext from '../src/index.ts'

const execFile = promisify(execFileCallback)
const signal = new AbortController().signal

let cwd: string
let ctx: Context

function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text ?? '').join('')
}

describe('git_context on the real Harness runtime', () => {
  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'dsh-git-context-'))
    await execFile('git', ['init', '--quiet'], { cwd })
    ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(LocalSubprocessRuntime)
    await ctx.plugin(GitContext, { cwd })
  })

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true })
  })

  it('executes status through ctx.tools and ctx.subprocess', async () => {
    const result = await ctx.tools.execute({
      signal,
      callId: CallId('integration-status'),
      name: 'git_context',
      arguments: { operation: 'status' },
    })

    expect(result.isError).toBe(false)
    expect(text(result)).toContain(`status in ${cwd}`)
    expect(text(result)).toContain('##')
  })

  it('returns a contained Git diagnostic for a non-repository directory', async () => {
    const nonRepository = await mkdtemp(join(tmpdir(), 'dsh-git-context-no-repo-'))
    try {
      const nonRepoCtx = new Context()
      await nonRepoCtx.plugin(SystemPrompt)
      await nonRepoCtx.plugin(ToolRuntime)
      await nonRepoCtx.plugin(LocalSubprocessRuntime)
      await nonRepoCtx.plugin(GitContext, { cwd: nonRepository })
      const result = await nonRepoCtx.tools.execute({
        signal,
        callId: CallId('integration-no-repo'),
        name: 'git_context',
        arguments: { operation: 'status' },
      })
      expect(result.isError).toBe(false)
      expect(text(result)).toContain('exit 128')
    } finally {
      await rm(nonRepository, { recursive: true, force: true })
    }
  })
})
