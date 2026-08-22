# GRISOMAQ CONTROLE

PWA offline-first que substitui as três fichas de campo da GrisoMaq Serviços Agrícolas:

| Aba | Substitui | Estado |
|---|---|---|
| Abastecimento | Bloco de papel carbonado numerado (ex.: nº 6901) | **Funcional offline** — lança, valida, assina e enfileira |
| Caminhões | `CONTROLE DE CAMINHÕES.xlsx` | **Funcional offline** — pátio ao vivo, chegada e saída |
| Apontamento | `FICHA_APONTAMENTO.xlsx` | **Funcional offline** — grade, assinaturas e fechamento |

O preenchimento é feito **pelo funcionário, no campo, pelo celular**, com sinal
intermitente. O escritório consolida num painel e exporta nos layouts originais.

## Como roda

Três serviços numa VPS Hostinger KVM 1, orquestrados pelo EasyPanel:

| Serviço | O que é |
|---|---|
| `banco` | Postgres 17 — schema, RLS, triggers e as funções de sincronização |
| `api` | Node/Fastify — autenticação por PIN e as duas RPCs de sync |
| `app` | nginx servindo o PWA compilado |

O passo a passo de implantação está em [DEPLOY.md](DEPLOY.md).

A API é pequena de propósito. Ela não é uma camada de negócio: a lógica de
idempotência, conflito e resolução de versão vive no Postgres, e a API apenas
assume o papel `authenticated` e publica as reivindicações do JWT — o mesmo
mecanismo que o PostgREST usa. Com isso a **RLS continua sendo a autoridade**:
a API roda com um usuário sem `bypassrls`, então nem um bug dela consegue ler
o que aquele funcionário não poderia.

## Como o app se comporta sem sinal

A UI nunca fala com a API. Toda escrita entra no IndexedDB (Dexie) dentro de
uma transação que grava o registro **e** um item de fila (`outbox`). Toda leitura
vem do Dexie. Um único módulo — o motor de sincronização — conhece a rede.

É isso que faz o app se comportar igual com e sem sinal, em vez de ter dois modos.
Consequência prática: o operador nunca espera a rede para salvar, e o app continua
funcionando integralmente mesmo dias offline (o JWT só é necessário no push).

## Rodando

```bash
npm install
cp .env.example .env
npm run dev                          # PWA em http://localhost:5180

cd servidor && npm install
DATABASE_URL=... JWT_SEGREDO=... npm run dev   # API em http://localhost:3000
```

Ou tudo junto, do jeito mais próximo da VPS:

```bash
docker compose up --build
```

## O que já funciona

Entrar com código + PIN, lançar um abastecimento completo sem nenhuma rede, e ver
a ficha na lista do dia marcada como “esperando sinal”. No caminho, o app:

- atribui o próximo número livre da faixa do bloco daquele celular;
- pré-preenche o Início Reg. com o fim da ficha anterior **do mesmo comboio**, e
  avisa se o operador mudar esse valor (é o salto que denuncia diesel sem
  lançamento);
- confere ao vivo `litros = final − início` da bomba, e exige um motivo escrito
  quando não bate;
- desabilita horímetro de elevador e hodômetro nas frotas que não os têm;
- mostra a última leitura conhecida de cada frota, com um toque para reusá-la;
- registra o aceite por PIN com o texto exato que estava na tela e o hash do
  documento assinado.

No **pátio**, ver quem está no campo agora com o cronômetro correndo, registrar
uma chegada em quatro toques e a saída em um. O app impede o mesmo caminhão de
entrar duas vezes sem ter saído, e avisa quando uma carreta consta em outro
rodotrem que ainda está no campo.

A permanência é o número que a planilha nunca pôde mostrar: no papel ela só
existiria se alguém subtraísse trezentas linhas à mão.

No **apontamento**, abrir a ficha do turno, lançar cada funcionário com frota e
leituras, colher as assinaturas no modo “passa o celular” e fechar. O seletor de
turno só oferece os turnos da escala daquela frente — algumas rodam 2 turnos,
outras 3. A ficha não fecha enquanto faltar assinatura ou leitura final, e a
tela diz exatamente o que falta.

## Exportação nos layouts originais

As três fichas saem em `.xlsx` reproduzindo a planilha que a GrisoMaq já usa:
mesmas colunas, mesma ordem, mesmas mesclagens e larguras, e as 25 linhas
numeradas do apontamento mesmo quando o turno teve oito pessoas. A fidelidade
não é capricho — o escritório confere o arquivo ao lado da via de papel.

O que o papel não tinha entra como coluna extra: a **permanência** dos caminhões
e a **diferença** entre os litros informados e o registrador da bomba, esta em
carmim quando passa da tolerância.

A coluna de assinatura traz a trilha real do aceite, e diz quando a revalidação
no servidor ainda não aconteceu — uma assinatura só conferida no celular vale
menos, e omitir a diferença seria afirmar mais do que se sabe.

A exportação roda **no celular**, a partir do que está gravado localmente: o
responsável fecha o turno na frente de colheita e manda a ficha por WhatsApp na
mesma hora, sem esperar a fila subir. O ExcelJS entra por `import()` dinâmico e
fica num chunk próprio, mas é precacheado pelo service worker de propósito —
sem isso a exportação exigiria sinal, justamente o que falta em campo. O preço é
uma instalação inicial maior, paga uma vez, no escritório.

Os arquivos de exemplo saem em `exemplos-relatorio/` ao rodar os testes.

## Painel do escritório

O escritório entra com o **mesmo código e PIN** do campo — não há segunda
credencial para lembrar. O papel no cadastro é que decide onde a pessoa cai.

- **Painel** — abre pelo que exige ação (lançamentos travados, celulares sem
  enviar, assinaturas a conferir, fichas com diferença de diesel) e só depois
  mostra tendência. Quem abre a tela de manhã precisa saber se algo quebrou
  antes de olhar gráfico.
- **Lançamentos travados** — o que o campo preencheu e o banco recusou, com o
  payload do operador e o que costuma resolver cada tipo de conflito. Marcar
  como resolvido só tira da fila; o lançamento em si é corrigido pela ficha.
- **Funcionários** — cadastro e provisionamento de PIN. O PIN inicial aparece
  uma vez, para ser impresso e entregue em mãos.

As cores das séries dos gráficos foram validadas para daltonismo contra o fundo
do painel, e evitam de propósito o carmim e as cores de estado: carmim é
identidade de documento, e verde/âmbar/vermelho significam "tudo bem / atenção /
erro". Reaproveitá-los como cor de série faria uma linha subindo parecer alerta.

## Verificação

```bash
npm run verificar
```

Roda, em ordem: typecheck do app e do servidor, os testes de domínio e da fila
local, a aplicação de todas as migrations num Postgres real, os testes de
comportamento do sync e os testes de integração da API.

### Testes de integração da API

`npm run servidor:testar` sobe o Fastify de verdade contra um Postgres real e
bate nas rotas por HTTP, exercitando JWT, `SET LOCAL ROLE`, publicação das
reivindicações, policies e as funções de sync.

O teste mais importante do arquivo é o de **vazamento de identidade no pool**:
requisições de dois funcionários intercaladas na mesma conexão. Se
`set_config` não estivesse amarrado à transação, a identidade do primeiro
sobreviveria e o segundo leria dados que não são dele — um vazamento silencioso,
que não aparece em log nem em erro.

### Por que o banco é testado sem Docker

`npm run db:validar` e `npm run db:testar` executam o esquema num Postgres de
verdade compilado para WASM (PGlite), com os papéis `authenticated`/`service_role`
e a RLS ligada. Migration que nunca foi executada não é migration, é rascunho — e
nem toda máquina de desenvolvimento tem Docker.

Isso **não** substitui subir a pilha real com `docker compose`. O que estes
scripts pegam é o que custa mais caro descobrir tarde. Dois exemplos reais,
achados por eles antes de qualquer deploy: o trigger que alimenta o histórico de
leituras rodava com a permissão do funcionário e era barrado pela própria RLS
(todo abastecimento falharia), e o `sync_push` marcava o status da operação com
um UPDATE que a RLS bloqueava em silêncio (conflito ficava gravado como
"aplicada", e o lançamento sumia da fila sem nunca ter entrado no banco).

## Estrutura

```
banco/
  migrations/        0100 tipos · 0200 mestres · 0300 as três fichas
                     0400 assinaturas/sync · 0500 triggers · 0600 views
                     0700 PIN · 0800 token hook · 0900 RLS · 1000 sync · 1100 parâmetros
  testes/sync.mjs    comportamento do motor: idempotência, conflito, RLS
  banco-de-teste.mjs Postgres em WASM, para validar o esquema sem Docker
servidor/
  src/banco.ts       pool + `comoFuncionario` (com RLS) e `comoServico` (sem)
  src/jwt.ts         emissão do access token e rotação do refresh
  src/rotas/         autenticação, sincronização, administração
  src/api.teste.ts   integração da API contra Postgres real
src/
  dominio/           tipos e regras de validação, sem dependência de UI
  dados/             Dexie, cliente da API, repositórios, motor de sincronização
  autenticacao/      login por código+PIN, sessão, PIN local
  componentes/ui/    teclado numérico, botão, marca — feitos para luva e sol
  telas/campo/       as três abas de lançamento
  telas/admin/       painel do escritório
  relatorios/        exportação Excel e PDF nos layouts das fichas originais
```

## Decisões que não são óbvias

**Chaves primárias nascem no celular** (UUIDv7, não v4). Sem isso nada poderia ser
criado offline. A v7 carrega o timestamp no prefixo, então a fila ordenada por id
fica em ordem cronológica — o cabeçalho do apontamento sobe antes dos itens dele.

**A API não é a autoridade de acesso; a RLS é.** Ela roda com um usuário sem
`bypassrls` e abre cada requisição assumindo o papel do funcionário. O
`set_config` é amarrado à transação de propósito: sem isso, a identidade
sobreviveria no pool e vazaria para a próxima requisição.

**O PIN de 4 dígitos vale como assinatura.** É proporcional à finalidade: substitui
uma rubrica a caneta. Os controles reais são a revalidação no servidor, a RLS que
limita o funcionário aos próprios lançamentos do dia, e a trilha imutável com
dispositivo, IP, geolocalização e hash do documento. O hash autoritativo do PIN
nunca sai do Postgres.

**Nenhum payload de campo é descartado.** Violação de constraint vira `conflito`
com código semântico e o payload fica guardado em `sync_operacoes` para o
escritório resolver. O operador preencheu; o dado sobrevive.

**Numeração do bloco é pré-alocada por dispositivo** (`blocos_abastecimento`, com
`EXCLUDE` impedindo faixas sobrepostas). É assim que dois celulares offline nunca
emitem o mesmo número de documento.

**Sem fontes externas.** O app precisa abrir idêntico sem rede. A personalidade
tipográfica vem da inversão de hierarquia: o número é o conteúdo (monoespaçado,
grande, tabular, como o contador mecânico de onde foi copiado) e o rótulo é o
andaime.
