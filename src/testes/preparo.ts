import '@testing-library/jest-dom/vitest'
import 'fake-indexeddb/auto'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// A limpeza automatica da testing-library so acontece com `globals: true`, que
// esta desligado aqui. Sem isto o DOM de um teste sobra para o proximo, e as
// consultas passam a encontrar elementos de outro caso — falha confusa e, pior,
// teste que passa por acidente.
afterEach(cleanup)

// O motor de sincronizacao usa Web Locks para nao rodar em duas abas ao mesmo
// tempo. jsdom nao implementa a API; um lock que sempre concede e o
// comportamento correto num ambiente de aba unica.
if (!('locks' in navigator)) {
  Object.defineProperty(navigator, 'locks', {
    value: {
      request: async (_nome: string, callback: () => unknown) => callback(),
    },
    configurable: true,
  })
}
