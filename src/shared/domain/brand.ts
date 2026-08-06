declare const brand: unique symbol;

/**
 * Tipo nominal. Impede trocar acidentalmente identificadores que sao `string`
 * por baixo — por exemplo passar um `UserId` onde se espera um
 * `YouTubeChannelId`. Sem custo em tempo de execucao.
 *
 * Uso:
 *   export type UserId = Brand<string, 'UserId'>;
 *   const id = 'abc' as UserId;
 */
export type Brand<T, B extends string> = T & { readonly [brand]: B };
