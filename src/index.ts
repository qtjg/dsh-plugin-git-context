/**
 * Model-facing Git context for DeepSeek Harness.
 *
 * The plugin keeps Git execution behind `ctx.subprocess`, uses a fixed argv
 * vocabulary, and returns bounded structured output suitable for both Native
 * rendering and Code Mode consumers.
 * @module @qtjg/dsh-plugin-git-context
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView, ToolRunContext } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-subprocess'
import z from '@deepseek-ai/schemastery'

/** Cordis plugin name used in loader diagnostics. */
export const name = 'git-context'

/** Services required by the Git context tool. */
export const inject = ['tools', 'subprocess']

/** Plugin configuration before schemastery defaults are applied. */
export interface Config {
  /** Directory in which Git commands run. Defaults to the process working directory. */
  cwd?: string
  /** Maximum bytes retained from each output stream. */
  maxBytes?: number
  /** Maximum number of commits returned by a `log` operation. */
  maxLogEntries?: number
  /** Process-tree termination grace period in milliseconds. */
  graceMs?: number
}

/** Config schema consumed by the Cordis loader. */
export const Config: z<Config> = z.object({
  cwd: z.string().default(process.cwd()),
  maxBytes: z.number().default(100_000),
  maxLogEntries: z.number().default(20),
  graceMs: z.number().default(2_000),
})

type ResolvedConfig = Required<Config>
type Operation = 'status' | 'diff' | 'log'

interface GitContextArgs {
  operation: Operation
  path?: string
  limit?: number
}

interface GitContextResult {
  operation: Operation
  cwd: string
  exitCode: number | null
  signal: string | null
  stdout: string
  stderr: string
  truncated: boolean
}

/**
 * Build the fixed Git argv for a validated request.
 * @param args - Schema-validated operation arguments.
 * @param maxLogEntries - Deployment cap for log requests.
 * @returns Arguments after the executable name.
 */
export function buildGitArgs(args: GitContextArgs, maxLogEntries: number): string[] {
  if (args.path !== undefined && args.path.trim().length === 0) {
    throw new Error('path must be a non-empty string when provided')
  }

  switch (args.operation) {
    case 'status':
      if (args.path !== undefined) throw new Error('path is supported only for diff')
      return ['status', '--short', '--branch']
    case 'diff':
      return ['diff', '--no-ext-diff', '--no-color', '--', ...(args.path === undefined ? [] : [args.path])]
    case 'log': {
      if (args.path !== undefined) throw new Error('path is supported only for diff')
      const limit = args.limit ?? maxLogEntries
      if (!Number.isInteger(limit) || limit < 1 || limit > maxLogEntries) {
        throw new Error(`limit must be an integer from 1 to ${maxLogEntries}`)
      }
      return ['log', '--no-decorate', '--no-color', '--format=%h %s', '-n', String(limit)]
    }
    default:
      return assertNever(args.operation)
  }
}

function assertNever(value: never): never {
  throw new Error(`unsupported Git operation: ${String(value)}`)
}

function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`)
}

function formatResult(value: GitContextResult): string {
  const header = `${value.operation} in ${value.cwd} (exit ${value.exitCode ?? value.signal ?? 'unknown'})`
  const truncation = value.truncated ? '\n[output truncated]' : ''
  const stderr = value.stderr.length > 0 ? `\n\nstderr:\n${value.stderr}` : ''
  return `${header}\n\n${value.stdout}${stderr}${truncation}`
}

async function runGit(
  ctx: Context,
  exec: ToolRunContext,
  args: GitContextArgs,
  config: ResolvedConfig,
): Promise<GitContextResult> {
  const executable = await ctx.subprocess.resolveExecutable('git', undefined, exec.signal)
  const handle = ctx.subprocess.spawn({
    argv: [executable, ...buildGitArgs(args, config.maxLogEntries)],
    cwd: config.cwd,
    stdio: {
      stdin: 'ignore',
      stdout: { maxBytes: config.maxBytes },
      stderr: { maxBytes: config.maxBytes },
    },
    graceMs: config.graceMs,
    signal: exec.signal,
    env: {
      GIT_CONFIG_COUNT: undefined,
      GIT_CONFIG_KEY_0: undefined,
      GIT_CONFIG_VALUE_0: undefined,
    },
  })
  const outcome = await handle.done
  if (exec.signal.aborted) throw new Error('Git context request cancelled')
  const stdout = handle.collected.stdout?.readFrom(0)
  const stderr = handle.collected.stderr?.readFrom(0)
  return {
    operation: args.operation,
    cwd: config.cwd,
    exitCode: outcome.exitCode,
    signal: outcome.signal,
    stdout: stdout?.text ?? '',
    stderr: stderr?.text ?? '',
    truncated: Boolean(stdout?.lossy || stderr?.lossy),
  }
}

/**
 * Register the `git_context` tool.
 * @param ctx - Plugin context; the registration is scoped to the plugin fiber.
 * @param config - Resolved plugin configuration from schemastery.
 */
export function apply(ctx: Context, config: Config): void {
  const resolved = config as ResolvedConfig
  assertPositiveInteger('maxBytes', resolved.maxBytes)
  assertPositiveInteger('maxLogEntries', resolved.maxLogEntries)
  assertPositiveInteger('graceMs', resolved.graceMs)
  if (resolved.cwd.trim().length === 0) throw new Error('cwd must be a non-empty string')

  ctx.tools.register(defineTool({
    name: 'git_context',
    description: 'Inspect the current Git status, diff, or recent commit subjects in the configured workspace.',
    parameters: {
      operation: {
        type: 'string',
        required: true,
        enum: ['status', 'diff', 'log'],
        description: 'Git view to retrieve.',
      },
      path: {
        type: 'string',
        description: 'Optional pathspec for a diff. Do not provide this for status or log.',
      },
      limit: {
        type: 'number',
        description: `Number of commits for log, from 1 to ${resolved.maxLogEntries}.`,
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          operation: { type: 'string', required: true, enum: ['status', 'diff', 'log'] },
          cwd: { type: 'string', required: true },
          exitCode: { oneOf: [{ type: 'integer' }, { type: 'null' }], required: true },
          signal: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
          stdout: { type: 'string', required: true },
          stderr: { type: 'string', required: true },
          truncated: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: formatResult(value) }],
    },
    async execute(args, exec) {
      return await runGit(ctx, exec, args, resolved)
    },
    presentCall(args): GenericCallView {
      const suffix = args.path === undefined ? '' : ` ${args.path}`
      return { card: 'generic', title: `Git ${args.operation}${suffix}`, kind: 'search' }
    },
  }))
}

export default apply
