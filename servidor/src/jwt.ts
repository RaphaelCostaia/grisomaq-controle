import { createHash, randomBytes } from 'node:crypto'
import { SignJWT, jwtVerify } from 'jose'
import { config } from './config.ts'
import type { Consultavel, Identidade } from './banco.ts'

const segredo = new TextEncoder().encode(config.jwtSegredo)
const EMISSOR = 'grisomaq-controle'

/**
 * O access token carrega a identidade que a RLS lê. Ele é curto de propósito:
 * quem sustenta a sessão longa do celular é o refresh token, que pode ser
 * revogado quando um aparelho some.
 */
export async function assinarAcesso(identidade: Identidade): Promise<string> {
  return new SignJWT({ app_metadata: identidade })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(EMISSOR)
    .setSubject(identidade.funcionario_id)
    .setIssuedAt()
    .setExpirationTime(config.jwtMinutos + 'm')
    .sign(segredo)
}

export async function verificarAcesso(token: string): Promise<Identidade> {
  const { payload } = await jwtVerify(token, segredo, { issuer: EMISSOR })
  const identidade = payload.app_metadata as Identidade | undefined
  if (!identidade?.funcionario_id) throw new Error('TOKEN_SEM_IDENTIDADE')
  return identidade
}

// --- Refresh token -----------------------------------------------------------

/**
 * O refresh token é opaco e aleatório, e o banco guarda apenas o SHA-256 dele.
 *
 * Guardar o valor em claro daria a quem lesse a tabela o poder de emitir sessão
 * em nome de qualquer funcionário — e o backup do banco sai da máquina.
 */
export function novoRefresh(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url')
  return { token, hash: hashDeRefresh(token) }
}

export function hashDeRefresh(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export async function registrarSessao(
  cliente: Consultavel,
  funcionarioId: string,
  hash: string,
  dispositivoId: string | null,
): Promise<void> {
  await cliente.query(
    `insert into public.sessoes (id, funcionario_id, refresh_hash, dispositivo_id, expira_em)
     values (gen_random_uuid(), $1, $2, $3, now() + ($4 || ' days')::interval)`,
    [funcionarioId, hash, dispositivoId, String(config.refreshDias)],
  )
}

export interface SessaoEncontrada {
  id: string
  funcionario_id: string
}

/**
 * Troca um refresh token por uma sessão válida, rotacionando-o.
 *
 * A rotação tem uma janela de reuso curta: em rede instável, duas requisições
 * sobem quase juntas e a segunda chega com o token já rotacionado. Invalidar a
 * sessão nesse caso derrubaria o funcionário no meio do turno por um problema
 * que é do sinal, não dele.
 */
export async function trocarRefresh(
  cliente: Consultavel,
  token: string,
): Promise<SessaoEncontrada | null> {
  const hash = hashDeRefresh(token)

  const { rows } = await cliente.query<SessaoEncontrada>(
    `select id, funcionario_id
       from public.sessoes
      where refresh_hash = $1
        and revogada_em is null
        and expira_em > now()
      limit 1`,
    [hash],
  )

  const atual = rows[0]
  if (atual) return atual

  // Token já rotacionado há pouco: aceita, sem emitir sessão nova.
  const { rows: recentes } = await cliente.query<SessaoEncontrada>(
    `select id, funcionario_id
       from public.sessoes
      where refresh_anterior_hash = $1
        and revogada_em is null
        and rotacionada_em > now() - interval '60 seconds'
      limit 1`,
    [hash],
  )

  return recentes[0] ?? null
}

export async function rotacionarSessao(
  cliente: Consultavel,
  sessaoId: string,
  novoHash: string,
  hashAnterior: string,
): Promise<void> {
  await cliente.query(
    `update public.sessoes
        set refresh_anterior_hash = $3,
            refresh_hash = $2,
            rotacionada_em = now(),
            ultimo_uso_em = now()
      where id = $1`,
    [sessaoId, novoHash, hashAnterior],
  )
}

export async function revogarSessoesDoFuncionario(
  cliente: Consultavel,
  funcionarioId: string,
): Promise<void> {
  await cliente.query(
    `update public.sessoes set revogada_em = now()
      where funcionario_id = $1 and revogada_em is null`,
    [funcionarioId],
  )
}
