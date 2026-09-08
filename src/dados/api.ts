import { idDoDispositivo } from '@/utilitarios/dispositivo'

/**
 * Endereço da API.
 *
 * Em desenvolvimento a API é anunciada como `localhost`. Aberto no CELULAR, na
 * mesma rede, "localhost" é o próprio celular — a chamada iria para lugar
 * nenhum e o app pareceria estar sem sinal. Quando a página não veio de
 * localhost, a API mora no mesmo host de onde a página veio.
 *
 * Em produção `VITE_API_URL` aponta para um domínio de verdade e nada disto se
 * aplica: só reescreve quando o endereço configurado é local.
 */
export function resolverBase(): string {
  const configurada = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')
  if (!configurada || typeof window === 'undefined') return configurada

  const ehLocal = (host: string) => host === 'localhost' || host === '127.0.0.1' || host === '[::1]'

  try {
    const alvo = new URL(configurada)
    if (ehLocal(alvo.hostname) && !ehLocal(window.location.hostname)) {
      alvo.hostname = window.location.hostname
      return alvo.toString().replace(/\/$/, '')
    }
  } catch {
    // Endereço relativo (mesmo domínio da página): fica como veio.
  }
  return configurada
}

const BASE = resolverBase()

/**
 * Servir o app e a API do mesmo endereço é um arranjo legítimo — é o que
 * dispensa CORS e faz um único endereço HTTPS cobrir os dois. Nesse caso a base
 * é vazia de propósito e as chamadas saem relativas.
 *
 * Vazio POR DESCUIDO é outra coisa: aí ninguém disse onde a API mora, e o app
 * precisa dizer isso em vez de tentar falar com o servidor de arquivos. A
 * diferença está em a variável existir (`''`) ou não existir (`undefined`).
 */
const mesmaOrigem = import.meta.env.VITE_API_URL === ''

export const apiConfigurada = mesmaOrigem || BASE.length > 0

const CHAVE_SESSAO = 'grisomaq.sessao'

interface SessaoArmazenada {
  access_token: string
  refresh_token: string
  /** Momento em que o access token expira, em epoch ms. */
  expira_em: number
}

/**
 * Códigos que o servidor devolve e como cada um deve aparecer para quem opera.
 *
 * A frase em português vem primeiro; o próprio código fica entre parênteses ao
 * final para que, num pedido de socorro, o operador tenha algo copiável.
 *
 * Códigos não listados aqui caem no fallback "Deu problema aqui no sistema
 * (CÓDIGO)"; mapear os que aparecem na prática é melhor que tentar cobrir tudo
 * de uma vez e errar o tom.
 */
const MENSAGEM_POR_CODIGO: Record<string, string> = {
  FALHA_INTERNA: 'Deu problema aqui no sistema. Tente de novo em alguns minutos.',
  API_NAO_CONFIGURADA: 'Este aparelho ainda não foi configurado para o servidor.',
  SEM_SESSAO: 'Sua sessão expirou. Entre de novo.',
  SESSAO_INVALIDA: 'Sua sessão expirou. Entre de novo.',
  SESSAO_REVOGADA: 'Sua sessão foi encerrada. Entre de novo.',
  CORPO_INVALIDO: 'Faltou preencher algum campo.',
  DADOS_AUSENTES: 'Faltou preencher algum campo.',
  CREDENCIAL: 'Código ou PIN inválido.',
  BLOQUEADO: 'Muitas tentativas. Espere 15 minutos ou peça ao escritório para liberar.',
  NAO_PROVISIONADO: 'Este funcionário ainda não tem PIN. Peça ao escritório.',
  INATIVO: 'Este funcionário está inativo. Fale com o escritório.',
  PIN_FRACO: 'PIN muito simples. Evite sequências, repetições e anos.',
  SEM_PERMISSAO: 'Você não tem permissão para esta ação.',
  VERSAO_OBSOLETA: 'Atualize o aplicativo antes de continuar.',
  ROTA_INEXISTENTE: 'Não encontrei este endereço no servidor.',
  ARQUIVO_INEXISTENTE: 'O arquivo pedido não existe.',
  ANEXO_INEXISTENTE: 'Esta foto não está mais disponível.',
  ABASTECIMENTO_INEXISTENTE: 'Este abastecimento não existe mais no servidor.',
  ARQUIVO_GRANDE: 'A foto é grande demais. Tire de novo com menos qualidade.',
  BASE64_INVALIDO: 'A foto veio corrompida. Tire de novo.',
  ARQUIVO_VAZIO: 'A foto veio vazia. Tire de novo.',
  PERIODO_FECHADO: 'O escritório já fechou este período. Correções agora passam por eles.',
  MOTIVO_OBRIGATORIO: 'Escreva o motivo antes de continuar.',
  FECHAMENTO_NAO_ENCONTRADO: 'Não encontrei este fechamento.',
  FUNCIONARIO_NAO_ENCONTRADO: 'Funcionário não encontrado.',
  NAO_ENCONTRADO: 'Registro não encontrado.',
  FAIXA_SOBREPOSTA: 'Esta faixa de numeração já é usada por outro celular.',
  FAIXA_INVALIDA: 'A faixa precisa começar antes de terminar.',
  DURACAO_INVALIDA: 'A duração do turno precisa ser maior que zero.',
  VINCULO_INEXISTENTE: 'Este cadastro depende de outro que ainda não existe.',
  JA_EXISTE: 'Já existe um registro com estes dados.',
  CODIGO_JA_USADO: 'Já existe um funcionário com este código.',
  CADASTRO_INVALIDO: 'Este tipo de cadastro não está disponível.',
  NADA_A_GRAVAR: 'Nada foi alterado.',
  CAMPOS_OBRIGATORIOS: 'Faltam campos obrigatórios.',
  PARAMETRO_INEXISTENTE: 'Este parâmetro não existe.',
  LOTE_GRANDE: 'Lote grande demais. O motor tenta em partes.',
}

/**
 * Traduz um erro qualquer para uma mensagem legível pelo operador.
 *
 * A regra: `ErroApi` conhecido → frase em português; `ErroApi` desconhecido →
 * frase genérica seguida do código entre parênteses (para socorro); erro
 * comum de rede/render → a própria mensagem do JS (essas costumam ser em
 * inglês, mas são raras e apontam a causa real).
 */
export function mensagemDe(erro: unknown, fallback = 'Não foi possível concluir.'): string {
  if (erro instanceof ErroApi) return erro.mensagem
  if (erro instanceof Error && erro.message) return erro.message
  return fallback
}

export class ErroApi extends Error {
  status: number
  codigo: string

  constructor(status: number, codigo: string) {
    super(codigo)
    this.name = 'ErroApi'
    this.status = status
    this.codigo = codigo
  }

  /** Frase legível ao operador. Fallback com o código para pedidos de socorro. */
  get mensagem(): string {
    const traduzida = MENSAGEM_POR_CODIGO[this.codigo]
    if (traduzida) return traduzida
    if (/^FALHA_\d/.test(this.codigo)) {
      return 'Deu problema aqui no sistema. Tente de novo em alguns minutos (' + this.codigo + ').'
    }
    return 'Deu problema aqui no sistema (' + this.codigo + ').'
  }
}

// --- Sessão ------------------------------------------------------------------

export function lerSessao(): SessaoArmazenada | null {
  const bruto = localStorage.getItem(CHAVE_SESSAO)
  if (!bruto) return null
  try {
    return JSON.parse(bruto) as SessaoArmazenada
  } catch {
    return null
  }
}

export function gravarSessao(dados: {
  access_token: string
  refresh_token: string
  expira_em_segundos: number
}): void {
  const sessao: SessaoArmazenada = {
    access_token: dados.access_token,
    refresh_token: dados.refresh_token,
    // Um minuto de folga: renovar às vésperas do vencimento evita a corrida em
    // que o token expira entre montar a requisição e o servidor recebê-la.
    expira_em: Date.now() + (dados.expira_em_segundos - 60) * 1000,
  }
  localStorage.setItem(CHAVE_SESSAO, JSON.stringify(sessao))
}

export function limparSessao(): void {
  localStorage.removeItem(CHAVE_SESSAO)
}

export function temSessao(): boolean {
  return lerSessao() !== null
}

// --- Renovação ---------------------------------------------------------------

/**
 * Renovação em voo, compartilhada.
 *
 * O motor de sincronização dispara várias requisições quase juntas quando o
 * sinal volta. Sem esta trava, cada uma tentaria renovar com o mesmo refresh
 * token; a primeira o rotacionaria e as outras chegariam com um token já
 * trocado, gerando falhas de sessão logo no melhor momento para sincronizar.
 */
let renovacaoEmVoo: Promise<string | null> | null = null

async function renovarSessao(): Promise<string | null> {
  if (renovacaoEmVoo) return renovacaoEmVoo

  renovacaoEmVoo = (async () => {
    const sessao = lerSessao()
    if (!sessao?.refresh_token) return null

    try {
      const resposta = await fetch(BASE + '/auth/renovar', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Dispositivo-Id': idDoDispositivo(),
        },
        body: JSON.stringify({ refresh_token: sessao.refresh_token }),
      })

      if (!resposta.ok) {
        // Refresh recusado é fim de sessão: limpar aqui evita o app ficar em
        // laço tentando renovar com um token que o servidor já descartou.
        if (resposta.status === 401 || resposta.status === 403) limparSessao()
        return null
      }

      const dados = (await resposta.json()) as {
        access_token: string
        refresh_token: string
        expira_em_segundos: number
      }
      gravarSessao(dados)
      return dados.access_token
    } catch {
      // Falha de rede não invalida a sessão: o celular está offline, e é
      // exatamente o caso que o app precisa sobreviver.
      return null
    } finally {
      renovacaoEmVoo = null
    }
  })()

  return renovacaoEmVoo
}

async function tokenValido(): Promise<string | null> {
  const sessao = lerSessao()
  if (!sessao) return null
  if (Date.now() < sessao.expira_em) return sessao.access_token
  return renovarSessao()
}

// --- Chamadas ----------------------------------------------------------------

interface OpcoesChamada {
  corpo?: unknown
  autenticada?: boolean
  timeoutMs?: number
  /** POST é o padrão; PUT quando o endpoint é idempotente por chave (foto). */
  metodo?: 'POST' | 'PUT'
}

/**
 * Faz uma chamada à API. Renova a sessão uma vez em caso de 401 e repete —
 * o access token dura uma hora e o app fica horas sem falar com o servidor,
 * então expirar no meio de uma rodada de sincronização é rotina, não exceção.
 */
/**
 * Baixa um binário (imagem) com autenticação e devolve como Blob.
 *
 * `chamar` monta JSON no request e espera JSON na resposta — inadequado para
 * imagem. Este helper compartilha só o cuidado com o token: uma renovação em
 * caso de 401 e depois retenta a requisição.
 */
export async function baixarBinario(caminho: string): Promise<Blob> {
  if (!apiConfigurada) throw new ErroApi(0, 'API_NAO_CONFIGURADA')

  const executar = async (token: string | null): Promise<Response> =>
    fetch(BASE + caminho, {
      method: 'GET',
      headers: {
        'X-Dispositivo-Id': idDoDispositivo(),
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
      },
    })

  let resposta = await executar(await tokenValido())
  if (resposta.status === 401) {
    const renovado = await renovarSessao()
    resposta = await executar(renovado)
  }
  if (!resposta.ok) throw new ErroApi(resposta.status, await lerCodigo(resposta))
  return resposta.blob()
}

async function lerCodigo(r: Response): Promise<string> {
  try {
    const j = (await r.json()) as { erro?: string }
    return j.erro ?? String(r.status)
  } catch {
    return String(r.status)
  }
}

export async function chamar<T>(caminho: string, opcoes: OpcoesChamada = {}): Promise<T> {
  if (!apiConfigurada) throw new ErroApi(0, 'API_NAO_CONFIGURADA')

  const { corpo, autenticada = true, timeoutMs = 20_000, metodo = 'POST' } = opcoes

  const executar = async (token: string | null): Promise<Response> => {
    const controlador = new AbortController()
    const relogio = setTimeout(() => controlador.abort(), timeoutMs)
    try {
      return await fetch(BASE + caminho, {
        method: metodo,
        headers: {
          'Content-Type': 'application/json',
          // Identifica o aparelho para o rate-limit do servidor. Sem este
          // header, a cota é por IP — um comboio inteiro na rede da sede
          // dividiria uma cota só.
          'X-Dispositivo-Id': idDoDispositivo(),
          ...(token ? { Authorization: 'Bearer ' + token } : {}),
        },
        body: JSON.stringify(corpo ?? {}),
        signal: controlador.signal,
      })
    } finally {
      clearTimeout(relogio)
    }
  }

  let token = autenticada ? await tokenValido() : null
  let resposta = await executar(token)

  if (resposta.status === 401 && autenticada) {
    token = await renovarSessao()
    if (token) resposta = await executar(token)
  }

  if (!resposta.ok) {
    const detalhe = await resposta.json().catch(() => ({}) as { erro?: string })
    throw new ErroApi(resposta.status, detalhe?.erro ?? 'FALHA_' + resposta.status)
  }

  return (await resposta.json()) as T
}

/** Checagem rápida antes de tentar sincronizar. */
export async function servidorAlcancavel(): Promise<boolean> {
  if (!apiConfigurada) return false
  try {
    const resposta = await fetch(BASE + '/saude', { signal: AbortSignal.timeout(5000) })
    return resposta.ok
  } catch {
    return false
  }
}
