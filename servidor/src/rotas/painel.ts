import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { comoFuncionario, type Consultavel, type Identidade } from '../banco.ts'

/**
 * Rotas do painel do escritório.
 *
 * Todas passam por `comoFuncionario`, então rodam com a RLS valendo. O papel
 * `admin` tem policy de acesso total, mas quem concede isso é o banco — não um
 * `if` nesta camada. A checagem de papel abaixo existe para dar 403 com
 * mensagem clara em vez de devolver lista vazia; ela não é a barreira.
 */
export async function rotasDoPainel(app: FastifyInstance): Promise<void> {
  const exigirAdmin = (
    requisicao: FastifyRequest,
    resposta: FastifyReply,
  ): Identidade | null => {
    const identidade = requisicao.identidade
    if (!identidade) {
      void resposta.code(401).send({ erro: 'SEM_SESSAO' })
      return null
    }
    if (identidade.papel !== 'admin') {
      void resposta.code(403).send({ erro: 'SEM_PERMISSAO' })
      return null
    }
    return identidade
  }

  /** Números do dia a dia, tudo numa chamada só — o painel abre de uma vez. */
  app.post('/painel/resumo', async (requisicao, resposta) => {
    const identidade = exigirAdmin(requisicao, resposta)
    if (!identidade) return

    const corpo = requisicao.body as { dias?: number }
    const dias = Math.min(Math.max(Number(corpo?.dias ?? 30), 1), 180)

    return comoFuncionario(identidade, async (cliente) => {
      const [caminhoes, abastecimento, apontamento, dispositivos, conflitos, assinaturas, fichasDivergentes] =
        await Promise.all([
          cliente.query(
            `select data, ciclos_concluidos, ciclos_abertos, permanencia_media_min, permanencia_p90_min
               from public.vw_kpi_caminhoes_dia
              where data >= current_date - $1::integer
              order by data desc`,
            [dias],
          ),
          cliente.query(
            `select data, frota_numero, abastecimentos, litros, divergencia_total, lancamentos_divergentes
               from public.vw_kpi_abastecimento_frota_dia
              where data >= current_date - $1::integer
              order by data desc, litros desc`,
            [dias],
          ),
          cliente.query(
            `select data, frente_id, turno_id, funcionarios, frotas, horas_elevador, km_percorridos, assinaturas_pendentes
               from public.vw_kpi_apontamento_dia
              where data >= current_date - $1::integer
              order by data desc`,
            [dias],
          ),
          cliente.query(
            `select id, apelido, funcionario_nome, app_versao, ultimo_sync_em, horas_sem_sync, desvio_relogio_ms
               from public.vw_dispositivos_sem_sync
              order by ultimo_sync_em nulls first
              limit 50`,
          ),
          cliente.query('select count(*)::int as total from public.vw_conflitos_pendentes'),
          cliente.query(
            `select count(*)::int as total,
                    count(*) filter (where validacao_pin = 'invalida')::int as invalidas
               from public.vw_assinaturas_a_conferir`,
          ),
          // O que o operador ESCREVEU quando a bomba não bateu. Sem esta linha,
          // o painel dizia "1 ficha com diferença" e o motivo — que é o que
          // decide se a divergência foi explicada ou se precisa investigar —
          // ficava enterrado em Relatórios. Mostrar aqui evita o clique
          // desnecessário e o esquecimento.
          cliente.query(
            `select a.id, a.numero_documento, a.data, a.hora,
                    a.litros, a.divergencia_litros,
                    a.justificativa_divergencia,
                    f.numero as frota_numero,
                    op.nome as operador_nome,
                    (select id from public.anexos
                      where tabela = 'abastecimentos' and registro_id = a.id
                      order by criado_em desc limit 1) as foto_id
               from public.abastecimentos a
               left join public.frotas f on f.id = a.frota_id
               left join public.funcionarios op on op.id = a.operador_funcionario_id
              where a.data >= current_date - $1::integer
                and not a.excluido
                and abs(a.divergencia_litros) > 0.5
              order by a.data desc, abs(a.divergencia_litros) desc
              limit 20`,
            [dias],
          ),
        ])

      return {
        periodo_dias: dias,
        caminhoes: caminhoes.rows,
        abastecimento: abastecimento.rows,
        apontamento: apontamento.rows,
        dispositivos_sem_sync: dispositivos.rows,
        conflitos_pendentes: conflitos.rows[0]?.total ?? 0,
        assinaturas: assinaturas.rows[0] ?? { total: 0, invalidas: 0 },
        fichas_divergentes: fichasDivergentes.rows,
      }
    })
  })

  /**
   * Lançamentos que o banco recusou e que estão esperando decisão humana.
   *
   * O payload vai junto: sem ele, o escritório saberia que algo falhou mas não
   * o que o operador tinha preenchido — e o lançamento estaria perdido na
   * prática, ainda que gravado.
   */
  app.post('/painel/conflitos', async (requisicao, resposta) => {
    const identidade = exigirAdmin(requisicao, resposta)
    if (!identidade) return

    return comoFuncionario(identidade, async (cliente) => {
      const { rows } = await cliente.query(
        `select * from public.vw_conflitos_pendentes order by recebido_em desc limit 200`,
      )
      return { conflitos: rows }
    })
  })

  app.post('/painel/conflitos/resolver', async (requisicao, resposta) => {
    const identidade = exigirAdmin(requisicao, resposta)
    if (!identidade) return

    const corpo = requisicao.body as { operacao_id?: string }
    if (!corpo?.operacao_id) return resposta.code(400).send({ erro: 'CORPO_INVALIDO' })

    return comoFuncionario(identidade, async (cliente) => {
      const { rows } = await cliente.query<{ fn_resolver_conflito: boolean }>(
        'select public.fn_resolver_conflito($1)',
        [corpo.operacao_id],
      )
      return { resolvido: rows[0]?.fn_resolver_conflito ?? false }
    })
  })

  /** Quadro de funcionários, com o estado do PIN de cada um. */
  app.post('/painel/funcionarios', async (requisicao, resposta) => {
    const identidade = exigirAdmin(requisicao, resposta)
    if (!identidade) return

    return comoFuncionario(identidade, async (cliente) => {
      const { rows } = await cliente.query(
        'select * from public.vw_funcionarios_admin order by codigo',
      )
      return { funcionarios: rows }
    })
  })

  /**
   * Libera quem se bloqueou errando o PIN, SEM trocar o PIN dele.
   *
   * O caminho antigo era gerar um PIN novo, o que resolve o bloqueio criando
   * outro problema: o operador precisa decorar outro número no meio do turno.
   */
  app.post('/painel/funcionarios/liberar', async (requisicao, resposta) => {
    const identidade = exigirAdmin(requisicao, resposta)
    if (!identidade) return

    const corpo = requisicao.body as { id?: string }
    if (!corpo?.id) return resposta.code(400).send({ erro: 'CORPO_INVALIDO' })

    try {
      return await comoFuncionario(identidade, async (cliente) => {
        await cliente.query('select public.fn_liberar_pin($1)', [corpo.id])
        return { liberado: true }
      })
    } catch (erro) {
      const mensagem = erro instanceof Error ? erro.message : ''
      if (mensagem.includes('FUNCIONARIO_NAO_ENCONTRADO')) {
        return resposta.code(404).send({ erro: 'NAO_ENCONTRADO' })
      }
      if (mensagem.includes('SEM_PERMISSAO')) return resposta.code(403).send({ erro: 'SEM_PERMISSAO' })
      throw erro
    }
  })

  app.post('/painel/funcionarios/salvar', async (requisicao, resposta) => {
    const identidade = exigirAdmin(requisicao, resposta)
    if (!identidade) return

    const corpo = requisicao.body as {
      id?: string
      codigo?: string
      nome?: string
      funcao?: string | null
      papel?: string
      frente_padrao_id?: string | null
      ativo?: boolean
    }

    if (!corpo?.codigo || !corpo?.nome) return resposta.code(400).send({ erro: 'CORPO_INVALIDO' })
    if (!/^[0-9]{1,8}$/.test(corpo.codigo)) return resposta.code(400).send({ erro: 'CODIGO_FORMATO' })
    if (!['campo', 'lider', 'admin'].includes(corpo.papel ?? 'campo')) {
      return resposta.code(400).send({ erro: 'PAPEL_INVALIDO' })
    }

    try {
      return await comoFuncionario(identidade, async (cliente) => {
        if (corpo.id) {
          const { rows } = await cliente.query(
            `update public.funcionarios
                set codigo = $2, nome = $3, funcao = $4, papel = $5::public.papel_usuario,
                    frente_padrao_id = $6, ativo = $7
              where id = $1
              returning id`,
            [
              corpo.id,
              corpo.codigo,
              corpo.nome,
              corpo.funcao ?? null,
              corpo.papel ?? 'campo',
              corpo.frente_padrao_id ?? null,
              corpo.ativo ?? true,
            ],
          )
          return { id: rows[0]?.id }
        }

        const { rows } = await cliente.query(
          `insert into public.funcionarios (id, codigo, nome, funcao, papel, frente_padrao_id, ativo)
           values (gen_random_uuid(), $1, $2, $3, $4::public.papel_usuario, $5, $6)
           returning id`,
          [
            corpo.codigo,
            corpo.nome,
            corpo.funcao ?? null,
            corpo.papel ?? 'campo',
            corpo.frente_padrao_id ?? null,
            corpo.ativo ?? true,
          ],
        )
        return { id: rows[0]?.id }
      })
    } catch (erro) {
      // Código repetido é o erro mais provável aqui, e o escritório precisa
      // saber qual foi — não um "falha interna" genérico.
      const mensagem = erro instanceof Error ? erro.message : ''
      if (mensagem.includes('funcionarios_codigo_uk')) {
        return resposta.code(409).send({ erro: 'CODIGO_JA_USADO' })
      }
      throw erro
    }
  })

  /** Assinaturas ainda não confirmadas pelo servidor, e as contestadas. */
  app.post('/painel/assinaturas', async (requisicao, resposta) => {
    const identidade = exigirAdmin(requisicao, resposta)
    if (!identidade) return

    return comoFuncionario(identidade, async (cliente) => {
      const { rows } = await cliente.query(
        'select * from public.vw_assinaturas_a_conferir order by momento_servidor desc limit 200',
      )
      return { assinaturas: rows }
    })
  })

  /**
   * Fecha um período. Depois disso o campo não corrige mais nada dentro dele —
   * os números já viraram folha e conferência de diesel.
   */
  app.post('/painel/fechamentos/travar', async (requisicao, resposta) => {
    const identidade = exigirAdmin(requisicao, resposta)
    if (!identidade) return

    const corpo = requisicao.body as { de?: string; ate?: string; observacao?: string }
    if (!corpo?.de || !corpo?.ate) return resposta.code(400).send({ erro: 'CORPO_INVALIDO' })

    try {
      return await comoFuncionario(identidade, async (cliente) => {
        const { rows } = await cliente.query<{ fechamento_id: string; documentos: number }>(
          'select * from public.fn_travar_periodo($1::date, $2::date, $3)',
          [corpo.de, corpo.ate, corpo.observacao ?? null],
        )
        return rows[0]
      })
    } catch (erro) {
      const mensagem = erro instanceof Error ? erro.message : ''
      if (mensagem.includes('PERIODO_INVALIDO')) return resposta.code(400).send({ erro: 'PERIODO_INVALIDO' })
      throw erro
    }
  })

  app.post('/painel/fechamentos/reabrir', async (requisicao, resposta) => {
    const identidade = exigirAdmin(requisicao, resposta)
    if (!identidade) return

    const corpo = requisicao.body as { fechamento_id?: string; motivo?: string }
    if (!corpo?.fechamento_id) return resposta.code(400).send({ erro: 'CORPO_INVALIDO' })

    try {
      return await comoFuncionario(identidade, async (cliente) => {
        const { rows } = await cliente.query<{ fn_destravar_periodo: number }>(
          'select public.fn_destravar_periodo($1, $2)',
          [corpo.fechamento_id, corpo.motivo ?? ''],
        )
        return { documentos: rows[0]?.fn_destravar_periodo ?? 0 }
      })
    } catch (erro) {
      const mensagem = erro instanceof Error ? erro.message : ''
      // Reabrir o mês é excepcional: sem motivo escrito, não acontece.
      if (mensagem.includes('MOTIVO_OBRIGATORIO')) return resposta.code(400).send({ erro: 'MOTIVO_OBRIGATORIO' })
      if (mensagem.includes('FECHAMENTO_NAO_ENCONTRADO')) return resposta.code(404).send({ erro: 'NAO_ENCONTRADO' })
      throw erro
    }
  })

  app.post('/painel/fechamentos', async (requisicao, resposta) => {
    const identidade = exigirAdmin(requisicao, resposta)
    if (!identidade) return

    return comoFuncionario(identidade, async (cliente) => {
      const { rows } = await cliente.query('select * from public.vw_fechamentos order by de desc limit 100')
      return { fechamentos: rows }
    })
  })

  /** Lançamentos de um período, para conferência e exportação. */
  app.post('/painel/lancamentos', async (requisicao, resposta) => {
    const identidade = exigirAdmin(requisicao, resposta)
    if (!identidade) return

    const corpo = requisicao.body as { ficha?: string; de?: string; ate?: string }
    const de = corpo?.de ?? null
    const ate = corpo?.ate ?? null

    const consultas: Record<string, string> = {
      abastecimentos: `
        select a.*, f.numero as frota_numero, c.numero as comboio_numero
          from public.abastecimentos a
          join public.frotas f on f.id = a.frota_id
          left join public.frotas c on c.id = a.comboio_frota_id
         where not a.excluido
           and ($1::date is null or a.data >= $1::date)
           and ($2::date is null or a.data <= $2::date)
         order by a.data desc, a.numero_documento desc
         limit 1000`,
      caminhoes: `
        select c.*, v.numero as caminhao_numero, fz.codigo as fazenda_codigo, l.nome as lider_nome
          from public.caminhao_ciclos c
          join public.veiculos_transporte v on v.id = c.caminhao_id
          left join public.fazendas fz on fz.id = c.fazenda_id
          left join public.lideres l on l.id = c.lider_id
         where not c.excluido
           and ($1::date is null or c.data >= $1::date)
           and ($2::date is null or c.data <= $2::date)
         order by c.data desc, c.chegada_em desc
         limit 1000`,
      apontamentos: `
        select ap.*, fr.nome as frente_nome, t.nome as turno_nome,
               (select count(*) from public.apontamento_itens i
                 where i.apontamento_id = ap.id and not i.excluido) as itens
          from public.apontamentos ap
          join public.frentes fr on fr.id = ap.frente_id
          join public.turnos t on t.id = ap.turno_id
         where not ap.excluido
           and ($1::date is null or ap.data >= $1::date)
           and ($2::date is null or ap.data <= $2::date)
         order by ap.data desc
         limit 1000`,
    }

    const sql = consultas[corpo?.ficha ?? '']
    // A ficha vem do cliente e escolhe a consulta. Ela indexa um mapa fechado,
    // nunca é concatenada: é assim que esta rota não vira injeção de SQL.
    if (!sql) return resposta.code(400).send({ erro: 'FICHA_INVALIDA' })

    return comoFuncionario(identidade, async (cliente: Consultavel) => {
      const { rows } = await cliente.query(sql, [de, ate])
      return { linhas: rows }
    })
  })
}
