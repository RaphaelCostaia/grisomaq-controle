import { spawn, type ChildProcess } from 'node:child_process'
import type { Plugin } from 'vite'

/**
 * Sobe a API de desenvolvimento junto com o `npm run dev`.
 *
 * Sem isto seriam dois terminais para ver o sistema funcionando, e quem só quer
 * validar uma tela esbarra nesse atrito antes de chegar na tela. O processo
 * morre junto com o Vite, então não fica servidor órfão segurando a porta 3000.
 *
 * Vale só em desenvolvimento: `apply: 'serve'` mantém o plugin fora do build,
 * e o banco desta API vive na memória do processo.
 */
export function apiLocal(): Plugin {
  let processo: ChildProcess | null = null

  const encerrar = () => {
    if (!processo || processo.killed) return
    // No Windows, `kill` não derruba a árvore de processos do npm/node; o
    // taskkill com /T é o que garante que a porta 3000 fique livre.
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

    configureServer(servidor) {
      if (process.env.SEM_API_LOCAL === '1') {
        servidor.config.logger.info('  API local desligada por SEM_API_LOCAL=1')
        return
      }

      processo = spawn(process.execPath, ['servidor/src/servidor-de-teste.ts'], {
        cwd: servidor.config.root,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, NODE_ENV: 'production' },
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
            servidor.config.logger.info('  [api] ' + texto)
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
