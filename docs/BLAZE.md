# Blaze Brasil — provider HTTP pré-jogo

Implementação: `apps/odds-service/src/modules/blaze/`. Validação em 14/09/2026 (Brasil; capturas a partir de 15/09 UTC), sem login. Não depende de Chrome em execução, CDP, cookies ou credenciais. Bet365 e Betano continuam limitadas ao runtime local Mac/CDP.

## Transporte descoberto

A navegação normal de `https://blaze.bet.br/` → Esportes carrega o sportsbook Betby. A confirmação de idade e o consentimento foram feitos pela UI em um Chrome anônimo de investigação. Nenhum cookie dessa sessão foi transferido ao cliente HTTP.

Base observada: `https://api-31-sp-c7818b61-584.sptpub.com`.
Brand pública: `2480840120849276929`. Locale: `pt-BR`.

| GET | Função | Resultado HTTP direto |
|---|---|---|
| `/api/v4/prematch/brand/2480840120849276929/pt-BR/0` | Manifesto do snapshot | 200 JSON |
| `/api/v4/prematch/brand/2480840120849276929/pt-BR/{version}` | Partes indicadas pelo manifesto | 200 JSON |
| `/api/v3/descriptions/brand/2480840120849276929/markets/pt-BR` | Dicionário de mercados/outcomes | 200 JSON |
| `/api/v1/top/events/2480840120849276929/country/BR/currency/BRL/lang/pt-BR` | IDs de destaques; descoberta somente | 200 JSON |
| `/api/v4/prematch/brand/2480840120849276929/event/pt-BR/{eventId}` | Endpoint individual observado na UI | 403 no teste direto; **não utilizado** |

O cliente usa GET sem body, query, headers especiais, cookies, Authorization ou tokens. Recusa redirecionamentos e respostas não JSON. Não tenta novamente por outra estratégia após bloqueio. O hostname/brand são constantes específicas da Blaze, e podem exigir atualização se a integração pública mudar.

**O feed completo já contém mercados detalhados.** `collectEventDetails` obtém um novo snapshot completo e seleciona o evento pedido. Não depende do endpoint individual bloqueado e não reutiliza uma resposta antiga da listagem como se fosse uma nova captura. Não há acesso a endpoints de aposta ou conta.

## Snapshot completo e paginação

1. Ler manifesto `/0`.
2. Concatenar `top_events_versions` e `rest_events_versions`.
3. Ler cada versão indicada, sem construir tokens ou inventar versões.
4. Validar quantidade/ordem, epoch consistente, cadeia `version`, `fixtures_complete` e `snapshot_complete` na última parte.
5. Unir dicionário de torneios e eventos. Duplicata idêntica é deduplicada; duplicata conflitante invalida a captura.
6. Normalizar todos os esportes solicitados antes de publicar. Resposta vazia não é remoção autoritativa: falha preserva o catálogo anterior.

As requisições `other` do Chrome também carregam partes do feed; observar apenas fetch/XHR omite essas respostas. Não usamos deltas incrementais nesta versão: cada coleta começa pelo manifesto completo. A projeção arquivada filtra o esporte e os metadados úteis depois da validação completa. O teste de projeção exige saída normalizada idêntica à captura original.

## Campos do protocolo

| Campo bruto | Domínio |
|---|---|
| Chave `events[eventId]` | `eventId` string, identidade externa junto de `provider=blaze` |
| `desc.sport` | `109 → cs2`, `110 → lol`, `194 → valorant` |
| `desc.type` | Apenas `match`; classificações/stages não viram partidas |
| `desc.competitors[0/1].name` | teamA/teamB, rawTeamA/rawTeamB, normalização comum |
| `desc.competitors[].id` | Preservado em proveniência |
| `desc.tournament` / `tournaments[id].name` | ID bruto / tournament e rawTournament |
| `desc.category` | ID bruto da categoria em proveniência |
| `desc.scheduled` | Epoch segundos → startsAt ISO UTC |
| `state.status=0`, `state.match_status=0` | Partida pré-jogo ainda elegível; demais estados não são inferidos como finished |
| Chave de `markets` | `rawMarketId`, por exemplo `186` ou `330` |
| Chave interna `mapnr=1`, `mapnr=1\|hcp=-2.5` | Especificadores preservados; map extraído de `mapnr` |
| `186` sem especificadores | `match_winner` |
| `330` com `mapnr` positivo inteiro | `map_winner`; sem limite artificial de mapas |
| Chave do outcome `4` / `5` | `selectionId`; nome de competitor1 / competitor2 |
| Outcome `k` | Odd decimal; string original preservada em raw |
| Outcome `b=1` | Suspensão; ausência/0 indica oferta não bloqueada neste feed |
| `generated` da parte | Timestamp de origem preservado em `market.fetchedAt` |
| Hora da captura HTTP | `event.fetchedAt` e timestamp da publicação |

`marketId = rawMarketId + especificadores ordenados` quando existem especificadores. Assim `330:mapnr=1` e `330:mapnr=2` são distintos, sem perder `rawMarketId=330`. IDs de seleção são locais ao mercado: `4` não é uma seleção global.

Odds não numéricas, ausentes ou <=1 tornam-se null, preservando o valor bruto. Não se converte null em zero. Ambos os outcomes precisam existir nos mercados prioritários. Suspensão de todos os outcomes suspende o mercado. Estados não reconhecidos não viram disponibilidade afirmativa.

Mercados extras ficam `unknown`, preservando IDs, nome do dicionário, especificadores e outcomes. Linhas/nomes especializados dos mercados extras ainda não são interpretados; `line` permanece null e o valor original fica em raw. Isso é intencional neste escopo.

## Integração

- `BlazeService implements ProviderRuntime` (extensão de `OddsProvider`). Módulo possui client, collector, parser, store, controller, fixtures e testes próprios.
- Registry/CollectionModule incluem Blaze; `BLAZE_ENABLED` controla participação na agenda e impede coleta manual quando desabilitada.
- Discovery 300s; detalhe segue os intervalos compartilhados 60/30/5/1 minutos. `BLAZE_MAX_CONCURRENCY=1`; locks, timeout, backoff e circuit breaker existentes.
- Scope `blaze:list:{esport}:prematch` e `blaze:detail:{eventId}:prematch`; checkpoint `blaze:state`.
- PostgreSQL confirma antes de publicar arquivo/memória, pelo sistema existente. Seed idempotente cadastra `blaze / Blaze`; nenhuma tabela ou migration específica é necessária.
- Matching continua genérico. Quatro providers são suportados, sem aliases novos ou regras par-a-par. A validação isolada Blaze gera unmatched; o teste SQL comprova vínculos entre quatro providers usando peers controlados.
- Issues usam as validações existentes. Não foram criados detectores novos de outlier, queda de contagem ou estruturas desconhecidas; categorias previstas não significam que todos esses detectores existam.
- `EventRemoved` nunca significa `EventFinished`. Erro de transporte/parser preserva o último snapshot válido; TTL continua valendo.

## Execução e API

```sh
cd apps/odds-service
# Com PostgreSQL já configurado/migrado; não exige browser
BLAZE_ENABLED=true npm run capture:blaze -- --detail
# O scheduler normal inclui Blaze quando habilitado
npm start
```

Configuração: `BLAZE_ENABLED=true`, `BLAZE_MAX_CONCURRENCY=1`, `BLAZE_INBOX_DIR=blaze-inbox` (opcional). Timeouts e intervalos são os globais já documentados em [Collection](COLLECTION.md). Nenhuma credencial Blaze é necessária.

Endpoints GET: `/providers/blaze/events`, `/providers/blaze/events/:id`, `/providers/blaze/health`; aliases `matches` preservam o padrão dos outros módulos. Query opcional `esport=cs2|lol|valorant`. Dados stale retornam 503. `/health` inclui a agenda Blaze; health específico inclui eventCount e último detalhe. Não há novo endpoint de escrita.

## Evidência real

Snapshot elegível: **57 CS2 + 12 LoL + 11 Valorant = 80 partidas**. O feed bruto também contém eventos que não são partidas pré-jogo elegíveis; as contagens não incluem stages ou partidas já iniciadas.

| UI comparada | Vencedor da partida | Mapa 1 | Mapa 2 | Mapa 3 |
|---|---|---|---|---|
| CS2: Team Brute × G2 Ares | 1.70 / 2.08 | 1.87 / 1.87 | 1.67 / 2.12 | 1.80 / 1.94 |
| LoL: T1 Esports Academy × KT Rolster Challengers | 1.34 / 3.00 | Feed 1.50 / 2.46 | UI 1.50 / 2.46 | Feed 1.50 / 2.46 |
| Valorant: Gen.G GC × FENNEL Female | 1.51 / 2.42 | 1.59 / 2.24 | 1.59 / 2.24 | 1.66 / 2.12 |

Valores temporais, nunca hardcoded no parser. LoL também oferece mapas 4 e 5 na fixture real. A captura visual de LoL permite verificar vencedor da partida e mapa 2; não reivindicamos comparação visual de cada mercado extra.

Primeira validação SQL: dois ciclos, 60s de pausa entre eles e uma nova instância NestJS por ciclo. Ambos OK, três detalhes por ciclo (71 CS2, 32 LoL, 20 Valorant: **123 mercados detalhados**). Eventos/mercados/seleções permaneceram 80/3.119/6.238; snapshots cresceram 6.484 → 12.968; restart restaurou 80 eventos; API 200. Tempos 26,98s e 26,29s. Não houve mudança real de preço nessa janela; append-only e `1.70 → 1.68` são comprovados por teste controlado, sem modificar fixture real.

A versão final, com projeção dos arquivos publicados, foi validada em mais dois ciclos: **25,62s / 22,60s**, ambos OK, restaurando 80 eventos em cada startup. Entidades permaneceram 80/3.119/6.238; snapshots cumulativos chegaram a **25.936** após quatro ciclos. Checks finais: **127 testes offline aprovados + 4 opcionais ignorados; 24/24 SQL aprovados**. Build, typecheck e format:check passaram. Coleta encerrada após validação. Os ciclos reais foram manuais, com o scheduler desabilitado; por isso o estado da agenda em `/health` aparece como `starting`. Um teste de integração Nest separado executa listagem/detalhe pela agenda e comprova `/health` com Blaze `ok`.

Artefatos locais ignorados: `apps/odds-service/evidence/blaze-discovery/` (rede sanitizada e screenshots) e `evidence/blaze-validation*/report.json` (ciclos). A fixture versionada `fixtures/prematch.json` contém recorte real dos três esportes; não contém headers, cookies ou segredos. Manter o relatório local não exige publicar os arquivos temporários de investigação.

## Testes e limitações

`npm test`, `npm run test:db`, `npm run build`, `npm run typecheck`, `npm run format:check`. Testes normais são offline. Teste SQL requer banco descartável `_test` e cobre Blaze, seed, histórico, upsert e matching canônico junto das regressões existentes.

- HTTP funciona no Mac/rede testados. Validação real de Blaze em Railway/Linux ainda não realizada; não herdar conclusão de outros providers.
- Detalhe baixa snapshot completo: maior tráfego que um endpoint individual funcional. Não aumenta frequência nem adiciona browser. Coleta adaptativa continua sob o scheduler existente.
- Cobertura do snapshot completo validada; não há implementação do protocolo de deltas. Uma estrutura incompatível falha explicitamente.
- Sidebar externa da Blaze para Valorant mostrou uma rota sem esporte; a navegação pelo ícone Valorant do sportsbook carregou as partidas normalmente. A coleta HTTP não depende dessa navegação.
- O driver pg emitiu aviso de depreciação sobre queries concorrentes no mesmo client durante persistência existente. Testes e transações concluíram; não foi feita refatoração de PostgreSQL nesta tarefa.
