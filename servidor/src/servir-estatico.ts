import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'

/**
 * Serve o PWA construído no mesmo endereço da API.
 *
 * Um endereço só significa: sem CORS, sem porta separada, um único domínio
 * HTTPS. É o que dispensa complicação em túnel de teste e o que simplifica a
 * publicação — instalar um PWA e mantê-lo offline exige contexto seguro, e um
 * túnel HTTPS encaminha uma porta só.
 *
 * Duas regras de cache que costumam derrubar quem usa esse padrão:
 *
 *  - O HTML e o `sw.js` são VOLÁTEIS: se o navegador cacheá-los, uma versão
 *    nova nunca chega e o app fica preso na antiga para sempre.
 *  - O restante tem hash no nome e é imutável — pode cachear por um ano.
 *
 * E uma regra de contorno: um erro de digitação num endpoint da API deve ser
 * 404 de API (JSON), não a página do app. Sem isto, o cliente tentaria
 * interpretar HTML como JSON — erro que não diz nada a quem lê.
 */

const TIPOS: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
}

/**
 * Prefixos exclusivos da API — se um deles aparecer numa URL que não bateu com
 * arquivo estático, devolvemos 404 de API (JSON) em vez do index. Sem isto,
 * cliente que erra o endpoint recebe HTML e tenta interpretar como JSON — o
 * erro que aparece na tela some com o motivo.
 *
 * Rotas que compartilham namespace com o SPA (/admin do painel, /abastecimento
 * do formulário) NÃO entram aqui — o roteador do React resolve, e as rotas de
 * API específicas são sob /painel ou /anexos.
 *
 * Nota: /abastecimento/:id/foto é ambígua no papel; na prática, uma requisição
 * de PUT com corpo JSON só chega aqui por engano do cliente e o método PUT já
 * não bate com o servidor estático. A tela do SPA correspondente é aberta por
 * GET e devolve o index, que é o correto.
 */
const PREFIXOS_DE_API = /^\/(auth|sync|painel|assinaturas|anexos|saude)(\/|$)/

function ehArquivo(caminho: string): boolean {
  try {
    return statSync(caminho).isFile()
  } catch {
    return false
  }
}

function extensaoDeArquivo(url: string): boolean {
  const ultimo = url.slice(url.lastIndexOf('/') + 1)
  return ultimo.includes('.')
}

export function servirEstatico(app: FastifyInstance, dirDist: string): void {
  app.setNotFoundHandler((requisicao, resposta) => {
    const url = requisicao.url.split('?')[0] ?? '/'
    if (PREFIXOS_DE_API.test(url)) {
      return resposta.code(404).send({ erro: 'ROTA_INEXISTENTE' })
    }

    const arquivo = join(dirDist, url === '/' ? 'index.html' : url.replace(/^\/+/, ''))
    const dentroDoDist = arquivo.startsWith(dirDist)

    if (dentroDoDist && ehArquivo(arquivo)) {
      const extensao = arquivo.slice(arquivo.lastIndexOf('.'))
      const volatil = extensao === '.html' || url === '/sw.js' || extensao === '.webmanifest'
      return resposta
        .header('content-type', TIPOS[extensao] ?? 'application/octet-stream')
        .header('cache-control', volatil ? 'no-cache' : 'public, max-age=31536000, immutable')
        .send(readFileSync(arquivo))
    }

    // Navegação interna do app (/abastecimento, /admin/…): entrega o index e
    // deixa o roteador do React resolver. Um arquivo que não existe (algo com
    // ponto) é 404 de verdade — devolver HTML no lugar de um .js some com o
    // erro.
    if (extensaoDeArquivo(url)) return resposta.code(404).send({ erro: 'ARQUIVO_INEXISTENTE' })

    return resposta
      .header('content-type', 'text/html; charset=utf-8')
      .header('cache-control', 'no-cache')
      .send(readFileSync(join(dirDist, 'index.html')))
  })
}
