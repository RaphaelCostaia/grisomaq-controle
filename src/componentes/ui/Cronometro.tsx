import { useEffect, useState } from 'react'
import { duracaoCurta, minutosEntre } from '@/utilitarios/datas'

/**
 * Tempo decorrido desde a chegada, atualizado a cada 30 s.
 *
 * Segundo a segundo seria desperdício de bateria num aparelho que passa o turno
 * inteiro com a tela ligada, e ninguém decide nada com essa precisão — o que
 * importa é "esse caminhão está parado há muito tempo".
 */
export function Cronometro({ desde }: { desde: string }) {
  const [minutos, setMinutos] = useState(() => minutosEntre(new Date(desde), new Date()))

  useEffect(() => {
    const atualizar = () => setMinutos(minutosEntre(new Date(desde), new Date()))
    atualizar()
    const t = setInterval(atualizar, 30_000)

    // O celular suspende timers com a tela apagada. Sem isto, o operador
    // voltaria ao app e leria um tempo congelado como se fosse o atual.
    const aoVoltar = () => document.visibilityState === 'visible' && atualizar()
    document.addEventListener('visibilitychange', aoVoltar)

    return () => {
      clearInterval(t)
      document.removeEventListener('visibilitychange', aoVoltar)
    }
  }, [desde])

  return (
    <span className="numerico tabular-nums" aria-label={'No campo há ' + duracaoCurta(minutos)}>
      {duracaoCurta(minutos)}
    </span>
  )
}
