# Implantação — Hostinger KVM 1 + EasyPanel

O sistema roda em **dois contêineres**:

| Serviço | O que é | Memória |
|---|---|---|
| `banco` | Postgres 17 | até ~1,5 GB |
| `web` | Node/Fastify servindo PWA + API no mesmo endereço | ~200 MB |

Cabe com folga na KVM 1 (1 vCPU / 4 GB). A carga real é em rajadas curtas —
dezenas de celulares sincronizando ao voltar para a sede —, não tráfego
contínuo.

## Um serviço para os dois

App e API saem do **mesmo endereço**. Isso muda três coisas:

- **Sem CORS.** O navegador nunca faz cross-origin, então nenhuma configuração
  extra é necessária.
- **Um túnel HTTPS cobre tudo.** Instalar um PWA e mantê-lo offline exige
  contexto seguro, e um domínio só é um problema só.
- **Um deploy só.** Uma imagem, um serviço no EasyPanel, um domínio, um
  certificado. Menos coisa para monitorar.

Se um dia o volume crescer a ponto de justificar API dedicada, dá para
desmembrar: a arquitetura interna já está pronta para isso.

## Por que não o Supabase self-hosted

O app consome do backend apenas duas RPCs (`sync_push`, `sync_pull`) e algumas
rotas de autenticação. O stack completo do Supabase sobe ~12 contêineres —
Kong, GoTrue, PostgREST, Realtime, Storage, imgproxy, Studio, edge-runtime,
Logflare, Vector — para servir essa superfície. Numa máquina de 1 vCPU, o
Logflare sozinho competiria com o Postgres pela memória no pico de
sincronização.

Todo o SQL é Postgres puro: schema, RLS, triggers e as funções de sync não
mudam. O servidor Fastify faz o que o PostgREST fazia — assumir o papel
`authenticated` e publicar as reivindicações do JWT — em ~500 linhas.

---

## 1. Preparar os segredos

Uma única vez, na sua máquina:

```bash
node banco/gerar-chaves-assinatura.mjs
```

**Guarde a saída inteira.** Ela imprime três coisas:

- **`VITE_CHAVE_PUBLICA_ASSINATURA`** — vai para o BUILD do PWA
- **`CHAVE_PRIVADA_ASSINATURA`** — vai para a API em runtime, nunca no bundle
- **`JWT_SEGREDO`** — vai para a API em runtime

Trocar as chaves depois **descarta** as assinaturas ainda na fila dos
celulares. Gere uma vez, guarde num cofre e não mexa mais.

## 2. Criar o banco no EasyPanel

Serviço → **Postgres**. Escolha nome, usuário, senha, banco. Anote os quatro:

- Nome do serviço (ex.: `grisomaq_banco`) — é o host DNS interno
- Usuário (ex.: `grisomaq`)
- Senha (escolha uma forte)
- Nome do banco (ex.: `grisomaq`)

**Não exponha a porta 5432 para a internet.** A API fala com o Postgres pela
rede interna do EasyPanel.

## 3. Criar o serviço web

Serviço → **App**, a partir do repositório Git.

- **Source:** o repositório `Grisomaq-Controle`, branch `main`
- **Build Method:** Dockerfile
- **Dockerfile Path:** `Dockerfile` (raiz)
- **Porta:** `3000`

### Build Arguments (embutidos no PWA em tempo de compilação)

```
VITE_API_URL=
VITE_APP_VERSAO=0.1.0
VITE_CHAVE_PUBLICA_ASSINATURA=<a que o gerador imprimiu>
```

O `VITE_API_URL` vazio de propósito: o cliente usa **caminhos relativos**
porque tudo vem do mesmo endereço. Se você preencher com um domínio, o app
tenta falar com esse outro domínio e nada funciona.

### Environment Variables (só no servidor, nunca no bundle)

```
NODE_ENV=production
DATABASE_URL=postgres://USUARIO:SENHA@NOME_DO_SERVICO_DO_BANCO:5432/grisomaq
JWT_SEGREDO=<o gerado>
CHAVE_PRIVADA_ASSINATURA=<a privada do gerador>
ORIGENS_PERMITIDAS=*
```

As migrations são aplicadas sozinhas na subida do contêiner, uma por transação
e registradas ao serem aplicadas — reiniciar não reaplica nada. **Se uma
migration falhar, o serviço não sobe.** É proposital: atender com o esquema
pela metade faria o app de campo receber conflitos que não são conflitos.

### Domínio

Use o subdomínio gratuito do EasyPanel para começar — algo como
`grisomaq-web.projetos.easypanel.host`. Ligue o HTTPS (Let's Encrypt).

Quando o domínio próprio (`controle.grisomaq.com.br`, por exemplo) estiver
disponível, adicione como segundo domínio no mesmo serviço. Não precisa
rebuildar nada: o app usa caminhos relativos.

> **HTTPS não é opcional.** Sem certificado válido o navegador não instala o
> PWA, não libera o service worker e não expõe o WebCrypto — ou seja, o app
> não funciona offline nem cifra o PIN. Sem HTTPS, não há sistema.

## 4. Primeiro administrador

O provisionamento de funcionários exige um admin, e o primeiro precisa ser
criado à mão. No console SQL do banco (EasyPanel → Postgres → Console):

```sql
insert into public.funcionarios (id, codigo, nome, papel, ativo)
values (gen_random_uuid(), '9001', 'Escritório', 'admin', true);

-- Troque '7196' por um PIN de 4 dígitos que NÃO seja sequência (1234) nem
-- ano de nascimento nem dígitos repetidos (1111). O sistema recusa esses.
select public.fn_definir_pin(
  (select id from public.funcionarios where codigo = '9001'),
  '7196',
  null,
  true             -- obriga a trocar no primeiro acesso
);
```

## 5. Conferir

```bash
curl https://SEU_DOMINIO/saude
```

Deve responder `{"ok":true,...}`.

Depois entre no navegador com o código `9001` e o PIN escolhido — a tela vai
pedir que você defina um novo PIN, esse será o de verdade. Vá para
**Cadastros** e registre frotas, fazendas, frentes, turnos e os blocos de
numeração. Depois vá em **Funcionários** e gere um PIN para cada operador
(o sistema imprime a folha para entrega).

A ordem importa: enquanto os cadastros estiverem vazios, os seletores do app
de campo abrem sem opção, e sem um bloco de numeração alocado ao aparelho
nenhum abastecimento pode ser lançado.

## 6. No celular

Abra o mesmo endereço, entre com o código do operador, e o Chrome (Android)
ou o Safari (iPhone) oferece **Adicionar à Tela de Início** / **Instalar
aplicativo**. Instale. Feche. Abra pelo ícone. Ligue o modo avião e abra
de novo — se abrir e mostrar a tela do dia, o sistema serve para campo.

---

## Backup

**Isto não é opcional.** O sistema guarda a jornada e o abastecimento de uma
safra inteira; perder o banco significa perder a base da folha e da
conferência de diesel.

Os scripts estão prontos em `banco/`. O que falta é agendá-los na VPS — isso
depende do seu EasyPanel e ninguém pode fazer por você.

### Agendar o backup diário

No EasyPanel, serviço do Postgres → **Scheduled Tasks** (ou `crontab -e` no
host), uma vez por dia de madrugada:

```bash
DATABASE_URL=postgres://USUARIO:SENHA@NOME_DO_SERVICO_DO_BANCO:5432/grisomaq DESTINO=/backups sh banco/backup.sh
```

O script **confere que o arquivo abre** (`pg_restore --list`) e aborta se
vier truncado ou com menos de cinco tabelas com dados. Um dump que parece ter
funcionado e está vazio é o pior caso — parece sucesso e não é.

Retém 30 dias por padrão (`RETENCAO_DIAS`). A safra dura meses e o erro
costuma ser percebido dias depois.

### Tirar os dumps da máquina

Backup que mora no mesmo disco do banco não protege contra o disco morrer.
Aponte `/backups` para um volume externo, ou adicione um `rclone`/`aws s3 sync`
depois do script.

### Testar a restauração — antes de precisar

```bash
DATABASE_URL=postgres://...@banco-de-teste:5432/teste sh banco/restaurar.sh /backups/grisomaq_AAAA-MM-DD_HHMM.dump
```

Crie um **segundo** serviço Postgres no EasyPanel e restaure nele. O de
produção não é tocado, e no fim o script imprime a contagem de funcionários,
frotas e lançamentos para você conferir que veio tudo.

O script recusa restaurar por cima de um banco que já tem tabelas, a menos
que você passe `FORCAR=sim`. É proposital: restaurar no banco errado apagaria
a safra.

Backup nunca restaurado é esperança, não backup.

## Atualizações

O EasyPanel reconstrói e troca o contêiner a cada push na branch conectada.
Dois cuidados:

- **Migrations são sempre aditivas.** Nunca renomeie nem remova coluna em
  uso: há celulares em campo com a versão anterior do app, e eles vão
  sincronizar depois. Deprecie por duas versões antes de remover.
- **`app_versao_minima`** (tabela `parametros`, editável em Cadastros →
  Parâmetros): é o freio de emergência. Subir esse valor faz o servidor
  recusar lotes de apps velhos demais, e o app responde pedindo atualização
  em vez de tentar em laço.

## Rodar tudo local antes de publicar

```bash
cp .env.example .env
docker compose up --build
```

Sistema completo em `http://localhost:8080`.
