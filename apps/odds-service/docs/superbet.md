# Superbet Brasil — provider pré-jogo

Validado em 14/09/2026. Módulo NestJS independente em `src/modules/superbet`. Somente leitura, sem login. Bet365 e Betano conservam seus transportes, parsers, fixtures e stores.

## Coleta e protocolo observado

Navegação real em uma sessão anônima própria do Chrome: `/apostas/counter-strike-2`, `/apostas/league-of-legends`, `/apostas/valorant`; calendário **Todos** e links `/odds/<modalidade>/<times>-<eventId>`. Responses de rede capturadas por CDP, sem DevTools manual, coordenadas ou clipboard. O parser usa exclusivamente JSON de rede; a tela foi consultada somente para comparar valores.

Origem pública usada pelo frontend: `https://production-superbet-offer-br.freetls.fastly.net`.

| Método e caminho | Uso e parâmetros |
|---|---|
| GET `/v2/pt-BR/struct` | Dicionários de torneios e outcomes; sem query/body |
| GET `/v3/pt-BR/events` | `index=active-prematch`, `sports=55/39/153`, `startDate`, `endDate` em UTC |
| GET `/v2/pt-BR/events/{eventId}` | Detalhe completo, sem query/body; somente o ID numérico é necessário |
| GET `/v2/pt-BR/sport/{sportId}/phase/prematch/market-groups` | Organização de mercados observada; não necessária para os mercados prioritários |
| GET `/v3/subscription/pt-BR/prematch` e `/v3/subscription/pt-BR/events` | Atualizações observadas no frontend; não usadas pelo scheduler pré-jogo |

`index` escolhe o catálogo, **não é um número de página**. O calendário Todos consulta uma janela de 180 dias, sem cursor ou paginação observados. O coletor replica essa janela por modalidade. `startDate` precisa ter precisão de hora inteira: datas com minutos/segundos causam HTTP 400 (`startDate must be whole-hour precision`). Essa exigência foi descoberta na validação e coberta por teste. `endDate = startDate + 180 dias`. A listagem rejeita escopos/janelas diferentes antes de publicar remoções.

HTTP direto retornou 200 sem cookies, autenticação, assinaturas, headers personalizados ou reprodução de tokens. O Chrome enviava, entre outros, Referer, User-Agent e X-Client-Id; nenhum foi copiado. Redirecionamentos são rejeitados pelo cliente. HTTP 403/erros não acionam tentativas de contorno: seguem timeout/backoff/circuit breaker. As credenciais não foram usadas.

## Campos e normalização

| Domínio | Listagem v3 | Detalhe v2 |
|---|---|---|
| eventId | `event_id` | `eventId` |
| modalidade | `fixture.sport_id`: CS2=55, LoL=39, Valorant=153 | `sportId` |
| competição | `fixture.tournament_id` + `struct.data.tournaments[].localNames.pt-BR` | `tournamentId`, mesmo dicionário |
| região/categoria | `fixture.category_id` | `categoryId` |
| equipes/IDs | `fixture.event_name`, `home_team_id`, `away_team_id` | `matchName`, `homeTeamId`, `awayTeamId` |
| horário UTC | `fixture.utc_date` | `matchDate` em UTC; `utcDate`/`unixDateMillis` preservados no bruto |
| estado | `inplay_stats_metadata.status` | `metadata.status`; variante observada usa `streams: ["PREMATCH"]` |
| oferta pré-jogo | `fixture.offer_state_status[1]` | `offerStateStatus[1]`, `odds[].offerStateId=1` |
| tipo de mercado | `markets[].id` | `odds[].marketId` |
| identidade da linha | `odds[].metadata.market_line_uuid` | `odds[].marketUuid` |
| selectionId | `odds[].uuid` | `odds[].uuid` |
| nome/odd | `markets[].name`, metadata da seleção, `price` | `marketName`, `name`, `price` |
| mapa | specifiers quando oferecido | `specifiers.mapnr`, sem limite de mapas |
| seleção/time | `metadata.code/name/outcome_id` | `code/name/outcomeId` e templates do dicionário (`competitor1/2`) |
| suspensão | status numérico ativo=1; display e campos brutos preservados | `status=active` ativo; suspended/inactive/blocked indisponível; valor desconhecido fica null |

`matchName` separa as duas equipes pelo caractere `·`. Os nomes originais e normalizados são preservados. “1” e “2” no vencedor de LoL/Valorant são mapeados para mandante/visitante por campos estruturados, nunca pela ordem das seleções.

O `marketId` normalizado é o UUID da linha, estável entre listagem e detalhe. `rawMarketId` conserva o tipo numérico. Assim, mapas ou linhas do mesmo tipo não colidem. `marketGroupOrder` é preservado como ordenação, não tratado como ID de grupo.

| Modalidade | match_winner | map_winner |
|---|---|---|
| CS2 | 2483 | 2484 |
| LoL | 2519 | 2512 |
| Valorant | 232494 | 232498 |

São IDs de protocolo observados, não odds codificadas. Outros tipos permanecem `unknown`, com seleções, preços, specifiers e campos brutos. Handicap/props não receberam interpretação de produto: handicap permanece nos specifiers brutos, sem atribuir uma linha incorreta à seleção visitante. `display=false` representa indisponibilidade na normalização, preservando separadamente o status bruto. `hasLive=true` indica disponibilidade de cobertura e não significa partida ao vivo. Apenas oferta pré-jogo é normalizada. Metadados de estado desconhecidos são rejeitados; a variante sem metadata só é aceita quando traz explicitamente o único stream PREMATCH.

O detalhe valida `counts.odds[1]` contra UUIDs únicos recebidos, evitando publicar resposta incompleta. Duplicatas idênticas são deduplicadas; conflitos são rejeitados. Traduções vazias de torneios não utilizados no diretório global são ignoradas; torneio referenciado sem nome continua sendo erro.

## Comparação com a interface

Snapshots temporais, não preços atuais nem constantes de implementação:

| Modalidade/evento | Vencedor da partida | Mapas verificados | Vencedor por mapa |
|---|---|---|---|
| CS2: Brute × G2 Ares, 14983869 | 1.71 / 2.02 | 1, 2, 3 | 1.75 / 1.97 |
| LoL: T1 Challengers × KT Rolster Challengers, 14986522 | 1.35 / 2.80 | 1, 2, 3, 4, 5 | 1.53 / 2.25 |
| Valorant: TyLoo × G2, 14900724 | 3.30 / 1.27 | 1, 2, 3 | 2.62 / 1.41 |

14 mercados prioritários comparados com a interface. Os três detalhes produziram 61, 92 e 101 linhas de mercado (254 no total), preservando extras; não se afirma comparação visual de todas essas linhas. A variante adicional Natus Vincere × Movistar KOI (14961853) gerou 255 linhas e três mapas, validada pelo feed e pela publicação local.

Captura inicial: 62 CS2, 10 LoL, 9 Valorant. Validação contínua posterior: **63 CS2, 10 LoL, 9 Valorant**. A quantidade varia com a oferta.

## Scheduler, armazenamento e API

Fluxo: `CollectionService → SuperbetService → SuperbetCollector → SuperbetClient (HTTP GET) → parser → publicação diferida de inbox → SuperbetStore → MarketJournal → API/matching`.

- Listagem: 60 s. Detalhes: >24 h=10 min; 6–24 h=5 min; 1–6 h=2 min; <1 h=60 s.
- `SUPERBET_MAX_CONCURRENCY=1`; limite efetivo conservador de uma operação por provider.
- Startup 3 s, jitter até 5 s, timeouts de listagem/detalhe 60 s.
- Backoff 30/60/120/300 s; threshold 5, cooldown 300 s; shutdown grace 30 s.
- ConfigModule usa as mesmas variáveis de intervalo dos outros providers.
- `SUPERBET_INBOX_DIR=superbet-inbox`; persistência em `$DATA_DIR/superbet`.
- `/providers/superbet/events`, `/providers/superbet/events/:id`, `/providers/superbet/health`; `?esport=cs2|lol|valorant`.
- `/health` incorpora o estado operacional próprio da Superbet.

Snapshots mantêm provider, eventId, UUID de mercado/seleção, preço, mapa, linha, suspensão, inPlay e fetchedAt. Journal append-only reutilizado sem alteração de lógica. Scopes separados: listagem por modalidade/janela e detalhe por evento. Os sete eventos de mudança permanecem disponíveis. EventRemoved nunca vira EventFinished.

Preserva-se a política atual: listagem totalmente vazia não autoriza remover todo o catálogo; falha mantém estado anterior até TTL. O TTL permanece 600 s. Eventos cujo início chegou param de receber detalhes pelo scheduler, sem inferir encerramento. Apenas uma instância escritora por diretório; não há coordenação distribuída nem nova política de retenção.

## Matching de três fontes

O algoritmo recebe eventos normalizados de qualquer provider do registry. A identidade operacional inclui provider + eventId. Grupos precisam concordar em esporte, par de equipes, alias de competição e horário (15 minutos), com um único evento por provider e concordância entre todos os pares. Cadeias transitivas ou candidatos ambíguos ficam unmatched. Confidence=1 é pontuação de regra, não probabilidade.

Foram adicionados somente dois aliases explícitos observados: CS2 `StarSeries → StarLadder StarSeries`; Valorant `VCT Champions → Champions`. Nomes divergentes sem equivalência revisada continuam sem correspondência.

A API compara fontes frescas disponíveis; uma fonte stale/unavailable não interrompe as demais. Quando nenhuma fonte está fresca, retorna 503. A estrutura continua `{matched, unmatched}`. Nenhuma margem, preço próprio ou escolha de melhor odd é calculada.

Na rodada real: 18 grupos correspondentes, 16 com Superbet e **5 com as três casas**. Exemplo MOUZ × NRG, 17/09/2026 10:00 UTC, capturas entre 21:52:52 e 21:52:59 UTC de 14/09:

| Provider | eventId | MOUZ | NRG |
|---|---|---|---|
| bet365 | 201152866 | 1.10 | 6.50 |
| betano | 92353340 | 1.10 | 6.10 |
| superbet | 14943371 | 1.12 | 5.60 |

Exemplos completos e contagens estão em `superbet-validation.json`. As capturas operacionais e screenshots ficam em `captures/superbet-investigation` e `captures/superbet-validation-final`, ignorados pelo Git. Fixtures de regressão sanitizadas ficam no módulo.

## Estabilidade e limites observados

Foram observadas duas listagens bem-sucedidas de cada provider no scheduler real. A Superbet completou 82 operações de detalhe, sem sobreposição por provider. Houve duas rejeições do mesmo detalhe sem metadata; a variante PREMATCH foi corrigida e sua coleta/publicação real confirmada depois. Também foram corrigidos precisão de hora do HTTP e um torneio global sem tradução antes da conclusão.

O journal real acumulou 95 publicações e 12.136 snapshots de seleções incluindo a confirmação posterior. Nenhuma alteração natural de preço ocorreu entre snapshots comparáveis nessa janela; OddsChanged, suspensão, reabertura e remoções foram verificados em testes derivados de fixtures reais.

Bet365 e Betano concluíram listagens, mas tiveram falhas em alguns detalhes no transporte existente (9 e 7 falhas durante a rodada); Bet365 abriu seu circuit breaker. Essas falhas ficaram isoladas e não alteraram seus parsers. A suíte de regressão valida a preservação dos contratos. Não se afirma disponibilidade contínua das casas.

A observação de estabilidade é curta, não um SLA. A janela de catálogo é limitada a 180 dias e os nomes novos podem exigir aliases revisados. Ofertas live não são coletadas. Não houve apostas, alterações de conta ou uso de credenciais. Todos os processos de validação foram encerrados, com drain das tarefas e fechamento das abas próprias.

## Verificações finais

`BROWSER_TESTS=1 npm test`: **86/86 aprovados**, incluindo o browser opcional contra fixture local. `npm run build`, `npm run typecheck` e `npm run format:check`: OK. Os testes normais não consultam sites reais. A matriz inclui parsers dos três esportes, mapas 1–5, IDs/odds/unknown, deduplicação, publicação, persistência, TTL, os sete eventos de journal, módulo isolado, API, matching conservador entre três providers, concorrência, locks, timeout, backoff e circuit breaker isolado.

Arquivos de integração alterados: domínio/Source compartilhados (somente novos discriminantes), configuração, registry CollectionModule, CLI de captura, MatchingModule e aliases revisados. Fixtures e implementação de parsing/transporte da Bet365 e Betano não foram reescritas.
