import { execFile as execFileCallback } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { Context } from '@deepseek-ai/cordis'
import { CallId, LlmAdapter, LlmRuntime } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as GitContext from '../src/index.ts'

const execFile = promisify(execFileCallback)
const signal = new AbortController().signal
const cleanGitEnv: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_CONFIG_COUNT: undefined,
  GIT_CONFIG_KEY_0: undefined,
  GIT_CONFIG_VALUE_0: undefined,
}

class ReviewAdapter extends LlmAdapter {
  prompt = ''

  override stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.prompt = options.messages.at(-1)?.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('') ?? ''
    return (async function* (): AsyncIterable<StreamChunk> {
      yield { type: 'text-delta', index: 0, text: 'Potential issue: add a regression test for the changed behavior.' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    })()
  }
}

let cwd: string
let ctx: Context
let reviewAdapter: ReviewAdapter

function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text ?? '').join('')
}

async function git(args: string[], directory: string): Promise<void> {
  await execFile('git', args, { cwd: directory, env: cleanGitEnv })
}

async function mount(target: Context, directory: string, withReview = true): Promise<ReviewAdapter> {
  await target.plugin(SystemPrompt)
  await target.plugin(ToolRuntime)
  await target.plugin(LocalSubprocessRuntime)
  await target.plugin(LlmRuntime)
  const adapter = new ReviewAdapter()
  target.llm.registerAdapter(['test-review'], adapter)
  await target.plugin(GitContext, {
    cwd: directory,
    ...withReview ? { reviewProvider: 'test-review', reviewModel: 'test-model' } : {},
  })
  return adapter
}

describe('Git tools on the real Harness runtime', () => {
  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'dsh-git-context-'))
    await git(['init', '--quiet'], cwd)
    await writeFile(join(cwd, 'review.ts'), 'export const answer = 1\n')
    await git(['add', 'review.ts'], cwd)
    await git(['-c', 'user.name=Harness Test', '-c', 'user.email=test@example.com', 'commit', '--quiet', '-m', 'initial'], cwd)
    await writeFile(join(cwd, 'review.ts'), 'export const answer = 2\n')
    ctx = new Context()
    reviewAdapter = await mount(ctx, cwd)
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
    expect(text(result)).toContain('review.ts')
  })

  it('sends the bounded diff through ctx.llm for an independent review', async () => {
    const result = await ctx.tools.execute({
      signal,
      callId: CallId('integration-review'),
      name: 'git_review',
      arguments: {},
    })

    expect(result.isError).toBe(false)
    expect(text(result)).toContain('Potential issue')
    expect(reviewAdapter.prompt).toContain('<git-diff>')
    expect(reviewAdapter.prompt).toContain('answer = 2')
  })

  it('returns a contained Git diagnostic for a non-repository directory', async () => {
    const nonRepository = await mkdtemp(join(tmpdir(), 'dsh-git-context-no-repo-'))
    try {
      const nonRepoCtx = new Context()
      await mount(nonRepoCtx, nonRepository)
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
