/**
 * A runtime map of field names to their type OIDs. Currently, this data is only
 * used for parsing/serializing composite types.
 */
export type Fields = { [name: string]: number | Fields }
