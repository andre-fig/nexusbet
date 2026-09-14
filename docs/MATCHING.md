# Matching entre providers

[Índice](../README.md#documentation) · Código: [matching.ts](../apps/odds-service/src/modules/matching/matching.ts), [names.ts](../apps/odds-service/src/shared/utils/names.ts), [repository SQL](../apps/odds-service/src/modules/persistence/repositories/matching.repository.ts).

## Objetivo e identidade

Comparar versões do mesmo jogo sem confundir IDs externos. `bet365:123` e `betano:123` não são o mesmo evento por causa do ID. A comparação opera exclusivamente sobre NormalizedEvent e produz `{ matched, unmatched }`, com objeto canônico, referências dos providers, nomes raw/normalizados, orientação das equipes e odds observadas.

A identidade SQL CanonicalEvent é separada. Sua ligação atual é `event_matches`, e mudanças ficam em `match_decisions`. Eventos isolados permanecem unmatched sem criar um canônico artificial.

## Normalização auditável

A função de limpeza aplica NFKD, remove marcas de acentuação, converte para minúsculas, substitui pontuação por espaços e compacta espaços. Nomes de times removem a palavra `esports`. Nomes originais não são perdidos.

Aliases de times são explícitos e por esporte: CS2 `navi` → `natus vincere`; LoL `vivo keyd stars` → `keyd stars`. Não há distância de edição ou fuzzy matching agressivo. Remover `esports` é uma regra já existente; preserve testes de colisão ao ampliá-la.

Aliases de competição atuais incluem as variantes de StarLadder/StarSeries em CS2, `lol lec summer playoffs` → `lec`, `lol cblol split 2 playoffs` → `cblol`, e variantes VCT Champions → `champions`. A tabela executável está em shared/utils/names.ts; adicionar alias requer evidência de equivalência e teste negativo de times/competições parecidos.

## Regras exatas

`compareAllProviders(events, toleranceMinutes = 15)` exige:

1. Providers diferentes e mesmo esport.
2. Mesmo par de equipes normalizadas, independentemente da ordem.
3. Ambos com status `scheduled`.
4. Mesma competição após normalização/alias.
5. Diferença absoluta de início ≤15 minutos.

A tolerância é argumento da função, não variável de ambiente; serviços atuais usam o default. Eventos suspended/live não são candidatos, mesmo se o scheduler ainda puder coletar um suspended pré-jogo.

O algoritmo deduplica por provider:eventId. Conteúdo divergente para a mesma identidade gera conflito. Monta componentes de candidatos e só aceita um grupo se **todos os pares forem compatíveis**, houver pelo menos dois membros e no máximo um de cada provider. Uma cadeia A↔B↔C em que A não corresponde a C não é fundida.

Confidence retornada é **1** para grupos aprovados e 0 na decisão SQL unmatched. É um indicador da regra, não probabilidade estatística. Evidence registra equivalência de times/competição e diferença temporal. A seleção recebe `canonicalSide` quando seu nome corresponde ao time canônico; `reversed` informa orientação invertida.

## Unmatched e ambiguidades

Razões atuais:

| Reason | Significado |
|---|---|
| `ambiguous` | Grupo conflitante, múltiplos candidatos do mesmo provider ou identidade duplicada inconsistente |
| `time_competition_or_status_mismatch` | Existe par de times em outro provider, mas outro critério falha |
| `no_team_pair` | Nenhum par equivalente em outra fonte |

Dois providers podem formar comparação sem o terceiro. Um único provider disponível retorna seus eventos unmatched. Falta/stale de uma fonte não impede comparar as demais; se nenhuma estiver disponível, a API retorna 503.

## API versus persistência

`/comparisons?esport=cs2` usa **listagens frescas**, filtrando suas odds para match_winner/map_winner. Não busca automaticamente mercados dos stores de detalhe. Portanto um mapa salvo no banco pode não aparecer nessa comparação. `/matching/unmatched` usa o mesmo processo.

Na persistência, o repository compara scopes de listagem dentro do TTL relativo ao timestamp da publicação. Isso permite replay histórico sem substituir timestamps por agora. Reutiliza canônico atual ou histórico compatível; múltiplos canônicos anteriores conflitantes geram issue LOW_CONFIDENCE e não são fundidos automaticamente. Canônico novo nasce scheduled; atualização de canônico existente ajusta startsAt, não deduz término.

O repository preserva decisões `manual` existentes. Unmatched recebe canonicalEventId null, motivo e issue UNMATCHED_EVENT; match aceito resolve essa issue. Mudança de vínculo/status/motivo relevante acrescenta decisão histórica.

`partial`, `low_confidence` e `manual` são valores modelados no enum SQL; não há fluxo público de revisão manual, score gradual ou classificação automática completa dessas categorias. LOW_CONFIDENCE como issue de conflito não equivale a um workflow de EventMatch low_confidence.

## Depurar um resultado errado

1. Capture as duas listagens no mesmo intervalo e confira fetchedAt/status.
2. Compare rawTeamA/B e normalizedTeamA/B, esporte, competição normalizada e UTC de início.
3. Confira aliases em names.ts/matching.ts e candidatos adicionais do mesmo provider.
4. Reproduza `compareAllProviders` com fixture mínima sanitizada; inclua caso que **não** deve unir.
5. Compare `/comparisons` com `/events/:uuid` lembrando que são projeções distintas; consulte match_decisions para identidade histórica.
6. Não corrija resultado editando ID externo, estendendo tolerância indiscriminadamente ou unindo canônicos ambíguos no banco.

Testes: `modules/matching/tests/{matching,three-providers}.test.ts` e suíte PostgreSQL. Nenhuma etapa calcula melhor preço, margem, probabilidade justa ou odds próprias.
