import React from "react";

export default class AppErrorBoundary extends React.Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("No se pudo mostrar la pantalla de ClusterAG:", error, info.componentStack);
  }

  returnToDashboard = () => {
    try {
      window.localStorage.setItem("cluster_os_view", "dashboard");
    } catch {
      // La recarga sigue disponible si el navegador bloquea el almacenamiento.
    }
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <main className="min-h-screen flex items-center justify-center p-6 text-slate-800 dark:text-slate-100">
        <section className="w-full max-w-lg space-y-5" role="alert" aria-labelledby="app-error-title">
          <p className="text-sm font-semibold text-slate-500">CLUSTER AGENCY OS</p>
          <h1 id="app-error-title" className="text-2xl font-bold">
            No pudimos mostrar esta pantalla
          </h1>
          <p>
            Intenta volver al panel de inicio o recargar la página. Si el problema
            continúa, comparte el detalle del error con soporte.
          </p>
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={this.returnToDashboard}
              className="rounded-lg bg-indigo-600 px-4 py-3 font-semibold text-white">
              Volver al inicio
            </button>
            <button type="button" onClick={() => window.location.reload()}
              className="rounded-lg border border-slate-300 px-4 py-3 font-semibold">
              Recargar página
            </button>
          </div>
          <details className="text-sm">
            <summary className="cursor-pointer">Detalle del error</summary>
            <pre className="mt-3 whitespace-pre-wrap break-words">
              {String(this.state.error?.message || this.state.error)}
            </pre>
          </details>
        </section>
      </main>
    );
  }
}
