import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

/**
 * Regras de fronteira arquitetural.
 *
 * A fonte da verdade em prosa e docs/architecture/dependency-rules.md.
 * Aqui esta a metade "pacotes externos e imports com alias"; a outra metade
 * (imports relativos, resolvidos para caminhos reais no disco) esta em
 * tests/architecture/dependency-rules.test.ts. As duas rodam em `npm run verify`.
 *
 * IMPORTANTE: `no-restricted-imports` e uma regra unica. Em flat config, o
 * ultimo bloco que casa com o arquivo substitui a configuracao da regra por
 * inteiro — nao acumula. Por isso os blocos abaixo vao do geral para o
 * especifico e cada bloco especifico REPETE os padroes gerais.
 */

/**
 * Arquivos de teste sao raizes de composicao: montam casos de uso com
 * adaptadores falsos, como src/config/composition/ fara com os reais. Ficam de
 * fora das regras de ACESSO A ADAPTADORES (R3, R5, R6), mas continuam sujeitos
 * a R1, R2 e R4 pela camada em que vivem. Mesma excecao em
 * tests/architecture/dependency-rules.test.ts — as duas redes tem de concordar.
 */
const TEST_FILES = ['**/*.test.ts', '**/*.test.tsx', '**/*.spec.ts', '**/*.spec.tsx'];

const UI_AND_FRAMEWORK = [
  'react',
  'react/*',
  'react-dom',
  'react-dom/*',
  'next',
  'next/*',
  'server-only',
  'client-only',
];

const EXTERNAL_SDKS = [
  '@supabase/*',
  '@anthropic-ai/*',
  'googleapis',
  'googleapis/*',
  'google-auth-library',
];

const INFRASTRUCTURE_PATHS = [
  '**/infrastructure',
  '**/infrastructure/**',
  '@/**/infrastructure/**',
];

/** R5: um modulo so pode ser alcancado pelo seu barrel publico `@/modules/<nome>`. */
const CROSS_MODULE_DEEP_IMPORT = {
  group: [
    '@/modules/*/domain',
    '@/modules/*/domain/**',
    '@/modules/*/application',
    '@/modules/*/application/**',
    '@/modules/*/infrastructure',
    '@/modules/*/infrastructure/**',
    '@/modules/*/presentation',
    '@/modules/*/presentation/**',
  ],
  message:
    'Import profundo em outro modulo. Use apenas o barrel publico `@/modules/<nome>`; dentro do proprio modulo, use caminhos relativos. Regra R5 em docs/architecture/dependency-rules.md.',
};

/** R1, R2 e R4: valem inclusive para arquivos de teste. */
const INNER_LAYER_ALWAYS_FORBIDDEN = [
  {
    group: UI_AND_FRAMEWORK,
    message:
      'Camadas domain/application nao podem depender de React ou Next.js. Regra R1 em docs/architecture/dependency-rules.md.',
  },
  {
    group: EXTERNAL_SDKS,
    message:
      'Camadas domain/application nao podem depender de SDKs externos. Defina uma porta e implemente o adaptador em infrastructure. Regra R2 em docs/architecture/dependency-rules.md.',
  },
  {
    group: ['**/presentation', '**/presentation/**', '@/**/presentation/**'],
    message:
      'Camadas domain/application nao podem importar presentation. Regra R4 em docs/architecture/dependency-rules.md.',
  },
];

/** R3: dispensada em teste, que atua como raiz de composicao. */
const INNER_LAYER_FORBIDDEN = [
  ...INNER_LAYER_ALWAYS_FORBIDDEN,
  {
    group: INFRASTRUCTURE_PATHS,
    message:
      'Camadas internas nao podem importar infrastructure. A dependencia se inverte: infrastructure implementa as portas. Regra R3 em docs/architecture/dependency-rules.md.',
  },
];

/**
 * R9: camadas internas nao acessam fontes de nao-determinismo.
 *
 * `new Date()` sem argumento, `Date.now()`, `Math.random()` e `performance.now()`
 * devolvem valores diferentes a cada execucao. Uma unica chamada dessas dentro
 * de `domain` faz a mesma entrada produzir saidas diferentes e derruba a RN-13
 * sem que nenhum teste necessariamente falhe.
 *
 * `new Date(valor)` COM argumento continua permitido: e construcao pura.
 * A unica implementacao autorizada a ler o relogio e
 * `shared/infrastructure/system-clock.ts`, atras da porta `Clock`.
 */
const NONDETERMINISTIC_SYNTAX = [
  {
    selector: 'NewExpression[callee.name="Date"][arguments.length=0]',
    message:
      'domain/application nao podem ler o relogio. Receba o instante por parametro (`collectedAt`) ou injete a porta `Clock`. Regra R9 em docs/architecture/dependency-rules.md.',
  },
  {
    selector: 'CallExpression[callee.object.name="Date"][callee.property.name="now"]',
    message:
      'domain/application nao podem ler o relogio. Receba o instante por parametro ou injete a porta `Clock`. Regra R9 em docs/architecture/dependency-rules.md.',
  },
  {
    selector: 'CallExpression[callee.object.name="Math"][callee.property.name="random"]',
    message:
      'domain/application nao podem usar aleatoriedade: quebra o determinismo exigido pela RN-13. Injete o valor. Regra R9 em docs/architecture/dependency-rules.md.',
  },
  {
    selector: 'CallExpression[callee.object.name="performance"][callee.property.name="now"]',
    message:
      'domain/application nao podem ler o relogio. Regra R9 em docs/architecture/dependency-rules.md.',
  },
];

/**
 * Excecao da raiz de composicao (R5/R6).
 *
 * `src/config/composition/` monta os casos de uso com adaptadores CONCRETOS, e
 * para isso precisa alcancar `infrastructure` — que os barrels nao reexportam,
 * de proposito: adaptador nao e contrato publico de modulo.
 *
 * E a mesma excecao ja concedida aos arquivos de teste, e estes dois sao os
 * unicos lugares que a tem. Sem ela, a alternativa seria reexportar adaptadores
 * nos barrels, o que tornaria qualquer arquivo capaz de instanciar um cliente
 * Supabase — exatamente o que a R6 existe para impedir.
 *
 * A excecao e ESTREITA: libera apenas `infrastructure`. `domain` e `application`
 * de outro modulo continuam acessiveis so pelo barrel publico.
 */
const COMPOSITION_ROOT_FORBIDDEN = [
  {
    group: [
      '@/modules/*/domain',
      '@/modules/*/domain/**',
      '@/modules/*/application',
      '@/modules/*/application/**',
      '@/modules/*/presentation',
      '@/modules/*/presentation/**',
    ],
    message:
      'A raiz de composicao alcanca `infrastructure`, mas nao o domain/application de outro modulo — esses vem do barrel publico `@/modules/<nome>`. Regra R5 em docs/architecture/dependency-rules.md.',
  },
];

/** R6: presentation consome casos de uso, nao instancia adaptadores. */
const PRESENTATION_FORBIDDEN = [
  CROSS_MODULE_DEEP_IMPORT,
  {
    group: INFRASTRUCTURE_PATHS,
    message:
      'Presentation nao instancia adaptadores. Injete as dependencias a partir da raiz de composicao em src/config/composition/. Regra R6 em docs/architecture/dependency-rules.md.',
  },
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,

  // `supabase/.temp/` guarda o bundle do edge runtime que o CLI gera ao subir a
  // stack local. E codigo de terceiro, minificado, e nao passa pelas nossas
  // regras — nem deveria.
  globalIgnores([
    '.next/**',
    'out/**',
    'build/**',
    'coverage/**',
    'next-env.d.ts',
    'supabase/.temp/**',
    'supabase/.branches/**',
  ]),

  {
    name: 'niche-miner/module-boundaries',
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [CROSS_MODULE_DEEP_IMPORT] }],
    },
  },

  {
    name: 'niche-miner/inner-layer-boundaries',
    files: [
      'src/**/domain/**/*.ts',
      'src/**/domain/**/*.tsx',
      'src/**/application/**/*.ts',
      'src/**/application/**/*.tsx',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [CROSS_MODULE_DEEP_IMPORT, ...INNER_LAYER_FORBIDDEN] },
      ],
      'no-restricted-syntax': ['error', ...NONDETERMINISTIC_SYNTAX],
    },
  },

  {
    name: 'niche-miner/presentation-boundaries',
    files: [
      'src/app/**/*.ts',
      'src/app/**/*.tsx',
      'src/**/presentation/**/*.ts',
      'src/**/presentation/**/*.tsx',
    ],
    rules: {
      'no-restricted-imports': ['error', { patterns: PRESENTATION_FORBIDDEN }],
    },
  },

  {
    // Depois de module-boundaries de proposito: substitui a regra para a raiz de
    // composicao, que e o unico lugar do codigo de producao autorizado a
    // instanciar adaptadores.
    name: 'niche-miner/composition-root',
    files: ['src/config/composition/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: COMPOSITION_ROOT_FORBIDDEN }],
    },
  },

  {
    // Vem por ultimo de proposito: substitui os blocos acima para arquivos de
    // teste, mantendo R1/R2/R4 e liberando R3/R5/R6.
    name: 'niche-miner/test-boundaries',
    files: TEST_FILES,
    rules: {
      'no-restricted-imports': ['error', { patterns: INNER_LAYER_ALWAYS_FORBIDDEN }],
    },
  },
]);

export default eslintConfig;
