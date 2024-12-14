import * as devalue from 'devalue'
import { uid } from 'radashi'
import type { RunnerTask, SerializedConfig } from 'vitest'
import type { VitestExecutor } from 'vitest/execute'
import { VitestTestRunner } from 'vitest/runners'
import { getFn } from 'vitest/suite'
import WebSocket from 'ws'
import type { Message, Request, Response } from './message'

export default class extends VitestTestRunner {
  ws: WebSocket
  requests = new Map<string, (error: any, result: any) => void>()
  executor: VitestExecutor

  constructor(config: SerializedConfig) {
    super(config)

    this.executor = (this as any).__vitest_executor

    const wsPath = config.environmentOptions?.wsPath
    if (!wsPath) {
      throw new Error('Could not connect to pg-nano server')
    }

    this.ws = new WebSocket(wsPath)
    this.ws.on('message', payload => {
      const message = devalue.parse(payload.toString())
      const handler = '_id' in message ? this.requests.get(message._id) : null

      if (handler) {
        this.requests.delete(message._id)
        handler(message.error, message.result)
      }
    })
  }

  async runTask(test: RunnerTask): Promise<void> {
    const fn = getFn(test)
    if (!fn) {
      // Same message as https://github.com/vitest-dev/vitest/blob/4e60333dc7235704f96314c34ca510e3901fe61f/packages/runner/src/run.ts#L249
      throw new Error(
        'Test function is not found. Did you add it using `setFn`?',
      )
    }
    try {
      await fn()
    } catch (error: any) {
      throw await this.rewriteError(error)
    }
  }

  async rewriteError(error: any) {
    if (isResponseError(error)) {
      console.log('response.status => %O', error.response.status)
      if (error.response.headers.get('content-type') === 'application/json') {
        console.log('response.json => %O', await error.response.json())
      } else {
        console.log('response.text => %O', await error.response.text())
      }
    }
    if (error.name === 'PgResultError') {
      const { patch } = await this.request({
        type: 'pg-error',
        error: {
          ...error,
          stack: error.stack,
        },
      })
      if (patch) {
        Object.assign(error, patch)
      }
    }
    return error
  }

  send(message: Message) {
    this.ws.send(devalue.stringify(message))
  }

  request<TRequest extends Request>(request: TRequest) {
    const id = uid(12)
    return new Promise<Response<TRequest>>((resolve, reject) => {
      this.requests.set(id, (error, result) =>
        error ? reject(Object.assign(new Error(), error)) : resolve(result),
      )
      this.ws.send(devalue.stringify({ ...request, _id: id }))
    })
  }
}

interface ResponseError {
  response: {
    status: number
    headers: Headers
    json(): Promise<any>
    text(): Promise<string>
  }
}

function isResponseError(error: any): error is ResponseError {
  return (
    typeof error.response === 'object' &&
    typeof error.response.status === 'number' &&
    typeof error.response.headers === 'object'
  )
}
