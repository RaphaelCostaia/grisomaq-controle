function exigir(nome: string): string {
  const valor = process.env[nome]
  if (!valor) {
    throw new Error(
      'Variável de ambiente ausente: ' + nome + '. Confira as variáveis do serviço no EasyPanel.',
    )
  }
  return valor
}

function opcional(nome: string, padrao: string): string {
  return process.env[nome] || padrao
}

/**
 * Configuração do servidor. Tudo vem do ambiente porque no EasyPanel é assim
 * que se configura um serviço — e porque segredo em arquivo versionado é
 * segredo vazado.
 */
export const config = {
  porta: Number(opcional('PORT', '3000')),
  host: opcional('HOST', '0.0.0.0'),

  /** URL do Postgres. No EasyPanel, o host é o nome do serviço do banco. */
  bancoUrl: exigir('DATABASE_URL'),

  /**
   * Papel que a API assume ao atender requisição de usuário. Ele NÃO tem
   * bypassrls: é isso que faz a RLS valer mesmo se houver bug na API.
   */
  papelUsuario: opcional('PAPEL_USUARIO', 'authenticated'),

  /** Segredo de assinatura do JWT (HS256). Gere com `openssl rand -base64 48`. */
  jwtSegredo: exigir('JWT_SEGREDO'),
  /** O access token é curto: a sessão longa vive no refresh token, revogável. */
  jwtMinutos: Number(opcional('JWT_MINUTOS', '60')),
  /**
   * Validade do refresh token. Precisa cobrir o pior caso de campo: um celular
   * que passa dias sem sinal e só sincroniza ao voltar para a sede.
   */
  refreshDias: Number(opcional('REFRESH_DIAS', '90')),

  /** Chave privada RSA (PKCS8, base64) da revalidação de assinaturas. */
  chavePrivadaAssinatura: process.env.CHAVE_PRIVADA_ASSINATURA ?? '',

  /** Origens liberadas no CORS, separadas por vírgula. */
  origens: opcional('ORIGENS_PERMITIDAS', 'http://localhost:5180')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),

  ambiente: opcional('NODE_ENV', 'production'),
}

export const ehDesenvolvimento = config.ambiente !== 'production'
