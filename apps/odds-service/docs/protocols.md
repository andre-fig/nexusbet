# Protocolos dos providers

Notas técnicas das respostas observadas em setembro de 2026. Os IDs de exemplo são históricos, não configuração. As fixtures reais ficam junto dos testes de cada provider em `src/modules/`.

# Bet365

## Endpoint e parâmetros

O detalhe individual real é:

```
GET /contentdata/othersportsmatchbettingcontentapi/coupon
?lid=33&zid=0&pd=%23AC%23B151%23C21168549%23D19%23E26688438%23F19%23&cid=28&cgid=0&ctid=28
```

`/othersportsmatchmarketscontentapi/list` continua fornecendo a listagem. O `/othersportsmatchmarketscontentapi/coupon` observado anteriormente pertence a outra página de competição/mercado; não é o coupon individual capturado neste caso.

Para localizar um evento: procurar `PA.FI` na listagem, aproveitar `PA.PD` e retirar os componentes de retorno `P^50/Q^3`. Estral: FI `200976787`, rota `#AC#B151#C21168549#D19#E26688438#F19#`. **E26688438 não é o FI.** Não existe fórmula de conversão validada nem chamada validada com FI isolado. O frontend recebe a rota na URL da página e emite a chamada real. As abas fornecem seus próprios `MA.PD`, frequentemente acrescentando `I1/I2/...`.

Os parâmetros são os observados, não um conjunto mínimo demonstrado por remoção individual: `lid=33`, `zid=0`, `cid=28`, `ctid=28`, `pd` e `cgid` emitido pela sessão (`0` anônima, `1` autenticada). O código não fabrica esses parâmetros, headers ou tokens: intercepta a resposta da navegação normal.

## Campos do protocolo

| Informação | Regra observada e implementada |
|---|---|
| Evento | `EV.FI`, validado contra FI da listagem; nomes dos times vêm do contexto da listagem. |
| Grupo | `MG.ID`, `MG.NA`; preservados como grupo e campos brutos. |
| Abas | Grupo `MG.SY=cm`; `MA.PD/NA/LS` indicam rotas, rótulos e aba selecionada. |
| Mercado | Seleções `PA.MA` identificam o mercado no layout por colunas. Alternativas: `MA.MA`, identificador do registro/grupo. Chave normalizada `<FI>:<id do mercado>`, com `rawMarketId` preservado. Não usar apenas `MG.PI`, que não enumera todos os mercados observados. |
| Nome | `MA.NA`, `MG.NA` e cabeçalhos `PA.ID=PC...` conforme layout; metadados de linha/coluna são preservados. PC pode ligar o nome do mercado à primeira seleção numérica; não é seleção apostável. |
| Seleção | `PA.ID` numérico; rótulo de `PA.NA`, coluna ou linha conforme layout. Grades de placar e dragões preservam rótulos de linhas. |
| Odd | `PA.OD` fracionário; conversão com precisão/truncamento já validados na interface. Ausente sem suspensão conhecida causa rejeição; ausente com suspensão conhecida vira null. |
| Linha | `PA.HA` numérico, com fallback ao rótulo `HD`; linha por seleção, e por mercado quando comum. Linhas alternativas não são descartadas. |
| Over/under | Prefixos O/U em `HD` e rótulos Mais de/Menos de. O prefixo tem prioridade sobre rótulos de coluna que parecem times. |
| Mapa | Número no nome do grupo/mercado; fallback à aba selecionada. Buscar separadamente evita interpretar o time “100 Thieves” como mapa 100. |
| Período/round | Preservados separadamente quando identificados; primeiro tempo e round não viram vencedor do mapa. |
| Suspensão | `SU`; herança de suspensão de ancestrais; desconhecido null. `SU=0` real, `SU=1` e transições testados sinteticamente. |
| In-play | `IB`, ou contexto validado da listagem. `IB=0` real; `IB=1` testado sinteticamente. Não inferir término pelo relógio ou desaparecimento. |
| Contagem | `CN` depende do layout; em algumas grades significa colunas, não número de seleções. Validação de cardinalidade somente nos layouts conhecidos. |

Categorias reconhecidas incluem vencedor/handicap da partida, vencedor de mapa, handicap de kills/rounds, totais de kills/mapas/rounds, primeiro tempo, vencedor de round, primeira kill e placar correto. Outros mercados ficam com categoria `unknown`, nomes, seleções e campos brutos preservados. Mercados compostos não são indevidamente reduzidos a vencedor simples.


# Betano

## Endpoints descobertos no tráfego do frontend

Todas as chamadas usadas são **GET**, sem body.

| Finalidade | Caminho observado |
|---|---|
| Diretório de modalidades/competições | `/api/sport/esports/?req=la,s,stnf,c,mb` |
| CS2 | `/api/sport/esports/competicoes/counter-strike/189374/?req=la,s,stnf,c,mb` |
| LoL | `/api/sport/esports/competicoes/league-of-legends/189377/?req=la,s,stnf,c,mb` |
| Valorant | `/api/sport/esports/competicoes/valorant/189513/?req=la,s,stnf,c,mb` |
| Outra competição da mesma modalidade | Mesma rota com `sl=<leagueId>`; exemplo CS2 `sl=205214` |
| Próximas 24 horas | `/api/sport/esports/jogos-de-hoje/?req=la,s,stnf,c,mb` |
| Detalhe | `/api/odds/<slug-do-evento>/<eventId>/?req=la,s,stnf,c,mb` |

Host: `https://www.betano.bet.br`. Exemplo de detalhe real: `/api/odds/mouz-nrg-esports/92353340/?req=la,s,stnf,c,mb`.

O frontend também emitiu `req=s,stnf,c,mb`. `req` foi preservado tal como recebido; a necessidade e o significado de cada componente não foram demonstrados por remoção individual. O coletor não constrói chamadas HTTP ao feed: navega pelos links/abas da aplicação e intercepta a resposta correspondente.

**Cobertura:** abrir a modalidade retorna uma competição selecionada, não todas. O coletor usa `regionGroups[].regions[].leagues` e `selectedLeagues` para percorrer cada competição, acionando sua aba real. Só publica a listagem agregada após validar a cobertura. “Próximos” restringe a 24 horas e excluía muitos eventos futuros; não foi usado como catálogo completo. Nenhuma paginação adicional foi observada nas respostas das 14 competições percorridas. Novos layouts/paginação exigirão validação antes de ampliar essa afirmação.

Não foi necessário investigar REST adicional, GraphQL, SSE ou mensagens de WebSocket para obter os snapshots requeridos. Isso não afirma que a aplicação nunca use outros transportes para atualizações. O MVP captura respostas completas e repete a navegação, sem streaming de alterações entre capturas.

## Protocolo e normalização

| Campo | Origem / regra |
|---|---|
| Esporte | `sportId=ESPS` |
| Modalidade | `regionId`: CS2 `189374`, LoL `189377`, Valorant `189513`; rótulos Counter Strike, League of Legends, Valorant |
| Competição | `leagueId`, `leagueName`, `leagueDescription`; IDs da lista de competições |
| Evento | `event.id`, independente do FI da bet365 |
| Equipes | `participants[0/1].name`, com IDs próprios; nunca separar nomes pelo hífen do título |
| Horário | `startTime` em milissegundos Unix, convertido para ISO UTC |
| Pré-jogo/live | `liveNow=true` e rota `/live/` identificam live; rota `/odds/` é a página pré-jogo observada. Eventos live são excluídos da listagem publicada. `willGoLive` significa capacidade futura, não estado atual |
| Mercado | `markets[].id`, `uniqueId`, `type`, `typeId`, `name`; ID normalizado `<eventId>:<marketId bruto>`, sempre acompanhado de provider |
| MATCH_WINNER | `type=H2HT`, `typeId=3183`, nome Vencedor |
| MAP_WINNER | `type=TMPW`, `typeId=3185`, nome estruturado `Vencedor do mapa (Mapa N)` |
| Número do mapa | Extraído desse nome estruturado, nunca da ordem visual ou `displayOrder`; aceita qualquer inteiro positivo, inclusive mapas 4 e 5 reais |
| Seleção | `selections[].id`, `name`, `teamId` quando presente |
| Odd | `price`, já decimal numérico; nenhuma conversão fracionária como na bet365 |
| Suspensão | Flags positivas não apareceram nos coupons pré-jogo usados. Ausência fica `null`. O parser aceita booleanos `suspended`/`isSuspended` com herança evento → mercado → seleção, validados apenas sinteticamente; não apresentar isso como descoberta confirmada da semântica positiva da Betano |
| Outros mercados | Categoria `unknown`, nomes/seleções preservados. `handicap`, tipos, layouts e demais campos ficam em `raw`/proveniência |

As seleções de vencedor precisam ser duas, distintas e corresponder às equipes. IDs repetidos idênticos são deduplicados; conflitos e odds inválidas são rejeitados. Odd ausente sem suspensão conhecida é erro; suspensão conhecida permite `null`. `finished` não é inferido por horário ou desaparecimento.

O CLI manual escolhe uma partida por modalidade com preferência por maior oferta anunciada de mercados. `BETANO_EVENT_ID` permite escolher um evento específico com `ESPORTS` restrito à modalidade. O detalhe publicado tem cobertura `popular`: não representa os 148/159 mercados totais anunciados por algumas páginas. A aba popular já ofereceu todos os vencedores de mapas nos casos validados. O produto pode filtrar mapa ≤3 posteriormente; o parser não descarta mapas superiores.


## Transporte e limites

A coleta usa somente o tráfego normal de contextos anônimos próprios no Chrome existente, via CDP. HTTP direto recebeu 403 nos testes anteriores; não há contorno, reprodução de tokens ou login automático. Headless não foi validado. Valores de cookies/headers não são exportados. A ausência de odds ou cobertura incompleta impede publicação; desconhecidos são preservados genericamente.
