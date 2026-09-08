import Fastify, { type FastifyError } from 'fastify'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import { config, ehDesenvolvimento } from './config.ts'
import { comoServico, encerrarPool, pool, type Identidade } from './banco.ts'
import { verificarAcesso } from './jwt.ts'
import { aplicarMigracoes } from './migracoes.ts'
import { rotasDeAutenticacao } from './rotas/autenticacao.ts'
import { rotasDeSincronizacao } from './rotas/sincronizacao.ts'
import { rotasDeAdministracao } from './rotas/administracao.ts'
import { rotasDoPainel } from './rotas/painel.ts'
import { rotasDeAnexos } from './rotas/anexos.ts'
import { rotasDeCadastros } from './rotas/cadastros.ts'
import { servirEstatico } from './servir-estatico.ts'

declare module 'fastify' {
  interface FastifyRequest {
    identidade?: Identidade
  }
}

/**
 * Chave do rate-limit — header `x-dispositivo-id` quando presente, IP como
 * fallback. Extraída para permitir teste unitário: o rate-limit real do
 * `@fastify/rate-limit` depende do config lido no import do servidor, e mudar
 * o teto durante a suíte exigiria subir um segundo processo. Testar a lógica
 * de chaveamento aqui cobre o que interessa: o header ganha do IP.
 */
export function chaveDeRateLimit(
  headers: Record<string, string | string[] | undefined>,
  ip: string,
): string {
  const dispositivo = headers['x-dispositivo-id']
  if (typeof dispositivo === 'string' && dispositivo.length > 0) return dispositivo
  return ip
}

export async function construirServidor() {
  const app = Fastify({
    logger: ehDesenvolvimento
      ? { transport: { target: 'pino-pretty' } }
      : {
          level: 'info',
          // O PIN e os tokens não podem chegar ao log. Num sistema em que o PIN
          // vale como assinatura, log é prova — e prova vazada é prova perdida.
          //
          // `refresh_token` e `pin_cifrado` entraram aqui defensivamente: nenhum
          // log atual os expõe, mas um `req.log.info({ corpo })` que alguém
          // adicione depois basta para vazar. Cobrimos agora que a lista é curta
          // e mora num só lugar.
          redact: {
            paths: [
              'req.headers.authorization',
              'req.body.pin',
              'req.body.pin_atual',
              'req.body.pin_novo',
              'req.body.pin_cifrado',
              'req.body.refresh_token',
            ],
            remove: true,
          },
        },
    // Atrás do Traefik do EasyPanel: sem isto o rate limit veria todos os
    // celulares como um IP só, o do proxy.
    trustProxy: true,
    bodyLimit: 2 * 1024 * 1024,
  })

  await app.register(cors, {
    origin: config.origens,
    methods: ['GET', 'PUT', 'POST', 'OPTIONS'],
    allowedHeaders: ['authorization', 'content-type', 'x-app-versao', 'x-dispositivo-id'],
  })

  await app.register(rateLimit, {
    max: config.rateLimiteGeral,
    timeWindow: '1 minute',
    // Um comboio inteiro pode sincronizar da mesma rede da sede. Sem chavear
    // por dispositivo, o primeiro celular consumiria a cota de todos.
    //
    // O chaveamento vem de um HEADER, não do corpo: `@fastify/rate-limit` roda
    // no `onRequest`, antes de o body ser parseado, então uma leitura de
    // `req.body.dispositivo_id` era sempre `undefined` — na prática só o IP
    // valia. Header é lido no `onRequest` naturalmente. Fallback pro IP mantém
    // proteção contra cliente que não manda o header.
    keyGenerator: (requisicao) => chaveDeRateLimit(requisicao.headers, requisicao.ip),
  })

  /**
   * Resolve a identidade do portador antes de cada rota.
   *
   * Token ausente ou inválido não derruba a requisição aqui: cada rota decide
   * se exige sessão. Isso mantém `/auth/login-campo` e `/saude` acessíveis sem
   * um caso especial espalhado pelo roteamento.
   */
  app.addHook('preHandler', async (requisicao) => {
    const cabecalho = requisicao.headers.authorization
    if (!cabecalho?.startsWith('Bearer ')) return

    try {
      requisicao.identidade = await verificarAcesso(cabecalho.slice(7))
    } catch {
      // Token expirado é rotina neste app: o celular passa horas offline e
      // renova ao voltar. A rota responde 401 e o cliente troca pelo refresh.
    }
  })

  app.get('/saude', async () => {
    const { rows } = await comoServico((cliente) => cliente.query('select 1 as ok'))
    return {
      ok: rows[0]?.ok === 1,
      versao: process.env.APP_VERSAO ?? '0.1.0',
      conexoes: { total: pool.totalCount, ociosas: pool.idleCount, esperando: pool.waitingCount },
    }
  })

  await app.register(rotasDeAutenticacao)
  await app.register(rotasDeSincronizacao)
  await app.register(rotasDeAdministracao)
  await app.register(rotasDoPainel)
  await app.register(rotasDeAnexos)
  await app.register(rotasDeCadastros)

  // Publicar o PWA no mesmo endereço da API é opcional — em desenvolvimento o
  // Vite serve o front. Em produção define-se `SERVIR_DIST=1` e o servidor
  // entrega o build junto: um domínio só, sem CORS, um serviço a menos para
  // monitorar. É o formato do deploy no EasyPanel.
  if (process.env.SERVIR_DIST === '1') {
    const dir = process.env.DIST_DIR ?? '/app/dist'
    servirEstatico(app, dir)
  }

  app.setErrorHandler((erro: FastifyError, requisicao, resposta) => {
    requisicao.log.error({ erro: erro.message }, 'falha na requisição')
    // Detalhe de erro do Postgres não vai para o cliente: nomes de constraint e
    // trechos de SQL descrevem o esquema para quem estiver sondando.
    resposta.code(erro.statusCode ?? 500).send({ erro: 'FALHA_INTERNA' })
  })

  return app
}

async function subir(): Promise<void> {
  const app = await construirServidor()

  try {
    const resultado = await aplicarMigracoes()
    app.log.info(
      resultado.aplicadas.length > 0
        ? { aplicadas: resultado.aplicadas }
        : { migrations: resultado.jaAplicadas },
      'esquema pronto',
    )
  } catch (falha) {
    // Subir com o esquema pela metade é pior que não subir: o app de campo
    // começaria a receber conflitos que não são conflitos de verdade.
    app.log.error({ erro: falha instanceof Error ? falha.message : String(falha) }, 'migrations falharam')
    process.exit(1)
  }

  await comoServico((cliente) => cliente.query('select public.fn_limpar_sessoes_vencidas()')).catch(
    () => {},
  )

  await app.listen({ port: config.porta, host: config.host })

  for (const sinal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(sinal, () => {
      void (async () => {
        app.log.info('encerrando')
        await app.close()
        await encerrarPool()
        process.exit(0)
      })()
    })
  }
}

// Só sobe quando executado direto; importado pelos testes, não sobe.
if (process.argv[1]?.replaceAll('\\', '/').endsWith('src/index.ts')) {
  await subir()
}
