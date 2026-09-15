# Fixtures reais EstrelaBet

Capturas HTTP anônimas de 15/09/2026 UTC. `capturedAt` registra a captura local; endpoints, query, transport e autenticação estão no envelope. Sem cookies, tokens, headers de conta ou dados pessoais.

- `list.json`: quatro páginas reais de GetUpcoming (inclui outras categorias para validar o filtro); 36 CS2, 3 LoL, 2 Valorant elegíveis.
- `cs2.json`: Team Brute × G2 Ares, 17707439; 30 objetos de mercado, mapas 1/2.
- `lol.json`: ⁠9z Globant × Fuego, 17688530; 14 objetos, mapas 1/2/3.
- `valorant.json`: Gen.G GC × FENNEL GC, 17708904; 18 objetos, mapas 1/2.

Cada detalhe contém um container Boosted Odds vazio. Não são fixtures inventadas de mapas 4/5 ou suspensão: esses casos são mutações controladas em testes, mantendo os arquivos originais. Odds, horários e IDs não devem ser atualizados só para fazer testes passar.

[Protocolo, validação visual e limitações](../../../../../../docs/ESTRELABET.md).
