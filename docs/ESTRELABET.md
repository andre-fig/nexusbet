# EstrelaBet — provider HTTP pré-jogo

[Providers](PROVIDERS.md) · [Collection](COLLECTION.md) · [Histórico](ODDS_HISTORY.md)

Implementação independente em `apps/odds-service/src/modules/estrelabet`. `EstrelaBetService` implementa `ProviderRuntime`/`OddsProvider`; produz `NormalizedEvent`, `Market` e `Selection` existentes. Não importa parsers/clientes de outros bookmakers, nem usa browser na coleta regular.

## Transporte comprovado

Investigação anônima pela navegação da aplicação em `https://www.estrelabet.bet.br/`, seção eSports e detalhes. O frontend utiliza Altenar. Requisições de leitura reproduzidas com **fetch nativo do Node, sem login, Cookie, Authorization, token, assinatura, Origin, Referer ou User-Agent customizado** retornaram HTTP 200. Não foi necessário ler credentials.txt.

Base: `https://sb2frontend-altenar2.biahosted.com/api/widget/`

Parâmetros comuns observados e usados:

```text
culture=pt-BR
timezoneOffset=180
integration=estrelabet
deviceType=1
numFormat=en-GB
```

Os espaços acima são apenas formatação. O frontend também emite `countryCode=BR`, dispensável nas chamadas HTTP validadas. Todos os endpoints abaixo são GET, sem body. Não há headers especiais configurados. Redirects, HTTP não-2xx e respostas não-JSON causam falha; não há fallback de browser ou replay de sessão.

| Endpoint | Parâmetros adicionais | Utilização |
|---|---|---|
| `GetUpcoming` | `sportId=145&eventCount=20`, depois `page=2..pageCount` | Coleta regular de listagem, todas as páginas |
| `GetEventDetails` | `eventId=<ID>&showNonBoosts=false` | Coleta regular de detalhe |
| `GetSportMenu` | `period=0` | Descoberta dos IDs; não necessário no polling |
| `GetTopEvents` | `sportId=145&eventCount=0&timePeriod=0` | Observado; subconjunto, não usado como catálogo |
| `GetCouponEvents` | `sportId=145&eventCount=0&couponType=3` | Observado na UI; depende de data/filtros, não usado |

A paginação declara `page` e `pageCount`. A primeira página observada foi 1, com quatro páginas; o parâmetro `page` foi validado diretamente por HTTP. O client exige páginas consecutivas e `pageCount` constante (limite defensivo 100), abortando a rodada se mudar. Não existe token de snapshot que garanta atomicidade remota entre páginas: validação local rejeita conflitos e preserva a última publicação válida.

A cobertura é **a oferta retornada por GetUpcoming**, filtrada pelos três esports e status pré-jogo. Contadores de menus, live, outros jogos e cards TopEvents não são intercambiáveis com esse catálogo; não se promete enumerar toda oferta de qualquer outra seção do site.

## Protocolo e mapeamento

`events`, `markets`, `odds`, `competitors` e `champs` são tabelas de objetos ligadas por IDs na listagem. No detalhe o evento está na raiz, com `sport`, `category`, `champ`, `competitors`, `marketGroups`, `markets` e `odds`.

| Campo | Significado / domínio |
|---|---|
| `sportId=145` / `sport.id` | eSports Altenar, não modalidade individual |
| `catId` / `category.id` | 1534 = CS2; 1531 = LoL; 1532 = Valorant |
| `champId` / `champ.id` | Competição; nome de `champs`/`champ` |
| `event.id` | `eventId` string; `feedEventId`/`extId` permanecem em raw quando presentes |
| `competitorIds` | Referências ordenadas dos dois times na listagem |
| `competitors[].name` | Nomes brutos; normalização usa o utilitário comum, preservando raw |
| `startDate` | ISO UTC; convertido sem perder timezone |
| `events[].status=0` | Pré-jogo; status 1 observado em live é excluído |
| `marketIds` | Referências de mercados de cada evento/grupo |
| `market.id` | `marketId` e `rawMarketId`, string, scoped pelo evento |
| `market.typeId=30001` | `match_winner` |
| `market.typeId=330` | `map_winner` em CS2/Valorant |
| `market.typeId=395` | `map_winner` em LoL, nome inclui prorrogação |
| `market.sv` nos tipos 330/395 | Número explícito do mapa; aceita qualquer inteiro positivo, inclusive 4/5 |
| `oddIds` | Seleções da listagem |
| `desktopOddIds` | Matriz de IDs no detalhe; achatada e deduplicada por ID |
| `odds[].id/name/price` | `selectionId`, nome e odd decimal numérica |
| `odds[].oddStatus` | 0 observado disponível; outros números tratados conservadoramente como suspensos; ausente = null |
| `marketGroups[].id/name` | Grupo; todas as associações ficam no raw do mercado |

O detalhe pré-jogo observado omite `status`. O parser aceita a forma observada somente com horário futuro, rejeita live/status desconhecido e encerra a janela pré-jogo quando `startsAt <= fetchedAt`. Isso **não** significa finished. `et`, `rc` e outros campos brutos não são reinterpretados como in-play/suspensão sem evidência.

Cada mercado vencedor precisa de duas seleções e referências válidas. Odd não numérica, não finita ou <=1 vira null, preservando o valor bruto permitido. Outros tipos ficam `unknown`; `sv`, nomes e IDs preservam informação útil. Linhas/handicaps desses tipos não recebem interpretação numérica nesta etapa. O grupo estruturado `Mapa N` pode preencher o mapa de mercados unknown; nunca se usa posição visual.

Os detalhes observados incluem um container `Boosted Odds` vazio: ele permanece unknown com zero seleções, sem gerar snapshot de odd. `childMarkets` e `childMarketGroups` estavam vazios. Se vierem preenchidos, a captura é rejeitada explicitamente até validar essa estrutura; não se publica detalhe truncado.

Os raw normalizados usam uma lista explícita de campos públicos; não carregam envelopes de sessão/headers. O sanitizador comum continua protegendo a persistência JSONB. Capture fixtures somente dos feeds públicos, nunca dos endpoints de configuração/autenticação.

## Integração e operação

```dotenv
ESTRELABET_ENABLED=true
ESTRELABET_MAX_CONCURRENCY=1
# ESTRELABET_INBOX_DIR=estrelabet-inbox
```

Sem configurações novas de timeout: list/detail usam `PROVIDER_LIST_TIMEOUT_MS` e `PROVIDER_DETAIL_TIMEOUT_MS`. Discovery 60s; detalhes 10/5/2/1 minutos nas faixas existentes. Usa locks, timeout/AbortSignal, backoff e circuit breaker comuns. Falha mantém snapshots/TTL; um esporte vazio não é tratado como remoção autoritativa do catálogo.

```sh
cd apps/odds-service
npm run capture:estrelabet -- --detail
# Scheduler contínuo normal: npm start
```

A CLI captura para inbox; a ingestão ocorre pelo serviço normal, conforme o contrato existente. `CollectionService` aceita o slug `estrelabet` tanto em ciclos manuais quanto no scheduler. O client não tem sessão para fechar: shutdown aborta requests ativas. O store confirma PostgreSQL antes de journal/estado local e usa checkpoint `estrelabet:state`. Scopes:

- `estrelabet:list:<esport>:prematch`
- `estrelabet:detail:<eventId>:prematch`

API preservada, com novas rotas:

- `GET /providers/estrelabet/events[?esport=cs2|lol|valorant]`
- `GET /providers/estrelabet/events/:id`
- `GET /providers/estrelabet/health`: transporte, enabled, lastListSuccessAt, lastDetailSuccessAt, eventCount e último erro de ingestão.
- `GET /health`: estado do scheduler/provider, consecutiveFailures, tentativas/sucessos de listagem e jobs ativos.

Seed idempotente inclui slug `estrelabet`, nome `EstrelaBet`. Nenhuma tabela/migration nova: o schema genérico já suporta outros providers. Matching continua independente do ORM/protocolo e sem aliases novos ou fuzzy matching. Regras de issues são as existentes; não foram adicionados detectores de outlier/queda de contagem ainda não implementados globalmente.

## Evidência real — 15/09/2026 UTC

Dois ciclos Nest + PostgreSQL em banco isolado `odds_estrelabet_validation`, com shutdown/restart e 60s entre os ciclos. API retornou 200 em ambos; nenhum browser foi utilizado nesses ciclos. A validação real chamou collectCycle com o timer contínuo desligado, portanto /health mantém o scheduler parado; a publicação por ticks e saúde operacional ok também foram validadas no teste Nest com transporte mockado.

| Medida | Ciclo 1 | Ciclo 2 |
|---|---:|---:|
| CS2 | 36 | 36 |
| LoL | 3 | 3 |
| Valorant | 2 | 2 |
| Detalhes coletados | 3 | 3 |
| Duração, incluindo persistência | 1.883s | 1.893s |
| Eventos SQL | 41 | 41 |
| Mercados SQL históricos | 100 | 104 |
| Seleções SQL históricas | 270 | 310 |
| Snapshots SQL acumulados | 276 | 552 |
| Issues unmatched | 41 | 41 |
| Eventos restaurados antes da coleta | 0 | 41 |

Não houve duplicatas nas chaves externas de eventos, mercados ou seleções. O crescimento de mercados decorreu de **quatro novos IDs de totais auxiliares** no feed; quatro anteriores saíram do scope. O journal registrou 4 MarketAdded + 4 MarketRemoved, preservando histórico. As odds principais permaneceram iguais; OddsChanged foi validado por teste controlado, não por uma mudança real inventada.

Detalhes: Team Brute × G2 Ares (CS2, 17707439), ⁠9z Globant × Fuego (LoL, 17688530), Gen.G GC × FENNEL GC (Valorant, 17708904). Foram interpretados 62 objetos de mercado, dos quais 59 têm seleções; 3 são containers vazios. Ofereciam mapas 1/2 em CS2/Valorant e 1/2/3 em LoL. Mapas 4/5 têm testes derivados explicitamente, sem fingir captura real.

### Comparação com a interface

A UI trunca preços a duas casas decimais; o domínio conserva **o número integral do feed**. Portanto igualdade visual significa igualdade depois da apresentação, não alteração destrutiva da precisão.

| Evento | Mercado | Feed (A / B) | UI (A / B) |
|---|---|---|---|
| Team Brute × G2 Ares | Partida | 1.5264 / 2.3 | 1.52 / 2.30 |
| Team Brute × G2 Ares | Mapa 1 | 1.8334 / 1.9091 | 1.83 / 1.90 |
| ⁠9z Globant × Fuego | Partida | 3.4 / 1.25 | 3.40 / 1.25 |
| ⁠9z Globant × Fuego | Mapa 1 | 2.6 / 1.4348 | 2.60 / 1.43 |
| Gen.G GC × FENNEL GC | Partida | 1.4762 / 2.4 | 1.47 / 2.40 |
| Gen.G GC × FENNEL GC | Mapa 1 | 1.5715 / 2.25 | 1.57 / 2.25 |

Valores acima são evidência temporal, nunca constantes de produção. Screenshots e payloads correspondentes estão em `apps/odds-service/evidence/estrelabet-discovery` (ignorado pelo Git). Fixtures sanitizadas versionadas em `src/modules/estrelabet/fixtures`. Relatório dos ciclos/checkpoints/journal em `evidence/estrelabet-validation-final`.

## Testes e limites

17 testes específicos offline cobrem list/detail, IDs, mapas, unknown, odds inválidas, dedupe, paginação parcial, suspensão, secret exclusion, snapshots/restart, matching de cinco providers, isolamento Nest/API/health, HTTP/timeout e scheduler/backoff/circuit. A suíte SQL inclui fixture EstrelaBet, seed, upsert, precisão/histórico e vínculo canônico de cinco providers. Casos de peers no teste são controlados, não evidência de cinco ofertas simultâneas reais.

Checks finais: build, typecheck, format:check; testes normais 144 aprovados/148 descobertos (4 browser opcionais pulados), SQL 25/25. Suíte SQL usa somente banco descartável terminado em `_test`.

- Validação de estabilidade foi curta: dois ciclos locais HTTP; não equivale a SLA ou deploy Railway validado.
- Python urllib retornou 403 numa tentativa; Node fetch e curl normais funcionaram sem headers forjados. O transporte implementado é Node. Uma falha não dispara tentativas com identidades diferentes.
- A UI de descoberta apresentou CORS no Chrome headless e algumas navegações SPA exigiram recarregar. Chrome headed foi usado somente para inspeção/comparação; isso não cria dependência de browser no provider.
- Não há suporte live, aposta, conta, carteira ou login automatizado.
- O driver pg emitiu aviso de depreciação sobre query concorrente durante persistência existente; não houve falha de transação. Não foi alterada a camada comum para tratar esse aviso nesta tarefa.
- Diferente de Bet365/Betano, não precisa do Mac/CDP. Como Superbet, possui endpoints separados de list/detail. Diferente de Blaze, não baixa manifesto/shards para cada detalhe: usa `GetEventDetails` direto.
