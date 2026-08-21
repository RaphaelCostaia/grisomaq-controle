# GRISOMAQ CONTROLE

PWA offline-first que substitui as três fichas de campo da GrisoMaq Serviços Agrícolas:

| Aba | Substitui | Estado |
|---|---|---|
| Abastecimento | Bloco de papel carbonado numerado (ex.: nº 6901) | **Funcional offline** — lança, valida, assina e enfileira |
| Caminhões | `CONTROLE DE CAMINHÕES.xlsx` | **Funcional offline** — pátio ao vivo, chegada e saída |
| Apontamento | `FICHA_APONTAMENTO.xlsx` | **Funcional offline** — grade, assinaturas e fechamento |

O preenchimento é feito **pelo funcionário, no campo, pelo celular**, com sinal
intermitente. O escritório consolida num painel e exporta nos layouts originais.

## Como o app se comporta sem sinal

A UI nunca fala com o Supabase. Toda escrita entra no IndexedDB (Dexie) dentro de
uma transação que grava o registro **e** um item de fila (`outbox`). Toda leitura
vem do Dexie. Um único módulo — o motor de sincronização — conhece a rede.

É isso que faz o app se comportar igual com e sem sinal, em vez de ter dois modos.
Consequência prática: o operador nunca espera a rede para salvar, e o app continua
funcionando integralmente mesmo dias offline (o JWT só é necessário no push).

## Rodando

```bash
npm install
cp .env.example .env   # preencher com a URL e a anon key do projeto Supabase
npm run dev
```

O app sobe em `http://localhost:5180`.

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

## Verificação

```bash
npm run verificar
```

Roda, em ordem: typecheck, os testes de domínio e da fila local, a aplicação de
todas as migrations num Postgres real e os testes de comportamento do sync.

### Por que o banco é testado sem Docker

`npm run db:validar` e `npm run db:testar` executam o esquema num Postgres de
verdade compilado para WASM (PGlite), com os papéis `authenticated`/`service_role`
e a RLS ligada. Migration que nunca foi executada não é migration, é rascunho — e
nem toda máquina de desenvolvimento tem Docker.

Isso **não** substitui `supabase db reset` no ambiente real, que tem GoTrue,
Storage e o Custom Access Token Hook. O que estes scripts pegam é o que custa mais
caro descobrir tarde. Dois exemplos reais, achados por eles antes de qualquer
deploy: o trigger que alimenta o histórico de leituras rodava com a permissão do
funcionário e era barrado pela própria RLS (todo abastecimento falharia), e o
`sync_push` marcava o status da operação com um UPDATE que a RLS bloqueava em
silêncio (conflito ficava gravado como "aplicada", e o lançamento sumia da fila
sem nunca ter entrado no banco).

## Estrutura

```
supabase/
  migrations/        0100 tipos · 0200 mestres · 0300 as três fichas
                     0400 assinaturas/sync · 0500 triggers · 0600 views
                     0700 PIN · 0800 token hook · 0900 RLS · 1000 sync · 1100 parâmetros
  testes/sync.mjs    comportamento do motor: idempotência, conflito, RLS
  banco-de-teste.mjs Postgres em WASM + stubs do que o Supabase dá em runtime
src/
  dominio/           tipos e regras de validação (Zod), sem dependência de UI
  dados/             Dexie, cliente Supabase, repositórios, motor de sincronização
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
