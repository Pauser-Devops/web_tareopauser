import React from "react";

type Props = {
    paginaActual: number;
    totalPaginas: number;
    porPagina: number;
    totalFiltradas: number;
    setPagina: (p: number) => void;
};

export default function PaginationControls({ paginaActual, totalPaginas, porPagina, totalFiltradas, setPagina }: Props) {
    if (totalPaginas <= 1) return null;
    const offsetInicio = paginaActual * porPagina;
    return (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "12px", flexWrap: "wrap", gap: "8px" }}>
            <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
                Mostrando {offsetInicio + 1}–{Math.min(offsetInicio + porPagina, totalFiltradas)} de {totalFiltradas} empleados
            </span>
            <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
                <button
                    className="btn btn--ghost"
                    style={{ fontSize: "12px", padding: "4px 10px" }}
                    onClick={() => setPagina(paginaActual - 1)}
                    disabled={paginaActual === 0}
                >
                    ← Anterior
                </button>
                {Array.from({ length: totalPaginas }, (_, i) => {
                    const cerca = Math.abs(i - paginaActual) <= 2 || i === 0 || i === totalPaginas - 1;
                    const esPunto = Math.abs(i - paginaActual) === 3 && i !== 0 && i !== totalPaginas - 1;
                    if (esPunto) {
                        return <span key={`dot-${i}`} style={{ padding: "0 2px", color: "var(--color-text-muted)", fontSize: "12px" }}>…</span>;
                    }
                    if (!cerca) return null;
                    return (
                        <button
                            key={i}
                            className="btn"
                            style={{
                                fontSize: "12px", padding: "4px 9px", minWidth: "32px",
                                background: paginaActual === i ? "var(--color-primary)" : "transparent",
                                color: paginaActual === i ? "#fff" : "var(--color-text-muted)",
                                border: paginaActual === i ? "none" : "1px solid var(--color-border)",
                            }}
                            onClick={() => setPagina(i)}
                        >
                            {i + 1}
                        </button>
                    );
                })}
                <button
                    className="btn btn--ghost"
                    style={{ fontSize: "12px", padding: "4px 10px" }}
                    onClick={() => setPagina(paginaActual + 1)}
                    disabled={paginaActual >= totalPaginas - 1}
                >
                    Siguiente →
                </button>
            </div>
        </div>
    );
}
