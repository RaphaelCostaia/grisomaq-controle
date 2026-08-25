import { registerSW } from 'virtual:pwa-register'

/**
 * Liga o service worker.
 *
 * Sem isto o `sw.js` era gerado no build e nunca entrava em vigor. As
 * consequências não apareciam na tela: o app abria normalmente com rede, e só
 * falhava onde ninguém estava olhando — sem o service worker não há precache,
 * então **reabrir o app sem sinal não carrega nada**, e o navegador não oferece
 * instalar (o critério de instalação exige um service worker com handler de
 * fetch). Um app de campo que promete funcionar offline precisa dos dois.
 *
 * O registro é `prompt`: uma versão nova espera em vez de assumir no meio de um
 * lançamento. Quem manda atualizar é o motor de sincronização, quando o
 * servidor recusa o envio por versão obsoleta.
 */
export function registrarServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return

  registerSW({
    immediate: true,
    onRegisteredSW(_url, registro) {
      // Procura versão nova de hora em hora. O celular passa dias sem recarregar
      // a página — sem isto, uma correção só chegaria quando alguém fechasse o
      // app, e o operador não fecha.
      if (!registro) return
      setInterval(() => void registro.update(), 60 * 60 * 1000)
    },
    onRegisterError(erro) {
      // Falhar aqui não pode impedir o app de abrir: sem service worker ele
      // ainda funciona com rede, que é melhor que uma tela branca.
      console.error('[pwa] service worker não registrou', erro)
    },
  })
}
