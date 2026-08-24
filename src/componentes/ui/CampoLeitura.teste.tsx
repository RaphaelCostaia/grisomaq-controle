import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { CampoLeitura, GrupoDeLeituras } from './CampoLeitura'

function Formulario({ agrupado }: { agrupado: boolean }) {
  const [a, setA] = useState<number | null>(null)
  const [b, setB] = useState<number | null>(null)
  const campos = (
    <>
      <CampoLeitura rotulo="Final reg." valor={a} onMudar={setA} />
      <CampoLeitura rotulo="Litros" valor={b} onMudar={setB} />
    </>
  )
  return agrupado ? <GrupoDeLeituras>{campos}</GrupoDeLeituras> : campos
}

/** Quantos teclados estão montados: a tecla 7 só existe dentro de um deles. */
const teclados = () => screen.queryAllByRole('button', { name: '7' }).length
// Com o teclado aberto o rótulo aparece tambem em elementos internos; a linha
// e sempre o primeiro botao com aquele nome.
const linha = (nome: RegExp) => screen.getAllByRole('button', { name: nome })[0]!

describe('CampoLeitura', () => {
  /**
   * Dois teclados numéricos idênticos abertos ao mesmo tempo, um embaixo do
   * outro, não dizem qual deles recebe o dígito. De luva e sol forte isso é
   * número lançado no campo errado — e era o que acontecia antes do
   * agrupamento, com o formulário passando de duas telas e meia de altura.
   */
  it('mantém só um teclado aberto dentro de um grupo', () => {
    render(<Formulario agrupado />)

    fireEvent.click(linha(/Final reg/i))
    expect(teclados()).toBe(1)

    fireEvent.click(linha(/Litros/i))
    expect(teclados()).toBe(1)
  })

  it('digita no campo que está aberto, e só nele', () => {
    render(<Formulario agrupado />)

    fireEvent.click(linha(/Litros/i))
    fireEvent.click(screen.getByRole('button', { name: '9' }))
    fireEvent.click(screen.getByRole('button', { name: '0' }))

    expect(linha(/Litros/i)).toHaveTextContent('90')
    expect(linha(/Final reg/i)).not.toHaveTextContent('90')
  })

  // Fora de um grupo o componente continua se governando sozinho, para não
  // obrigar todo uso a montar um provedor.
  it('funciona sozinho, sem grupo', () => {
    render(<Formulario agrupado={false} />)

    fireEvent.click(linha(/Final reg/i))
    expect(teclados()).toBe(1)
  })
})
