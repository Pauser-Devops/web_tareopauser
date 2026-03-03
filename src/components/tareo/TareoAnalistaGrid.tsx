import React, { useState, useEffect, useCallback } from "react";
import {
    calcDiasTrab,
    calcTotalHoras,
    calcSueldoProporcional,
    calcAfpOnpSimple,
    calcEssalud,
    calcVidaLey,
    calcTotalIngresos,
    calcTotalDescuentos,
    calcNetoPagar,
    round2,
} from "../../lib/formulas";
import {
    fetchOrCreateTareoAnalista,
    fetchEmpleadosDeSede,
    fetchDetallesAnalista,
    upsertDetallesLote,
    cerrarTareoAnalista,
    marcarObsLevantadas,
    type TareoAnalista,
    type TareoAnalistaDetalle,
} from "../../lib/tareoAnalista";
import type { EmpleadoBase } from "../../lib/empleados";
import type { TareoEmployeeConfig } from "../../lib/empleados";
import { supabase } from "../../lib/supabase";

// ─── Tipos locales ─────────────────────────────────────────────────────────────
type EmpleadoFila = EmpleadoBase & {
    config: TareoEmployeeConfig | null;
    detalle: TareoAnalistaDetalle;
};

type VistaTab = "dias" | "ingresos" | "descuentos" | "totales";

type Props = {
    analistaId: string;
    analistaNombre: string;
    sede: string;
    businessUnit: string | null;
    anio: number;
    mes: number;
    mesLabel: string;
    readonly?: boolean; // para vista del Jefe
    tareoAnalistaId?: string; // si el Jefe pasa el ID directamente
};

// ─── Calcular totales por fila ─────────────────────────────────────────────────
function calcularFila(emp: EmpleadoFila) {
    const d = emp.detalle;
    const config = emp.config;
    const sueldoBase = config?.sueldo_base ?? 0;
    const afp = config?.afp_codigo ?? "ONP";
    const tieneVidaLey = config?.vida_ley ?? false;

    const diasTrab = calcDiasTrab(d.dias_habiles, d.vac, d.lic_sin_h, d.susp, d.aus_sin_just);
    const totalHoras = calcTotalHoras(d.dias_habiles, d.descanso_lab, d.desc_med, d.vel, d.vac, d.lic_sin_h, d.susp, d.aus_sin_just, 0);
    const sueldoProp = calcSueldoProporcional(sueldoBase, diasTrab, 30);
    const totalAfecto = round2(sueldoProp);
    const totalNoAfecto = round2(d.movilidad);
    const totalIngresos = calcTotalIngresos(totalAfecto, totalNoAfecto);
    const baseAfecta = totalAfecto;
    const afpOnp = calcAfpOnpSimple(baseAfecta, afp);
    const vidaLey = calcVidaLey(baseAfecta, tieneVidaLey);
    const totalDesc = calcTotalDescuentos({ afp_onp: afpOnp, vida_ley: vidaLey, ret_jud: d.ret_jud });
    const netoPagar = calcNetoPagar(totalIngresos, totalDesc);
    const essalud = calcEssalud(baseAfecta);

    return { diasTrab, totalHoras, sueldoBase, sueldoProp, afp, totalAfecto, totalNoAfecto, totalIngresos, afpOnp, vidaLey, totalDesc, netoPagar, essalud };
}

// ─── Detalle vacío por defecto ─────────────────────────────────────────────────
function detalleVacio(tareoAnalistaId: string, empleadoId: string): TareoAnalistaDetalle {
    return {
        tareo_analista_id: tareoAnalistaId,
        empleado_id: empleadoId,
        dias_habiles: 30,
        descanso_lab: 0,
        desc_med: 0,
        vel: 0,
        vac: 0,
        lic_sin_h: 0,
        susp: 0,
        aus_sin_just: 0,
        movilidad: 0,
        ret_jud: 0,
    };
}

// ─── Componente Principal ──────────────────────────────────────────────────────
export default function TareoAnalistaGrid({
    analistaId,
    analistaNombre,
    sede,
    businessUnit,
    anio,
    mes,
    mesLabel,
    readonly = false,
    tareoAnalistaId: externalTareoId,
}: Props) {
    const [tareo, setTareo] = useState<TareoAnalista | null>(null);
    const [empleados, setEmpleados] = useState<EmpleadoFila[]>([]);
    const [verColumnas, setVerColumnas] = useState<VistaTab>("dias");
    const [buscar, setBuscar] = useState("");
    const [guardando, setGuardando] = useState(false);
    const [cerrando, setCerrando] = useState(false);
    const [levantando, setLevantando] = useState(false);
    const [showConfirmCierre, setShowConfirmCierre] = useState(false);
    const [loaded, setLoaded] = useState(false);
    const [msgError, setMsgError] = useState<string | null>(null); const [msgOk, setMsgOk] = useState<string | null>(null);

    // ── Carga inicial ──────────────────────────────────────────────────────────
    useEffect(() => {
        async function cargar() {
            if (!supabase) {
                setMsgError("Supabase no configurado.");
                setLoaded(true);
                return;
            }

            let tareoActual: TareoAnalista | null = null;

            if (externalTareoId) {
                // Vista del Jefe: ID pasado directamente
                const { data } = await supabase
                    .from("tareos_analista")
                    .select("*")
                    .eq("id", externalTareoId)
                    .single();
                tareoActual = data as TareoAnalista | null;
            } else {
                // Vista del Analista: crear/recuperar
                tareoActual = await fetchOrCreateTareoAnalista(
                    analistaId, sede, businessUnit ?? "", anio, mes
                );
            }

            if (!tareoActual) {
                setMsgError("No se pudo cargar el tareo.");
                setLoaded(true);
                return;
            }
            setTareo(tareoActual);

            // Cargar empleados de la sede
            const emps = await fetchEmpleadosDeSede(
                tareoActual.sede,
                tareoActual.business_unit
            );

            // Cargar configs tareo
            const ids = emps.map((e) => e.id);
            const { data: configs } = await supabase
                .from("tareo_employee_config")
                .select("*")
                .in("employee_id", ids);

            const configMap = new Map(
                ((configs ?? []) as unknown as TareoEmployeeConfig[]).map((c) => [c.employee_id, c])
            );

            // Cargar detalles existentes
            const detalles = await fetchDetallesAnalista(tareoActual.id);
            const detalleMap = new Map(detalles.map((d) => [d.empleado_id, d]));

            // Construir filas
            const filas: EmpleadoFila[] = emps.map((emp) => ({
                ...emp,
                config: configMap.get(emp.id) ?? null,
                detalle: detalleMap.get(emp.id) ?? detalleVacio(tareoActual!.id, emp.id),
            }));

            setEmpleados(filas);
            setLoaded(true);
        }
        cargar();
    }, [analistaId, sede, businessUnit, anio, mes, externalTareoId]);

    // ── Realtime: escuchar cambios en el tareo propio ──────────────────────────
    useEffect(() => {
        if (!supabase || !tareo) return;
        const sb = supabase;
        const channel = sb
            .channel(`analista-tareo-${tareo.id}`)
            .on(
                "postgres_changes",
                {
                    event: "UPDATE",
                    schema: "public",
                    table: "tareos_analista",
                    filter: `id=eq.${tareo.id}`,
                },
                (payload: any) => {
                    const nuevo = payload.new as TareoAnalista;
                    setTareo((prev) => prev ? { ...prev, estado: nuevo.estado, observaciones: nuevo.observaciones } : prev);
                }
            )
            .subscribe();
        return () => { sb.removeChannel(channel); };
    }, [tareo?.id]);

    // ── Actualizar campo de detalle ────────────────────────────────────────────
    const updateDetalle = useCallback(
        (empId: string, field: keyof TareoAnalistaDetalle, val: number) => {
            setEmpleados((prev) =>
                prev.map((e) =>
                    e.id === empId
                        ? { ...e, detalle: { ...e.detalle, [field]: val } }
                        : e
                )
            );
        },
        []
    );

    // ── Guardar todos los detalles ─────────────────────────────────────────────
    const guardarTodo = useCallback(async () => {
        if (!tareo || readonly) return;
        setGuardando(true);
        setMsgError(null);
        const detalles = empleados.map((e) => e.detalle);
        const result = await upsertDetallesLote(detalles);
        if (!result.ok) setMsgError(result.error ?? "Error al guardar.");
        setGuardando(false);
    }, [empleados, tareo, readonly]);

    // ── Cierre del tareo ───────────────────────────────────────────────────────
    const ejecutarCierre = useCallback(async () => {
        if (!tareo) return;
        setCerrando(true);
        setMsgError(null);
        await upsertDetallesLote(empleados.map((e) => e.detalle));
        const result = await cerrarTareoAnalista(tareo.id);
        if (result.ok) {
            setTareo((prev) => prev ? { ...prev, estado: "cerrado" } : prev);
        } else {
            setMsgError(result.error ?? "Error al cerrar tareo.");
        }
        setCerrando(false);
        setShowConfirmCierre(false);
    }, [tareo, empleados]);

    // ── Levantar observaciones ─────────────────────────────────────────────────
    const ejecutarLevantarObs = useCallback(async () => {
        if (!tareo) return;
        setLevantando(true);
        setMsgError(null);
        setMsgOk(null);
        await upsertDetallesLote(empleados.map((e) => e.detalle));
        const result = await marcarObsLevantadas(tareo.id);
        if (result.ok) {
            setTareo((prev) => prev ? { ...prev, estado: "obs_levantadas" } : prev);
            setMsgOk("Observaciones levantadas. El Jefe revisará tu tareo nuevamente.");
        } else {
            setMsgError(result.error ?? "Error al levantar observaciones.");
        }
        setLevantando(false);
    }, [tareo, empleados]);

    // ── Filtrar empleados ──────────────────────────────────────────────────────
    const filasFiltradas = empleados.filter((e) => {
        const q = buscar.toLowerCase();
        return (
            e.full_name.toLowerCase().includes(q) ||
            e.dni.includes(q) ||
            e.position.toLowerCase().includes(q)
        );
    });

    // ── Totales generales ──────────────────────────────────────────────────────
    const totales = filasFiltradas.reduce(
        (acc, emp) => {
            const c = calcularFila(emp);
            return {
                diasTrab: acc.diasTrab + c.diasTrab,
                totalHoras: acc.totalHoras + c.totalHoras,
                totalIngresos: acc.totalIngresos + c.totalIngresos,
                afpOnp: acc.afpOnp + c.afpOnp,
                vidaLey: acc.vidaLey + c.vidaLey,
                totalDesc: acc.totalDesc + c.totalDesc,
                netoPagar: acc.netoPagar + c.netoPagar,
                essalud: acc.essalud + c.essalud,
            };
        },
        { diasTrab: 0, totalHoras: 0, totalIngresos: 0, afpOnp: 0, vidaLey: 0, totalDesc: 0, netoPagar: 0, essalud: 0 }
    );

    const esCerrado = tareo?.estado === "cerrado";
    const enRevision = tareo?.estado === "en_revision";
    const obsLevantadas = tareo?.estado === "obs_levantadas";
    // en_revision: el analista puede editar para corregir
    // readonly prop viene de la vista del Jefe
    const esReadonly = readonly || esCerrado || obsLevantadas;

    const tabs: { key: VistaTab; label: string }[] = [
        { key: "dias", label: "Días Laborados" },
        { key: "ingresos", label: "Ingresos" },
        { key: "descuentos", label: "Descuentos" },
        { key: "totales", label: "Totales" },
    ];

    // ── Estado de carga ────────────────────────────────────────────────────────
    if (!loaded) {
        return (
            <div style={{ padding: "40px", textAlign: "center", color: "var(--color-text-muted)" }}>
                Cargando empleados de{" "}
                <strong>{sede}{businessUnit ? ` / ${businessUnit}` : ""}</strong>...
            </div>
        );
    }

    if (msgError && empleados.length === 0) {
        return (
            <div style={{ padding: "20px", color: "var(--color-danger)", background: "rgba(248,113,113,0.1)", borderRadius: "8px" }}>
                ⚠️ {msgError}
            </div>
        );
    }

    return (
        <div>
            {/* Banner estado tareo */}
            {esCerrado && (
                <div style={{ padding: "10px 16px", marginBottom: "14px", background: "rgba(52,211,153,0.1)", border: "1px solid rgba(52,211,153,0.3)", borderRadius: "8px", display: "flex", alignItems: "center", gap: "10px", fontSize: "13px", color: "var(--color-success)" }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>
                    <strong>Tareo cerrado.</strong>
                    <span style={{ color: "var(--color-text-muted)" }}>Los datos son de solo lectura.</span>
                </div>
            )}

            {/* Banner: En Revisión — el Jefe mandó observaciones */}
            {enRevision && !readonly && (
                <div style={{ padding: "14px 18px", marginBottom: "14px", background: "rgba(251,146,60,0.08)", border: "2px solid rgba(251,146,60,0.5)", borderRadius: "10px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "10px" }}>
                        <span style={{ fontSize: "22px" }}>🔍</span>
                        <div>
                            <div style={{ fontWeight: 700, fontSize: "14px", color: "#f97316" }}>Tareo en Revisión</div>
                            <div style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>El Jefe ha enviado observaciones que debes corregir. Puedes editar los datos y luego marcar las observaciones como levantadas.</div>
                        </div>
                    </div>
                    {tareo?.observaciones && (
                        <div style={{ padding: "10px 14px", background: "rgba(251,146,60,0.12)", borderRadius: "6px", borderLeft: "3px solid #f97316", fontSize: "13px", marginBottom: "12px", whiteSpace: "pre-wrap" }}>
                            <span style={{ fontWeight: 600, color: "#f97316", fontSize: "11px", display: "block", marginBottom: "4px" }}>OBSERVACIONES DEL JEFE:</span>
                            {tareo.observaciones}
                        </div>
                    )}
                    <button
                        className="btn btn--primary"
                        style={{ fontSize: "13px", background: "#16a34a", borderColor: "#16a34a" }}
                        onClick={ejecutarLevantarObs}
                        disabled={levantando}
                    >
                        {levantando ? "Guardando..." : "✅ Levantar Observaciones"}
                    </button>
                </div>
            )}

            {/* Banner: Observaciones levantadas */}
            {obsLevantadas && !readonly && (
                <div style={{ padding: "10px 16px", marginBottom: "14px", background: "rgba(79,142,247,0.08)", border: "1px solid rgba(79,142,247,0.35)", borderRadius: "8px", display: "flex", alignItems: "center", gap: "10px", fontSize: "13px" }}>
                    <span style={{ fontSize: "18px" }}>✅</span>
                    <div>
                        <span style={{ fontWeight: 700, color: "var(--color-primary)" }}>Observaciones levantadas</span>
                        <span style={{ color: "var(--color-text-muted)", marginLeft: "8px" }}>— Pendiente revisión final del Jefe.</span>
                    </div>
                </div>
            )}

            {/* Mensaje OK */}
            {msgOk && (
                <div style={{ padding: "8px 14px", marginBottom: "10px", background: "rgba(52,211,153,0.1)", borderRadius: "6px", color: "var(--color-success)", fontSize: "12px" }}>
                    ✅ {msgOk}
                </div>
            )}

            {/* Info sede/unidad */}
            <div style={{
                padding: "10px 16px", marginBottom: "14px",
                background: "var(--color-surface)", border: "1px solid var(--color-border)",
                borderRadius: "8px", fontSize: "12px", display: "flex", gap: "20px", flexWrap: "wrap",
            }}>
                <span><span style={{ color: "var(--color-text-muted)" }}>Analista:</span> <strong>{analistaNombre}</strong></span>
                <span><span style={{ color: "var(--color-text-muted)" }}>Sede:</span> <strong>{sede || tareo?.sede || "—"}</strong></span>
                {(businessUnit || tareo?.business_unit) && <span><span style={{ color: "var(--color-text-muted)" }}>Unidad:</span> <strong>{businessUnit || tareo?.business_unit}</strong></span>}
                <span><span style={{ color: "var(--color-text-muted)" }}>Empleados:</span> <strong>{empleados.length}</strong></span>
                <span style={{ marginLeft: "auto" }}>
                    {esCerrado && <span className="badge badge--green">Cerrado</span>}
                    {enRevision && <span className="badge badge--orange">En Revisión</span>}
                    {obsLevantadas && <span className="badge badge--blue">Obs. Levantadas</span>}
                    {!esCerrado && !enRevision && !obsLevantadas && <span className="badge badge--yellow">Borrador</span>}
                </span>
            </div>

            {/* Error */}
            {msgError && (
                <div style={{ padding: "8px 14px", marginBottom: "10px", background: "rgba(248,113,113,0.1)", borderRadius: "6px", color: "var(--color-danger)", fontSize: "12px" }}>
                    ⚠️ {msgError}
                </div>
            )}

            {/* Toolbar */}
            <div style={{ display: "flex", gap: "10px", marginBottom: "16px", flexWrap: "wrap", alignItems: "center" }}>
                <input
                    type="text"
                    placeholder="🔍 Buscar por nombre, DNI o cargo..."
                    className="form-input"
                    style={{ width: "300px" }}
                    value={buscar}
                    onChange={(e) => setBuscar(e.target.value)}
                />
                <div style={{ display: "flex", gap: "6px", marginLeft: "auto" }}>
                    {!esReadonly && (
                        <button
                            className="btn btn--primary"
                            style={{ fontSize: "12px" }}
                            onClick={guardarTodo}
                            disabled={guardando}
                        >
                            {guardando ? "Guardando..." : (
                                <>
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" />
                                    </svg>
                                    Guardar
                                </>
                            )}
                        </button>
                    )}
                    {/* Cerrar: solo en borrador */}
                    {!readonly && tareo?.estado === "borrador" && (
                        <button
                            className="btn btn--danger"
                            style={{ fontSize: "12px", background: "rgba(248,113,113,0.15)", color: "var(--color-danger)", border: "1px solid var(--color-danger)" }}
                            onClick={() => setShowConfirmCierre(true)}
                        >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
                            </svg>
                            Cerrar Tareo del Mes
                        </button>
                    )}
                </div>
            </div>

            {/* Tabs */}
            <div style={{ display: "flex", gap: "4px", marginBottom: "14px", borderBottom: "1px solid var(--color-border)", paddingBottom: "1px" }}>
                {tabs.map((t) => (
                    <button
                        key={t.key}
                        onClick={() => setVerColumnas(t.key)}
                        className="btn"
                        style={{
                            fontSize: "12px", padding: "6px 14px",
                            borderRadius: "6px 6px 0 0", border: "none",
                            background: verColumnas === t.key ? "var(--color-primary)" : "transparent",
                            color: verColumnas === t.key ? "#fff" : "var(--color-text-muted)",
                        }}
                    >
                        {t.label}
                    </button>
                ))}
            </div>

            {/* Tabla */}
            <div className="table-wrapper">
                <table className="data-table planilla-table">
                    <colgroup>
                        <col style={{ width: "44px" }} />
                        <col style={{ width: "230px" }} />
                        <col style={{ width: "160px" }} />
                        <col style={{ width: "72px" }} />
                        {verColumnas === "dias" && <>
                            <col style={{ width: "60px" }} />
                            <col style={{ width: "60px" }} />
                            <col style={{ width: "60px" }} />
                            <col style={{ width: "60px" }} />
                            <col style={{ width: "60px" }} />
                            <col style={{ width: "60px" }} />
                            <col style={{ width: "60px" }} />
                            <col style={{ width: "60px" }} />
                        </>}
                        {verColumnas === "ingresos" && <>
                            <col style={{ width: "88px" }} />
                            <col style={{ width: "88px" }} />
                            <col style={{ width: "88px" }} />
                            <col style={{ width: "96px" }} />
                            <col style={{ width: "96px" }} />
                            <col style={{ width: "104px" }} />
                        </>}
                        {verColumnas === "descuentos" && <>
                            <col style={{ width: "96px" }} />
                            <col style={{ width: "80px" }} />
                            <col style={{ width: "88px" }} />
                            <col style={{ width: "96px" }} />
                        </>}
                        {verColumnas === "totales" && <>
                            <col style={{ width: "104px" }} />
                            <col style={{ width: "100px" }} />
                            <col style={{ width: "110px" }} />
                            <col style={{ width: "96px" }} />
                        </>}
                    </colgroup>

                    <thead>
                        <tr>
                            <th style={{ textAlign: "center" }}>N°</th>
                            <th>Apellidos y Nombres</th>
                            <th>Cargo</th>
                            <th style={{ textAlign: "center" }}>AFP</th>
                            {verColumnas === "dias" && <>
                                <th className="th-num">Días<br />Trab</th>
                                <th className="th-num">Total<br />Hrs</th>
                                <th className="th-num">Des<br />Lab</th>
                                <th className="th-num">Des<br />Med</th>
                                <th className="th-num">Vac</th>
                                <th className="th-num">Lic<br />S/H</th>
                                <th className="th-num">Susp</th>
                                <th className="th-num">Aus<br />S/J</th>
                            </>}
                            {verColumnas === "ingresos" && <>
                                <th className="th-num">Sueldo<br />Base</th>
                                <th className="th-num">S/ Prop.</th>
                                <th className="th-num">Movilidad</th>
                                <th className="th-num">Total<br />Afecto</th>
                                <th className="th-num">Total No<br />Afecto</th>
                                <th className="th-num">Total<br />Ingresos</th>
                            </>}
                            {verColumnas === "descuentos" && <>
                                <th className="th-num">AFP / ONP</th>
                                <th className="th-num">Vida<br />Ley</th>
                                <th className="th-num">Ret.<br />Judicial</th>
                                <th className="th-num">Total<br />Dsctos</th>
                            </>}
                            {verColumnas === "totales" && <>
                                <th className="th-num">Total<br />Ingresos</th>
                                <th className="th-num">Total<br />Dsctos</th>
                                <th className="th-num" style={{ color: "var(--color-primary)" }}>Neto a<br />Pagar</th>
                                <th className="th-num" style={{ color: "var(--color-warning)" }}>EsSalud<br />9%</th>
                            </>}
                        </tr>
                    </thead>

                    <tbody>
                        {filasFiltradas.map((emp, idx) => {
                            const c = calcularFila(emp);
                            return (
                                <tr key={emp.id}>
                                    <td className="text-muted mono" style={{ textAlign: "center" }}>{idx + 1}</td>
                                    <td style={{ fontWeight: 600, fontSize: "12px" }}>
                                        {emp.full_name}
                                        <div style={{ fontSize: "11px", color: "var(--color-text-muted)", fontWeight: 400 }}>{emp.dni}</div>
                                    </td>
                                    <td style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>{emp.position}</td>
                                    <td style={{ textAlign: "center" }}>
                                        <span className="badge badge--blue mono" style={{ fontSize: "10px" }}>
                                            {c.afp || "—"}
                                        </span>
                                    </td>

                                    {verColumnas === "dias" && <>
                                        <td className="cell-num" style={{ fontWeight: 700, color: c.diasTrab < 30 ? "var(--color-warning)" : "var(--color-text)" }}>
                                            {c.diasTrab}
                                        </td>
                                        <td className="cell-num">{c.totalHoras}</td>
                                        <td className="cell-num">
                                            {esReadonly ? emp.detalle.descanso_lab : (
                                                <input type="number" min={0} max={31} className="cell-input"
                                                    value={emp.detalle.descanso_lab}
                                                    onChange={(e) => updateDetalle(emp.id, "descanso_lab", +e.target.value)} />
                                            )}
                                        </td>
                                        <td className="cell-num">
                                            {esReadonly ? emp.detalle.desc_med : (
                                                <input type="number" min={0} max={31} className="cell-input"
                                                    value={emp.detalle.desc_med}
                                                    onChange={(e) => updateDetalle(emp.id, "desc_med", +e.target.value)} />
                                            )}
                                        </td>
                                        <td className="cell-num">
                                            {esReadonly ? emp.detalle.vac : (
                                                <input type="number" min={0} max={31} className="cell-input"
                                                    value={emp.detalle.vac}
                                                    onChange={(e) => updateDetalle(emp.id, "vac", +e.target.value)} />
                                            )}
                                        </td>
                                        <td className="cell-num">
                                            {esReadonly ? emp.detalle.lic_sin_h : (
                                                <input type="number" min={0} max={31} className="cell-input"
                                                    value={emp.detalle.lic_sin_h}
                                                    onChange={(e) => updateDetalle(emp.id, "lic_sin_h", +e.target.value)} />
                                            )}
                                        </td>
                                        <td className="cell-num">
                                            {esReadonly ? emp.detalle.susp : (
                                                <input type="number" min={0} max={31} className="cell-input"
                                                    value={emp.detalle.susp}
                                                    onChange={(e) => updateDetalle(emp.id, "susp", +e.target.value)} />
                                            )}
                                        </td>
                                        <td className="cell-num">
                                            {esReadonly ? emp.detalle.aus_sin_just : (
                                                <input type="number" min={0} max={31} className="cell-input"
                                                    value={emp.detalle.aus_sin_just}
                                                    onChange={(e) => updateDetalle(emp.id, "aus_sin_just", +e.target.value)} />
                                            )}
                                        </td>
                                    </>}

                                    {verColumnas === "ingresos" && <>
                                        <td className="cell-currency">{c.sueldoBase.toFixed(2)}</td>
                                        <td className="cell-currency">{c.sueldoProp.toFixed(2)}</td>
                                        <td className="cell-currency">
                                            {esReadonly ? emp.detalle.movilidad.toFixed(2) : (
                                                <input type="number" min={0} step={10} className="cell-input"
                                                    value={emp.detalle.movilidad}
                                                    onChange={(e) => updateDetalle(emp.id, "movilidad", +e.target.value)} />
                                            )}
                                        </td>
                                        <td className="cell-currency">{c.totalAfecto.toFixed(2)}</td>
                                        <td className="cell-currency">{c.totalNoAfecto.toFixed(2)}</td>
                                        <td className="cell-currency" style={{ fontWeight: 700, color: "var(--color-success)" }}>{c.totalIngresos.toFixed(2)}</td>
                                    </>}

                                    {verColumnas === "descuentos" && <>
                                        <td className="cell-currency text-danger">{c.afpOnp.toFixed(2)}</td>
                                        <td className="cell-currency text-danger">{c.vidaLey.toFixed(2)}</td>
                                        <td className="cell-currency">
                                            {esReadonly ? emp.detalle.ret_jud.toFixed(2) : (
                                                <input type="number" min={0} className="cell-input"
                                                    value={emp.detalle.ret_jud}
                                                    onChange={(e) => updateDetalle(emp.id, "ret_jud", +e.target.value)} />
                                            )}
                                        </td>
                                        <td className="cell-currency text-danger" style={{ fontWeight: 700 }}>{c.totalDesc.toFixed(2)}</td>
                                    </>}

                                    {verColumnas === "totales" && <>
                                        <td className="cell-currency">{c.totalIngresos.toFixed(2)}</td>
                                        <td className="cell-currency text-danger">{c.totalDesc.toFixed(2)}</td>
                                        <td className="cell-currency text-primary" style={{ fontWeight: 800 }}>{c.netoPagar.toFixed(2)}</td>
                                        <td className="cell-currency" style={{ color: "var(--color-warning)" }}>{c.essalud.toFixed(2)}</td>
                                    </>}
                                </tr>
                            );
                        })}
                    </tbody>

                    <tfoot>
                        <tr>
                            <td colSpan={4} style={{ textAlign: "right" }}>
                                SUBTOTALES ({filasFiltradas.length} trabajadores)
                            </td>
                            {verColumnas === "dias" && <>
                                <td className="cell-num">{totales.diasTrab}</td>
                                <td className="cell-num">{totales.totalHoras}</td>
                                <td colSpan={6}></td>
                            </>}
                            {verColumnas === "ingresos" && <>
                                <td colSpan={3}></td>
                                <td className="cell-currency">{totales.totalIngresos.toFixed(2)}</td>
                                <td></td>
                                <td className="cell-currency" style={{ color: "var(--color-success)" }}>{totales.totalIngresos.toFixed(2)}</td>
                            </>}
                            {verColumnas === "descuentos" && <>
                                <td className="cell-currency">{totales.afpOnp.toFixed(2)}</td>
                                <td className="cell-currency">{totales.vidaLey.toFixed(2)}</td>
                                <td></td>
                                <td className="cell-currency">{totales.totalDesc.toFixed(2)}</td>
                            </>}
                            {verColumnas === "totales" && <>
                                <td className="cell-currency">{totales.totalIngresos.toFixed(2)}</td>
                                <td className="cell-currency">{totales.totalDesc.toFixed(2)}</td>
                                <td className="cell-currency text-primary" style={{ fontWeight: 800 }}>{totales.netoPagar.toFixed(2)}</td>
                                <td className="cell-currency" style={{ color: "var(--color-warning)" }}>{totales.essalud.toFixed(2)}</td>
                            </>}
                        </tr>
                    </tfoot>
                </table>
            </div>

            {/* Resumen pie */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "12px", marginTop: "16px" }}>
                {[
                    { label: "Total Ingresos", val: totales.totalIngresos, color: "var(--color-success)" },
                    { label: "Total Descuentos", val: totales.totalDesc, color: "var(--color-danger)" },
                    { label: "Neto a Pagar", val: totales.netoPagar, color: "var(--color-primary)" },
                    { label: "EsSalud Empleador", val: totales.essalud, color: "var(--color-warning)" },
                ].map((s) => (
                    <div key={s.label} className="card" style={{ padding: "12px 16px" }}>
                        <div style={{ fontSize: "11px", color: "var(--color-text-muted)", marginBottom: "4px" }}>{s.label}</div>
                        <div style={{ fontSize: "16px", fontWeight: 800, color: s.color }}>
                            S/ {s.val.toLocaleString("es-PE", { minimumFractionDigits: 2 })}
                        </div>
                    </div>
                ))}
            </div>

            {/* Modal de confirmación de cierre */}
            {showConfirmCierre && (
                <div style={{
                    position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)",
                    zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                    <div className="card" style={{ width: "420px", padding: "28px", textAlign: "center" }}>
                        <div style={{ fontSize: "40px", marginBottom: "12px" }}>🔒</div>
                        <h3 style={{ marginBottom: "8px" }}>¿Cerrar tareo de {mesLabel}?</h3>
                        <p style={{ color: "var(--color-text-muted)", fontSize: "13px", marginBottom: "20px" }}>
                            Esta acción guardará todos los datos y marcará el tareo como <strong>cerrado</strong>. El JEFE podrá visualizarlo. Esta acción <strong>no se puede deshacer</strong>.
                        </p>
                        <div style={{ display: "flex", gap: "10px", justifyContent: "center" }}>
                            <button
                                className="btn btn--ghost"
                                onClick={() => setShowConfirmCierre(false)}
                                disabled={cerrando}
                            >
                                Cancelar
                            </button>
                            <button
                                className="btn btn--primary"
                                style={{ background: "var(--color-danger)", borderColor: "var(--color-danger)" }}
                                onClick={ejecutarCierre}
                                disabled={cerrando}
                            >
                                {cerrando ? "Cerrando..." : "Sí, cerrar tareo"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
