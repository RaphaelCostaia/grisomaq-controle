import { useCallback, useState } from 'react'
import { ArrowRight, CloudOff, Loader2, TriangleAlert } from 'lucide-react'
import { Botao } from '@/componentes/ui/Botao'
import { Marca } from '@/componentes/ui/Marca'
import { TecladoNumerico } from '@/componentes/ui/TecladoNumerico'
import { entrarComCodigoEPin } from '@/autenticacao/login'
import { useAutenticacao } from '@/autenticacao/contexto'
import { vibrar } from '@/utilitarios/dispositivo'
import { cls } from '@/utilitarios/classes'

const TAMANHO_PIN = 4
const TAMANHO_MAX_CODIGO = 8

type Etapa = 'codigo' | 'pin'

export function Entrar() {
  const [etapa, setEtapa] = useState<Etapa>('codigo')
  const [codigo, setCodigo] = useState('')
  const [pin, setPin] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const { definirSessao } = useAutenticacao()

  const autenticar = useCallback(
    async (pinCompleto: string) => {
      setEnviando(true)
      setErro(null)
      const resultado = await entrarComCodigoEPin(codigo, pinCompleto)
      setEnviando(false)

      if (!resultado.ok) {
        vibrar('erro')
        setPin('')
        setErro(resultado.mensagem)
        return
      }

      vibrar('ok')
      // O contexto lê a sessão do IndexedDB só na montagem. Sem avisá-lo aqui,
      // o login grava a sessão e a tela continua pedindo o PIN — o app fica
      // parado sem nenhum erro para mostrar.
      definirSessao(resultado.sessao)
    },
    [codigo, definirSessao],
  )

  function digitar(digito: string) {
    setErro(null)
    if (etapa === 'codigo') {
      if (codigo.length >= TAMANHO_MAX_CODIGO) return
      setCodigo(codigo + digito)
      return
    }
    if (pin.length >= TAMANHO_PIN || enviando) return
    const novo = pin + digito
    setPin(novo)
    // Autentica sozinho no 4o digito: nao ha razao para pedir um toque a mais.
    if (novo.length === TAMANHO_PIN) void autenticar(novo)
  }

  function apagar() {
    setErro(null)
    if (etapa === 'codigo') {
      setCodigo(codigo.slice(0, -1))
    } else if (pin.length > 0) {
      setPin(pin.slice(0, -1))
    } else {
      setEtapa('codigo')
    }
  }

  return (
    <div className="flex min-h-dvh flex-col bg-[var(--cor-fundo)]">
      <header className="area-segura-superior px-5 pt-6 pb-5">
        <Marca />
      </header>

      <main className="pauta flex flex-1 flex-col justify-center">
        {etapa === 'codigo' ? (
          <CampoCodigo codigo={codigo} />
        ) : (
          <CampoPin codigo={codigo} pin={pin} enviando={enviando} onVoltar={() => setEtapa('codigo')} />
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
      </main>

      <div className="area-segura-inferior">
        {etapa === 'codigo' && (
          <div className="px-4 py-3">
            <Botao
              barra
              disabled={codigo.length === 0}
              onClick={() => setEtapa('pin')}
              icone={<ArrowRight aria-hidden className="size-5" />}
            >
              Continuar
            </Botao>
          </div>
        )}
        <TecladoNumerico onDigito={digitar} onApagar={apagar} />
      </div>
    </div>
  )
}

function CampoCodigo({ codigo }: { codigo: string }) {
  return (
    <div className="linha-ficha">
      <span className="rotulo-campo">Seu código de funcionário</span>
      <p className={cls('valor-leitura mt-1.5 text-[2.75rem]', !codigo && 'valor-leitura--vazio')}>
        {codigo || '––––'}
      </p>
      <p className="mt-1.5 text-sm text-[var(--cor-texto-suave)]">
        É o mesmo número que já vai na ficha de papel.
      </p>
    </div>
  )
}

function CampoPin({
  codigo,
  pin,
  enviando,
  onVoltar,
}: {
  codigo: string
  pin: string
  enviando: boolean
  onVoltar: () => void
}) {
  return (
    <>
      <button type="button" onClick={onVoltar} className="linha-ficha">
        <span className="rotulo-campo">Funcionário</span>
        <span className="valor-leitura mt-1 block text-2xl">{codigo}</span>
        <span className="mt-1 block text-sm font-semibold text-marca-500 underline">Trocar código</span>
      </button>

      <div className="linha-ficha">
        <span className="rotulo-campo">Seu PIN</span>
        <div className="mt-3 flex items-center gap-3.5" aria-live="polite" aria-label={`${pin.length} de 4 dígitos`}>
          {enviando ? (
            <span className="flex items-center gap-2.5 text-base font-semibold text-[var(--cor-texto-suave)]">
              <Loader2 aria-hidden className="size-6 animate-spin" />
              Conferindo…
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
    </>
  )
}

/** Aviso persistente de que a entrada precisa de sinal ao menos uma vez. */
export function AvisoPrimeiroAcessoOffline() {
  return (
    <p className="flex items-start gap-2.5 border-b-2 border-[var(--cor-borda-forte)] bg-[var(--cor-superficie)] px-4 py-3.5 text-sm">
      <CloudOff aria-hidden className="mt-0.5 size-5 shrink-0 text-[var(--cor-texto-suave)]" />
      <span>
        A primeira entrada neste celular precisa de sinal. Depois disso, o app abre e registra normalmente sem
        internet.
      </span>
    </p>
  )
}
