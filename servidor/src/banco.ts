import pg from 'pg'
import { config } from './config.ts'

// O Postgres devolve numeric como string para não perder precisão. Nas nossas
// colunas (litros, horímetro, odômetro) a precisão cabe folgada num double, e
// devolver string quebraria o cliente, que espera número.
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => (v === null ? null : Number(v)))

export const pool = new pg.Pool({
  connectionString: config.bancoUrl,
  // A KVM 1 tem 1 vCPU: um pool grande só cria contenção. Dez conexões atendem
  // com folga o padrão real de uso — dezenas de celulares sincronizando em
  // rajadas curtas, não tráfego contínuo.
  max: Number(process.env.BANCO_MAX_CONEXOES ?? '10'),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
})

export interface Identidade {
  funcionario_id: string
  codigo: string
  papel: 'campo' | 'lider' | 'admin'
  frente_padrao_id: string | null
}

export interface Consultavel {
  query<T extends pg.QueryResultRow = pg.QueryResultRow>(
    texto: string,
    valores?: unknown[],
  ): Promise<pg.QueryResult<T>>
}

/**
 * Executa no papel do funcionário, com a RLS valendo.
 *
 * É o mesmo mecanismo que o PostgREST usa, e o mesmo que os testes de banco já
 * exercitam: assume `authenticated` e publica as reivindicações do JWT numa
 * configuração de sessão que as policies leem via `auth.jwt()`.
 *
 * Dois detalhes que não podem mudar:
 *
 * 1. `set_config(..., true)` — o `true` amarra o valor à TRANSAÇÃO. Sem ele, a
 *    identidade sobreviveria no pool e a próxima requisição a reusar aquela
 *    conexão herdaria o funcionário anterior. É o modo de falha mais perigoso
 *    de um pool, e o mais silencioso.
 * 2. `SET LOCAL ROLE` — pelo mesmo motivo, e porque o papel precisa voltar ao
 *    do dono da conexão no fim.
 */
export async function comoFuncionario<T>(
  identidade: Identidade,
  acao: (cliente: Consultavel) => Promise<T>,
): Promise<T> {
  const cliente = await pool.connect()
  try {
    await cliente.query('begin')
    await cliente.query('set local role ' + nomeDePapelSeguro(config.papelUsuario))
    await cliente.query('select set_config($1, $2, true)', [
      'request.jwt.claims',
      JSON.stringify({ app_metadata: identidade }),
    ])

    const resultado = await acao(cliente)
    await cliente.query('commit')
    return resultado
  } catch (erro) {
    await cliente.query('rollback').catch(() => {})
    throw erro
  } finally {
    cliente.release()
  }
}

/**
 * Executa com o usuário dono da conexão, por fora da RLS.
 *
 * Reservado ao que não tem um funcionário por trás: conferir PIN no login,
 * provisionar acesso, revalidar assinatura e aplicar migrations. Toda rota que
 * age em nome de alguém usa `comoFuncionario`.
 */
export async function comoServico<T>(acao: (cliente: Consultavel) => Promise<T>): Promise<T> {
  const cliente = await pool.connect()
  try {
    return await acao(cliente)
  } finally {
    cliente.release()
  }
}

/**
 * O nome do papel entra numa instrução que não aceita parâmetro, então ele é
 * validado antes de ser interpolado. Vem de variável de ambiente nossa, não de
 * entrada de usuário, mas interpolar sem conferir é como injeção começa.
 */
function nomeDePapelSeguro(papel: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(papel)) {
    throw new Error('Nome de papel inválido em PAPEL_USUARIO: ' + papel)
  }
  return papel
}

export async function encerrarPool(): Promise<void> {
  await pool.end()
}
