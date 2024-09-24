import { isIntString } from 'radashi'

/**
 * Connection options for libpq.
 *
 * @see https://www.postgresql.org/docs/current/libpq-connect.html#LIBPQ-PARAMKEYWORDS
 */
export interface ConnectOptions {
  /**
   * Name of host to connect to. If a host name looks like an absolute path
   * name, it specifies Unix-domain communication rather than TCP/IP
   * communication.
   *
   * @default process.env.PGHOST
   * @see https://www.postgresql.org/docs/current/libpq-connect.html#LIBPQ-CONNECT-HOST
   */
  host?: string

  /**
   * Numeric IP address of host to connect to.
   *
   * @default process.env.PGHOSTADDR
   * @see https://www.postgresql.org/docs/current/libpq-connect.html#LIBPQ-CONNECT-HOSTADDR
   */
  hostaddr?: string

  /**
   * Port number to connect to at the server host, or socket file name extension
   * for Unix-domain connections.
   *
   * @default process.env.PGPORT
   * @see https://www.postgresql.org/docs/current/libpq-connect.html#LIBPQ-CONNECT-PORT
   */
  port?: string | number

  /**
   * The database name. Defaults to be the same as the user name.
   *
   * @default process.env.PGDATABASE
   * @see https://www.postgresql.org/docs/current/libpq-connect.html#LIBPQ-CONNECT-DBNAME
   */
  dbname?: string

  /**
   * PostgreSQL user name to connect as. Defaults to be the same as the
   * operating system name of the user running the application.
   *
   * @default process.env.PGUSER
   * @see https://www.postgresql.org/docs/current/libpq-connect.html#LIBPQ-CONNECT-USER
   */
  user?: string

  /**
   * Password to be used if the server demands password authentication.
   *
   * @default process.env.PGPASSWORD
   * @see https://www.postgresql.org/docs/current/libpq-connect.html#LIBPQ-CONNECT-PASSWORD
   */
  password?: string

  /**
   * Specifies the name of the file used to store passwords.
   *
   * @default process.env.PGPASSFILE
   * @see https://www.postgresql.org/docs/current/libpq-connect.html#LIBPQ-CONNECT-PASSFILE
   */
  passfile?: string

  /**
   * Specifies the authentication method that the client requires from the
   * server.
   *
   * @default process.env.PGREQUIREAUTH
   * @see https://www.postgresql.org/docs/current/libpq-connect.html#LIBPQ-CONNECT-REQUIRE-AUTH
   */
  require_auth?: string

  /**
   * Sets the client_encoding configuration parameter for this connection.
   *
   * @default process.env.PGCLIENTENCODING
   * @see https://www.postgresql.org/docs/current/libpq-connect.html#LIBPQ-CONNECT-CLIENT-ENCODING
   */
  client_encoding?: string

  /**
   * Specifies command-line options to send to the server at connection start.
   *
   * @default process.env.PGOPTIONS
   * @see https://www.postgresql.org/docs/current/libpq-connect.html#LIBPQ-CONNECT-OPTIONS
   */
  options?: string

  /**
   * Specifies a value for the application_name configuration parameter.
   *
   * @default process.env.PGAPPNAME
   * @see https://www.postgresql.org/docs/current/libpq-connect.html#LIBPQ-CONNECT-APPLICATION-NAME
   */
  application_name?: string

  /**
   * Specifies a fallback value for the application_name configuration
   * parameter, if `application_name` is not specified and the `PGAPPNAME`
   * environment variable is not set.
   *
   * @see https://www.postgresql.org/docs/current/libpq-connect.html#LIBPQ-CONNECT-FALLBACK-APPLICATION-NAME
   */
  fallback_application_name?: string

  /**
   * Controls whether client-side TCP keepalives are used.
   *
   * @default 1
   * @see https://www.postgresql.org/docs/current/libpq-connect.html#LIBPQ-CONNECT-KEEPALIVES
   */
  keepalives?: 1 | 0

  /**
   * Controls the number of seconds of inactivity after which TCP should send a
   * keepalive message to the server.
   *
   * @see https://www.postgresql.org/docs/current/libpq-connect.html#LIBPQ-CONNECT-KEEPALIVES-IDLE
   */
  keepalives_idle?: number

  /**
   * Controls the number of seconds after which a TCP keepalive message that is
   * not acknowledged by the server should be retransmitted.
   *
   * @see https://www.postgresql.org/docs/current/libpq-connect.html#LIBPQ-CONNECT-KEEPALIVES-INTERVAL
   */
  keepalives_interval?: number

  /**
   * Controls the number of TCP keepalives that can be lost before the client's
   * connection to the server is considered dead.
   *
   * @see https://www.postgresql.org/docs/current/libpq-connect.html#LIBPQ-CONNECT-KEEPALIVES-COUNT
   */
  keepalives_count?: number

  /**
   * Controls the number of milliseconds that transmitted data may remain
   * unacknowledged before a connection is forcibly closed.
   *
   * @see https://www.postgresql.org/docs/current/libpq-connect.html#LIBPQ-CONNECT-TCP-USER-TIMEOUT
   */
  tcp_user_timeout?: number

  /**
   * Determines whether the connection should use the replication protocol
   * instead of the normal protocol.
   *
   * @see https://www.postgresql.org/docs/current/libpq-connect.html#LIBPQ-CONNECT-REPLICATION
   */
  replication?: 'database' | boolean | 1 | 0

  /**
   * Determines whether a secure GSS TCP/IP connection will be negotiated with
   * the server.
   *
   * @default process.env.PGGSSENCMODE || 'prefer'
   * @see https://www.postgresql.org/docs/current/libpq-connect.html#LIBPQ-CONNECT-GSSENCMODE
   */
  gssencmode?: 'disable' | 'require' | 'prefer'

  /**
   * Determines whether or with what priority a secure SSL TCP/IP connection
   * will be negotiated with the server.
   *
   * @default process.env.PGSSLMODE || 'prefer'
   * @see https://www.postgresql.org/docs/current/libpq-connect.html#LIBPQ-CONNECT-SSLMODE
   */
  sslmode?:
    | 'allow'
    | 'prefer'
    | 'require'
    | 'verify-ca'
    | 'verify-full'
    | 'disable'

  /**
   * Specifies the file name of the client SSL certificate.
   *
   * @default process.env.PGSSLCERT
   * @see https://www.postgresql.org/docs/current/libpq-connect.html#LIBPQ-CONNECT-SSLCERT
   */
  sslcert?: string

  /**
   * Specifies the location for the secret key used for the client certificate.
   *
   * @default process.env.PGSSLKEY
   * @see https://www.postgresql.org/docs/current/libpq-connect.html#LIBPQ-CONNECT-SSLKEY
   */
  sslkey?: string

  /**
   * Specifies the password for the secret key specified in sslkey.
   *
   * @see https://www.postgresql.org/docs/current/libpq-connect.html#LIBPQ-CONNECT-SSLPWD
   */
  sslpassword?: string

  /**
   * Determines whether a client certificate may be sent to the server, and
   * whether the server is required to request one.
   *
   * @default process.env.PGSSLCERTMODE
   * @see https://www.postgresql.org/docs/current/libpq-connect.html#LIBPQ-CONNECT-SSLCERTMODE
   */
  sslcertmode?: string

  /**
   * Specifies the name of a file containing SSL certificate authority (CA)
   * certificate(s).
   *
   * @default process.env.PGSSLROOTCERT
   * @see https://www.postgresql.org/docs/current/libpq-connect.html#LIBPQ-CONNECT-SSLROOTCERT
   */
  sslrootcert?: string

  /**
   * Specifies the name of a file containing SSL certificate revocation list
   * (CRL).
   *
   * @default process.env.PGSSLCRL
   * @see https://www.postgresql.org/docs/current/libpq-connect.html#LIBPQ-CONNECT-SSLCRL
   */
  sslcrl?: string

  /**
   * Specifies the directory name of the SSL server certificate revocation list
   * (CRL).
   *
   * @default process.env.PGSSLCRLDIR
   * @see https://www.postgresql.org/docs/current/libpq-connect.html#LIBPQ-CONNECT-SSLCRLDIR
   */
  sslcrldir?: string

  /**
   * Specifies whether the client should use SNI (Server Name Indication) on
   * SSL-enabled connections.
   *
   * @default process.env.PGSSLSNI || 1
   * @see https://www.postgresql.org/docs/current/libpq-connect.html#LIBPQ-CONNECT-SSLSNI
   */
  sslsni?: 1 | 0

  /**
   * Specifies the peer name of the server to connect to.
   *
   * @default process.env.PGREQUIREPEER
   * @see https://www.postgresql.org/docs/current/libpq-connect.html#LIBPQ-CONNECT-REQUIREPEER
   */
  requirepeer?: string

  /**
   * Specifies the minimum SSL/TLS protocol version to allow for the connection.
   *
   * @default process.env.PGSSLMINPROTOCOLVERSION
   * @see https://www.postgresql.org/docs/current/libpq-connect.html#LIBPQ-CONNECT-SSL-MIN-PROTOCOL-VERSION
   */
  ssl_min_protocol_version?: string

  /**
   * Specifies the maximum SSL/TLS protocol version to allow for the connection.
   *
   * @default process.env.PGSSLMAXPROTOCOLVERSION
   * @see https://www.postgresql.org/docs/current/libpq-connect.html#LIBPQ-CONNECT-SSL-MAX-PROTOCOL-VERSION
   */
  ssl_max_protocol_version?: string

  /**
   * Kerberos service name to use when authenticating with GSSAPI.
   *
   * @default process.env.PGKRBSRVNAME
   * @see https://www.postgresql.org/docs/current/libpq-connect.html#LIBPQ-CONNECT-KRBSRVNAME
   */
  krbsrvname?: string

  /**
   * GSS library to use for GSSAPI authentication.
   *
   * Currently this is disregarded except on Windows builds that include both
   * GSSAPI and SSPI support.
   *
   * @default process.env.PGGSSLIB
   * @see
   * https://www.postgresql.org/docs/current/libpq-connect.html#LIBPQ-CONNECT-GSSLIB
   */
  gsslib?: 'gssapi'

  /**
   * Forward (delegate) GSS credentials to the server.
   *
   * @default process.env.PGGSSDELEGATION
   * @see https://www.postgresql.org/docs/current/libpq-connect.html#LIBPQ-CONNECT-GSSDELEGATION
   */
  gssdelegation?: 1

  /**
   * Service name to use for additional parameters.
   *
   * @default process.env.PGSERVICE
   * @see https://www.postgresql.org/docs/current/libpq-connect.html#LIBPQ-CONNECT-SERVICE
   */
  service?: string

  /**
   * Determines whether the session must have certain properties to be
   * acceptable.
   *
   * @default process.env.PGTARGETSESSIONATTRS
   * @see https://www.postgresql.org/docs/current/libpq-connect.html#LIBPQ-CONNECT-TARGET-SESSION-ATTRS
   */
  target_session_attrs?: string

  /**
   * Controls the order in which the client tries to connect to the available
   * hosts and addresses.
   *
   * @default process.env.PGLOADBALANCEHOSTS
   * @see https://www.postgresql.org/docs/current/libpq-connect.html#LIBPQ-CONNECT-LOAD-BALANCE-HOSTS
   */
  load_balance_hosts?: string
}

export function stringifyConnectOptions(options: ConnectOptions): string {
  return Object.entries(options)
    .filter(([_, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${value}`)
    .join(' ')
}

export function parseConnectionString(
  connectionString: string,
): ConnectOptions {
  if (/^\w+:\/\//.test(connectionString)) {
    const url = new URL(connectionString)
    return {
      ...Object.fromEntries(url.searchParams),
      user: url.username || undefined,
      password: url.password || undefined,
      host: url.hostname,
      port: url.port || undefined,
      dbname: url.pathname.split('/')[1] || undefined,
    }
  }
  const options = {} as ConnectOptions
  for (const option of connectionString.split(' ')) {
    const separatorIndex = option.indexOf('=')
    const key = option.slice(0, separatorIndex) as keyof ConnectOptions
    const value = option.slice(separatorIndex + 1)
    options[key] = (isIntString(value) ? Number(value) : value) as any
  }
  return options
}
