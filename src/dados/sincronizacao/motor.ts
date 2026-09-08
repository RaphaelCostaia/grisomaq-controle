import { CHAVES_META, db, gravarMeta, totalPendentes } from '../db'
import { apiConfigurada, mensagemDe, temSessao } from '../api'
import { enviarFotosPendentes } from '../fotos'
import { atualizarEstadoSync, lerEstadoSync } from './estado'
import { enviarLote } from './push'
import { baixarAlteracoes } from './pull'

const INTERVALO_ONLINE_MS = 30_000
const NOME_TRAVA = 'grisomaq-sync'

let temporizador: ReturnType<typeof setInterval> | null = null
let rodando = false

/**
 * Uma rodada completa: sobe a fila, baixa o que mudou, atualiza o estado da
 * barra. Protegida por Web Lock para que duas abas do mesmo celular nao
 * disputem a fila - sem isso, as duas leriam o mesmo lote e o servidor
 * receberia tudo em duplicidade (o trinco de idempotencia salvaria o dado, mas
 * a fila local ficaria inconsistente).
 */
export async function sincronizarAgora(): Promise<void> {
  if (rodando || !apiConfigurada) return
  if (!navigator.onLine) {
    atualizarEstadoSync({ situacao: 'sem_sinal', pendentes: await totalPendentes() })
    return
  }

  const executar = async () => {
    rodando = true
    atualizarEstadoSync({ situacao: 'sincronizando' })

    try {
      // Sem sessao nao ha o que fazer, e isso NAO e erro: o aparelho pode estar
      // dias offline. A fila espera; ninguem perde lancamento.
      if (!temSessao()) {
        atualizarEstadoSync({ situacao: 'ocioso', pendentes: await totalPendentes() })
        return
      }

      let versaoObsoleta = false
      let desvio: number | null = null

      // Esvazia a fila em lotes ate nao sobrar nada pronto para enviar.
      for (;;) {
        const saida = await enviarLote()
        if (saida.desvioRelogioMs !== null) desvio = saida.desvioRelogioMs
        if (saida.versaoObsoleta) {
          versaoObsoleta = true
          break
        }
        if (saida.enviadas === 0 || saida.erro) break
      }

      if (versaoObsoleta) {
        atualizarEstadoSync({
          situacao: 'erro',
          ultimoErro: 'Atualize o aplicativo: esta versão não envia mais lançamentos.',
          pendentes: await totalPendentes(),
        })
        pedirAtualizacaoDoApp()
        return
      }

      const { erro: erroPull } = await baixarAlteracoes()

      // Fotos entram por fila e endpoint separados: uma foto que falha não
      // pode empurrar o abastecimento para conflito, e o resultado do envio
      // NÃO influencia o "sync ok" — os números vieram, mesmo que a imagem
      // ainda esteja em fila.
      if (!erroPull) {
        try {
          await enviarFotosPendentes()
        } catch (erro) {
          console.error('[fotos] falha inesperada no envio', erro)
        }
      }

      const pendentes = await totalPendentes()
      const conflitos = await db.outbox.filter((i) => i.erro_codigo !== null && i.status === 'erro').count()
      const agora = new Date().toISOString()

      if (!erroPull) {
        await gravarMeta(CHAVES_META.ultimoSyncOk, agora)
        if (desvio !== null) await gravarMeta(CHAVES_META.desvioRelogioMs, desvio)
      }

      atualizarEstadoSync({
        situacao: erroPull ? 'erro' : 'ocioso',
        pendentes,
        conflitos,
        ultimoSyncOk: erroPull ? lerEstadoSync().ultimoSyncOk : agora,
        desvioRelogioMs: desvio ?? lerEstadoSync().desvioRelogioMs,
        ultimoErro: erroPull,
      })
    } catch (erro) {
      atualizarEstadoSync({
        situacao: 'erro',
        // `mensagemDe` traduz o código do servidor para uma frase que o
        // operador entende — sem isso o `FALHA_INTERNA` cru aparecia no topo
        // da tela do campo, humilhando o produto e sem dizer o que fazer.
        ultimoErro: mensagemDe(erro),
        pendentes: await totalPendentes(),
      })
    } finally {
      rodando = false
    }
  }

  if (navigator.locks) {
    await navigator.locks.request(NOME_TRAVA, { ifAvailable: true }, async (trava) => {
      if (trava) await executar()
    })
  } else {
    await executar()
  }
}

/**
 * Liga os gatilhos. Sao varios de proposito: em sinal intermitente, cada janela
 * de rede e uma oportunidade que pode nao se repetir tao cedo.
 */
export function iniciarMotorDeSync(): () => void {
  const aoVoltarSinal = () => void sincronizarAgora()
  const aoFicarVisivel = () => {
    if (document.visibilityState === 'visible') void sincronizarAgora()
  }
  const aoPerderSinal = () => atualizarEstadoSync({ situacao: 'sem_sinal' })

  window.addEventListener('online', aoVoltarSinal)
  window.addEventListener('offline', aoPerderSinal)
  document.addEventListener('visibilitychange', aoFicarVisivel)

  temporizador = setInterval(() => {
    if (navigator.onLine) void sincronizarAgora()
  }, INTERVALO_ONLINE_MS)

  void sincronizarAgora()

  return () => {
    window.removeEventListener('online', aoVoltarSinal)
    window.removeEventListener('offline', aoPerderSinal)
    document.removeEventListener('visibilitychange', aoFicarVisivel)
    if (temporizador) clearInterval(temporizador)
    temporizador = null
  }
}

/** Chamado apos cada gravacao: se houver sinal, o dado sobe na hora. */
export function sincronizarSePuder(): void {
  if (navigator.onLine) void sincronizarAgora()
}

function pedirAtualizacaoDoApp(): void {
  void navigator.serviceWorker?.getRegistration().then((registro) => {
    registro?.waiting?.postMessage({ tipo: 'ATUALIZAR_AGORA' })
  })
}
