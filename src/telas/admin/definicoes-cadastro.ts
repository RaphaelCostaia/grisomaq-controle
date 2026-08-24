import { chamar } from '@/dados/api'

/**
 * Definição das telas de cadastro.
 *
 * Uma descrição de campos em vez de sete telas quase iguais. O que muda entre
 * frota e turno é a lista de campos, não a mecânica de listar, editar e salvar.
 *
 * As descrições não são enfeite: `tem_horimetro_elevador` decide se o campo de
 * elevador aparece habilitado na ficha do operador, e quem preenche o cadastro
 * precisa saber disso na hora de marcar a caixa.
 */
export type TipoCampo = 'texto' | 'numero' | 'inteiro' | 'booleano' | 'hora' | 'opcao' | 'referencia'

export interface Campo {
  nome: string
  rotulo: string
  tipo: TipoCampo
  descricao?: string
  obrigatorio?: boolean
  opcoes?: Array<{ valor: string; rotulo: string }>
  /** Para `referencia`: de qual cadastro vêm as opções. */
  referencia?: 'frentes' | 'fazendas' | 'frotas' | 'funcionarios'
  /** Coluna mostrada na tabela de listagem. */
  naLista?: boolean
}

export interface Cadastro {
  chave: string
  titulo: string
  descricao: string
  campos: Campo[]
}

const ATIVO: Campo = {
  nome: 'ativo',
  rotulo: 'Ativo',
  tipo: 'booleano',
  descricao: 'Inativo some dos seletores do app, mas o histórico é preservado.',
  naLista: true,
}

const ESCALAS = [
  { valor: '3_turnos', rotulo: '3 turnos' },
  { valor: '2_turnos', rotulo: '2 turnos' },
]

export const CADASTROS: Cadastro[] = [
  {
    chave: 'frotas',
    titulo: 'Frotas',
    descricao: 'O parque de máquinas. Os três indicadores abaixo decidem quais campos o operador enxerga na ficha.',
    campos: [
      { nome: 'numero', rotulo: 'Número', tipo: 'texto', obrigatorio: true, naLista: true },
      { nome: 'descricao', rotulo: 'Descrição', tipo: 'texto', obrigatorio: true, naLista: true },
      {
        nome: 'tipo',
        rotulo: 'Tipo',
        tipo: 'opcao',
        obrigatorio: true,
        naLista: true,
        opcoes: [
          { valor: 'colhedora', rotulo: 'Colhedora' },
          { valor: 'trator', rotulo: 'Trator' },
          { valor: 'caminhao', rotulo: 'Caminhão' },
          { valor: 'comboio', rotulo: 'Comboio' },
          { valor: 'transbordo', rotulo: 'Transbordo' },
          { valor: 'outro', rotulo: 'Outro' },
        ],
      },
      {
        nome: 'tem_horimetro_motor',
        rotulo: 'Tem horímetro de motor',
        tipo: 'booleano',
        descricao: 'Se desmarcado, o campo aparece desabilitado na ficha de abastecimento.',
      },
      {
        nome: 'tem_horimetro_elevador',
        rotulo: 'Tem horímetro de elevador',
        tipo: 'booleano',
        descricao: 'Colhedoras têm. É esta leitura que mede colheita efetiva.',
      },
      { nome: 'tem_odometro', rotulo: 'Tem hodômetro', tipo: 'booleano' },
      {
        nome: 'capacidade_tanque_litros',
        rotulo: 'Capacidade do tanque (L)',
        tipo: 'numero',
        descricao: 'Abastecimento acima de 115% disto é bloqueado como erro de digitação.',
      },
      { nome: 'consumo_esperado_litros_hora', rotulo: 'Consumo esperado (L/h)', tipo: 'numero' },
      { nome: 'consumo_esperado_km_litro', rotulo: 'Consumo esperado (km/L)', tipo: 'numero' },
      { nome: 'frente_id', rotulo: 'Frente', tipo: 'referencia', referencia: 'frentes' },
      ATIVO,
    ],
  },
  {
    chave: 'veiculos',
    titulo: 'Caminhões e carretas',
    descricao: 'A frota de transporte, geralmente terceirizada. Cavalo 12 e carreta 12 são veículos diferentes.',
    campos: [
      { nome: 'numero', rotulo: 'Número', tipo: 'texto', obrigatorio: true, naLista: true },
      {
        nome: 'tipo',
        rotulo: 'Tipo',
        tipo: 'opcao',
        obrigatorio: true,
        naLista: true,
        opcoes: [
          { valor: 'cavalo', rotulo: 'Cavalo' },
          { valor: 'carreta', rotulo: 'Carreta' },
        ],
      },
      { nome: 'placa', rotulo: 'Placa', tipo: 'texto', naLista: true },
      { nome: 'transportadora', rotulo: 'Transportadora', tipo: 'texto', naLista: true },
      ATIVO,
    ],
  },
  {
    chave: 'fazendas',
    titulo: 'Fazendas',
    descricao: 'A coluna "CÓDIGO" da ficha de caminhões.',
    campos: [
      { nome: 'codigo', rotulo: 'Código', tipo: 'texto', obrigatorio: true, naLista: true },
      { nome: 'nome', rotulo: 'Nome', tipo: 'texto', obrigatorio: true, naLista: true },
      { nome: 'municipio', rotulo: 'Município', tipo: 'texto', naLista: true },
      ATIVO,
    ],
  },
  {
    chave: 'frentes',
    titulo: 'Frentes',
    descricao: 'A escala define quais turnos aparecem para o responsável ao abrir a ficha de apontamento.',
    campos: [
      { nome: 'codigo', rotulo: 'Código', tipo: 'texto', obrigatorio: true, naLista: true },
      { nome: 'nome', rotulo: 'Nome', tipo: 'texto', obrigatorio: true, naLista: true },
      { nome: 'fazenda_id', rotulo: 'Fazenda', tipo: 'referencia', referencia: 'fazendas', naLista: true },
      {
        nome: 'escala',
        rotulo: 'Escala',
        tipo: 'opcao',
        obrigatorio: true,
        naLista: true,
        opcoes: ESCALAS,
        descricao: 'Algumas frentes rodam 2 turnos, outras 3.',
      },
      ATIVO,
    ],
  },
  {
    chave: 'turnos',
    titulo: 'Turnos',
    descricao: 'Os horários alimentam a validação de horas de elevador do apontamento.',
    campos: [
      { nome: 'codigo', rotulo: 'Código', tipo: 'texto', obrigatorio: true, naLista: true },
      { nome: 'nome', rotulo: 'Nome', tipo: 'texto', obrigatorio: true, naLista: true },
      { nome: 'escala', rotulo: 'Escala', tipo: 'opcao', obrigatorio: true, naLista: true, opcoes: ESCALAS },
      { nome: 'hora_inicio', rotulo: 'Início', tipo: 'hora', obrigatorio: true, naLista: true },
      { nome: 'hora_fim', rotulo: 'Fim', tipo: 'hora', obrigatorio: true, naLista: true },
      { nome: 'duracao_horas', rotulo: 'Duração (h)', tipo: 'numero', obrigatorio: true },
      {
        nome: 'vira_dia',
        rotulo: 'Atravessa a meia-noite',
        tipo: 'booleano',
        descricao: 'A ficha continua sendo a do dia em que o turno começou.',
      },
      ATIVO,
    ],
  },
  {
    chave: 'lideres',
    titulo: 'Líderes do malhador',
    descricao: 'O líder às vezes é da transportadora, e não do quadro da GrisoMaq — por isso o vínculo é opcional.',
    campos: [
      { nome: 'codigo', rotulo: 'Código', tipo: 'texto', naLista: true },
      { nome: 'nome', rotulo: 'Nome', tipo: 'texto', obrigatorio: true, naLista: true },
      { nome: 'funcionario_id', rotulo: 'Funcionário', tipo: 'referencia', referencia: 'funcionarios' },
      ATIVO,
    ],
  },
  {
    chave: 'blocos',
    titulo: 'Blocos de numeração',
    descricao:
      'A faixa de números que cada celular pode emitir na ficha de abastecimento. É o que impede dois aparelhos offline de gerarem o mesmo número — por isso faixas não podem se sobrepor.',
    campos: [
      { nome: 'numero_inicial', rotulo: 'Número inicial', tipo: 'inteiro', obrigatorio: true, naLista: true },
      { nome: 'numero_final', rotulo: 'Número final', tipo: 'inteiro', obrigatorio: true, naLista: true },
      {
        nome: 'dispositivo_id',
        rotulo: 'Aparelho',
        tipo: 'texto',
        naLista: true,
        descricao: 'O identificador aparece na tela de envio do celular, em "Bloco deste celular".',
      },
      { nome: 'funcionario_id', rotulo: 'Funcionário', tipo: 'referencia', referencia: 'funcionarios', naLista: true },
      { nome: 'comboio_frota_id', rotulo: 'Comboio', tipo: 'referencia', referencia: 'frotas' },
      ATIVO,
    ],
  },
]

export const listarCadastro = (cadastro: string) =>
  chamar<{ registros: Array<Record<string, unknown>> }>('/painel/cadastros/listar', {
    corpo: { cadastro },
  }).then((r) => r.registros)

export const salvarCadastro = (cadastro: string, registro: Record<string, unknown>, id?: string) =>
  chamar<{ registro: Record<string, unknown> }>('/painel/cadastros/salvar', {
    corpo: id ? { cadastro, id, registro } : { cadastro, registro },
  })

/**
 * Grava um limiar de validação.
 *
 * Parâmetro não é cadastro: não se cria nem se apaga, só se ajusta. Por isso
 * tem endpoint próprio, que só aceita chave existente.
 */
export const salvarParametro = (chave: string, valor: unknown) =>
  chamar<{ parametro: { chave: string; valor: unknown } }>('/painel/parametros/salvar', {
    corpo: { chave, valor },
  })

/** Mensagens para os erros que o banco recusa por regra de negócio. */
export const MOTIVO_DA_RECUSA: Record<string, string> = {
  FAIXA_SOBREPOSTA:
    'Esta faixa invade outro bloco já cadastrado. Duas faixas sobrepostas fariam dois celulares emitirem o mesmo número de ficha.',
  FAIXA_INVALIDA: 'O número final precisa ser maior ou igual ao inicial.',
  JA_EXISTE: 'Já existe um registro com este código ou número.',
  DURACAO_INVALIDA: 'A duração precisa estar entre 0 e 24 horas.',
  VINCULO_INEXISTENTE: 'Um dos vínculos escolhidos não existe mais. Recarregue a página.',
  CAMPOS_OBRIGATORIOS: 'Preencha os campos obrigatórios.',
}
