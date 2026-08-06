# Contratos de API

Vazio nesta etapa: nenhuma rota HTTP existe.

Quando as rotas surgirem, cada uma sera documentada aqui com metodo, caminho,
schema Zod de entrada, schema de saida, codigos de erro possiveis (usando o
`ErrorCode` de `src/shared/errors`) e exigencia de autenticacao.

Regra que vale desde ja: nenhuma rota devolve dado bruto de terceiro. A resposta
e sempre montada a partir de tipos de dominio, e nunca inclui chave, token ou
identificador interno de provedor.
