import { invoke } from './bridge'
import type { SqlConnection, SqlEngine } from './store'

export type Cell = string | number | boolean | null
export type ResultSet = { columns: string[]; rows: Cell[][]; truncated?: boolean; affected?: number; command?: string }
export type Outcome = { results: ResultSet[]; error?: string; position?: number; notices?: string[]; ms: number }
export type ObjectKind = 'table' | 'view' | 'procedure' | 'function'
export type DbObject = { schema: string; name: string; kind: ObjectKind }
export type Database = { name: string; system: boolean }
export type Column = { name: string; type: string; nullable: boolean; key: boolean }
export type Info = { engine: SqlEngine; version: string; database: string; user: string }

export const engineNames: Record<SqlEngine, string> = {
  postgres: 'PostgreSQL',
  mysql: 'MySQL / MariaDB',
  mssql: 'SQL Server',
  sqlite: 'SQLite',
}

export const defaultPorts: Record<SqlEngine, number> = { postgres: 5432, mysql: 3306, mssql: 1433, sqlite: 0 }

const open = new Set<string>()

export function newSqlId(): string {
  return crypto.randomUUID()
}

export async function connect(id: string, c: SqlConnection): Promise<Info> {
  const { name: _name, ...config } = c
  open.add(id)
  return invoke<Info>('sql_connect', { id, config })
}

export async function disconnect(id: string) {
  open.delete(id)
  await invoke('sql_disconnect', { id }).catch(() => {})
}

export const query = (id: string, text: string) => invoke<Outcome>('sql_query', { id, text })
export const cancel = (id: string) => invoke<void>('sql_cancel', { id })
export const databases = (id: string) => invoke<Database[]>('sql_databases', { id })
export const objects = (id: string, database: string) => invoke<DbObject[]>('sql_objects', { id, database })
export const columns = (id: string, database: string, schema: string, table: string) =>
  invoke<Column[]>('sql_columns', { id, database, schema, table })

export function quoteName(engine: SqlEngine, name: string): string {
  if (/^[a-z_][a-z0-9_]*$/.test(name) || (engine !== 'postgres' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(name))) return name
  if (engine === 'mysql') return '`' + name.replaceAll('`', '``') + '`'
  if (engine === 'mssql') return '[' + name.replaceAll(']', ']]') + ']'
  return '"' + name.replaceAll('"', '""') + '"'
}

/** The database the connection is using, as databases() names it. */
export function currentDatabase(info: Info): string {
  return info.engine === 'sqlite' ? 'main' : info.database
}

export function defaultSchema(info: Info, database: string): string {
  return { postgres: 'public', mssql: 'dbo', mysql: database, sqlite: database }[info.engine]
}

/** How to name an object in a query run on this connection. */
export function objectName(info: Info, database: string, o: { schema: string; name: string }): string {
  const { engine } = info
  const q = (n: string) => quoteName(engine, n)
  const here = database === currentDatabase(info)
  if (engine === 'mysql' || engine === 'sqlite') return here ? q(o.name) : `${q(database)}.${q(o.name)}`
  if (engine === 'mssql' && !here) return `${q(database)}.${q(o.schema)}.${q(o.name)}`
  return (o.schema === defaultSchema(info, database) ? '' : q(o.schema) + '.') + q(o.name)
}

export function selectTop(info: Info, name: string, n = 100): string {
  return info.engine === 'mssql' ? `SELECT TOP ${n} * FROM ${name};` : `SELECT * FROM ${name} LIMIT ${n};`
}

export function describe(c: SqlConnection): string {
  if (c.engine === 'sqlite') return c.file ?? ''
  const where = `${c.host || 'localhost'}${c.port && c.port !== defaultPorts[c.engine] ? ':' + c.port : ''}`
  return `${c.user ? c.user + '@' : ''}${where}${c.database ? '/' + c.database : ''}`
}
