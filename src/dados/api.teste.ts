import { afterEach, describe, expect, it, vi } from 'vitest'

/** Recarrega o módulo com um VITE_API_URL e um endereço de página. */
async function baseCom(apiUrl: string | undefined, hostDaPagina: string) {
  vi.resetModules()
  vi.stubEnv('VITE_API_URL', apiUrl ?? '')
  Object.defineProperty(window, 'location', {
    value: new URL('http://' + hostDaPagina + '/'),
    writable: true,
    configurable: true,
  })
  const { resolverBase } = await import('./api')
  return resolverBase()
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('endereço da API', () => {
  it('mantém localhost quando a página também é localhost', async () => {
    expect(await baseCom('http://localhost:3000', 'localhost:5180')).toBe('http://localhost:3000')
  })

  /**
   * O caso do celular. A API é anunciada como localhost porque foi o PC que a
   * subiu; aberto no telefone, "localhost" é o próprio telefone e a chamada
   * morre — e o app parece estar sem sinal, que é o diagnóstico errado.
   */
  it('segue o host da página quando aberta de outro aparelho', async () => {
    expect(await baseCom('http://localhost:3000', '192.168.1.167:5180')).toBe(
      'http://192.168.1.167:3000',
    )
  })

  it('preserva a porta da API, que não é a da página', async () => {
    expect(await baseCom('http://127.0.0.1:3002', '192.168.0.42:5180')).toBe(
      'http://192.168.0.42:3002',
    )
  })

  // Em produção o endereço é um domínio de verdade. Reescrevê-lo mandaria o app
  // falar com o próprio servidor de arquivos em vez da API.
  it('não mexe num endereço que já é remoto', async () => {
    expect(await baseCom('https://api.grisomaq.com.br', 'controle.grisomaq.com.br')).toBe(
      'https://api.grisomaq.com.br',
    )
  })

  it('aceita ficar sem endereço configurado', async () => {
    expect(await baseCom(undefined, 'localhost:5180')).toBe('')
  })
})
