# Decisões e divergências conhecidas

[Índice](../README.md#documentation)

Este registro descreve decisões verificáveis no código e limites explícitos do escopo, sem inventar histórico de aprovação ou roadmap fechado.

| Decisão atual | Razão / consequência | Evidência |
|---|---|---|
| odds-service NestJS separado | Pipeline de leitura independente de frontend/BFF | apps/odds-service, AppModule |
| Módulos específicos por provider | Protocolos/validações não são intercambiáveis | bet365/betano/superbet |
| Domínio normalizado sem ORM | Matching/collectors não dependem de schema SQL | shared/domain e interfaces |
| Pré-jogo primeiro | Eventos iniciados deixam agenda, sem finished inferido | scheduling-policy/scheduled-operation |
| Headless por padrão | Não abrir páginas na tela; perfil técnico persistente próprio | owned-browser e clients |
| HTTP Superbet / browser Bet365 e Betano | Reutiliza transporte validado, sem reproduzir tokens | clients e guias de protocolo |
| Scheduler em memória no Nest | Sem Redis, fila externa ou cron por evento | AdaptiveScheduler/SchedulerService |
| Concorrência efetiva 1/provider | Protege transporte mutável; pode atrasar detalhes | AdaptiveScheduler |
| PostgreSQL + Prisma único ORM | Constraints e transação de publicações/histórico | schema/migration/PersistenceService |
| Matching conservador/canônico | Evita falso positivo e preserva identidade entre fontes | compareAllProviders/repository |
| Vínculo atual somente em event_matches | Evita duas FKs divergentes; histórico separado | schema/match_decisions |
| Snapshots por observação / último snapshot atual | Conserva histórico sem current_odds duplicada | odds_snapshots/read.repository |
| Journal local/checkpoints mantidos | Migração incremental e contratos anteriores | stores/PersistencePort |
| API local GET | Sem auth/BFF/ordens/contas | bootstrap/main/controllers |

## Documentação anterior versus código

- O guia antigo do scheduler dizia que Chrome existente com CDP autorizado era obrigatório. Hoje HEADLESS=true lança Chrome próprio invisível; exigência de CDP externo só vale no diagnóstico HEADLESS=false. O texto foi corrigido, preservando o guia.
- O mesmo guia descrevia conexão compartilhada como caminho geral. No modo headless cada provider usa browser próprio; compartilhamento CDP por referência permanece apenas no modo externo.
- README do serviço dizia genericamente que dados vencidos retornam 503. Isso vale para rotas normalizadas; consultas SQL históricas podem devolver dados antigos. A distinção foi explicitada.
- O requisito conceitual citava NormalizedMarket/NormalizedSelection e providerEventId no domínio. Código usa Market/Selection e eventId; documentação preserva os nomes reais.
- O schema tem 13 tabelas, não apenas as oito entidades inicialmente propostas. match_decisions, issue_transitions, feed_scopes, publications e legacy_checkpoints são necessários ao comportamento atual.
- package.json declara Node >=22, mas Prisma instalado exige ^22.12 (ou linhas suportadas superiores). Onboarding recomenda 22.12+ na linha 22 ou 24+.
- Código habilita collection por default; .env.example a desabilita para primeiro startup seguro. Não são defaults equivalentes.
- Descrições históricas de interface validada não garantem coleta headless atual: Bet365/Betano tiveram bloqueios. Testes locais não provam acesso remoto.

## Não implementado / limites atuais

- Não há integração Sentry nem configuração Railway encontrada no repositório. Não são ferramentas operacionais já disponíveis.
- odds-monitor existente é React/Vite com mocks, não dashboard conectado. Backend não depende dele. Não há BFF nem frontend público de apostas.
- partial/low_confidence/manual existem no schema, mas workflow completo de revisão humana/classificação gradual não está implementado. Issues automáticas cobrem unmatched e conflitos canônicos, não todos os detectores previstos.
- Matching da API compara listagens, sem juntar automaticamente todos os detalhes; não há consenso, escolha de melhor preço ou odds próprias.
- Não há live collector, aposta, carteira, pagamento, liquidação ou risk engine. Valores live/finished modelados não equivalem a implementá-los.
- Não há coordenação distribuída, fila persistente de jobs, retenção/purge automático, backup automatizado ou paginação completa.
- Não há garantia de detalhe atualizado para todo o catálogo dentro do TTL, nem coleta Bet365/Betano headless real bem-sucedida na última validação deste ambiente.

Esses itens não devem ser apresentados como funcionalidades atuais. Uma futura tarefa pode implementá-los; esta documentação não os autoriza nem muda a arquitetura para antecipá-los.

## Evolução do browser persistente

Os clients agora usam OwnedBrowser nos dois modos; o perfil técnico não é removido ao fechar. O antigo contexto anônimo interno e o fechamento da Betano em toda listagem deixaram de fazer parte desse fluxo. BROWSER_MODE=headed seleciona Chrome próprio, não CDP pessoal. A investigação demonstrou divergência na resposta inicial da homepage, mas não coleta headless funcional; detalhes em [HEADLESS_DIAGNOSTICS](HEADLESS_DIAGNOSTICS.md). As descrições anteriores de perfil temporário/CDP externo neste log são históricas.

## Produção: Chrome headed em display virtual

Após a matriz homepage Linux headed 200/headless 403, o padrão passa a headed + Xvfb. Docker usa Chrome Stable amd64 e um volume para profiles/journals, sem cópia de cookies ou fallback headless. Tini entrega sinal ao supervisor, que drena Nest antes de encerrar o display. Uma réplica; sem coordenador distribuído. Ver [runtime e limitações verificadas](PRODUCTION_RUNTIME.md). As decisões headless anteriores permanecem como histórico.

## Um browser/contexto, tabs por provider

O custo do processo e do contexto é compartilhado, mantendo parser/collector e locks separados por provider. Storage continua sujeito às origens normais do Chrome; não há evidência que justifique contextos isolados. Não abrir tabs para coletores HTTP. Contexto persistente é dono do Chrome, portanto falha real do contexto/processo exige recriação conjunta; falhas de página só substituem a tab. Não mesclar perfis antigos nem copiar cookies para formar o perfil compartilhado. Ver [SHARED_BROWSER](SHARED_BROWSER.md).
