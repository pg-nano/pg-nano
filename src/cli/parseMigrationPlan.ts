import type { Readable } from 'node:stream'

export async function* parseMigrationPlan(stdout: Readable) {
  let buffer = ''
  let skipped = false

  for await (const chunk of stdout) {
    buffer += chunk.toString()

    while (true) {
      const newlineIndex = buffer.indexOf('\n')
      if (newlineIndex === -1) {
        break
      }

      const line = buffer.slice(0, newlineIndex)
      buffer = buffer.slice(newlineIndex + 1)

      if (line.startsWith('#')) {
        const title = line.replace(/^#+\s*|\s*#+$/g, '')

        // Skip the review plan section.
        if (title === 'Review plan') {
          skipped = true
          continue
        }

        yield { type: 'title', text: title }
        skipped = false
      } else if (!skipped && line) {
        yield { type: 'body', text: line }
      }
    }
  }

  if (buffer.trimEnd()) {
    yield { type: 'body', text: buffer }
  }
}
