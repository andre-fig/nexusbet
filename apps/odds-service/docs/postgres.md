# Persistência PostgreSQL do odds-service

O modo `postgres` grava cada publicação validada em uma transação antes de atualizar o journal em arquivo e a projeção em memória. Os parsers, transports, matching conservador, TTL e políticas do scheduler continuam os existentes. Prisma 7.10.0 é o único ORM; PostgreSQL 16 é o banco de desenvolvimento.

## Executar localmente

Dentro de `apps/odds-service`:

```sh
# Somente se ainda não existir .env:
cp .env.example .env
npm ci
# Configure POSTGRES_* e DATABASE_URL no .env.
docker compose up -d
npm run db:migrate
npm run db:seed
npm run build
COLLECTION_ENABLED=false npm run start:prod
# Para habilitar o scheduler após configurar o transporte:
COLLECTION_ENABLED=true npm start
```

O Compose publica apenas `127.0.0.1:5433` e mantém os dados no volume `odds_postgres`. As credenciais de `.env.example` são placeholders locais. `.env`, credentials.txt, dados operacionais e o cliente Prisma gerado ficam fora do Git. O ConfigModule agora lê `.env`; variáveis do processo têm precedência. Não existe leitura de credentials.txt pela persistência.

`PERSISTENCE_MODE=postgres` exige DATABASE_URL e falha no startup se o banco ou as migrations não estiverem disponíveis. Sem modo explícito, DATABASE_URL seleciona PostgreSQL; sua ausência mantém o modo legado `file`. Use o modo explícito em implantação. `PERSISTENCE_MODE=file` permite a transição/rollback operacional sem exigir banco. Não há fallback silencioso após uma falha de PostgreSQL configurado.

`prisma generate` roda no postinstall. A implantação precisa incluir `prisma/migrations`, além de `dist/` e das dependências. O Nest verifica nomes, término e checksum das migrations antes de habilitar a coleta; não executa DDL nem synchronize no startup. Aplicação de migrations é o comando separado `db:migrate`.

## Schema e fonte de verdade

Schema completo: [schema.prisma](../prisma/schema.prisma). Migration inicial: [202609150001_initial_odds](../prisma/migrations/202609150001_initial_odds/migration.sql).

| Tabela | Responsabilidade / identidade |
|---|---|
| providers | Slug único; seed idempotente de Bet365, Betano e Superbet. Inserir providers não exige alterar o schema. |
| canonical_events | Evento real identificado pelo matching: esporte, competição, equipes, horário e status explícito. UUID interno. |
| provider_events | Representação do provider. Unique `(provider_id, provider_event_id externo)`. Preserva nomes brutos/normalizados, proveniência, timestamps, `listed` e `removed_at`. |
| event_matches | **Única fonte do vínculo atual** entre provider event e canonical event. Um registro por provider event, confidence, status, motivo e delta de horário. Unmatched tem canonical nulo. Não há FK canônica duplicada em provider_events. |
| match_decisions | Histórico das mudanças de decisão. Permite reutilizar identidade canônica após ausência temporária sem inventar matching novo. Identidades históricas conflitantes geram issue e não são unidas automaticamente. |
| markets | Unique `(provider_event_id interno, provider_market_id externo)`. Preserva raw_market_id separado, categoria, mapa, linha, período, flags e JSONB. |
| selections | Unique `(market_id interno, provider_selection_id externo)`. Nome, lado, linha, suspensão e raw. |
| odds_snapshots | Histórico por selection, publicação e scope de origem. Odds/linha `numeric(24,12)`, mapa e flags observadas. Trigger bloqueia UPDATE e DELETE. |
| data_issues | Tipo/severidade extensíveis, vínculos opcionais, mensagem, detalhes sanitizados e status open/resolved/ignored. Dedupe por chave da ocorrência. |
| issue_transitions | Histórico de abertura, resolução e reabertura de issues. |
| feed_scopes | Última rodada normalizada por scope, seus batches originais e fetched_at; mantém cobertura, baseline de mudanças e catálogo recuperável. |
| publications | Registro transacional de cada captura, hash e eventos de mudança; unique `(scope_id, fetched_at)`. |
| legacy_checkpoints | Projeção JSONB sanitizada necessária para restaurar integralmente os contratos atuais dos stores/APIs. Escrita na mesma transação das entidades normalizadas. |

Todos os IDs internos são UUID; todos os IDs externos são string. Datas são `timestamptz(3)`/UTC. Odds não usam float SQL. Não há remoção de margem, preço próprio, novas regras de matching ou lifecycle live.

Uma observação nova gera snapshots mesmo se a odd não mudou. Repetir a mesma captura no mesmo scope e timestamp é idempotente; conteúdo diferente no mesmo timestamp é rejeitado. Batches/tabulações mantêm timestamps e scopes originais: não se substitui o horário da odd pelo horário de commit. Eventos de mudança usam a função existente `marketChanges`, validada contra journals reais. Comparação de baseline restaurado tolera a ordem das chaves JSONB, preservando a verificação dos valores.

## Publicação, matching e recuperação

```text
Provider → parser/validação existentes → PersistencePort
  → transaction + advisory lock de publicação
    → provider / provider_event / market / selection (upsert)
    → odds_snapshots (append)
    → feed_scopes + publications / mudanças
    → matching sobre NormalizedEvent → canonical / vínculos / issues
    → checkpoint de compatibilidade
  → commit
  → journal em arquivo → memória / API atual
```

Falha SQL reverte a publicação inteira e não altera o estado válido em memória nem o journal. Arquivo e PostgreSQL não formam uma transação distribuída: se houver falha do arquivo **após** commit SQL, PostgreSQL é a fonte de recuperação; os arquivos podem ficar atrás até uma repetição aceita. O journal SQL em `publications` preserva as mudanças. Não removemos nem truncamos journals locais.

Cada scope é atômico; não se transforma a coleta dos três providers em uma transação global. Uma falha de transporte de um provider não reverte dados válidos de outro. O advisory lock serializa apenas as publicações SQL e protege o matching; transporte e os limites de concorrência continuam separados por provider.

Ao reiniciar: conexão → validação de migrations → seed idempotente → restauração dos stores/baselines → catálogo do scheduler → coleta inicial, se habilitada. Locks e contadores de tentativas permanecem operacionais em memória; não retomamos jobs antigos. O transporte exige nova discovery antes de detalhes, mesmo com catálogo restaurado. A restauração não inventa EventAdded nem atualiza fetched_at. Dados vencidos continuam retornando 503 nas APIs existentes conforme o TTL.

O pool só desconecta em `OnApplicationShutdown`, depois que o scheduler encerrou e aguardou publicações em `OnModuleDestroy`.

Evento ausente de listagem válida fica `listed=false` e recebe removed_at; histórico e status anterior permanecem. `EventRemoved` nunca implica `finished`. Falha de listagem não executa remoções. As validações atuais dos providers continuam rejeitando feeds vazios não autoritativos.

## Consultas de leitura

Endpoints existentes permanecem iguais. Consultas novas de banco:

- `GET /providers`: providers e contagem histórica de provider events.
- `GET /events` / `/events/:uuid`: eventos canônicos, vínculos, providers, mercados, seleções e último snapshot.
- `GET /provider-events?provider=superbet`: eventos de provider, inclusive unmatched e ausentes, com flags e last_seen_at.
- `GET /issues?status=open`: issues e transições.
- `GET /selections/:uuid/odds-history?before=<ISO>`: snapshots em ordem temporal decrescente.

A odd atual usa a abordagem **A: último snapshot por seleção**, ordenando fetched_at e created_at, com índice correspondente. Não existe coluna paralela de current_odds. Relações são carregadas em lote pelo Prisma, não por uma consulta manual para cada seleção. O histórico da mesma captura pode conter observações em scopes distintos.

Essas consultas são persistentes/históricas, não uma autorização para usar odds vencidas: inspecione fetched_at/last_seen_at/listed e os scopes. Mercados antigos não são apagados e podem aparecer na consulta histórica. O frontend não foi implementado. Limites atuais: 50 canonical events, 100 provider events/issues, 200 snapshots; ainda não há paginação completa para um dashboard. Odds decimais nas **novas** rotas serializam como string; as rotas normalizadas existentes continuam usando o schema original numérico.

## Índices e constraints

Além de PKs e FKs, a migration cria:

- providers: unique slug.
- canonical_events: starts_at; status.
- provider_events: unique provider_id/external ID; provider_id/starts_at; last_seen_at; provider_status.
- event_matches: unique provider_event_id; canonical_event_id; status.
- match_decisions: provider_event_id/detected_at DESC.
- markets: unique provider_event_id/external market ID (também serve às consultas por provider_event_id); category/map_number.
- selections: unique market_id/external selection ID (também serve às consultas por market_id).
- odds_snapshots: selection_id/fetched_at DESC/created_at DESC; unique publication_id/selection_id/source_scope/fetched_at.
- data_issues: unique dedupe_key; status/severity/detected_at DESC; provider_id; canonical_event_id; provider_event_id.
- issue_transitions: issue_id/at.
- feed_scopes: unique name; provider_id/kind.
- publications: unique scope_id/fetched_at.
- legacy_checkpoints: unique key.

Checks SQL: odd nula ou >1; mapa positivo; confidence entre 0 e 1; vínculo canônico coerente com status matched/unmatched. Snapshot append-only é imposto por trigger. Não há purge, particionamento ou banco adicional.

## Importação opcional

```sh
# Inspeciona apenas, sem gravar/conectar ao banco:
npm run db:import-legacy -- --root /caminho/do/arquivo
# Com o coletor parado, destino inicialmente vazio:
npm run db:import-legacy -- --root /caminho/do/arquivo --apply
# Retomar/repetir o mesmo arquivo:
npm run db:import-legacy -- --root /caminho/do/arquivo --apply --resume
```

O importador lê os captures originais de `inbox/`, `detail-inbox/`, `betano-inbox/` e `superbet-inbox/`, ordena pelo timestamp e reutiliza os stores/parsers. Assim reconstrói entidades, snapshots, matching e checkpoints sem inventar dados a partir de journals incompletos. Não acessa browser nem autenticação. O comando nunca roda automaticamente.

Limitação explícita: não importa NDJSON isolado quando os captures originais já foram descartados. Não faz backfill de capturas anteriores ao último timestamp de um scope já publicado. `--resume` serve para o mesmo arquivo após interrupção, e a deduplicação foi testada. O scanner normal continua consumindo inboxes configuradas; na migração, use diretórios de entrada novos ou faça a importação antes de iniciar o serviço. O importador usa um diretório temporário para sua cópia dos journals, sem editar o arquivo original.

## Testes e validação

```sh
npm test
npm run typecheck
npm run build
npm run format:check
# Banco separado, destrutível, com nome terminado em _test:
docker compose exec postgres createdb -U odds odds_service_test
# Defina TEST_DATABASE_URL conforme seu .env, apontando para esse banco:
npm run test:db
```

A suíte SQL exige TEST_DATABASE_URL, aplica migrations e limpa apenas o banco explicitamente indicado com sufixo `_test`. Não aponta automaticamente para DATABASE_URL. Cobre seed, constraints, upserts, precisão, histórico imutável, entidades de três providers, matching/identidade, issues/transições, rollback, scopes, retomada, isolamento do journal, importação idempotente, API, TTL e shutdown. Fixtures dos providers são as mesmas, sem alterações. Os testes normais não dependem de PostgreSQL nem dos sites.

O build compilado, a recuperação sem arquivos locais e o shutdown foram validados. O health indica a conexão inicializada e degrada após uma operação SQL falhar; não é um ping externo contínuo. Falhas de consultas retornam 503 com mensagem sanitizada.

## Limitações de operação

- Uma instância escritora/coletora por instalação, como antes. O lock SQL não transforma os checkpoints e o scheduler em um sistema distribuído.
- Retenção e backup/purge operacional ainda não são implementados. Faça backup PostgreSQL/volume antes de alterações destrutivas.
- Issues automáticas nesta etapa: unmatched e conflitos de identidade canônica. Os outros tipos têm espaço no modelo, mas não inventamos detectores.
- O journal de arquivo e as projeções JSONB de compatibilidade são legado deliberadamente mantido. Não há migração destrutiva de arquivos.
- Bet365/Betano usam Chrome headless por padrão, sem fallback visível. Neste ambiente, o headless recebeu bloqueio e não forneceu os feeds; o modo visível é diagnóstico explícito via HEADLESS=false. Superbet usa HTTP público. Nenhuma credencial de bookmaker foi necessária nesta tarefa.
- Overrides pontuais de `deepmerge-ts` e `mysql2` atualizam dependências transitivas da CLI Prisma. O config usado é composto por objetos simples; generate/migrate/seed foram testados com essas versões. [Notas do deepmerge-ts 8](https://github.com/RebeccaStevens/deepmerge-ts/releases/tag/v8.0.0). `npm audit` não reportou vulnerabilidades após a atualização.
