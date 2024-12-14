import * as t from 'valibot'

export const Message = <Type extends string, Entries extends t.ObjectEntries>(
  type: Type,
  entries: Entries,
) =>
  t.object({
    _id: t.optional(t.string()),
    type: t.literal(type),
    ...entries,
  })

/**
 * Messages sent from the runner to the main process.
 */
const MessageSchema = t.union([
  // Message('foo', {
  // }),
])

/**
 * Requests sent from the main process to the runner, and their responses.
 */
const RequestSchema = [
  {
    message: Message('pg-error', {
      error: t.record(t.string(), t.any()),
    }),
    response: t.object({
      patch: t.optional(t.record(t.string(), t.any())),
    }),
  },
] as const

export type Message = t.InferInput<typeof MessageSchema>

export type Request = t.InferInput<(typeof RequestSchema)[number]['message']>
export type Response<TRequest extends Request> =
  (typeof RequestSchema)[number] extends infer T
    ? T extends {
        message: infer TRequestSchema extends t.BaseSchema<any, any, any>
        response: infer TResponseSchema extends t.BaseSchema<any, any, any>
      }
      ? TRequest extends t.InferInput<TRequestSchema>
        ? t.InferOutput<TResponseSchema>
        : never
      : never
    : never

type Promisable<T> = T | Promise<T>

export type MessageHandlers = {
  [TMessage in Message as TMessage['type']]: (
    message: TMessage,
  ) => Promisable<void>
} & {
  [TRequest in Request as TRequest['type']]: (
    request: TRequest,
  ) => Promisable<Response<TRequest>>
}

const messageSchemas = t.union([
  MessageSchema,
  ...RequestSchema.map(schema => schema.message),
])

export function parseMessage(message: object) {
  return t.parse(messageSchemas, message)
}
