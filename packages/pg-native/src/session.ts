import { createHash } from 'node:crypto'
import type { Options } from 'option-types'
import { sql } from './template.js'

const aliases: Record<string, string> = {
  date_style: 'DateStyle',
  interval_style: 'IntervalStyle',
  timezone: 'TimeZone',
}

/**
 * Generate a MD5 hash of the session parameters. You must not modify the given
 * object after calling this function.
 */
export function hashSessionParameters(params: SessionParameters): string {
  if ('_hex' in params) {
    return params._hex as string
  }
  const hash = createHash('md5')
  for (const key of Object.keys(params).sort()) {
    hash.update(`${aliases[key] ?? key}=${params[key]};`)
  }
  const hex = hash.digest('hex')
  Object.defineProperty(params, '_hex', {
    value: hex,
  })
  return hex
}

export function renderSessionParameters(params: SessionParameters) {
  return sql`${Object.entries(params).map(([key, value]) => {
    return sql.unsafe(`SET ${aliases[key] ?? key} TO ${value};\n`)
  })}`
}

export type SessionParameters = Record<string, unknown> &
  Options<{
    /**
     * Controls whether function bodies are checked for syntax errors. Disabling
     * validation avoids side effects of the validation process, in particular
     * preventing false positives due to problems such as forward references.
     *
     * @default true
     * @see https://postgresqlco.nf/doc/en/param/check_function_bodies/
     */
    check_function_bodies?: boolean

    /**
     * Controls the message levels sent to the client.
     *
     * @default 'NOTICE'
     * @see https://postgresqlco.nf/doc/en/param/client_min_messages/
     */
    client_min_messages?: SessionParameter.ClientMinMessages

    /**
     * Sets the planner's estimate of the cost of processing each index entry
     * during an index scan.
     *
     * Decrease this slightly to make your database favor indexes slightly more.
     *
     * @default 0.005
     * @see https://postgresqlco.nf/doc/en/param/cpu_index_tuple_cost/
     */
    cpu_index_tuple_cost?: number

    /**
     * Sets the display format for date and time values.
     *
     * Note that `initdb` will initialize the configuration file with a setting
     * that corresponds to the behavior of the chosen `lc_time` locale.
     *
     * @default 'ISO, MDY'
     * @see https://postgresqlco.nf/doc/en/param/DateStyle/
     */
    date_style?: SessionParameter.DateStyle

    /**
     * Sets whether new transactions are deferrable.
     *
     * If you use serializable transactions by default, it may be also useful to
     * set this in order to decrease the overhead of long-running transactions.
     *
     * @default false
     * @see https://postgresqlco.nf/doc/en/param/default_transaction_deferrable/
     */
    default_transaction_deferrable?: boolean

    /**
     * Sets the isolation level for new transactions.
     *
     * @default 'read committed'
     * @see https://postgresqlco.nf/doc/en/param/default_transaction_isolation/
     */
    default_transaction_isolation?: SessionParameter.TransactionIsolation

    /**
     * Sets the default read-only status of new transactions.
     *
     * This setting is mainly useful for preventing yourself from accidentally
     * changing data. Defaults to true if you are on a replication standby.
     *
     * @default false
     * @see https://postgresqlco.nf/doc/en/param/default_transaction_read_only/
     */
    default_transaction_read_only?: boolean

    /**
     * Sets the planner's assumption about the total size of the data caches.
     *
     * This setting just helps the planner make good cost estimates; it does not
     * actually allocate the memory.
     *
     * @default '4GB'
     * @see https://postgresqlco.nf/doc/en/param/effective_cache_size/
     */
    effective_cache_size?: SessionParameter.MemoryLimit

    /**
     * Enables the planner's use of bitmap-scan plans.
     *
     * @default true
     * @see https://postgresqlco.nf/doc/en/param/enable_bitmapscan/
     */
    enable_bitmapscan?: boolean

    /**
     * Enables the planner's use of hash join plans.
     *
     * @default true
     * @see https://postgresqlco.nf/doc/en/param/enable_hashjoin/
     */
    enable_hashjoin?: boolean

    /**
     * Enables the planner's use of merge join plans.
     *
     * @default true
     * @see https://postgresqlco.nf/doc/en/param/enable_mergejoin/
     */
    enable_mergejoin?: boolean

    /**
     * Enables the planner's use of nested-loop join plans.
     *
     * It is impossible to suppress nested-loop joins entirely, but turning this
     * variable off discourages the planner from using one if there are other
     * methods available.
     *
     * @default true
     * @see https://postgresqlco.nf/doc/en/param/enable_nestloop/
     */
    enable_nestloop?: boolean

    /**
     * Enables the planner's use of parallel hash plans. Has no effect if
     * hash-join plans are not also enabled.
     *
     * @default true
     * @see https://postgresqlco.nf/doc/en/param/enable_parallel_hash/
     */
    enable_parallel_hash?: boolean

    /**
     * Sets the number of digits displayed for floating-point values. Can range
     * from -15 to 3.
     *
     * Only significant for applications which do a lot of float calculations,
     * like scientific databases.
     *
     * @default 1
     * @see https://postgresqlco.nf/doc/en/param/extra_float_digits/
     */
    extra_float_digits?: number

    /**
     * Soft upper limit of the size of the set returned by GIN index scans.
     *
     * If you're going to use GIN queries in a web application, it's generally
     * useful to set a limit on how many rows can be returned from the index
     * just for response times. However, the maximum number needs to depend on
     * your application; what do users see as an acceptable expression of
     * "many"?
     *
     * @default 0
     * @see https://postgresqlco.nf/doc/en/param/gin_fuzzy_search_limit/
     */
    gin_fuzzy_search_limit?: number

    /**
     * Sets the idle_in_transaction_session_timeout for terminating sessions
     * that are idle within a transaction. If no unit is specified, it defaults
     * to milliseconds.
     *
     * Set to 1 hour maximum, or as low as 1 minute if you know your query load
     * well. Idle transactions are bad news.
     *
     * @example '10min'
     * @default 0 // (no timeout)
     * @see https://postgresqlco.nf/doc/en/param/idle_in_transaction_session_timeout/
     */
    idle_in_transaction_session_timeout?: SessionParameter.Duration

    /**
     * Sets the display format for interval values.
     *
     * @default 'postgres'
     * @see https://postgresqlco.nf/doc/en/param/IntervalStyle/
     */
    interval_style?: SessionParameter.IntervalStyle

    /**
     * The language in which messages are returned.
     * Typically set to a locale like 'en_US.UTF-8'.
     *
     * @see https://postgresqlco.nf/doc/en/param/lc_messages/
     */
    lc_messages?: string

    /**
     * Defines the monetary formatting locale for the current session.
     *
     * @default 'C'
     * @see https://postgresqlco.nf/doc/en/param/lc_monetary/
     */
    lc_monetary?: string

    /**
     * Defines the numeric formatting locale for the current session.
     *
     * @default 'C'
     * @see https://postgresqlco.nf/doc/en/param/lc_numeric/
     */
    lc_numeric?: string

    /**
     * Configures the lock timeout for statements waiting for locks to be
     * released. If no unit is specified, it defaults to milliseconds.
     *
     * @example '1s' // (for 1 second)
     * @default 0 // (no timeout) @see
     * https://postgresqlco.nf/doc/en/param/lock_timeout/
     */
    lock_timeout?: SessionParameter.Duration

    /**
     * When true, timing information is logged with queries.
     *
     * @default false
     * @see https://postgresqlco.nf/doc/en/param/log_duration/
     */
    log_duration?: boolean

    /**
     * Sets the verbosity of error reports for the session.
     *
     * Using `"VERBOSE"` is not recommended unless doing intensive debugging.
     * Alternately, set to `"TERSE"` if managing log volume is becoming a
     * problem.
     *
     * @default 'DEFAULT'
     * @see https://postgresqlco.nf/doc/en/param/log_error_verbosity/
     */
    log_error_verbosity?: SessionParameter.LogErrorVerbosity

    /**
     * Writes executor performance statistics to the server log.
     *
     * @default false
     * @see https://postgresqlco.nf/doc/en/param/log_executor_stats/
     */
    log_executor_stats?: boolean

    /**
     * Controls information prefixed to each log line.
     *
     * Primarily useful for providing extra information when logging to syslog
     * or eventlog. Try `"%h:%d:%u:%c %t"` for this.
     *
     * @default '%m [%p]'
     * @see https://postgresqlco.nf/doc/en/param/log_line_prefix/
     */
    log_line_prefix?: string

    /**
     * Sets the minimum execution time above which all statements will be
     * logged.
     *
     * Possibly the most generally useful log setting for troubleshooting
     * performance, especially on a production server. Records only long-running
     * queries for analysis; since these are often your "problem" queries, these
     * are the most useful ones to know about.
     *
     * @default -1 // (no logging)
     * @see https://postgresqlco.nf/doc/en/param/log_min_duration_statement/
     */
    log_min_duration_statement?: SessionParameter.Duration

    /**
     * The minimum message severity that will be logged to the server log.
     *
     * @default 'WARNING'
     * @see https://postgresqlco.nf/doc/en/param/log_min_messages/
     */
    log_min_messages?: SessionParameter.LogMinMessages

    /**
     * Specifies whether temp files exceeding this size will be logged.
     *
     * @example '10MB'
     * @see https://postgresqlco.nf/doc/en/param/log_temp_files/
     */
    log_temp_files?: SessionParameter.MemoryLimit

    /**
     * Writes cumulative performance statistics to the server log.
     *
     * @default false
     * @see https://postgresqlco.nf/doc/en/param/log_statement_stats/
     */
    log_statement_stats?: boolean

    /**
     * Sets the type of statements logged.
     *
     * For exhaustive performance analysis on test systems, set to 'all'. Most
     * production setups will just want to use 'ddl' to make sure to record
     * database-altering actions, but very secure setups may want to use 'mod'
     * or even 'all'. Can produce a lot of log volume.
     *
     * @default 'none'
     * @see https://postgresqlco.nf/doc/en/param/log_statement/
     */
    log_statement?: SessionParameter.LogStatement

    /**
     * Sets the maximum number of parallel processes per executor node. Setting
     * to `0` disables parallel query execution.
     *
     * Increase to 4 or 8 (depending on cores / concurrent sessions) if you plan
     * to use parallel queries.
     *
     * @default 2
     * @see https://postgresqlco.nf/doc/en/param/max_parallel_workers_per_gather/
     */
    max_parallel_workers_per_gather?: number

    /**
     * Sets the random page cost for planner estimations.
     *
     * Should not be altered unless you're using special storage (SSDs, high end
     * SANs, etc.) where seek/scan ratios are actually different. If you need
     * the database to favor indexes more, tune `effective_cache_size` and some
     * of the `cpu_*` costs instead.
     *
     * @default 4.0
     * @see https://postgresqlco.nf/doc/en/param/random_page_cost/
     */
    random_page_cost?: number

    /**
     * Sets the search path for schema-qualified objects, controlling which
     * schemas are searched for unqualified table names.
     *
     * @default '$user, public'
     * @see https://postgresqlco.nf/doc/en/param/search_path/
     */
    search_path?: string

    /**
     * Enables or disables the use of nested transactions via savepoints.
     *
     * @default 'origin'
     * @see https://postgresqlco.nf/doc/en/param/session_replication_role/
     */
    session_replication_role?: SessionParameter.SessionReplicationRole

    /**
     * Sets the maximum allowed duration of any statement. If no unit is
     * specified, it defaults to milliseconds.
     *
     * For most web applications, it's a good idea to set a default timeout,
     * such as 60s to prevent runaway queries from bogging the server. If set,
     * though, you need to remember to set (at the ROLE or session level) a
     * higher statement_timeout for expected long-running maintenance or batch
     * operations.
     *
     * @default 0 // (no timeout)
     * @see https://postgresqlco.nf/doc/en/param/statement_timeout/
     */
    statement_timeout?: SessionParameter.Duration

    /**
     * Specifies the time zone for the current session. This can be set to a
     * specific time zone (e.g., 'UTC', 'America/New_York').
     *
     * To avoid a lot of confusion, make sure this is set to your local
     * timeszone. If the server covers multiple time zones, then this should be
     * set on a ROLE or connection basis.
     *
     * @default 'GMT'
     * @see https://postgresqlco.nf/doc/en/param/TimeZone/
     */
    timezone?: string

    /**
     * Sets the base maximum amount of memory to be used by a query operation
     * (such as a sort or hash table) before writing to temporary disk files. If
     * no unit is specified, it defaults to kilobytes.
     *
     * This limit acts as a primitive resource control, preventing the server
     * from going into swap due to overallocation. Note that this is non-shared
     * RAM per operation, which means large complex queries can use multiple
     * times this amount. Also, `work_mem` is allocated by powers of two, so
     * round to the nearest binary step.
     *
     * @default 4096 // (4MB)
     * @see https://postgresqlco.nf/doc/en/param/work_mem/
     */
    work_mem?: SessionParameter.MemoryLimit
  }>

export declare namespace SessionParameter {
  export type ClientMinMessages =
    | 'DEBUG5'
    | 'DEBUG4'
    | 'DEBUG3'
    | 'DEBUG2'
    | 'DEBUG1'
    | 'LOG'
    | 'NOTICE'
    | 'WARNING'
    | 'ERROR'

  export type DateOrder =
    | 'MDY'
    | 'DMY'
    | 'YMD'
    | 'Euro'
    | 'European'
    | 'NonEuro'
    | 'NonEuropean'
    | 'US'

  export type DateOutputFormat = 'ISO' | 'SQL' | 'Postgres' | 'German'
  export type DateStyle = `${DateOutputFormat}, ${DateOrder}`
  export type Duration = number | `${number}${IntervalUnit}`

  export type IntervalStyle =
    | 'postgres'
    | 'postgres_verbose'
    | 'sql_standard'
    | 'iso_8601'

  export type IntervalUnit = 'ms' | 's' | 'min' | 'h' | 'd'
  export type LogErrorVerbosity = 'TERSE' | 'DEFAULT' | 'VERBOSE'

  export type LogMinMessages =
    | 'DEBUG5'
    | 'DEBUG4'
    | 'DEBUG3'
    | 'DEBUG2'
    | 'DEBUG1'
    | 'INFO'
    | 'NOTICE'
    | 'WARNING'
    | 'ERROR'
    | 'LOG'
    | 'FATAL'
    | 'PANIC'

  export type LogStatement = 'none' | 'mod' | 'all' | 'ddl'
  export type MemoryLimit = number | `${number}${MemoryUnit}`
  export type MemoryUnit = 'kB' | 'MB' | 'GB' | 'TB'
  export type SessionReplicationRole = 'origin' | 'local' | 'replica'

  export type TransactionIsolation =
    | 'read committed'
    | 'read uncommitted'
    | 'repeatable read'
    | 'serializable'
}
