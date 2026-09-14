# Providers

[Índice](../README.md#documentation) · [Campos/URLs detalhados observados](../apps/odds-service/docs/protocols.md)

## Contrato e cobertura comuns

Módulos ficam em `apps/odds-service/src/modules/{bet365,betano,superbet}`. Cada service implementa ProviderRuntime, extensão de OddsProvider. Client/collector obtêm dados estruturados; parser valida e normaliza; store publica snapshots via porta comum. Não existe um parser compartilhado entre bookmakers.

Listagem e detalhe são coberturas distintas. IDs conflitantes, odds inválidas e respostas incompletas devem causar erro, não uma publicação vazia. Mapas 4/5 são aceitos; mercados extras permanecem unknown/raw quando não interpretados. Suspensão desconhecida permanece null. Dados live não são alvo da coleta.

## Bet365

- **Transporte:** Chrome headless isolado por padrão, iniciado via Playwright Core; CdpFeed intercepta respostas da navegação real. BrowserFeed e conexão a Chrome existente continuam como modos explícitos de diagnóstico.
- **Discovery:** `/contentdata/othersportsmatchmarketscontentapi/list`; rotas por modalidade e catálogo preservam FI e PD. Códigos de modalidade: CS2=2, LoL=3, Valorant=8 no contexto de eSports usado pelo coletor.
- **Detalhe:** `/contentdata/othersportsmatchbettingcontentapi/coupon`. FI é a identidade do evento; PD contém rota do frontend. O componente `#E...#` não é FI e não há conversão validada de FI isolado para essa rota. Abas anunciam PD próprios; são capturadas as abas de leitura aceitas, excluindo Criar Aposta.
- **Protocolo:** registros textuais EV/MG/MA/PA. MG identifica grupos; MA/PA e contexto de layout identificam mercados/seleções. PA.OD é fracionário, convertido com truncamento já validado; não use arredondamento genérico em substituição. Horários da listagem exigem tratamento do fuso de Londres/DST.
- **Arquivos:** `parsers/{protocol,list,coupon}.parser.ts`; `mappers/{list,bet365}.mapper.ts`; `persistence/{list,detail}.store.ts`; `transport/{browser-feed,cdp-feed}.ts`.
- **Fixtures/testes:** `fixtures/{cs2,lol,valorant}.json`, versões later e `fixtures/details/`; `tests/{parser,detail-parser,cdp-feed,browser-feed}.test.ts`.
- **Quirks:** cabeçalhos PC não são seleção; colunas/linhas compõem rótulos; map/round/período não são equivalentes; rawMarketId deve sobreviver à chave composta. Captura main não equivale à cobertura completa de abas.
- **Limites:** HTTP direto não é transporte funcional validado. Headless recebeu 403/Cloudflare no ambiente anterior; o código não contorna nem abre janela como fallback. Fixtures comprovam parser, não acesso remoto hoje.

## Betano

- **Transporte:** BetanoBrowser via CDP em Chrome headless próprio. Navega links/abas reais e intercepta JSON, sem reconstruir tokens/headers de sessão. HTTP direto recebeu 403 e não é o transporte de produção implementado.
- **Discovery:** GET `/api/sport/esports/?req=la,s,stnf,c,mb`, depois competições. regionId CS2=189374, LoL=189377, Valorant=189513. `regionGroups[].regions[].leagues`/selectedLeagues indicam cobertura; apenas a competição inicialmente selecionada não é catálogo completo. O coletor percorre competições anunciadas e valida a rodada agregada.
- **Detalhe:** GET `/api/odds/<slug>/<eventId>/?req=la,s,stnf,c,mb`, capturado pela navegação. Cobertura implementada **popular**, não todos os mercados anunciados no cabeçalho da página.
- **Protocolo:** event.id, participants, startTime Unix ms, markets/selections e price decimal. H2HT/typeId3183 identifica vencedor; TMPW/typeId3185 vencedor de mapa, com número no nome estruturado. Não derive mapa de displayOrder.
- **Arquivos:** `parsers/feed.parser.ts` inclui mapeamento normalizado; `transport/betano-browser.ts`; `persistence/betano.store.ts`. Não há pasta mapper vazia a preencher.
- **Fixtures/testes:** `fixtures/directory.json`, list/round/detail dos três esportes e cs2-detail-later; `tests/betano.test.ts`.
- **Quirks:** liveNow não é willGoLive; seleções 1/2 não devem ser interpretadas pela ordem visual. Duplicatas idênticas são deduplicadas, conflitantes rejeitadas. Flags de suspensão positiva aceitas pelo parser têm testes sintéticos; não foram confirmadas positivamente nos coupons reais disponíveis.
- **Limites:** popular já incluiu vencedores de mapas nos casos observados, mas não garante toda a oferta. Headless recebeu 403/splash sem feed utilizável; não há login automático nem fallback visível.

## Superbet

- **Transporte:** HTTP direto, somente GET, origem pública `https://production-superbet-offer-br.freetls.fastly.net`. Não usa browser na coleta regular, cookies ou assinatura reproduzida. Redirects são rejeitados.
- **Discovery:** `/v2/pt-BR/struct` fornece dicionários; `/v3/pt-BR/events` com index=active-prematch, sports=55 (CS2),39 (LoL),153 (Valorant), startDate/endDate. A janela é de 180 dias, começando em hora UTC inteira. index não é página; não houve cursor observado.
- **Detalhe:** `/v2/pt-BR/events/{eventId}`. A listagem v3 e detalhe v2 têm estruturas diferentes, tratadas dentro do mesmo módulo.
- **Protocolo:** UUID da linha de mercado é marketId normalizado; tipo numérico permanece rawMarketId. UUID de odd é selectionId. specifiers.mapnr indica mapa. Códigos competitor1/2 traduzem seleção para equipe; não use ordem de array.
- **Arquivos:** `superbet.client.ts`, `superbet.collector.ts`, `parsers/feed.parser.ts`, `types/feed.ts`, `persistence/superbet.store.ts`.
- **Fixtures/testes:** list/detail para os três esportes, structure, untranslated-structure e lol-lec-detail; `tests/{feed,integration,scheduler}.test.ts`.
- **Quirks:** startDate com minuto/segundo recebe 400; counts.odds[1] valida completude; metadata de estado deve ser reconhecida, com variante explicitamente PREMATCH em streams. hasLive não significa inPlay. Tradução vazia de torneio não utilizado pode ser ignorada; torneio referenciado precisa de nome.
- **Limites:** feeds de subscription foram observados, mas não são consumidos como streaming/live. Testes e capturas históricas não garantem disponibilidade futura dos endpoints.

## Browser, privacidade e validação real

`shared/browser/headless-feed.ts` lança perfil temporário Chrome, descobre seu CDP local e fecha processo/perfil próprios. HEADLESS=true ignora CDP_URL/--existing/reuseProfile. HEADLESS=false é diagnóstico visível explícito; conexão nativa pode pedir autorização manual. Não copie perfil pessoal nem automatize desafio anti-bot.

Sem login foi o ponto inicial das investigações; nenhuma credencial é necessária para o código atual. Isso não promete que um site nunca bloqueará uma sessão nova. Evidência de UI/protocolo preservada nos guias/fixtures é histórica e deve ser rotulada como tal.

Para uma mudança de feed, capture somente rede de leitura, sanitizada; compare um evento e seus vencedores com a UI por esporte. Registre fetchedAt e cobertura. Teste outro evento antes de concluir ausência de mapas. Não troque fixtures reais por valores inventados para passar testes.

## Adding a new provider

1. Leia `shared/interfaces/odds-provider.interface.ts` e um service/store existente; escolha HTTP quando funcionar legitimamente, senão browser normal.
2. Crie módulo independente com client/collector/parser, tipos necessários, store, controller e service. Separe mapper apenas se houver responsabilidade real.
3. Implemente NormalizedEvent/Market/Selection preservando IDs originais, raw sanitizado, timestamps, mercados unknown e mapas >3.
4. Implemente ProviderRuntime inteiro: leitura/TTL, refresh, selectDetail manual, closeCollection idempotente, AbortSignal e callbacks `publications`.
5. Defina identidade/cobertura dos scopes, valide catálogo completo e rejeite detalhe parcial conflitante. Integre SnapshotsModule/PersistencePort, sem Prisma no parser.
6. Atualize unions de Provider no domínio (inclusive usos em market-model), configuração de concorrência, CollectionModule/ODDS_PROVIDERS e seleção CLI quando necessária. Não basta inserir provider no banco.
7. Registre rotas/health pelo módulo; health agregado deriva do registry. Mantenha matcher genérico; alias novo deve ser explícito, auditado e testado.
8. Atualize seed e env/docs. O schema providers aceita novos slugs sem migration só para o nome; mudanças de estrutura exigem migration.
9. Teste parser/coverage/IDs/mapas/suspensão/unknown, snapshots, dedupe, timeout, isolamento, restart e matching ambíguo. Mantenha os testes antigos.
10. Faça validação remota limitada e autorizada, encerre recursos e documente bloqueios. Não amplie para contas/apostas ou live.
