# @qtjg/dsh-plugin-git-context

`@qtjg/dsh-plugin-git-context` adds one model-facing `git_context` tool to [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). The tool exposes bounded `status`, `diff`, and recent `log` views from a configured workspace without routing Git through a shell or leaking the parent process environment.

## Requirements

The plugin targets **Node.js 22.19 or newer** and a DeepSeek Harness installation that provides the `ctx.tools` and `ctx.subprocess` services.

## Install

From a Harness profile, install the package as an out-of-tree plugin:

```sh
dsh plugin --profile headless add @qtjg/dsh-plugin-git-context
```

Then add the plugin to the profile’s Cordis patch. A minimal entry is:

```yaml
- id: git-context
  plugin: '@qtjg/dsh-plugin-git-context'
  config:
    cwd: /path/to/your/checkout
```

The `cwd` directory must be a Git working tree or a directory inside one. Git itself resolves the repository root and reports a normal non-zero exit when the directory is not a repository.

## Configuration

| Field | Default | Description |
|---|---:|---|
| `cwd` | Harness process directory | Directory passed to Git as its working directory. |
| `maxBytes` | `100000` | Maximum retained bytes for each of stdout and stderr. The retained value is the stream tail when the limit is exceeded. |
| `maxLogEntries` | `20` | Maximum number of commits accepted by `log`. |
| `graceMs` | `2000` | Process-tree termination grace period used by the subprocess service. |

The plugin validates positive integer limits at load time and rejects unsupported argument combinations before starting Git.

## Usage

Ask the model for one of these operations:

```text
Use git_context with operation=status.
Use git_context with operation=diff and path=packages/core/tools/src/index.ts.
Use git_context with operation=log and limit=10.
```

The canonical result contains the operation, working directory, exit facts, stdout, stderr, and a `truncated` flag. A non-zero Git exit is returned as structured data so the model can distinguish an empty result from a Git diagnostic; infrastructure failures such as an unavailable executable still throw.

## Design notes

The plugin registers an effect-scoped tool on `ctx.tools` and declares its dependency on `ctx.subprocess`. It passes an explicit argv array to the subprocess seam, disables Git’s external diff driver for `diff`, disables color and decoration, bounds both output streams, and honors the tool execution cancellation signal. It does not invoke a shell and does not forward credential-shaped ambient environment variables.

The `path` argument is used only for `diff` and is placed after `--`. The plugin does not interpret pathspec syntax; Git remains the authority for path matching. The `limit` argument is accepted only for `log` and cannot exceed `maxLogEntries`.

## Development

```sh
pnpm install
pnpm run typecheck
pnpm run lint
pnpm test
pnpm run build
```

The repository includes focused tests for command construction and invalid argument combinations. The package is built as ESM with declaration files and keeps Harness services external as peer dependencies.

## License

MIT. See [LICENSE](LICENSE).
