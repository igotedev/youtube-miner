# shared/infrastructure

Adaptadores transversais, usados por mais de um modulo.

Hoje contem apenas `system-clock.ts`.

Vao entrar aqui, nas SPECs seguintes:

- fabrica do cliente Supabase (server-side e browser-side, separados);
- cliente HTTP com timeout, retry e backoff, compartilhado pelos adaptadores
  de YouTube e Claude;
- implementacao de cache das respostas de coleta.

Regra: nada aqui pode ser importado por `domain` ou `application`. Essas
camadas so conhecem as portas. Ver R3 em `docs/architecture/dependency-rules.md`.
