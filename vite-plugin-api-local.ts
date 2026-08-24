import { spawn, type ChildProcess } from 'node:child_process'
import { createConnection } from 'node:net'
import type { Plugin } from 'vite'

/** Porta preferida. Cede a vez se já houver algo escutando nela. */
const PORTA_PREFERIDA = 3000

/**
 * Descobre se alguém já atende naquela porta.
 *
 * A checagem é por conexão, não por tentativa de bind: no Windows dois
 * processos conseguem escutar a mesma porta sem erro, e aí quem responde vira
 * sorteio. Só conectando dá para saber que o vizinho está lá.
 */
function ocupada(porta: number): Promise<boolean> {
  return new Promise((resolver) => {
    const socket = createConnection({ port: porta, host: '127.0.0.1' })
    const encerrar = (resposta: boolean) => {
      socket.destroy()
      resolver(resposta)
    }
    socket.setTimeout(700)
    socket.once('connect', () => encerrar(true))
    socket.once('timeout', () => encerrar(false))
    socket.once('error', () => encerrar(false))
  })
}

async function primeiraPortaLivre(inicial: number): Promise<number> {
  for (let porta = inicial; porta < inicial + 20; porta += 1) {
    if (!(await ocupada(porta))) return porta
  }
  throw new Error('nenhuma porta livre entre ' + inicial + ' e ' + (inicial + 19))
}

/**
 * Sobe a API de desenvolvimento junto com o `npm run dev`.
 *
 * Sem isto seriam dois terminais para ver o sistema funcionando, e quem só quer
 * validar uma tela esbarra nesse atrito antes de chegar na tela. O processo
 * morre junto com o Vite, então não fica servidor órfão segurando a porta.
 *
 * A porta é escolhida na hora e informada ao app pela `VITE_API_URL` — a 3000 é
 * a mais disputada que existe, e um outro projeto rodando nela faria o app
 * conversar com o servidor errado em vez de dar erro.
 *
 * Vale só em desenvolvimento: `apply: 'serve'` mantém o plugin fora do build,
 * e o banco desta API vive na memória do processo.
 */
export function apiLocal(): Plugin {
  let processo: ChildProcess | null = null
  let porta = PORTA_PREFERIDA

  const desligado = () => process.env.SEM_API_LOCAL === '1'

  const encerrar = () => {
    if (!processo || processo.killed) return
    // No Windows, `kill` não derruba a árvore de processos do npm/node; o
    // taskkill com /T é o que garante que a porta fique livre.
    if (process.platform === 'win32' && processo.pid) {
      spawn('taskkill', ['/pid', String(processo.pid), '/f', '/t'], { stdio: 'ignore' })
    } else {
      processo.kill('SIGTERM')
    }
    processo = null
  }

  return {
    name: 'grisomaq-api-local',
    apply: 'serve',

    /**
     * Roda antes de o Vite carregar os arquivos `.env`, e o que está em
     * `process.env` tem precedência sobre eles — é assim que a porta escolhida
     * aqui chega ao `import.meta.env.VITE_API_URL` do app.
     */
    async config() {
      if (desligado()) return
      porta = await primeiraPortaLivre(PORTA_PREFERIDA)
      process.env.VITE_API_URL = 'http://localhost:' + porta
    },

    configureServer(servidor) {
      const registrar = (texto: string) => servidor.config.logger.info('  [api] ' + texto)

      if (desligado()) {
        registrar('desligada por SEM_API_LOCAL=1')
        return
      }

      if (porta !== PORTA_PREFERIDA) {
        registrar('porta ' + PORTA_PREFERIDA + ' ocupada por outro processo — usando ' + porta)
      }

      processo = spawn(process.execPath, ['servidor/src/servidor-de-teste.ts'], {
        cwd: servidor.config.root,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, NODE_ENV: 'production', PORTA: String(porta) },
      })

      // O log da API sai junto com o do Vite, com prefixo, para um erro de
      // migration ou de porta ocupada não passar despercebido.
      const repassar = (fluxo: NodeJS.ReadableStream | null, ehErro = false) => {
        fluxo?.on('data', (pedaco: Buffer) => {
          for (const linha of pedaco.toString().split('\n')) {
            const texto = linha.trim()
            // As linhas de log estruturado do Fastify só poluem o terminal do
            // front; o que interessa aqui são as mensagens legíveis.
            if (!texto || texto.startsWith('{')) continue
            registrar(texto)
          }
        })
        if (ehErro) fluxo?.on('error', () => {})
      }

      repassar(processo.stdout)
      repassar(processo.stderr, true)

      processo.on('exit', (codigo) => {
        if (codigo !== null && codigo !== 0) {
          servidor.config.logger.error('  [api] encerrou com código ' + codigo)
        }
        processo = null
      })

      for (const sinal of ['SIGINT', 'SIGTERM'] as const) {
        process.once(sinal, encerrar)
      }
      process.once('exit', encerrar)
    },

    closeBundle: encerrar,
  }
}
