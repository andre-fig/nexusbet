# Snapshots e histórico de odds

[Índice](../README.md#documentation) · Código: [market-journal.ts](../apps/odds-service/src/modules/snapshots/market-journal.ts), [PersistenceService](../apps/odds-service/src/modules/persistence/persistence.service.ts).

## Estado atual versus histórico

Stores mantêm a projeção aceita para servir a API. Journal e odds_snapshots conservam observações anteriores. Uma sequência 1.72 → 1.70 → 1.68 produz três observações históricas; não atualiza a primeira linha para 1.68. Nova observação com a mesma odd também é conservada inicialmente: não há deduplicação global apenas por igualdade de preço.

`OddsSnapshot` no domínio inclui provider, eventId, marketId, selectionId, map, odds, line, suspended, inPlay e fetchedAt. No SQL a FK selection permite chegar ao mercado/evento/provider; snapshots também guardam publicationId/sourceScope. UUIDs internos não substituem IDs externos.

Datas são da fonte/captura, não do momento do INSERT. Abas/mercados capturados em instantes diferentes conservam seus timestamps individuais. createdAt SQL é auditoria da gravação. Unknown/null não é false nem zero.

## Mudanças registradas

A função `marketChanges` compara estado anterior e novo dentro da cobertura aceita:

| Evento | Significado |
|---|---|
| EventAdded | Evento passou a existir nesse scope |
| EventRemoved | Evento deixou de existir nesse scope válido |
| MarketAdded | Mercado novo no evento |
| MarketRemoved | Mercado ausente na nova cobertura comparável |
| MarketSuspended | Flag do mercado passou de false para true |
| MarketReopened | Flag do mercado passou de true para false |
| OddsChanged | Seleção existente mudou odd ou linha (da seleção/mercado) |

Consulte o predicado exato de OddsChanged no código antes de adicionar novos campos à seleção; não crie outro comparador paralelo. OddsChanged compara odd, linha da seleção e linha do mercado; flags isoladas permanecem no snapshot e as transições false↔true do mercado têm os eventos próprios. null→true não emite MarketSuspended no comparador atual. Seleções de mercado novo aparecem no snapshot/MarketAdded; não se exige OddsChanged artificial para a primeira observação.

**EventRemoved != EventFinished.** Desaparecimento pode decorrer de oferta removida, mudança de cobertura ou início. O sistema não liquida e não infere término. Mercado removido não é apagado do histórico SQL.

## Scopes, cobertura e deduplicação

Scope identifica provider/modalidade/listagem ou detalhe e sua cobertura. Detalhe popular/main não pode substituir captura full como se cobrisse todos os mercados. Stores validam abas/competições e rejeitam cobertura parcial incompatível antes de remover registros.

Uma repetição idêntica de scope + fetchedAt é idempotente; conteúdo conflitante no mesmo timestamp é rejeitado. Publicações anteriores ao último timestamp de um scope não são backfill. Observações compartilhadas entre listagem/detalhe usam baselines de scopes relacionados e preservam timestamp original; repetição equivalente não inventa mudança.

A comparação de baselines restaurados considera valores, tolerando a reordenação de chaves pelo JSONB. Não normalize isso removendo campos de proveniência ou timestamps.

## SQL e arquivos

A transação grava entidades, snapshots, publications.changes, feed_scopes e legacy_checkpoints, além do matching. Depois confirma a projeção/journal mínimo em memória e emite notificações. `odds_snapshots` usa numeric(24,12); trigger proíbe UPDATE/DELETE. A proteção não é autorização para TRUNCATE nem substitui backup.

Unique `(publication_id, selection_id, source_scope, fetched_at)` impede duplicação da mesma observação na publicação. A consulta atual usa último snapshot por seleção, ordenado por fetchedAt DESC e createdAt DESC; não há current_odds separado.

Em modo postgres, checkpoints JSONB e feed scopes são a recuperação persistente; cada journal restaura somente os baselines dos feed scopes pertencentes ao seu provider (relação `provider_id` no banco), mesmo quando o nome interno do scope não tem prefixo do provider. Não duplica NDJSON/latest no filesystem. Falha SQL mantém memória/journal anterior. Journals em arquivo permanecem apenas no modo file para testes/replay e o importador legado lê capturas antigas explicitamente.

## Inspeção e reprocessamento

- `/selections/:uuid/odds-history` usa UUID interno, não selectionId do bookmaker.
- `/events/:uuid` traz últimas observações, inclusive de mercados historicamente conhecidos; verifique fetchedAt/listed.
- `publications.changes` preserva eventos do journal na transação SQL.
- Importador opcional reconstrói a partir de capturas originais das inboxes, não NDJSON isolado. Não executa automaticamente nem faz backfill antigo em scope avançado.

Não há purge, particionamento ou política automática de retenção. Planeje backup/capacidade antes de qualquer limpeza. Testes cobrem repetição, mudanças, suspensão, cobertura parcial, rollback e restauração: snapshots/tests e persistence/tests. Procedimentos em [Operations](OPERATIONS.md).
