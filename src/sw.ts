/// <reference lib="webworker" />
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'

declare const self: ServiceWorkerGlobalScope

/**
 * Service worker proprio (e nao o gerado automaticamente) por dois motivos:
 * precisamos que QUALQUER navegacao caia no index.html mesmo sem rede - o app
 * e uma SPA e o operador abre direto em /abastecimento; e precisamos do
 * `skipWaiting` sob comando, para o servidor conseguir forcar atualizacao
 * quando um celular ficar com versao velha demais para o sync (VERSAO_OBSOLETA).
 */

precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

// Toda rota da SPA e servida pelo shell em cache. Sem isso, abrir o app offline
// numa rota interna devolve 404 do navegador.
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('index.html'), {
    denylist: [/^\/api\//, /^\/functions\//],
  }),
)

self.addEventListener('message', (evento: ExtendableMessageEvent) => {
  if (evento.data?.tipo === 'ATUALIZAR_AGORA') void self.skipWaiting()
})

// O SW novo assume o controle das abas abertas assim que ativa, para nao
// conviverem duas versoes do app no mesmo celular.
self.addEventListener('activate', (evento: ExtendableEvent) => {
  evento.waitUntil(self.clients.claim())
})
