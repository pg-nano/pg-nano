import { type Client, sql } from 'pg-nano'

export type PgDependentObject = {
  /** The table where this object is defined. */
  type: string
  /** The schema where this object is defined. */
  schema: string
  /** The object ID. */
  oid: number
  /** The name of this object. */
  name: string
  /** The column number, as defined in `pg_attribute`. */
  columnId: number | null
  /** The specific column where the dependency occurs, if any. */
  column: string | null
  /** The relation kind, as defined in `pg_class`. */
  relKind: string | null
  /** The routine kind, as defined in `pg_proc`. */
  procKind: string | null
}

/**
 * Note that routines don't have their dependencies tracked by Postgres.
 */
export async function inspectDependencies(
  pg: Client,
  objid: number,
  columns?: string[],
) {
  let objsubids: number[] | undefined
  if (columns) {
    objsubids = await pg.queryValueList<number>(sql`
      SELECT a.attnum
      FROM pg_attribute a
      WHERE a.attrelid = ${sql.val(objid)}
      AND a.attname IN ${sql.list(columns)}
    `)
  }

  // Get the reltype if this is a relation (table, view, etc)
  const table = await pg.queryRowOrNull<{ oid: number; reltype: number }>(sql`
    SELECT oid, reltype
    FROM pg_class
    WHERE ${sql.val(objid)} IN (oid, reltype)
  `)

  let typid: number | null = null
  if (table && objid === table.reltype) {
    objid = table.oid
    typid = table.reltype
  }

  // Recursively query pg_depend to find all dependent objects
  const dependentObjects = await pg.queryRowList<PgDependentObject>(sql`
    WITH RECURSIVE deps AS (
      -- Base case: direct dependencies
      SELECT
        d.classid,
        d.objid,
        d.objsubid,
        d.deptype,
        1 as level
      FROM pg_depend d
      WHERE d.refobjid IN ${sql.list([objid, typid])}
      ${objsubids && sql`AND d.refobjsubid IN ${sql.list(objsubids)}`}

      -- Recursive case: dependencies of dependencies
      UNION ALL
      SELECT
        d.classid,
        d.objid,
        d.objsubid,
        d.deptype,
        deps.level + 1
      FROM pg_depend d
      JOIN deps ON d.refobjid = deps.objid
      WHERE deps.objsubid = 0
        OR d.refobjsubid = deps.objsubid
    )

    SELECT *
    FROM (
      SELECT DISTINCT ON (COALESCE(c.oid, deps.objid))
        h.relname AS type,
        nspname as schema,
        COALESCE(c.relname, typname, proname) as name,
        attnum AS column_id,
        attname as column,
        c.relkind as rel_kind,
        prokind as proc_kind,
        deps.level

      FROM deps
      LEFT JOIN pg_attrdef
        ON deps.classid = 'pg_attrdef'::regclass
        AND pg_attrdef.oid = deps.objid
      LEFT JOIN pg_rewrite rw
        ON deps.classid = 'pg_rewrite'::regclass
        AND rw.oid = deps.objid
      LEFT JOIN pg_class c
        ON c.oid = COALESCE(rw.ev_class, adrelid, deps.objid)
      LEFT JOIN pg_type
        ON deps.classid = 'pg_type'::regclass
        AND pg_type.oid = deps.objid
      LEFT JOIN pg_proc
        ON deps.classid = 'pg_proc'::regclass
        AND pg_proc.oid = deps.objid
      LEFT JOIN pg_attribute
        ON (deps.objsubid <> 0 OR adrelid IS NOT NULL)
        AND attnum = COALESCE(adnum, deps.objsubid)
        AND attrelid = COALESCE(adrelid, deps.objid)
      LEFT JOIN pg_namespace
        ON pg_namespace.oid = COALESCE(c.relnamespace, typnamespace, pronamespace)
      JOIN pg_class h
        ON h.oid = deps.classid

      WHERE deps.deptype NOT IN ('i', 'a')
        AND nspname = 'public'
        AND (c.oid IS NULL OR c.oid <> ${sql.val(objid)})
        -- Views are tracked by pg_rewrite.
        AND NOT (c.relkind = 'v' AND deps.classid = 'pg_class'::regclass)

      ORDER BY COALESCE(c.oid, deps.objid)
    )
    ORDER BY level DESC
  `)

  return dependentObjects
}
