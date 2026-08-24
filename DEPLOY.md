# Implantação — Hostinger KVM 1 + EasyPanel

O sistema roda em **dois contêineres e um banco**:

| Serviço | O que é | Memória |
|---|---|---|
| `banco` | Postgres 17 | até ~1,5 GB |
| `api` | Node/Fastify — autenticação por PIN e sincronização | ~150 MB |
| `app` | nginx servindo o PWA compilado | ~20 MB |

Cabe com folga na KVM 1 (1 vCPU / 4 GB). A carga real é em rajadas curtas —
dezenas de celulares sincronizando ao voltar para a sede —, não tráfego
contínuo.

## Por que não o Supabase self-hosted

O app consome do backend apenas duas RPCs (`sync_push`, `sync_pull`) e quatro
rotas de autenticação. Não usa PostgREST para tabelas, nem Realtime, nem
Storage. O stack completo do Supabase sobe ~12 contêineres — Kong, GoTrue,
PostgREST, Realtime, Storage, imgproxy, Studio, edge-runtime, Logflare, Vector —
para servir essa superfície. Numa máquina de 1 vCPU, o Logflare sozinho já
compete por memória com o Postgres, e é justamente no pico de sincronização que
isso apareceria.

Todo o SQL é Postgres puro: schema, RLS, triggers e as funções de sync não
mudam. A API só faz o que o PostgREST fazia — assumir o papel `authenticated` e
publicar as reivindicações do JWT — em ~400 linhas.

---

## 1. Preparar os segredos

Na sua máquina:

```bash
node banco/gerar-chaves-assinatura.mjs
```

Guarde as três saídas. Gere também o segredo do JWT:

```bash
openssl rand -base64 48
```

## 2. Criar o banco no EasyPanel

Serviço → **Postgres**. Anote usuário, senha e nome do banco. Dentro da rede do
EasyPanel o host é o nome do serviço (ex.: `grisomaq_banco`).

Não exponha a porta do Postgres para a internet: a API fala com ele pela rede
interna, e uma porta 5432 aberta é o alvo mais varrido que existe.

## 3. Criar a API

Serviço → **App**, a partir do repositório Git.

- **Dockerfile:** `servidor/Dockerfile`
- **Build context:** raiz do repositório
- **Porta:** `3000`

Variáveis de ambiente:

```
DATABASE_URL=postgres://USUARIO:SENHA@NOME_DO_SERVICO_DO_BANCO:5432/grisomaq
JWT_SEGREDO=<saída do openssl>
CHAVE_PRIVADA_ASSINATURA=<privada gerada no passo 1>
ORIGENS_PERMITIDAS=https://controle.seudominio.com.br
NODE_ENV=production
```

As migrations são aplicadas sozinhas na subida do contêiner, uma por transação
e registradas ao serem aplicadas — reiniciar não reaplica nada. **Se uma
migration falhar, o serviço não sobe.** É proposital: atender com o esquema pela
metade faria o app de campo receber conflitos que não são conflitos.

Domínio: `api.seudominio.com.br`, com HTTPS ligado (Let's Encrypt).

## 4. Criar o app

Serviço → **App**, mesmo repositório.

- **Dockerfile:** `Dockerfile` (raiz)
- **Porta:** `80`

Aqui a diferença que costuma passar batido: as variáveis do PWA são **Build
Arguments**, não variáveis de ambiente. Elas são embutidas no bundle em tempo de
compilação; definidas como runtime, não chegam a lugar nenhum.

```
VITE_API_URL=https://api.seudominio.com.br
VITE_APP_VERSAO=0.1.0
VITE_CHAVE_PUBLICA_ASSINATURA=<pública gerada no passo 1>
```

Domínio: `controle.seudominio.com.br`, com HTTPS.

> **HTTPS não é opcional.** Sem certificado válido o navegador não instala o
> PWA, não libera o service worker e não expõe o WebCrypto — ou seja, o app não
> funciona offline nem consegue cifrar o PIN. Sem domínio, não há sistema.

## 5. Primeiro administrador

O provisionamento de funcionários exige um admin, e o primeiro precisa ser
criado à mão. No console SQL do banco:

```sql
insert into public.funcionarios (id, codigo, nome, papel, ativo)
values (gen_random_uuid(), '9001', 'Escritório', 'admin', true);

select public.fn_definir_pin(
  (select id from public.funcionarios where codigo = '9001'),
  '7194',          -- troque por um PIN que não seja sequência nem ano
  null,
  true             -- obriga a trocar no primeiro acesso
);
```

Desse ponto em diante tudo é feito pelo painel: entre em
`https://controle.seudominio.com.br` com o código `9001`, troque o PIN, e use
**Cadastros** para registrar frotas, fazendas, frentes, turnos e os blocos de
numeração, e **Funcionários** para gerar o PIN de cada um.

A ordem importa: enquanto os cadastros estiverem vazios, os seletores do app de
campo abrem sem opção, e sem um bloco de numeração alocado ao aparelho nenhum
abastecimento pode ser lançado.

## 6. Conferir

```bash
curl https://api.seudominio.com.br/saude
```

Deve responder `{"ok":true,...}`. Depois, abra o app no celular, entre com
código e PIN, e confirme que o navegador oferece "Adicionar à tela de início".

---

## Backup

**Isto não é opcional.** O sistema guarda a jornada e o abastecimento de uma
safra inteira; perder o banco significa perder a base da folha e da conferência
de diesel.

Os scripts estão prontos em `banco/`. O que falta é agendá-los na VPS — isso
depende do seu EasyPanel e ninguém pode fazer por você.

### Agendar o backup diário

No EasyPanel, serviço do Postgres → **Scheduled Tasks** (ou um `crontab -e` no
host), uma vez por dia de madrugada:

```bash
DATABASE_URL=postgres://USUARIO:SENHA@NOME_DO_SERVICO_DO_BANCO:5432/grisomaq DESTINO=/backups sh banco/backup.sh
```

O script não se limita a gerar o dump: ele **confere que o arquivo abre**
(`pg_restore --list`) e aborta se vier truncado ou com menos de cinco tabelas
com dados. Um dump que parece ter funcionado e está vazio é o pior caso — parece
sucesso e não é.

Retém 30 dias por padrão (`RETENCAO_DIAS`). A safra dura meses e o erro costuma
ser percebido dias depois.

### Tirar os dumps da máquina

Backup que mora no mesmo disco do banco não protege contra o disco morrer.
Aponte `/backups` para um volume externo, ou adicione um `rclone`/`aws s3 sync`
depois do script.

### Testar a restauração — antes de precisar

```bash
DATABASE_URL=postgres://...@banco-de-teste:5432/teste sh banco/restaurar.sh /backups/grisomaq_AAAA-MM-DD_HHMM.dump
```

Crie um **segundo** serviço Postgres no EasyPanel e restaure nele. O de produção
não é tocado, e no fim o script imprime a contagem de funcionários, frotas e
lançamentos para você conferir que veio tudo.

O script recusa restaurar por cima de um banco que já tem tabelas, a menos que
você passe `FORCAR=sim`. É proposital: restaurar no banco errado apagaria a
safra.

Backup nunca restaurado é esperança, não backup.

## Atualizações

O EasyPanel reconstrói e troca o contêiner a cada push. Dois cuidados:

- **Migrations são sempre aditivas.** Nunca renomeie nem remova coluna em uso:
  há celulares em campo com a versão anterior do app, e eles vão sincronizar
  depois. Deprecie por duas versões antes de remover.
- **`app_versao_minima`** (tabela `parametros`) é o freio de emergência: subir
  esse valor faz o servidor recusar lotes de apps velhos demais, e o app
  responde pedindo atualização em vez de tentar em laço.

## Rodar tudo local antes de publicar

```bash
cp .env.example .env
docker compose up --build
```

App em `http://localhost:8080`, API em `http://localhost:3000`.
