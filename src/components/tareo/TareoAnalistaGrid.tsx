import React, { useState, useEffect, useCallback, useRef } from "react";
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
import type { TareoEmployeeConfig } from "../../lib/empleados";
import { supabase } from "../../lib/supabase";
import ImportadorHistoricoAvanzado from "./ImportadorHistoricoAvanzado";
import { exportarPDF, exportarExcel, construirFilas, type FilaRaw } from "../../lib/exportUtils";
import { type EmpleadoFila, type VistaTab, calcularFila, detalleVacio, diasDelMes, validarDetalle } from "./tareoAnalistaTypes";
import TareoAnalistaToolbar from "./TareoAnalistaToolbar";
import TareoAnalistaTable from "./TareoAnalistaTable";
import TareoConfirmModal from "./TareoConfirmModal";
import TareoAuditLog from "./TareoAuditLog";

type Props = {
    analistaId: string;
    analistaNombre: string;
    sede: string;
    businessUnit: string | null;
    anio: number;
    mes: number;
    mesLabel: string;
    readonly?: boolean;
    tareoAnalistaId?: string;
};

export default function TareoAnalistaGrid({
    analistaId, analistaNombre, sede, businessUnit, anio, mes, mesLabel,
    readonly = false, tareoAnalistaId: externalTareoId,
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
    const [msgError, setMsgError] = useState<string | null>(null);
    const [msgOk, setMsgOk] = useState<string | null>(null);
    const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [autosaveStatus, setAutosaveStatus] = useState<"idle" | "pending" | "saved">("idle");
    const [periodoConcreto, setPeriodoConcreto] = useState(false);
    const [pagina, setPagina] = useState(0);
    const POR_PAGINA = 20;

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
                const { data } = await supabase
                    .from("tareos_analista")
                    .select("*")
                    .eq("id", externalTareoId)
                    .single();
                tareoActual = data as TareoAnalista | null;
            } else {
                tareoActual = await fetchOrCreateTareoAnalista(analistaId, sede, businessUnit ?? "", anio, mes);
            }

            if (!tareoActual) {
                setMsgError("No se pudo cargar el tareo.");
                setLoaded(true);
                return;
            }
            setTareo(tareoActual);

            const emps = await fetchEmpleadosDeSede(tareoActual.sede, tareoActual.business_unit);
            const ids = emps.map((e) => e.id);
            const { data: configs } = await supabase
                .from("tareo_employee_config")
                .select("*")
                .in("employee_id", ids);

            const configMap = new Map(
                ((configs ?? []) as unknown as TareoEmployeeConfig[]).map((c) => [c.employee_id, c])
            );

            const detalles = await fetchDetallesAnalista(tareoActual.id);
            const detalleMap = new Map(detalles.map((d) => [d.empleado_id, d]));

            setEmpleados(emps.map((emp) => ({
                ...emp,
                config: configMap.get(emp.id) ?? null,
                detalle: detalleMap.get(emp.id) ?? detalleVacio(tareoActual!.id, emp.id),
            })));

            if (!externalTareoId) {
                const { data: maestro } = await supabase
                    .from("tareo_maestro")
                    .select("estado")
                    .eq("anio", anio)
                    .eq("mes", mes)
                    .maybeSingle();
                setPeriodoConcreto(maestro?.estado === "concretado");
            }

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
                { event: "UPDATE", schema: "public", table: "tareos_analista", filter: `id=eq.${tareo.id}` },
                (payload: any) => {
                    const nuevo = payload.new as TareoAnalista;
                    setTareo((prev) => prev ? { ...prev, estado: nuevo.estado, observaciones: nuevo.observaciones } : prev);
                }
            )
            .subscribe();
        return () => { sb.removeChannel(channel); };
    }, [tareo?.id]);

    // ── Refs para autosave ─────────────────────────────────────────────────────
    const empleadosRef = useRef<EmpleadoFila[]>([]);
    useEffect(() => { empleadosRef.current = empleados; }, [empleados]);

    const tareoRef = useRef<TareoAnalista | null>(null);
    useEffect(() => { tareoRef.current = tareo; }, [tareo]);

    const esReadonlyRef = useRef(false);

    // ── Handlers ───────────────────────────────────────────────────────────────
    const updateDetalle = useCallback(
        (empId: string, field: keyof TareoAnalistaDetalle, val: number) => {
            setEmpleados((prev) =>
                prev.map((e) => e.id === empId ? { ...e, detalle: { ...e.detalle, [field]: val } } : e)
            );
            if (!esReadonlyRef.current) {
                setAutosaveStatus("pending");
                if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
                autosaveTimer.current = setTimeout(async () => {
                    const currentTareo = tareoRef.current;
                    const currentEmpleados = empleadosRef.current;
                    if (!currentTareo) return;
                    await upsertDetallesLote(currentEmpleados.map((e) => e.detalle));
                    setAutosaveStatus("saved");
                    setTimeout(() => setAutosaveStatus("idle"), 2000);
                }, 2000);
            }
        },
        []
    );

    const guardarTodo = useCallback(async () => {
        if (!tareo || readonly) return;
        setGuardando(true);
        setMsgError(null);
        const result = await upsertDetallesLote(empleados.map((e) => e.detalle));
        if (!result.ok) setMsgError(result.error ?? "Error al guardar.");
        setGuardando(false);
    }, [empleados, tareo, readonly]);

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

    const handleImportComplete = async () => {
        if (!tareo) return;
        setMsgOk(null);
        setMsgError(null);
        const detalles = await fetchDetallesAnalista(tareo.id);
        const detalleMap = new Map(detalles.map((d) => [d.empleado_id, d]));
        setEmpleados((prev) => prev.map((emp) => ({
            ...emp,
            detalle: detalleMap.get(emp.id) ?? detalleVacio(tareo.id, emp.id),
        })));
        setMsgOk("Datos importados del Excel recargados exitosamente.");
    };

    const handleExportar = async (formato: "pdf" | "excel") => {
        const rawFilas: FilaRaw[] = filasFiltradas.map((emp) => ({
            nombre: emp.full_name,
            dni: emp.dni,
            cargo: emp.position,
            afpCodigo: emp.config?.afp_codigo ?? "ONP",
            sueldoBase: emp.config?.sueldo_base ?? 0,
            tieneVidaLey: emp.config?.vida_ley ?? false,
            diasHabiles: emp.detalle.dias_habiles,
            vac: emp.detalle.vac,
            licSinH: emp.detalle.lic_sin_h,
            susp: emp.detalle.susp,
            ausSinJust: emp.detalle.aus_sin_just,
            movilidad: emp.detalle.movilidad,
            comision: emp.detalle.comision,
            bonoProductiv: emp.detalle.bono_productiv,
            bonoAlimento: emp.detalle.bono_alimento,
            retJud: emp.detalle.ret_jud,
        }));
        const filasPlanilla = construirFilas(rawFilas);
        const titulo = `Planilla ${sede}${businessUnit ? ` / ${businessUnit}` : ""}`;
        if (formato === "pdf") {
            await exportarPDF(filasPlanilla, mesLabel, titulo);
        } else {
            await exportarExcel(filasPlanilla, mesLabel, titulo);
        }
    };

    // ── Derivados ──────────────────────────────────────────────────────────────
    const filasFiltradas = empleados.filter((e) => {
        const q = buscar.toLowerCase();
        return e.full_name.toLowerCase().includes(q) || e.dni.includes(q) || e.position.toLowerCase().includes(q);
    });

    // Reset página al filtrar
    const buscarPrev = useRef(buscar);
    if (buscarPrev.current !== buscar) {
        buscarPrev.current = buscar;
        if (pagina !== 0) setPagina(0);
    }

    const totalPaginas = Math.max(1, Math.ceil(filasFiltradas.length / POR_PAGINA));
    const paginaSegura = Math.min(pagina, totalPaginas - 1);
    const filasPagina = filasFiltradas.slice(paginaSegura * POR_PAGINA, (paginaSegura + 1) * POR_PAGINA);

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

    const diasMax = diasDelMes(anio, mes);
    const erroresCount = filasFiltradas.filter((emp) => validarDetalle(emp.detalle, diasMax).tieneError).length;

    const esCerrado = tareo?.estado === "cerrado";
    const enRevision = tareo?.estado === "en_revision";
    const obsLevantadas = tareo?.estado === "obs_levantadas";
    const esReadonly = readonly || esCerrado || obsLevantadas || periodoConcreto;
    esReadonlyRef.current = esReadonly;

    // ── Early returns ──────────────────────────────────────────────────────────
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
            {/* Periodo concretado */}
            {periodoConcreto && !readonly && (
                <div style={{ padding: "10px 16px", marginBottom: "14px", background: "rgba(79,142,247,0.08)", border: "1px solid rgba(79,142,247,0.3)", borderRadius: "8px", display: "flex", alignItems: "center", gap: "10px", fontSize: "13px" }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                    <div>
                        <span style={{ fontWeight: 700, color: "var(--color-primary)" }}>Periodo Concretado</span>
                        <span style={{ color: "var(--color-text-muted)", marginLeft: "8px" }}>— El Jefe concretó este período. Los datos son de solo lectura.</span>
                    </div>
                </div>
            )}

            {/* Cerrado */}
            {esCerrado && (
                <div style={{ padding: "10px 16px", marginBottom: "14px", background: "rgba(52,211,153,0.1)", border: "1px solid rgba(52,211,153,0.3)", borderRadius: "8px", display: "flex", alignItems: "center", gap: "10px", fontSize: "13px", color: "var(--color-success)" }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>
                    <strong>Tareo cerrado.</strong>
                    <span style={{ color: "var(--color-text-muted)" }}>Los datos son de solo lectura.</span>
                </div>
            )}

            {/* En revisión (analista) */}
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

            {/* Observaciones readonly (jefe) */}
            {readonly && tareo?.observaciones && (
                <div style={{ padding: "14px 18px", marginBottom: "14px", background: "rgba(251,146,60,0.08)", border: "1px solid rgba(251,146,60,0.4)", borderRadius: "10px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
                        <span style={{ fontSize: "18px" }}>🔍</span>
                        <span style={{ fontWeight: 700, fontSize: "13px", color: "#f97316" }}>Observaciones enviadas al analista</span>
                    </div>
                    <div style={{ padding: "10px 14px", background: "rgba(251,146,60,0.12)", borderRadius: "6px", borderLeft: "3px solid #f97316", fontSize: "13px", whiteSpace: "pre-wrap" }}>
                        {tareo.observaciones}
                    </div>
                </div>
            )}

            {/* Observaciones levantadas */}
            {obsLevantadas && !readonly && (
                <div style={{ padding: "10px 16px", marginBottom: "14px", background: "rgba(79,142,247,0.08)", border: "1px solid rgba(79,142,247,0.35)", borderRadius: "8px", display: "flex", alignItems: "center", gap: "10px", fontSize: "13px" }}>
                    <span style={{ fontSize: "18px" }}>✅</span>
                    <div>
                        <span style={{ fontWeight: 700, color: "var(--color-primary)" }}>Observaciones levantadas</span>
                        <span style={{ color: "var(--color-text-muted)", marginLeft: "8px" }}>— Pendiente revisión final del Jefe.</span>
                    </div>
                </div>
            )}

            {/* OK message */}
            {msgOk && (
                <div style={{ padding: "8px 14px", marginBottom: "10px", background: "rgba(52,211,153,0.1)", borderRadius: "6px", color: "var(--color-success)", fontSize: "12px" }}>
                    ✅ {msgOk}
                </div>
            )}

            {/* Info sede/unidad/empleados */}
            <div style={{ padding: "10px 16px", marginBottom: "14px", background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "8px", fontSize: "12px", display: "flex", gap: "20px", flexWrap: "wrap" }}>
                <span><span style={{ color: "var(--color-text-muted)" }}>Analista:</span> <strong>{analistaNombre}</strong></span>
                <span><span style={{ color: "var(--color-text-muted)" }}>Sede:</span> <strong>{sede || tareo?.sede || "—"}</strong></span>
                {(businessUnit || tareo?.business_unit) && (
                    <span><span style={{ color: "var(--color-text-muted)" }}>Unidad:</span> <strong>{businessUnit || tareo?.business_unit}</strong></span>
                )}
                <span><span style={{ color: "var(--color-text-muted)" }}>Empleados:</span> <strong>{empleados.length}</strong></span>
                <span style={{ marginLeft: "auto" }}>
                    {esCerrado && <span className="badge badge--green">Cerrado</span>}
                    {enRevision && <span className="badge badge--orange">En Revisión</span>}
                    {obsLevantadas && <span className="badge badge--blue">Obs. Levantadas</span>}
                    {!esCerrado && !enRevision && !obsLevantadas && <span className="badge badge--yellow">Borrador</span>}
                </span>
            </div>

            {/* Error message */}
            {msgError && (
                <div style={{ padding: "8px 14px", marginBottom: "10px", background: "rgba(248,113,113,0.1)", borderRadius: "6px", color: "var(--color-danger)", fontSize: "12px" }}>
                    ⚠️ {msgError}
                </div>
            )}

            <TareoAnalistaToolbar
                buscar={buscar}
                setBuscar={setBuscar}
                autosaveStatus={autosaveStatus}
                esReadonly={esReadonly}
                guardando={guardando}
                guardarTodo={guardarTodo}
                tareoEstado={tareo?.estado}
                readonly={readonly}
                onExportar={handleExportar}
                onCerrar={() => setShowConfirmCierre(true)}
                erroresCount={erroresCount}
            />

            {!esReadonly && tareo && tareo.estado !== "cerrado" && (
                <ImportadorHistoricoAvanzado
                    tareoAnalistaId={tareo.id}
                    onImportComplete={handleImportComplete}
                />
            )}

            <TareoAnalistaTable
                filasPagina={filasPagina}
                totalFiltradas={filasFiltradas.length}
                paginaActual={paginaSegura}
                totalPaginas={totalPaginas}
                porPagina={POR_PAGINA}
                setPagina={setPagina}
                verColumnas={verColumnas}
                setVerColumnas={setVerColumnas}
                esReadonly={esReadonly}
                updateDetalle={updateDetalle}
                totales={totales}
                diasMax={diasMax}
            />

            {showConfirmCierre && (
                <TareoConfirmModal
                    mesLabel={mesLabel}
                    cerrando={cerrando}
                    onCancel={() => setShowConfirmCierre(false)}
                    onConfirm={ejecutarCierre}
                />
            )}

            {tareo && (
                <TareoAuditLog
                    tareoAnalistaId={tareo.id}
                    empleados={empleados}
                />
            )}
        </div>
    );
}
