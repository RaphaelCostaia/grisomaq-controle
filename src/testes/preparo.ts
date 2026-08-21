import '@testing-library/jest-dom/vitest'
import 'fake-indexeddb/auto'

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
