import { apply, buildGitArgs, inject, name } from '../lib/index.js'

if (name !== 'git-context') throw new Error(`unexpected plugin name: ${name}`)
if (apply.length < 1) throw new Error('plugin apply export is missing')
if (inject.join(',') !== 'tools,subprocess,llm') throw new Error(`unexpected injections: ${inject.join(',')}`)
const args = buildGitArgs({ operation: 'status' }, 20)
if (args.join(' ') !== 'status --short --branch') throw new Error(`unexpected argv: ${args.join(' ')}`)
console.log('built artifact smoke passed')
