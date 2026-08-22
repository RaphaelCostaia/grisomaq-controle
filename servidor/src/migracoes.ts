import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { comoServico, encerrarPool } from './banco.ts'

const PASTA = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

/**
 * Aplica as migrations pendentes, em ordem, uma por transação.
 *
 * Roda na subida do contêiner. Cada arquivo é registrado ao ser aplicado, então
 * reiniciar o serviço não reaplica nada — o que importa num PaaS, onde o
 * contêiner sobe de novo a cada deploy.
 *
 * Uma migration que falha aborta a subida em vez de deixar o servidor no ar com
 * o esquema pela metade: é preferível o serviço não subir a atender com um
 * banco em estado desconhecido.
 */
export async function aplicarMigracoes(): Promise<{ aplicadas: string[]; jaAplicadas: number }> {
  return comoServico(async (cliente) => {
    await cliente.query(`
      create table if not exists public.migracoes (
        nome        text primary key,
        aplicada_em timestamptz not null default now()
      )
    `)

    const { rows } = await cliente.query<{ nome: string }>('select nome from public.migracoes')
    const jaAplicadas = new Set(rows.map((r) => r.nome))

    const arquivos = readdirSync(PASTA)
      .filter((f) => f.endsWith('.sql'))
      .sort()

    const aplicadas: string[] = []

    for (const nome of arquivos) {
      if (jaAplicadas.has(nome)) continue

      const sql = readFileSync(join(PASTA, nome), 'utf8')
      try {
        await cliente.query('begin')
        await cliente.query(sql)
        await cliente.query('insert into public.migracoes (nome) values ($1)', [nome])
        await cliente.query('commit')
        aplicadas.push(nome)
      } catch (erro) {
        await cliente.query('rollback').catch(() => {})
        const detalhe = erro instanceof Error ? erro.message : String(erro)
        throw new Error('Falha na migration ' + nome + ': ' + detalhe)
      }
    }

    return { aplicadas, jaAplicadas: jaAplicadas.size }
  })
}

// Execução direta: `npm run migrar`, útil para aplicar sem subir o servidor.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replaceAll('\\', '/'))) {
  const resultado = await aplicarMigracoes()
  console.log(
    resultado.aplicadas.length === 0
      ? 'Nada a aplicar (' + resultado.jaAplicadas + ' migrations já no banco).'
      : 'Aplicadas: ' + resultado.aplicadas.join(', '),
  )
  await encerrarPool()
}
