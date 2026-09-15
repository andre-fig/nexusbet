# Matching entre providers

[Índice](../README.md#documentation) · Código: [matching.ts](../apps/odds-service/src/modules/matching/matching.ts), [names.ts](../apps/odds-service/src/shared/utils/names.ts), [repository SQL](../apps/odds-service/src/modules/persistence/repositories/matching.repository.ts).

## Objetivo e identidade

Comparar versões do mesmo jogo sem confundir IDs externos. `bet365:123` e `betano:123` não são o mesmo evento por causa do ID. A comparação opera exclusivamente sobre NormalizedEvent e produz `{ matched, unmatched }`, com objeto canônico, referências dos providers, nomes raw/normalizados, orientação das equipes e odds observadas.

A identidade SQL CanonicalEvent é separada. Sua ligação atual é `event_matches`, e mudanças ficam em `match_decisions`. Eventos isolados permanecem unmatched sem criar um canônico artificial.

## Normalização auditável

A função de limpeza aplica NFKD, remove marcas de acentuação, converte para minúsculas, substitui pontuação por espaços e compacta espaços. Nomes originais não são perdidos.

Aliases de times são aplicados somente na camada de matching, de forma explícita e por esporte: CS2 inclui `navi` → `natus vincere`, `nrg esports` → `nrg`, `team brute` → `brute`, `nemiga gaming` → `nemiga`, `33` → `team 33`, `l g` → `leo team`, `baks esports` → `baks`, `astral esports` → `astral` e `rune eaters esports` → `rune eaters`; LoL inclui `vivo keyd stars` → `keyd stars` e `movistar koi` → `koi`; Valorant inclui `t1 esports` → `t1` e `fennel f` → `fennel gc`. Os campos raw e normalized de cada provider continuam preservando seus valores próprios; o alias define apenas a identidade canônica usada na comparação. Não há remoção genérica de `team`, `esports` ou `gaming`, distância de edição ou fuzzy matching agressivo. Preserve testes de colisão ao adicionar aliases.

Aliases de competição atuais incluem as variantes de StarLadder/StarSeries em CS2, `lol lec summer playoffs` → `lec`, `lol cblol split 2 playoffs` → `cblol`, e variantes VCT Champions → `champions`. As tabelas executáveis ficam em `modules/matching/team-aliases.ts` para equipes e `shared/utils/names.ts` para torneios; adicionar alias requer evidência de equivalência e teste negativo de nomes parecidos.

## Regras exatas

`compareAllProviders(events)` exige:

1. Providers diferentes e mesmo esport.
2. Mesmo par de equipes normalizadas, independentemente da ordem.
3. Ambos com status `scheduled`.
4. Mesmo instante de início após interpretar `startsAt`, sem tolerância.

Capitalização, acentos, espaços extras e pontuação irrelevante são ignorados na normalização dos times. A ordem dos dois times também é ignorada. A competição não veta o grupo: igualdade após normalização/alias produz confidence 1; divergência produz confidence 0,9. Eventos suspended/live não são candidatos, mesmo se o scheduler ainda puder coletar um suspended pré-jogo.

O algoritmo deduplica por provider:eventId. Conteúdo divergente para a mesma identidade gera conflito. Monta componentes de candidatos e só aceita um grupo se **todos os pares forem compatíveis**, houver pelo menos dois membros e no máximo um de cada provider. Uma cadeia A↔B↔C em que A não corresponde a C não é fundida.

Não existe quorum fixo de cinco providers. Um grupo pode ser formado por 2, 3, 4 ou 5 fontes desde que continue sendo uma clique completa, sem dois eventos do mesmo provider e sem ambiguidade. A cobertura `matched`/`partial` mostrada pelo monitor é uma projeção operacional separada: compara os membros ativos observados com os providers ativos no runtime, portanto providers intencionalmente desabilitados não tornam o evento parcial.

Confidence retornada é **1** para grupos aprovados com competição equivalente, **0,9** quando apenas a competição diverge e 0 na decisão SQL unmatched. É um indicador da regra, não probabilidade estatística. Evidence registra equivalência de times/competição e diferença temporal. A seleção recebe `canonicalSide` quando seu nome corresponde ao time canônico; `reversed` informa orientação invertida.

## Unmatched e ambiguidades

Razões atuais:

| Reason | Significado |
|---|---|
| `ambiguous` | Grupo conflitante, múltiplos candidatos do mesmo provider ou identidade duplicada inconsistente |
| `time_or_status_mismatch` | Existe par de times em outro provider, mas horário ou status diverge |
| `no_team_pair` | Nenhum par equivalente em outra fonte |
| `only_one_eligible_provider` | Matching não aplicável porque menos de dois providers têm listagem válida no esporte/contexto |

Dois providers podem formar comparação sem o terceiro. `eligibleProviders` é calculado por esporte a partir da interseção entre runtime habilitado/operacional e uma listagem válida dentro do TTL. Com menos de dois elegíveis, os eventos saem como `notApplicable`, com reason `only_one_eligible_provider`, e não geram `UNMATCHED_EVENT`. Disabled, indisponibilidade estrutural do runtime, stale e no-data ficam fora do denominador; saúde do provider continua separada. Se nenhum provider tiver listagem fresca, a API retorna 503.

## API versus persistência

`/comparisons?esport=cs2` usa **listagens frescas**, filtrando suas odds para match_winner/map_winner. Não busca automaticamente mercados dos stores de detalhe. Portanto um mapa salvo no banco pode não aparecer nessa comparação. `/matching/unmatched` usa o mesmo processo.

Na persistência, o repository compara scopes de listagem dentro do TTL relativo ao timestamp da publicação. Isso permite replay histórico sem substituir timestamps por agora. Reutiliza canônico atual ou histórico compatível; múltiplos canônicos anteriores conflitantes geram issue LOW_CONFIDENCE e não são fundidos automaticamente. Canônico novo nasce scheduled; atualização de canônico existente ajusta startsAt, não deduz término.

O repository preserva decisões `manual` existentes. Unmatched recebe canonicalEventId null, motivo e issue UNMATCHED_EVENT somente quando há ao menos dois providers elegíveis. `notApplicable` resolve uma issue unmatched anterior e não cria decisão negativa. Match aceito também resolve essa issue. Mudança de vínculo/status/motivo relevante acrescenta decisão histórica.

`partial`, `low_confidence` e `manual` são valores modelados no enum SQL; não há fluxo público de revisão manual, score gradual ou classificação automática completa dessas categorias. LOW_CONFIDENCE como issue de conflito não equivale a um workflow de EventMatch low_confidence.

## Depurar um resultado errado

1. Capture as duas listagens no mesmo intervalo e confira fetchedAt/status.
2. Compare rawTeamA/B e normalizedTeamA/B, esporte, competição normalizada e UTC de início.
3. Confira aliases em names.ts/matching.ts e candidatos adicionais do mesmo provider; torneios diferentes reduzem confidence, mas não vetam o match.
4. Reproduza `compareAllProviders` com fixture mínima sanitizada; inclua caso que **não** deve unir.
5. Compare `/comparisons` com `/events/:uuid` lembrando que são projeções distintas; consulte match_decisions para identidade histórica.
6. Não corrija resultado editando ID externo ou unindo canônicos ambíguos no banco.

Testes: `modules/matching/tests/{matching,three-providers}.test.ts` e suíte PostgreSQL. Nenhuma etapa calcula melhor preço, margem, probabilidade justa ou odds próprias.
