import { useEffect, useRef, useState } from 'react'
import { Camera, X } from 'lucide-react'
import { comprimirImagem } from '@/dados/fotos'
import { Botao } from './Botao'

interface Props {
  rotulo: string
  descricao: string
  valor: Blob | null
  onMudar: (b: Blob | null) => void
  /** Estado visual: pinta a borda de âmbar quando o preenchimento é esperado
   *  (por exemplo, quando há divergência de litros e uma foto ajudaria). */
  esperada?: boolean
}

/**
 * Captura de foto pela câmera do celular.
 *
 * Usa o `<input type=file capture>` porque é o único jeito universal: no
 * Android chama a câmera diretamente, no iPhone abre a folha "tirar foto /
 * escolher biblioteca" que o próprio Safari desenha. Sem API estrangeira e
 * sem permissão em runtime além da que o navegador já negocia.
 *
 * A compressão acontece no cliente ANTES de qualquer coisa: a foto crua da
 * câmera é de 3-5 MB e afogaria a fila em campo. 1600 px no lado maior é
 * mais que suficiente para ler um horímetro.
 */
export function CampoFoto({ rotulo, descricao, valor, onMudar, esperada }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [processando, setProcessando] = useState(false)
  const [urlPreview, setUrlPreview] = useState<string | null>(null)

  useEffect(() => {
    if (!valor) {
      setUrlPreview(null)
      return
    }
    const url = URL.createObjectURL(valor)
    setUrlPreview(url)
    // Revoga quando o Blob mudar OU o componente desmontar — sem isto o
    // navegador acumula referências até fechar a aba.
    return () => URL.revokeObjectURL(url)
  }, [valor])

  async function escolher(arquivo: File | undefined) {
    if (!arquivo) return
    setProcessando(true)
    try {
      const comprimido = await comprimirImagem(arquivo)
      onMudar(comprimido)
    } catch (erro) {
      // O navegador não conseguiu ler o arquivo. Não travar o formulário:
      // a foto é opcional, o operador pode salvar sem.
      console.error('[foto] falha ao processar', erro)
      alert('Não foi possível preparar essa foto. Tente outra ou salve sem foto.')
    } finally {
      setProcessando(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const cor = esperada && !valor ? 'border-aviso-500' : 'border-[var(--cor-borda-forte)]'

  return (
    <div className={'linha-ficha border-2 ' + cor}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="rotulo-campo">{rotulo}</div>
          <p className="mt-1 text-sm text-[var(--cor-texto-suave)]">{descricao}</p>
        </div>
        {valor && (
          <button
            type="button"
            onClick={() => onMudar(null)}
            aria-label="Remover foto"
            className="p-2 text-[var(--cor-texto-suave)] hover:text-carmim-500"
          >
            <X aria-hidden className="size-5" />
          </button>
        )}
      </div>

      {urlPreview ? (
        <div className="mt-3">
          {/* Imagem clicável abre o input de novo — refazer com um toque. */}
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="block w-full overflow-hidden rounded border border-[var(--cor-borda)]"
            aria-label="Refazer foto"
          >
            <img src={urlPreview} alt="Foto do horímetro" className="block h-auto w-full" />
          </button>
          <p className="mt-2 text-xs text-[var(--cor-texto-suave)]">
            Toque na foto para refazer.
          </p>
        </div>
      ) : (
        <Botao
          barra
          variante="secundaria"
          disabled={processando}
          onClick={() => inputRef.current?.click()}
          icone={<Camera aria-hidden className="size-6" />}
        >
          {processando ? 'Preparando…' : 'Tirar foto'}
        </Botao>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        onChange={(e) => void escolher(e.target.files?.[0])}
      />
    </div>
  )
}
