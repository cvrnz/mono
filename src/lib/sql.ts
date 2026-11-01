import { invoke } from './bridge'
import type { SqlConnection, SqlEngine } from './store'

export type Cell = string | number | boolean | null
export type ResultSet = { columns: string[]; rows: Cell[][]; truncated?: boolean; affected?: number; command?: string }
export type Outcome = { results: ResultSet[]; error?: string; position?: number; notices?: string[]; ms: number }
export type Table = { schema: string; name: string; view: boolean }
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
export const tables = (id: string) => invoke<Table[]>('sql_tables', { id })
export const columns = (id: string, schema: string, table: string) => invoke<Column[]>('sql_columns', { id, schema, table })

export function quoteName(engine: SqlEngine, name: string): string {
  if (/^[a-z_][a-z0-9_]*$/.test(name) || (engine !== 'postgres' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(name))) return name
  if (engine === 'mysql') return '`' + name.replaceAll('`', '``') + '`'
  if (engine === 'mssql') return '[' + name.replaceAll(']', ']]') + ']'
  return '"' + name.replaceAll('"', '""') + '"'
}

export function tableName(info: Info, t: Table): string {
  const { engine } = info
  const plain =
    engine === 'sqlite' || (engine === 'postgres' && t.schema === 'public') || (engine === 'mssql' && t.schema === 'dbo') || (engine === 'mysql' && t.schema === info.database)
  return (plain ? '' : quoteName(engine, t.schema) + '.') + quoteName(engine, t.name)
}

export function selectTop(info: Info, t: Table, n = 100): string {
  const { engine } = info
  const name = tableName(info, t)
  return engine === 'mssql' ? `SELECT TOP ${n} * FROM ${name};` : `SELECT * FROM ${name} LIMIT ${n};`
}

export function describe(c: SqlConnection): string {
  if (c.engine === 'sqlite') return c.file ?? ''
  const where = `${c.host || 'localhost'}${c.port && c.port !== defaultPorts[c.engine] ? ':' + c.port : ''}`
  return `${c.user ? c.user + '@' : ''}${where}${c.database ? '/' + c.database : ''}`
}
