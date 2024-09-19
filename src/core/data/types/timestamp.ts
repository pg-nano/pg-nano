/**
 * When a timestamp is not a Date instance, it's either Infinity or -Infinity.
 * @see https://www.postgresql.org/docs/current/datatype-datetime.html#DATATYPE-DATETIME-SPECIAL-VALUES
 */
export type Timestamp = Date | number
