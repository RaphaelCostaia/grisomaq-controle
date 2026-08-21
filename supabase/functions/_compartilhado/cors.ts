const ORIGENS_PERMITIDAS = (Deno.env.get('ORIGENS_PERMITIDAS') ?? 'http://localhost:5180')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean)

/**
 * Lista fechada de origens, e não `*`. Estas funções emitem sessão a partir de
 * um PIN de 4 dígitos: liberar qualquer origem transformaria qualquer página
 * aberta no celular num ponto de partida para tentar adivinhar PINs.
 */
export function cabecalhosCors(origem: string | null): Record<string, string> {
  const permitida = origem && ORIGENS_PERMITIDAS.includes(origem) ? origem : ORIGENS_PERMITIDAS[0]
  return {
    'Access-Control-Allow-Origin': permitida ?? '',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-app-versao',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  }
}

export function responderJson(
  corpo: unknown,
  status: number,
  origem: string | null,
): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { ...cabecalhosCors(origem), 'Content-Type': 'application/json' },
  })
}

/**
 * Erro para o cliente. `codigo` é estável e legível por máquina; a mensagem
 * amigável é montada no app, em português, perto do operador.
 */
export function responderErro(codigo: string, status: number, origem: string | null): Response {
  return responderJson({ erro: codigo }, status, origem)
}

export function preflight(req: Request): Response | null {
  if (req.method !== 'OPTIONS') return null
  return new Response('ok', { headers: cabecalhosCors(req.headers.get('origin')) })
}
