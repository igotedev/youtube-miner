import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Verificacao executavel das regras de dependencia.
 *
 * Complementa o ESLint em vez de repeti-lo. O ESLint casa padroes contra o
 * TEXTO do import, o que o deixa cego para caminhos relativos disfarcados
 * (`../../infrastructure/x`) e pode ser desligado com `eslint-disable`. Aqui os
 * imports sao RESOLVIDOS para caminhos reais no disco antes de julgar, e nao ha
 * como suprimir a checagem sem apagar o teste.
 *
 * Fonte da verdade em prosa: docs/architecture/dependency-rules.md.
 */

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src');

type Layer = 'domain' | 'application' | 'infrastructure' | 'presentation';

interface SourceFile {
  /** Caminho relativo a `src`, sempre com barra normal. */
  readonly rel: string;
  readonly abs: string;
  readonly layer: Layer | null;
  readonly moduleName: string | null;
  readonly isTest: boolean;
  /** Codigo sem comentarios. As checagens de texto usam este valor, nunca o bruto. */
  readonly code: string;
  readonly imports: readonly string[];
}

/**
 * Um teste e uma raiz de composicao: e o lugar legitimo para montar um caso de
 * uso com adaptadores falsos, exatamente como src/config/composition/ faz com
 * os reais. Por isso arquivos de teste ficam de fora das regras que restringem
 * o ACESSO A ADAPTADORES (R3, R5, R6).
 *
 * Eles continuam sujeitos a R1, R2, R4 e R8: um teste de dominio que importe
 * React ou leia process.env continua sendo violacao.
 */
const isTestFile = (rel: string) => /\.(test|spec)\.tsx?$/.test(rel);

/**
 * A raiz de composicao e a OUTRA excecao, e a unica no codigo de producao.
 *
 * Monta os casos de uso com adaptadores concretos, e por isso alcanca
 * `infrastructure`, que os barrels nao reexportam de proposito. A excecao e
 * estreita: vale so para `infrastructure`. O domain/application de outro modulo
 * continua vindo do barrel publico.
 *
 * Mesma excecao em eslint.config.mjs (bloco `niche-miner/composition-root`) —
 * as duas redes tem de concordar.
 */
const isCompositionRoot = (rel: string) => rel.startsWith('config/composition/');

const IMPORT_PATTERN = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s*['"]([^'"]+)['"]/g;
const BARE_IMPORT_PATTERN = /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g;

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listSourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

/**
 * Remove comentarios, preservando literais de string.
 *
 * Necessario porque as checagens abaixo trabalham sobre texto. Sem isso, um
 * comentario que apenas MENCIONA `process.env` ou um import — como a
 * documentacao de uma funcao pura explicando o que ela nao faz — seria acusado
 * como violacao real. Um guarda que acusa o inocente e abandonado.
 *
 * A varredura precisa reconhecer strings, e nao apenas apagar tudo depois de
 * `//`: uma URL em um caso de teste (`'https://youtube.com/@x'`) contem `//` e
 * seria truncada no meio.
 */
function stripComments(source: string): string {
  let out = '';
  let i = 0;

  while (i < source.length) {
    const char = source[i];
    const next = source[i + 1];

    if (char === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i += 1;
      continue;
    }

    if (char === '/' && next === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }

    if (char === '"' || char === "'" || char === '`') {
      const quote = char;
      out += char;
      i += 1;
      while (i < source.length) {
        if (source[i] === '\\') {
          out += source.slice(i, i + 2);
          i += 2;
          continue;
        }
        out += source[i];
        const closed = source[i] === quote;
        i += 1;
        if (closed) break;
      }
      continue;
    }

    out += char;
    i += 1;
  }

  return out;
}

function extractImports(contents: string): string[] {
  const found: string[] = [];
  for (const pattern of [IMPORT_PATTERN, BARE_IMPORT_PATTERN]) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(contents)) !== null) {
      const specifier = match[1];
      if (specifier !== undefined) found.push(specifier);
    }
  }
  return found;
}

function layerOf(rel: string): Layer | null {
  const segments = rel.split('/');
  for (const layer of ['domain', 'application', 'infrastructure', 'presentation'] as const) {
    if (segments.includes(layer)) return layer;
  }
  return null;
}

function moduleOf(rel: string): string | null {
  const segments = rel.split('/');
  return segments[0] === 'modules' ? (segments[1] ?? null) : null;
}

const FILES: readonly SourceFile[] = listSourceFiles(SRC).map((abs) => {
  const rel = path.relative(SRC, abs).split(path.sep).join('/');
  const code = stripComments(readFileSync(abs, 'utf8'));
  return {
    rel,
    abs,
    layer: layerOf(rel),
    moduleName: moduleOf(rel),
    isTest: isTestFile(rel),
    code,
    imports: extractImports(code),
  };
});

/**
 * Converte um import em caminho relativo a `src`, ou `null` se apontar para
 * fora do projeto (pacote do npm ou modulo nativo).
 */
function resolveToSrc(file: SourceFile, specifier: string): string | null {
  if (specifier.startsWith('@/')) return specifier.slice(2);
  if (!specifier.startsWith('.')) return null;

  const fromDir = path.dirname(file.abs);
  const resolved = path.resolve(fromDir, specifier);
  const rel = path.relative(SRC, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join('/');
}

function isExternalPackage(specifier: string): boolean {
  return !specifier.startsWith('.') && !specifier.startsWith('@/');
}

/** Descreve uma violacao de forma acionavel: arquivo + import + regra. */
function violation(file: SourceFile, specifier: string, rule: string): string {
  return `${rule} — src/${file.rel} importa "${specifier}"`;
}

const INNER_LAYERS: readonly Layer[] = ['domain', 'application'];

const FORBIDDEN_IN_INNER_LAYERS = [
  /^react$/,
  /^react\//,
  /^react-dom$/,
  /^react-dom\//,
  /^next$/,
  /^next\//,
  /^@supabase\//,
  /^@anthropic-ai\//,
  /^googleapis$/,
  /^google-auth-library$/,
  /^server-only$/,
  /^client-only$/,
];

describe('stripComments', () => {
  // Guarda do guarda: se o filtro de comentarios apagar codigo de verdade, as
  // regras abaixo passariam a nao detectar nada e ninguem perceberia.
  it('remove comentarios de linha e de bloco', () => {
    expect(stripComments('const a = 1; // process.env.X')).not.toContain('process.env');
    expect(stripComments('/* usa process.env */ const a = 1;')).not.toContain('process.env');
  });

  it('preserva codigo real', () => {
    expect(stripComments('// nota\nconst k = process.env.API_KEY;')).toContain('process.env');
    expect(stripComments("/* nota */\nimport x from './y';")).toContain("from './y'");
  });

  it('nao trunca URLs dentro de strings', () => {
    const source = "const url = 'https://youtube.com/@canal'; const k = process.env.X;";
    expect(stripComments(source)).toContain('process.env');
    expect(stripComments(source)).toContain('https://youtube.com/@canal');
  });
});

describe('regras de dependencia', () => {
  it('encontra os arquivos de src para analisar', () => {
    // Guarda contra um falso verde: se a varredura quebrar e devolver lista
    // vazia, todos os testes abaixo passariam sem verificar nada.
    expect(FILES.length).toBeGreaterThan(10);
    expect(FILES.some((f) => f.layer === 'domain')).toBe(true);
    expect(FILES.some((f) => f.layer === 'application')).toBe(true);
  });

  it('R1/R2 — domain e application nao dependem de React, Next ou SDKs externos', () => {
    const violations = FILES.filter(
      (f) => f.layer !== null && INNER_LAYERS.includes(f.layer),
    ).flatMap((file) =>
      file.imports
        .filter((s) => isExternalPackage(s))
        .filter((s) => FORBIDDEN_IN_INNER_LAYERS.some((p) => p.test(s)))
        .map((s) => violation(file, s, 'R1/R2')),
    );

    expect(violations).toEqual([]);
  });

  it('R3 — nenhuma camada interna importa infrastructure', () => {
    const violations = FILES.filter(
      (f) => !f.isTest && f.layer !== null && INNER_LAYERS.includes(f.layer),
    ).flatMap((file) =>
      file.imports
        .map((s) => ({ s, target: resolveToSrc(file, s) }))
        .filter(({ target }) => target !== null && target.split('/').includes('infrastructure'))
        .map(({ s }) => violation(file, s, 'R3')),
    );

    expect(violations).toEqual([]);
  });

  it('R4 — domain e application nao importam presentation', () => {
    const violations = FILES.filter(
      (f) => f.layer !== null && INNER_LAYERS.includes(f.layer),
    ).flatMap((file) =>
      file.imports
        .map((s) => ({ s, target: resolveToSrc(file, s) }))
        .filter(({ target }) => target !== null && target.split('/').includes('presentation'))
        .map(({ s }) => violation(file, s, 'R4')),
    );

    expect(violations).toEqual([]);
  });

  it('R5 — modulos so se alcancam pelo barrel publico', () => {
    // Vale para TODO codigo de producao, inclusive o que vive fora de
    // `modules/` — `src/app/` alcancando `@/modules/x/domain/y` e a mesma
    // violacao. Antes da SPEC-006 nao havia arquivo assim para pegar.
    const violations = FILES.filter((f) => !f.isTest).flatMap((file) =>
      file.imports
        .map((s) => ({ s, target: resolveToSrc(file, s) }))
        .filter(({ target }) => {
          if (target === null) return false;
          const segments = target.split('/');
          if (segments[0] !== 'modules') return false;
          const targetModule = segments[1];
          // Dentro do proprio modulo, qualquer caminho e permitido.
          if (targetModule === file.moduleName) return false;
          // Excecao estreita da raiz de composicao: so `infrastructure`.
          if (isCompositionRoot(file.rel) && segments.includes('infrastructure')) return false;
          // Fora dele, so `modules/<nome>` ou `modules/<nome>/index`.
          return segments.length > 2 || (segments.length === 3 && segments[2] !== 'index');
        })
        .map(({ s }) => violation(file, s, 'R5')),
    );

    expect(violations).toEqual([]);
  });

  it('R6 — so a raiz de composicao instancia adaptadores no codigo de producao', () => {
    // Afirmacao POSITIVA, complementar a R3 e a R6. As duas dizem quem NAO pode
    // importar infrastructure; esta diz quem pode — e a lista tem um item.
    // Sem ela, um arquivo novo em `src/config/` ou `src/shared/` poderia montar
    // um cliente Supabase sem cair em nenhuma das outras regras.
    const importers = FILES.filter((f) => !f.isTest)
      .filter((file) =>
        file.imports
          .map((s) => resolveToSrc(file, s))
          .some((target) => target !== null && target.split('/').includes('infrastructure')),
      )
      .map((f) => f.rel)
      // `infrastructure` importando a si mesma e legitimo: um adaptador usa o
      // cliente compartilhado e os mapeadores de linha.
      .filter((rel) => !rel.split('/').includes('infrastructure'))
      .filter((rel) => !isCompositionRoot(rel));

    expect(importers).toEqual([]);
  });

  it('R6 — presentation nao importa infrastructure', () => {
    const violations = FILES.filter(
      (f) => !f.isTest && (f.layer === 'presentation' || f.rel.startsWith('app/')),
    ).flatMap((file) =>
      file.imports
        .map((s) => ({ s, target: resolveToSrc(file, s) }))
        .filter(({ target }) => target !== null && target.split('/').includes('infrastructure'))
        .map(({ s }) => violation(file, s, 'R6')),
    );

    expect(violations).toEqual([]);
  });

  it('R9 — camadas internas nao acessam fontes de nao-determinismo', () => {
    // RN-13: a mesma entrada precisa produzir sempre a mesma saida. Uma unica
    // chamada de relogio dentro de domain derruba isso sem quebrar teste algum.
    // `new Date(valor)` COM argumento continua permitido: e construcao pura.
    const nondeterminism =
      /new\s+Date\s*\(\s*\)|Date\s*\.\s*now\s*\(|Math\s*\.\s*random\s*\(|performance\s*\.\s*now\s*\(/;

    const violations = FILES.filter(
      (f) => f.layer !== null && INNER_LAYERS.includes(f.layer) && nondeterminism.test(f.code),
    ).map((f) => `R9 — src/${f.rel} le o relogio ou usa aleatoriedade`);

    expect(violations).toEqual([]);
  });

  it('R8 — apenas src/config e shared/infrastructure leem process.env', () => {
    // Segredos entram por um unico lugar (src/config/env.ts). Ler process.env
    // espalhado pelo codigo e como as chaves acabam vazando para o cliente.
    const allowed = (rel: string) =>
      rel.startsWith('config/') || rel.startsWith('shared/infrastructure/');

    const violations = FILES.filter((f) => !allowed(f.rel))
      .filter((f) => /process\s*\.\s*env/.test(f.code))
      .map((f) => `R8 — src/${f.rel} le process.env diretamente`);

    expect(violations).toEqual([]);
  });
});
