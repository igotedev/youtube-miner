/**
 * Stub de `server-only` para o Vitest.
 *
 * `server-only` e um pacote-sentinela: ele nao tem comportamento, e existe para
 * que o BUILD DO NEXT falhe se um modulo de servidor for alcancado por codigo de
 * cliente. Quem resolve esse import e o bundler do Next, nao o Node — por isso
 * ele nao existe fora dele.
 *
 * ISTO NAO ENFRAQUECE A PROTECAO. A barreira continua inteira onde ela atua: no
 * `npm run build`. Um componente de cliente que alcance
 * `shared/infrastructure/supabase/` continua quebrando o build, como antes.
 * O alias existe so para que o executor de testes consiga CARREGAR o modulo.
 *
 * Aplicado apenas em `vitest.integration.mts`. A configuracao padrao nao o tem,
 * e nem precisa: os testes unitarios usam adaptadores em memoria e nunca tocam
 * o cliente Supabase.
 */
export {};
