import { useCallback, useState } from 'react'
import { Loader2, LogOut, TriangleAlert } from 'lucide-react'
import { Marca } from '@/componentes/ui/Marca'
import { TecladoNumerico } from '@/componentes/ui/TecladoNumerico'
import { trocarPin, sair } from '@/autenticacao/login'
import { useAutenticacao } from '@/autenticacao/contexto'
import { CHAVES_META, gravarMeta } from '@/dados/db'
import { vibrar } from '@/utilitarios/dispositivo'
import { cls } from '@/utilitarios/classes'

const TAMANHO_PIN = 4

/**
 * Troca obrigatória de PIN — primeira etapa quando o servidor devolve
 * `trocar_pin: true` no login.
 *
 * O operador recebe o PIN inicial impresso na folha. Se essa troca não fosse
 * exigida, o PIN em papel guardado no capacete valeria para sempre — e é
 * exatamente o cenário que a assinatura por PIN quer evitar. A guarda de rota
 * em `rotas.tsx` só libera o resto do app depois desta tela.
 *
 * "Sair" continua funcionando: se o operador não sabe o PIN atual, precisa de
 * uma saída para pedir ao escritório sem ficar preso à tela.
 */
type Etapa = 'atual' | 'novo' | 'confirmacao'

export function TrocarPin() {
  const { sessao, definirSessao } = useAutenticacao()
  const [etapa, setEtapa] = useState<Etapa>('atual')
  const [pinAtual, setPinAtual] = useState('')
  const [pinNovo, setPinNovo] = useState('')
  const [confirmacao, setConfirmacao] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  const enviar = useCallback(
    async (novoDigitado: string) => {
      setEnviando(true)
      setErro(null)

      const resultado = await trocarPin(pinAtual, novoDigitado)
      setEnviando(false)

      if (!resultado.ok) {
        vibrar('erro')
        // PIN atual errado volta pro começo; PIN novo fraco volta pro "novo".
        if (resultado.codigoErro === 'CREDENCIAL') {
          setPinAtual('')
          setPinNovo('')
          setConfirmacao('')
          setEtapa('atual')
        } else {
          setPinNovo('')
          setConfirmacao('')
          setEtapa('novo')
        }
        setErro(resultado.mensagem)
        return
      }

      vibrar('ok')
      // A sessão precisa refletir que a troca aconteceu. Sem isto, a guarda de
      // rota continua mandando o operador para cá em ciclo — a `sessao` vem do
      // Dexie e do contexto, então atualizo os dois.
      if (sessao) {
        const atualizada = { ...sessao, trocar_pin: false }
        await gravarMeta(CHAVES_META.sessaoCampo, atualizada)
        definirSessao(atualizada)
      }
    },
    [pinAtual, sessao, definirSessao],
  )

  function digitar(digito: string) {
    setErro(null)
    if (enviando) return

    if (etapa === 'atual') {
      if (pinAtual.length >= TAMANHO_PIN) return
      const novo = pinAtual + digito
      setPinAtual(novo)
      if (novo.length === TAMANHO_PIN) setEtapa('novo')
      return
    }

    if (etapa === 'novo') {
      if (pinNovo.length >= TAMANHO_PIN) return
      const novo = pinNovo + digito
      setPinNovo(novo)
      if (novo.length === TAMANHO_PIN) setEtapa('confirmacao')
      return
    }

    if (confirmacao.length >= TAMANHO_PIN) return
    const novaConfirmacao = confirmacao + digito
    setConfirmacao(novaConfirmacao)

    if (novaConfirmacao.length === TAMANHO_PIN) {
      // Confere localmente antes de mandar — evita gastar uma tentativa de PIN
      // atual só porque o operador se enganou na confirmação.
      if (novaConfirmacao !== pinNovo) {
        vibrar('erro')
        setErro('Os dois PINs novos não bateram. Digite de novo.')
        setPinNovo('')
        setConfirmacao('')
        setEtapa('novo')
        return
      }
      void enviar(pinNovo)
    }
  }

  function apagar() {
    setErro(null)
    if (etapa === 'confirmacao') {
      if (confirmacao.length > 0) {
        setConfirmacao(confirmacao.slice(0, -1))
      } else {
        setPinNovo('')
        setEtapa('novo')
      }
      return
    }
    if (etapa === 'novo') {
      if (pinNovo.length > 0) {
        setPinNovo(pinNovo.slice(0, -1))
      } else {
        setPinAtual('')
        setEtapa('atual')
      }
      return
    }
    if (pinAtual.length > 0) setPinAtual(pinAtual.slice(0, -1))
  }

  async function encerrar() {
    // Sair sempre pode: um operador que não lembra o PIN atual precisa poder
    // pedir ao escritório para gerar um novo, e a tela de troca não pode virar
    // uma armadilha.
    await sair()
    definirSessao(null)
  }

  const pinAtivo =
    etapa === 'atual' ? pinAtual : etapa === 'novo' ? pinNovo : confirmacao

  return (
    <div className="flex min-h-dvh flex-col bg-[var(--cor-fundo)]">
      <header className="area-segura-superior flex items-center justify-between px-5 pt-6 pb-5">
        <Marca />
        <button
          type="button"
          onClick={() => void encerrar()}
          className="flex items-center gap-1.5 text-sm font-semibold text-[var(--cor-texto-suave)] underline"
        >
          <LogOut aria-hidden className="size-4" />
          Sair
        </button>
      </header>

      <main className="pauta flex flex-1 flex-col justify-center">
        <div className="linha-ficha bg-marca-50">
          <span className="rotulo-campo">Trocar seu PIN</span>
          <p className="mt-2 text-sm text-[var(--cor-texto-suave)]">
            {sessao?.nome}, este é o seu primeiro acesso. Defina um PIN novo,
            de 4 dígitos, que só você saiba. O PIN da folha impressa deixa de
            valer depois disso.
          </p>
        </div>

        {etapa === 'atual' && (
          <CampoPin rotulo="PIN atual (o da folha)" pin={pinAtual} enviando={false} />
        )}
        {etapa === 'novo' && (
          <CampoPin rotulo="Novo PIN" pin={pinNovo} enviando={false} />
        )}
        {etapa === 'confirmacao' && (
          <CampoPin
            rotulo="Digite o novo PIN de novo"
            pin={confirmacao}
            enviando={enviando}
          />
        )}

        {erro && (
          <p
            role="alert"
            className="flex items-start gap-2.5 border-b-2 border-[var(--cor-borda-forte)] bg-carbono-50 px-4 py-3.5 text-base font-semibold text-carbono-700"
          >
            <TriangleAlert aria-hidden className="mt-0.5 size-5 shrink-0" />
            {erro}
          </p>
        )}

        <div className="linha-ficha">
          <span className="rotulo-campo">Regras do PIN</span>
          <ul className="mt-2 space-y-1 text-sm text-[var(--cor-texto-suave)]">
            <li>Não use sequência (1234, 4321).</li>
            <li>Não use dígitos repetidos (1111, 7777).</li>
            <li>Não use ano de nascimento (1990, 2002).</li>
          </ul>
        </div>
      </main>

      <div className="area-segura-inferior">
        <div className="border-t-2 border-[var(--cor-borda-forte)] bg-[var(--cor-superficie)] px-4 py-2 text-center text-xs font-semibold text-[var(--cor-texto-suave)]">
          Passo {etapa === 'atual' ? 1 : etapa === 'novo' ? 2 : 3} de 3
          {' · '}
          {pinAtivo.length}/{TAMANHO_PIN} dígitos
        </div>
        <TecladoNumerico onDigito={digitar} onApagar={apagar} />
      </div>
    </div>
  )
}

function CampoPin({
  rotulo,
  pin,
  enviando,
}: {
  rotulo: string
  pin: string
  enviando: boolean
}) {
  return (
    <div className="linha-ficha">
      <span className="rotulo-campo">{rotulo}</span>
      <div className="mt-3 flex items-center gap-3.5" aria-live="polite" aria-label={`${pin.length} de 4 dígitos`}>
        {enviando ? (
          <span className="flex items-center gap-2.5 text-base font-semibold text-[var(--cor-texto-suave)]">
            <Loader2 aria-hidden className="size-6 animate-spin" />
            Trocando…
          </span>
        ) : (
          Array.from({ length: TAMANHO_PIN }, (_, i) => (
            <span
              key={i}
              className={cls(
                'size-6 border-2 border-[var(--cor-borda-forte)]',
                i < pin.length && 'bg-[var(--cor-borda-forte)]',
              )}
            />
          ))
        )}
      </div>
    </div>
  )
}

