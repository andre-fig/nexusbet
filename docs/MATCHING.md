# Matching entre providers

[Índice](../README.md#documentation) · Código: [matching.ts](../apps/odds-service/src/modules/matching/matching.ts), [names.ts](../apps/odds-service/src/shared/utils/names.ts), [repository SQL](../apps/odds-service/src/modules/persistence/repositories/matching.repository.ts).

## Objetivo e identidade

Comparar versões do mesmo jogo sem confundir IDs externos. `bet365:123` e `betano:123` não são o mesmo evento por causa do ID. A comparação opera exclusivamente sobre NormalizedEvent e produz `{ matched, unmatched }`, com objeto canônico, referências dos providers, nomes raw/normalizados, orientação das equipes e odds observadas.

A identidade SQL CanonicalEvent é separada. Sua ligação atual é `event_matches`, e mudanças ficam em `match_decisions`. Eventos isolados permanecem unmatched sem criar um canônico artificial. `team_aliases` guarda abreviações aprendidas por esporte, com nome canônico e evidência, para reutilização após reinício.

## Normalização auditável

A função de limpeza aplica NFKD, remove marcas de acentuação, converte para minúsculas, substitui pontuação por espaços e compacta espaços. Só na chave de matching, remove o prefixo `team ` e um sufixo final ` team`, ` esports`, ` esport`, ` e-sports` ou ` gaming`, depois compacta a borda novamente. Como pontuação já foi normalizada, `e-sports` é reconhecido como `e sports`. `team` no meio do nome permanece. Em Valorant, um marcador final `(F)` também é removido antes da limpeza, com ou sem espaço anterior; um `F` sem parênteses ou no meio do nome permanece. Nomes raw e os campos normalized próprios do provider não são reescritos.

Depois da regra de borda, aliases explícitos por esporte cobrem apenas equivalências semânticas: CS2 inclui `navi` → `natus vincere` e `l g` → `leo`; LoL inclui `vivo keyd stars` → `keyd stars`, `movistar koi` → `koi` e `9z globant` → `9z`; Valorant inclui `fennel f` → `fennel gc`. Os aliases `33` → `team 33` e `9z team` → `9z` ficaram redundantes e foram removidos. A equivalência revisada prevalece para `FENNEL (F)` antes de retirar o marcador final, evitando confundir `FENNEL GC` com um `FENNEL` sem marcador. `academy`, `junior`, `young`, `gc`, `female`, `ex`, `fe` e `youth` permanecem na chave: `Nexus Gaming` e `Nexus` podem unir, mas `Nexus Academy Gaming` não vira `Nexus`. A regra não usa distância de edição nem fuzzy matching; preserve testes de colisão ao acrescentar novos aliases.

Aliases de competição atuais incluem as variantes de StarLadder/StarSeries em CS2, `lol lec summer playoffs` → `lec`, `lol cblol split 2 playoffs` → `cblol`, e variantes VCT Champions → `champions`. As tabelas executáveis ficam em `modules/matching/team-aliases.ts` para equipes e `shared/utils/names.ts` para torneios; aliases aprendidos ficam em `team_aliases`. Um alias novo requer grupo não ambíguo, mesmo adversário e torneio normalizados, horários a até cinco minutos e abreviação composta pelas iniciais de um prefixo do nome completo com sufixo idêntico. Por exemplo, `EAC Extra` → `EA Copenhagen Extra` em `OldMix`/`United21`. O nome canônico escolhe a forma mais completa. Não há distância de edição geral.

O alias específico de CS2 `wraith pcific` → `pcific` une `Wraith Pcific` com `Pcific Esports` após a remoção genérica do sufixo `esports`. `Wraith` não é removido de outros nomes.

O alias específico de LoL `mibr los` → `los` une `MIBR LOS` com `LOS`. `MIBR` permanece em outros nomes e esports.

Na chave de matching, o token final `juniors` vira `junior`: `Natus Vincere Juniors` e `Natus Vincere Junior` equivalem, mas ambos continuam distintos de `Natus Vincere`. O token não muda quando aparece no meio do nome, e os nomes raw permanecem intactos.

## Regras exatas

`compareAllProviders(events)` exige:

1. Providers diferentes e mesmo esport.
2. Mesmo par de equipes normalizadas, independentemente da ordem.
3. Ambos com status `scheduled`.
4. Mesmo instante de início após interpretar `startsAt`; até cinco minutos somente quando o torneio também coincide e o par de times é igual por alias conhecido, ou quando uma abreviação nova é confirmada pelo adversário e torneio.

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

Na persistência, o repository compara scopes de listagem dentro do TTL relativo ao timestamp da publicação. Isso permite replay histórico sem substituir timestamps por agora. Reutiliza canônico atual ou histórico compatível; múltiplos canônicos anteriores conflitantes geram issue LOW_CONFIDENCE e não são fundidos automaticamente. Canônico novo nasce scheduled; atualização de canônico existente ajusta nomes canônicos e startsAt, não deduz término.

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
