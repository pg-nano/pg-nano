import fs from 'node:fs'
import path from 'node:path'
import type { Plugin, PluginContext } from '../config/plugin.js'
import type { Env } from '../env.js'
import { events } from '../events.js'
import type { PgBaseType } from '../inspector/types.js'
import { parseSchemaFile, type PgSchema } from '../parser/parse.js'

export async function runGeneratorPlugins(
  env: Env,
  schema: PgSchema,
  baseTypes: PgBaseType[],
) {
  // Ensure that removed plugins don't leave behind any SQL files.
  fs.rmSync(env.config.generate.pluginSqlDir, {
    recursive: true,
    force: true,
  })

  type StatementsPlugin = Plugin & { statements: Function }

  const plugins = env.config.plugins.filter(
    (p): p is StatementsPlugin => p.statements != null,
  )

  const pluginsByStatementId = new Map<string, StatementsPlugin>()

  if (plugins.length === 0) {
    return pluginsByStatementId
  }

  fs.mkdirSync(env.config.generate.pluginSqlDir, { recursive: true })

  const context: PluginContext['statements'] = {
    objects: schema.objects.filter(object => object.id.schema !== 'nano'),
  }

  for (const plugin of plugins) {
    events.emit('plugin:statements', { plugin })

    const template = await plugin.statements(context, env.config)

    if (template) {
      const outFile = path.join(
        env.config.generate.pluginSqlDir,
        plugin.name.replace(/\//g, '__') + '.pgsql',
      )

      const pg = await env.client
      const content = pg.stringify(template, {
        reindent: true,
      })

      // Write to disk so the developer can see the generated SQL, and possibly
      // commit it to source control (if desired). Note that this won't trigger
      // the file watcher, since the pluginSqlDir is ignored.
      fs.writeFileSync(outFile, content)

      // Immediately parse the generated statements so they can be used by
      // plugins that run after this one.
      const pluginSchema = await parseSchemaFile(content, outFile, baseTypes)

      for (const object of pluginSchema.objects) {
        if (schema.objects.some(other => other.id.equals(object.id))) {
          events.emit('name-collision', { object })
          continue
        }
        schema.objects.push(object)
        pluginsByStatementId.set(object.id.toQualifiedName(), plugin)
      }

      for (const insert of pluginSchema.inserts) {
        const relation = schema.objects.find(object =>
          object.id.equals(insert.relationId),
        )

        if (!relation || !pluginSchema.objects.includes(relation)) {
          events.emit('prepare:skip-insert', { insert })
          continue
        }

        schema.inserts.push(insert)
      }
    }
  }

  return pluginsByStatementId
}
