import React, { useState, useEffect, useCallback } from "react";
import { fetchTareosPorMes, type TareoAnalistaResumen, mandarARevision } from "../../lib/tareoAnalista";
import { consolidarTareoMaestro, todosLosTareosCerrados } from "../../lib/tareoMaestro";
import { supabase } from "../../lib/supabase";
import { MESES } from "../../lib/supabase";

type Props = {
    anioInicial: number;
    mesInicial: number;
};

// ─── Badge helpers ─────────────────────────────────────────────────────────────
function estadoBadge(estado: string) {
    switch (estado) {
        case "cerrado": return { text: "Cerrado", cls: "badge--green" };
        case "en_revision": return { text: "En Revisión", cls: "badge--orange" };
        case "obs_levantadas": return { text: "Obs. Levantadas", cls: "badge--blue" };
        default: return { text: "Borrador", cls: "badge--yellow" };
    }
}

export default function TareoJefePanel({ anioInicial, mesInicial }: Props) {
    const [anio, setAnio] = useState(() => {
        if (typeof window !== "undefined") {
            const raw = window.sessionStorage.getItem("pt_periodo");
            if (raw) {
                try {
                    return JSON.parse(raw).anio;
                } catch (e) { }
            }
        }
        return anioInicial;
    });
    const [mes, setMes] = useState(() => {
        if (typeof window !== "undefined") {
            const raw = window.sessionStorage.getItem("pt_periodo");
            if (raw) {
                try {
                    return JSON.parse(raw).mes;
                } catch (e) { }
            }
        }
        return mesInicial;
    });

    // Escuchar cambios del global selector
    useEffect(() => {
        if (typeof window === "undefined") return;
        const onStorageChange = () => {
            const raw = window.sessionStorage.getItem("pt_periodo");
            if (raw) {
                try {
                    const pe = JSON.parse(raw);
                    if (pe.anio !== anio) setAnio(pe.anio);
                    if (pe.mes !== mes) setMes(pe.mes);
                } catch (e) { }
            }
        };
        const interval = setInterval(onStorageChange, 500);
        return () => clearInterval(interval);
    }, [anio, mes]);

    const mesLabel = `${MESES[mes]} ${anio}`;

    const [tareos, setTareos] = useState<TareoAnalistaResumen[]>([]);
    const [analistas, setAnalistas] = useState<Map<string, string>>(new Map());
    const [estadoMaestro, setEstadoMaestro] = useState<{
        todos: boolean; totalAnalistas: number; cerrados: number; enRevision: number
    } | null>(null);
    const [maestroConcretado, setMaestroConcretado] = useState(false);

    const [showConfirm, setShowConfirm] = useState(false);
    const [concretando, setConcretando] = useState(false);
    const [msgOk, setMsgOk] = useState<string | null>(null);
    const [msgError, setMsgError] = useState<string | null>(null);
    const [loaded, setLoaded] = useState(false);

    // ── Revisión modal ────────────────────────────────────────────────────────
    const [revisionTareoId, setRevisionTareoId] = useState<string | null>(null);
    const [revisionObs, setRevisionObs] = useState("");
    const [enviandoRevision, setEnviandoRevision] = useState(false);
    const [revisionError, setRevisionError] = useState<string | null>(null);

    const ANIOS = [2024, 2025, 2026, 2027];
    const MESES_LIST = Array.from({ length: 12 }, (_, i) => i + 1);

    // ── Carga principal ───────────────────────────────────────────────────────
    const cargar = useCallback(async () => {
        setLoaded(false);
        if (!supabase) { setLoaded(true); return; }

        const lista = await fetchTareosPorMes(anio, mes);
        setTareos(lista);

        if (lista.length > 0) {
            const ids = [...new Set(lista.map((t) => t.analista_id))];
            const { data: emps } = await supabase
                .from("employees")
                .select("id, full_name")
                .in("id", ids);
            setAnalistas(new Map(
                ((emps ?? []) as { id: string; full_name: string }[]).map((e) => [e.id, e.full_name])
            ));
        } else {
            setAnalistas(new Map());
        }

        const estado = await todosLosTareosCerrados(anio, mes);
        setEstadoMaestro(estado);

        const { data: maestro } = await supabase
            .from("tareo_maestro")
            .select("estado")
            .eq("anio", anio)
            .eq("mes", mes)
            .single();
        setMaestroConcretado(maestro?.estado === "concretado");

        setMsgOk(null);
        setMsgError(null);
        setLoaded(true);
    }, [anio, mes]);

    useEffect(() => { cargar(); }, [cargar]);

    // ── Realtime: escuchar cambios en tareos_analista del mes ─────────────────
    useEffect(() => {
        if (!supabase) return;
        const sb = supabase;
        const channel = sb
            .channel(`jefe-panel-${anio}-${mes}`)
            .on(
                "postgres_changes",
                {
                    event: "*",
                    schema: "public",
                    table: "tareos_analista",
                    filter: `anio=eq.${anio}`,
                },
                () => { cargar(); }
            )
            .subscribe();

        return () => { sb.removeChannel(channel); };
    }, [anio, mes, cargar]);

    // ── Concretar ────────────────────────────────────────────────────────────
    const ejecutarConcretar = useCallback(async () => {
        setConcretando(true);
        setMsgError(null);
        const result = await consolidarTareoMaestro(anio, mes);
        if (result.ok) {
            setMaestroConcretado(true);
            setMsgOk(`Tareo de ${mesLabel} concretado exitosamente.`);
        } else {
            setMsgError(result.error ?? "Error al concretar el tareo.");
        }
        setConcretando(false);
        setShowConfirm(false);
    }, [anio, mes, mesLabel]);

    // ── Mandar a revisión ─────────────────────────────────────────────────────
    const ejecutarRevision = useCallback(async () => {
        if (!revisionTareoId || !revisionObs.trim()) {
            setRevisionError("Debes escribir las observaciones antes de enviar.");
            return;
        }
        setEnviandoRevision(true);
        setRevisionError(null);
        const result = await mandarARevision(revisionTareoId, revisionObs);
        if (result.ok) {
            setRevisionTareoId(null);
            setRevisionObs("");
            // La lista se actualiza vía realtime
        } else {
            setRevisionError(result.error ?? "Error al enviar observaciones.");
        }
        setEnviandoRevision(false);
    }, [revisionTareoId, revisionObs]);

    const abrirRevision = (tareoId: string) => {
        setRevisionTareoId(tareoId);
        setRevisionObs("");
        setRevisionError(null);
    };

    const puedeConcretar = estadoMaestro?.todos === true && !maestroConcretado;

    return (
        <div>
            {/* Cabecera con selectores */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
                <div>
                    <h2 style={{ fontSize: "24px", fontWeight: 700, margin: "0 0 4px 0" }}>Mantenedor TAREO / SEDE</h2>
                    <p style={{ color: "var(--color-text-muted)", margin: 0, fontSize: "14px" }}>Supervisa y consolida los tareos de todos los analistas</p>
                </div>
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                    {maestroConcretado && (
                        <a href={`/tareo/maestro`}
                            className="btn btn--primary" style={{ marginLeft: "8px" }}>
                            Ver Tareo Maestro →
                        </a>
                    )}
                </div>
            </div>

            {/* Banner estado global */}
            {estadoMaestro && estadoMaestro.enRevision > 0 && !maestroConcretado && (
                <div style={{
                    padding: "10px 16px", marginBottom: "14px",
                    background: "rgba(251,146,60,0.1)", border: "1px solid rgba(251,146,60,0.4)",
                    borderRadius: "8px", fontSize: "13px", display: "flex", alignItems: "center", gap: "10px",
                }}>
                    <span style={{ fontSize: "18px" }}>🔍</span>
                    <span>
                        <strong>{estadoMaestro.enRevision} analista{estadoMaestro.enRevision > 1 ? "s" : ""}</strong>
                        {" "}tiene{estadoMaestro.enRevision > 1 ? "n" : ""} tareo en revisión pendiente de corrección.
                    </span>
                </div>
            )}

            <div style={{
                padding: "14px 20px", marginBottom: "20px",
                background: maestroConcretado
                    ? "rgba(52,211,153,0.1)"
                    : estadoMaestro?.todos
                        ? "rgba(79,142,247,0.1)"
                        : "rgba(251,191,36,0.1)",
                border: `1px solid ${maestroConcretado
                    ? "rgba(52,211,153,0.4)"
                    : estadoMaestro?.todos
                        ? "rgba(79,142,247,0.4)"
                        : "rgba(251,191,36,0.4)"}`,
                borderRadius: "10px",
                display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px",
            }}>
                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                    <span style={{ fontSize: "24px" }}>
                        {maestroConcretado ? "✅" : estadoMaestro?.todos ? "🟢" : "🟡"}
                    </span>
                    <div>
                        <div style={{ fontWeight: 700, fontSize: "14px" }}>
                            {maestroConcretado
                                ? "Tareo Maestro Concretado"
                                : estadoMaestro?.todos
                                    ? "Todos los tareos listos — listo para concretar"
                                    : "Tareos pendientes de cierre"}
                        </div>
                        <div style={{ fontSize: "12px", color: "var(--color-text-muted)", marginTop: "2px" }}>
                            {estadoMaestro
                                ? `${estadoMaestro.cerrados} de ${estadoMaestro.totalAnalistas} analistas listos (cerrado u obs. levantadas)`
                                : "Sin tareos registrados aún en " + mesLabel}
                        </div>
                    </div>
                </div>

                {!maestroConcretado && (
                    <button
                        className="btn btn--primary"
                        style={{
                            fontSize: "13px", padding: "10px 20px",
                            opacity: puedeConcretar ? 1 : 0.45,
                            cursor: puedeConcretar ? "pointer" : "not-allowed",
                        }}
                        disabled={!puedeConcretar || concretando}
                        onClick={() => setShowConfirm(true)}
                        title={!puedeConcretar ? "Todos los analistas deben cerrar su tareo o levantar observaciones primero" : ""}
                    >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: "6px" }}>
                            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
                        </svg>
                        Concretar Tareo Maestro
                    </button>
                )}
            </div>

            {/* Mensajes */}
            {msgOk && (
                <div style={{ padding: "10px 16px", marginBottom: "14px", background: "rgba(52,211,153,0.1)", borderRadius: "8px", color: "var(--color-success)", fontSize: "13px" }}>
                    ✅ {msgOk}
                </div>
            )}
            {msgError && (
                <div style={{ padding: "10px 16px", marginBottom: "14px", background: "rgba(248,113,113,0.1)", borderRadius: "8px", color: "var(--color-danger)", fontSize: "13px" }}>
                    ⚠️ {msgError}
                </div>
            )}

            {/* Tabla de tareos por analista/sede */}
            <div className="card" style={{ padding: 0 }}>
                <div className="card__header">
                    <div className="card__title">Tareos de Analistas — {mesLabel}</div>
                    <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
                        {tareos.length} analistas registrados
                    </span>
                </div>

                {!loaded ? (
                    <div style={{ padding: "40px", textAlign: "center", color: "var(--color-text-muted)" }}>
                        Cargando tareos de {mesLabel}...
                    </div>
                ) : (
                    <div className="table-wrapper" style={{ borderRadius: 0, border: "none" }}>
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>Analista</th>
                                    <th>Sede</th>
                                    <th>Unidad de Negocio</th>
                                    <th style={{ textAlign: "center" }}>Empleados</th>
                                    <th style={{ textAlign: "center" }}>Estado</th>
                                    <th style={{ textAlign: "center" }}>Acciones</th>
                                </tr>
                            </thead>
                            <tbody>
                                {tareos.length === 0 ? (
                                    <tr>
                                        <td colSpan={6} style={{ textAlign: "center", padding: "32px", color: "var(--color-text-muted)" }}>
                                            Ningún analista ha iniciado su tareo de {mesLabel} aún.
                                        </td>
                                    </tr>
                                ) : (
                                    tareos.map((t) => {
                                        const badge = estadoBadge(t.estado);
                                        const puedeRevision = !maestroConcretado &&
                                            (t.estado === "cerrado" || t.estado === "obs_levantadas");
                                        return (
                                            <tr key={t.id}>
                                                <td style={{ fontWeight: 600 }}>
                                                    {analistas.get(t.analista_id) ?? t.analista_id}
                                                </td>
                                                <td>{t.sede}</td>
                                                <td>{t.business_unit}</td>
                                                <td style={{ textAlign: "center" }}>
                                                    <span style={{ fontWeight: 700 }}>{t.cantidad_empleados}</span>
                                                </td>
                                                <td style={{ textAlign: "center" }}>
                                                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "4px" }}>
                                                        <span className={`badge ${badge.cls}`}>{badge.text}</span>
                                                        {t.estado === "en_revision" && t.observaciones && (
                                                            <span style={{ fontSize: "10px", color: "var(--color-warning)", maxWidth: "140px", textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}
                                                                title={t.observaciones}>
                                                                🔍 {t.observaciones}
                                                            </span>
                                                        )}
                                                    </div>
                                                </td>
                                                <td style={{ textAlign: "center" }}>
                                                    <div style={{ display: "flex", gap: "6px", justifyContent: "center", flexWrap: "wrap" }}>
                                                        <a
                                                            href={`/tareo/jefe/ver?id=${t.id}&anio=${anio}&mes=${mes}`}
                                                            className="btn btn--ghost"
                                                            style={{ fontSize: "11px", padding: "4px 10px" }}
                                                        >
                                                            Ver →
                                                        </a>
                                                        {puedeRevision && (
                                                            <button
                                                                className="btn"
                                                                style={{
                                                                    fontSize: "11px", padding: "4px 10px",
                                                                    background: "rgba(251,146,60,0.15)",
                                                                    color: "#f97316",
                                                                    border: "1px solid rgba(251,146,60,0.5)",
                                                                    borderRadius: "6px",
                                                                }}
                                                                onClick={() => abrirRevision(t.id)}
                                                            >
                                                                🔍 Revisión
                                                            </button>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })
                                )}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Modal confirmación concretar */}
            {showConfirm && (
                <div style={{
                    position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)",
                    zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                    <div className="card" style={{ width: "460px", padding: "32px", textAlign: "center" }}>
                        <div style={{ fontSize: "48px", marginBottom: "14px" }}>📋</div>
                        <h3 style={{ marginBottom: "10px" }}>¿Concretar Tareo de {mesLabel}?</h3>
                        <p style={{ color: "var(--color-text-muted)", fontSize: "13px", marginBottom: "8px" }}>
                            Esta acción consolidará los datos de <strong>{estadoMaestro?.totalAnalistas} analistas</strong> en el Tareo Maestro.
                        </p>
                        <p style={{ color: "var(--color-text-muted)", fontSize: "13px", marginBottom: "24px" }}>
                            El tareo maestro quedará <strong>concretado</strong> y no podrá modificarse.
                        </p>
                        <div style={{ display: "flex", gap: "10px", justifyContent: "center" }}>
                            <button className="btn btn--ghost" onClick={() => setShowConfirm(false)} disabled={concretando}>
                                Cancelar
                            </button>
                            <button className="btn btn--primary" onClick={ejecutarConcretar} disabled={concretando}>
                                {concretando ? "Concretando..." : "Sí, concretar tareo"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Modal Mandar a Revisión */}
            {revisionTareoId && (
                <div style={{
                    position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)",
                    zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                    <div className="card" style={{ width: "500px", padding: "32px" }}>
                        <div style={{ fontSize: "40px", textAlign: "center", marginBottom: "12px" }}>🔍</div>
                        <h3 style={{ textAlign: "center", marginBottom: "6px" }}>Mandar a Revisión</h3>
                        <p style={{ color: "var(--color-text-muted)", fontSize: "13px", textAlign: "center", marginBottom: "20px" }}>
                            Describe las observaciones o correcciones que debe realizar el analista.
                        </p>

                        <div style={{ marginBottom: "16px" }}>
                            <label style={{ display: "block", fontWeight: 600, fontSize: "13px", marginBottom: "6px" }}>
                                Observaciones <span style={{ color: "var(--color-danger)" }}>*</span>
                            </label>
                            <textarea
                                className="form-input"
                                placeholder="Ej: El empleado Juan Quispe tiene días incorrectos en Vacaciones. Revisar también los descuentos judiciales..."
                                value={revisionObs}
                                onChange={(e) => setRevisionObs(e.target.value)}
                                rows={5}
                                style={{ width: "100%", resize: "vertical", fontFamily: "inherit", fontSize: "13px" }}
                            />
                        </div>

                        {revisionError && (
                            <div style={{ padding: "8px 12px", marginBottom: "14px", background: "rgba(248,113,113,0.1)", borderRadius: "6px", color: "var(--color-danger)", fontSize: "12px" }}>
                                ⚠️ {revisionError}
                            </div>
                        )}

                        <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
                            <button className="btn btn--ghost"
                                onClick={() => { setRevisionTareoId(null); setRevisionObs(""); }}
                                disabled={enviandoRevision}>
                                Cancelar
                            </button>
                            <button
                                className="btn"
                                style={{
                                    background: "rgba(251,146,60,0.9)", color: "#fff",
                                    border: "none", borderRadius: "8px", padding: "9px 20px",
                                    fontWeight: 600, cursor: enviandoRevision ? "not-allowed" : "pointer",
                                    opacity: enviandoRevision ? 0.7 : 1,
                                }}
                                onClick={ejecutarRevision}
                                disabled={enviandoRevision}
                            >
                                {enviandoRevision ? "Enviando..." : "Enviar a Revisión"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
