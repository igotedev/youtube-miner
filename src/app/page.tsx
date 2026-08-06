/**
 * Pagina de fundacao.
 *
 * Deliberadamente estatica e sem regra de negocio: esta etapa entrega a
 * fundacao arquitetural, nao funcionalidades. A tela de analise de canais so
 * sera construida quando a SPEC correspondente existir.
 */

const MODULES = [
  { name: 'identity', role: 'Autenticacao, usuario, sessao e permissoes.' },
  {
    name: 'youtube-collection',
    role: 'Resolucao de URL, coleta de canais e videos, quota, cache.',
  },
  { name: 'channel-analysis', role: 'Orquestra a analise e registra o estado.' },
  { name: 'video-analytics', role: 'Metricas objetivas e deterministicas.' },
  { name: 'ai-insights', role: 'Relatorio textual gerado por IA.' },
  { name: 'watchlists', role: 'Listas de canais salvos e observacoes.' },
] as const;

export default function HomePage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-16">
      <header className="flex flex-col gap-3">
        <p className="font-mono text-xs tracking-widest text-muted uppercase">
          Etapa 1 — fundacao arquitetural
        </p>
        <h1 className="text-3xl font-semibold text-balance">YouTube Niche Miner</h1>
        <p className="text-muted">
          Plataforma para encontrar, analisar e comparar canais do YouTube a partir de dados
          publicos. Nenhuma funcionalidade do MVP foi implementada ainda.
        </p>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold tracking-wide uppercase">Modulos</h2>
        <ul className="divide-y divide-border rounded-lg border border-border">
          {MODULES.map((module) => (
            <li key={module.name} className="flex flex-col gap-1 px-4 py-3">
              <span className="font-mono text-sm">{module.name}</span>
              <span className="text-sm text-muted">{module.role}</span>
            </li>
          ))}
        </ul>
      </section>

      <footer className="text-sm text-muted">
        Documentacao em <code className="font-mono">docs/</code> — comece por{' '}
        <code className="font-mono">docs/specs/SPEC-001-product-foundation.md</code>.
      </footer>
    </main>
  );
}
