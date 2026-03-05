/**
 * Wrapper del Tareo Maestro — con guard de rol Jefe.
 * Muestra la planilla consolidada de todos los empleados (solo lectura).
 */
import React, { useEffect, useState } from "react";
import { useStore } from "@nanostores/react";
import { $periodo, $user } from "../../lib/stores";
import {
    fetchTareoMaestroLive,
    type TareoFilaLive,
} from "../../lib/tareoMaestro";
import { supabase, MESES } from "../../lib/supabase";
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
import type { TareoEmployeeConfig } from "../../lib/empleados";
import { exportarPDF, exportarExcel, construirFilas, type FilaRaw } from "../../lib/exportUtils";
import PaginationControls from "./PaginationControls";

type VistaTab = "dias" | "ingresos" | "descuentos" | "totales";

export default function TareoMaestroWrapper() {
    const { anio, mes } = useStore($periodo);
    const user = useStore($user);

    // Mantener URL sincronizada con el periodo del store
    useEffect(() => {
        const currentUrl = new URL(window.location.href);
        currentUrl.searchParams.set("anio", String(anio));
        currentUrl.searchParams.set("mes", String(mes));
        window.history.replaceState({}, "", currentUrl.toString());
    }, [anio, mes]);

    const mesLabel = `${MESES[mes]} ${anio}`;
    const ANIOS = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 1 + i);
    const MESES_LIST = Array.from({ length: 12 }, (_, i) => i + 1);

    const [detalles, setDetalles] = useState<TareoFilaLive[]>([]);
    const [configMap, setConfigMap] = useState<Map<string, TareoEmployeeConfig>>(new Map());
    const [verColumnas, setVerColumnas] = useState<VistaTab>("dias");
    const [buscar, setBuscar] = useState("");
    const [loaded, setLoaded] = useState(false);
    const [pagina, setPagina] = useState(0);
    const POR_PAGINA = 20;

    // Reset página al cambiar el filtro de búsqueda
    React.useEffect(() => { setPagina(0); }, [buscar]);

    useEffect(() => {
        if (!user) { window.location.href = "/login"; return; }
        const isJefeOrCentral = user.rol === "jefe" || (user.rol === "analista" && user.sede === "ADM. CENTRAL");
        if (!isJefeOrCentral) { window.location.href = "/"; }
    }, [user]);

    useEffect(() => {
        if (!user) return;
        async function cargar() {
            setLoaded(false);
            const datos = await fetchTareoMaestroLive(anio, mes);
            setDetalles(datos);

            // Bug fix: usar `datos` (recién cargado) en lugar de `detalles` (state anterior, vacío)
            if (datos.length > 0 && supabase) {
                const ids = datos.map((d) => d.empleado_id);
                const { data: configs } = await supabase
                    .from("tareo_employee_config")
                    .select("*")
                    .in("employee_id", ids);
                const map = new Map(
                    ((configs ?? []) as unknown as TareoEmployeeConfig[]).map((c) => [c.employee_id, c])
                );
                setConfigMap(map);
            } else {
                setConfigMap(new Map());
            }
            setLoaded(true);
        }
        cargar();
    }, [user, anio, mes]);

    if (!user) {
        return (
            <div style={{ padding: "40px", textAlign: "center", color: "var(--color-text-muted)" }}>
                Verificando sesión...
            </div>
        );
    }

    const headerJSX = (
        <div className="page-header" style={{ marginBottom: "20px", display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: "10px" }}>
            <div className="page-header__text">
                <h2 style={{ fontSize: "24px", fontWeight: 700, margin: "0 0 4px 0" }}>Tareo Maestro — {mesLabel}</h2>
                <p style={{ color: "var(--color-text-muted)", margin: 0, fontSize: "14px" }}>
                    Vista consolidada de todos los empleados · PAUSER DISTRIBUCIONES S.A.C.
                </p>
            </div>
            <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                <a href="/tareo/jefe" className="btn btn--ghost">
                    ← Volver a TAREO/SEDE
                </a>
            </div>
        </div>
    );

    if (!loaded) {
        return (
            <div>
                {headerJSX}
                <div style={{ padding: "40px", textAlign: "center", color: "var(--color-text-muted)" }}>
                    Calculando Tareo Maestro en vivo...
                </div>
            </div>
        );
    }

    // Filtrar y calcular
    const detallesFiltrados = detalles.filter((d) => {
        const q = buscar.toLowerCase();
        return (
            d.empleado?.full_name?.toLowerCase().includes(q) ||
            d.empleado?.dni?.includes(q) ||
            d.sede?.toLowerCase().includes(q) ||
            d.business_unit?.toLowerCase().includes(q)
        );
    });

    const totalPaginas = Math.max(1, Math.ceil(detallesFiltrados.length / POR_PAGINA));
    const paginaSegura = Math.min(pagina, totalPaginas - 1);
    const detallesPagina = detallesFiltrados.slice(paginaSegura * POR_PAGINA, (paginaSegura + 1) * POR_PAGINA);
    const offsetInicio = paginaSegura * POR_PAGINA;

    function calcFila(d: TareoFilaLive) {
        const config = configMap.get(d.empleado_id);
        const sueldoBase = config?.sueldo_base ?? 0;
        const afp = config?.afp_codigo ?? "ONP";
        const tieneVidaLey = config?.vida_ley ?? false;

        const diasTrab = calcDiasTrab(d.dias_habiles, d.vac, d.lic_sin_h, d.susp, d.aus_sin_just);
        const totalHoras = calcTotalHoras(d.dias_habiles, d.descanso_lab, d.desc_med, d.vel, d.vac, d.lic_sin_h, d.susp, d.aus_sin_just, 0);
        const sueldoProp = calcSueldoProporcional(sueldoBase, diasTrab, 30);
        // Bug fix: incluir comision y bono_productiv en afecto, bono_alimento en no afecto
        const totalAfecto = round2(sueldoProp + (d.comision || 0) + (d.bono_productiv || 0));
        const totalNoAfecto = round2((d.movilidad || 0) + (d.bono_alimento || 0));
        const totalIngresos = calcTotalIngresos(totalAfecto, totalNoAfecto);
        const afpOnp = calcAfpOnpSimple(totalAfecto, afp);
        const vidaLey = calcVidaLey(totalAfecto, tieneVidaLey);
        const totalDesc = calcTotalDescuentos({ afp_onp: afpOnp, vida_ley: vidaLey, ret_jud: d.ret_jud });
        const netoPagar = calcNetoPagar(totalIngresos, totalDesc);
        const essalud = calcEssalud(totalAfecto);
        return { diasTrab, totalHoras, sueldoBase, sueldoProp, afp, totalAfecto, totalNoAfecto, totalIngresos, afpOnp, vidaLey, totalDesc, netoPagar, essalud };
    }

    const totales = detallesFiltrados.reduce((acc, d) => {
        const c = calcFila(d);
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
    }, { diasTrab: 0, totalHoras: 0, totalIngresos: 0, afpOnp: 0, vidaLey: 0, totalDesc: 0, netoPagar: 0, essalud: 0 });

    const tabs: { key: VistaTab; label: string }[] = [
        { key: "dias", label: "Días Laborados" },
        { key: "ingresos", label: "Ingresos" },
        { key: "descuentos", label: "Descuentos" },
        { key: "totales", label: "Totales" },
    ];

    // Exportar planilla Maestro
    const handleExportarMaestro = async (formato: "pdf" | "excel") => {
        const rawFilas: FilaRaw[] = detallesFiltrados.map((d) => {
            const config = configMap.get(d.empleado_id);
            return {
                nombre: d.empleado?.full_name ?? d.empleado_id,
                dni: d.empleado?.dni ?? "",
                cargo: d.empleado?.position ?? "",
                afpCodigo: config?.afp_codigo ?? "ONP",
                sueldoBase: config?.sueldo_base ?? 0,
                tieneVidaLey: config?.vida_ley ?? false,
                diasHabiles: d.dias_habiles,
                vac: d.vac,
                licSinH: d.lic_sin_h,
                susp: d.susp,
                ausSinJust: d.aus_sin_just,
                movilidad: d.movilidad,
                comision: d.comision,
                bonoProductiv: d.bono_productiv,
                bonoAlimento: d.bono_alimento,
                retJud: d.ret_jud,
            };
        });
        const filasPlanilla = construirFilas(rawFilas);
        const titulo = "Tareo Maestro Consolidado";
        if (formato === "pdf") {
            await exportarPDF(filasPlanilla, mesLabel, titulo);
        } else {
            await exportarExcel(filasPlanilla, mesLabel, titulo);
        }
    };

    return (
        <div>
            {headerJSX}
            {/* Banner estado */}
            <div style={{
                padding: "10px 16px", marginBottom: "14px",
                background: "var(--color-surface-2)", border: "1px solid var(--color-border)",
                borderRadius: "8px", display: "flex", alignItems: "center", gap: "10px", fontSize: "13px",
            }}>
                <span style={{ color: "var(--color-primary)", fontWeight: 700 }}>📊 Consolidado en Vivo</span>
                <span style={{ color: "var(--color-text-muted)" }}>·</span>
                <span style={{ color: "var(--color-text-muted)" }}>{detalles.length} empleados consolidados</span>
                <span style={{ marginLeft: "auto", display: "flex", gap: "8px" }}>
                    <span className="badge badge--green">
                        {detalles.filter(d => d.estado_sede === "cerrado").length} Cerrados
                    </span>
                    <span className="badge badge--yellow">
                        {detalles.filter(d => d.estado_sede === "borrador").length} Borrador
                    </span>
                    <span className="badge text-muted" style={{ border: "1px solid var(--color-border)" }}>
                        {detalles.filter(d => d.estado_sede === "sin_iniciar").length} Sin iniciar
                    </span>
                </span>
            </div>

            {/* Toolbar */}
            <div style={{ display: "flex", gap: "10px", marginBottom: "16px", alignItems: "center" }}>
                <input
                    type="text"
                    placeholder="🔍 Buscar por nombre, DNI, sede..."
                    className="form-input"
                    style={{ width: "320px" }}
                    value={buscar}
                    onChange={(e) => setBuscar(e.target.value)}
                />
                <div style={{ display: "flex", gap: "6px", marginLeft: "auto" }}>
                    <button
                        className="btn btn--ghost"
                        style={{ fontSize: "12px" }}
                        onClick={() => handleExportarMaestro("pdf")}
                        title="Exportar planilla maestro a PDF"
                    >
                        📄 PDF
                    </button>
                    <button
                        className="btn btn--ghost"
                        style={{ fontSize: "12px" }}
                        onClick={() => handleExportarMaestro("excel")}
                        title="Exportar planilla maestro a Excel"
                    >
                        📊 Excel
                    </button>
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
                            <th>Sede / Unidad<br /><span style={{ fontSize: "10px", color: "var(--color-text-muted)", fontWeight: 400 }}>Estado Analista</span></th>
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
                        {detallesPagina.map((d, idx) => {
                            const c = calcFila(d);
                            return (
                                <tr key={d.id}>
                                    <td className="text-muted mono" style={{ textAlign: "center" }}>{offsetInicio + idx + 1}</td>
                                    <td style={{ fontWeight: 600, fontSize: "12px" }}>
                                        {d.empleado?.full_name ?? d.empleado_id}
                                        <div style={{ fontSize: "11px", color: "var(--color-text-muted)", fontWeight: 400 }}>{d.empleado?.dni}</div>
                                    </td>
                                    <td style={{ fontSize: "12px" }}>
                                        {d.sede}{d.business_unit ? ` / ${d.business_unit}` : ""}
                                        <div style={{ marginTop: "4px" }}>
                                            {d.estado_sede === "cerrado" && <span className="badge badge--green" style={{ fontSize: "9px" }}>✓ Cerrado</span>}
                                            {d.estado_sede === "borrador" && <span className="badge badge--yellow" style={{ fontSize: "9px" }}>Borrador</span>}
                                            {d.estado_sede === "sin_iniciar" && <span className="badge text-muted" style={{ fontSize: "9px", border: "1px solid var(--color-border)" }}>Sin iniciar</span>}
                                        </div>
                                    </td>
                                    <td style={{ textAlign: "center" }}>
                                        <span className="badge badge--blue mono" style={{ fontSize: "10px" }}>{c.afp}</span>
                                    </td>
                                    {verColumnas === "dias" && <>
                                        <td className="cell-num" style={{ fontWeight: 700 }}>{c.diasTrab}</td>
                                        <td className="cell-num">{c.totalHoras}</td>
                                        <td className="cell-num">{d.descanso_lab}</td>
                                        <td className="cell-num">{d.desc_med}</td>
                                        <td className="cell-num">{d.vac}</td>
                                        <td className="cell-num">{d.lic_sin_h}</td>
                                        <td className="cell-num">{d.susp}</td>
                                        <td className="cell-num">{d.aus_sin_just}</td>
                                    </>}
                                    {verColumnas === "ingresos" && <>
                                        <td className="cell-currency">{c.sueldoBase.toFixed(2)}</td>
                                        <td className="cell-currency">{c.sueldoProp.toFixed(2)}</td>
                                        <td className="cell-currency">{d.movilidad.toFixed(2)}</td>
                                        <td className="cell-currency">{c.totalAfecto.toFixed(2)}</td>
                                        <td className="cell-currency">{c.totalNoAfecto.toFixed(2)}</td>
                                        <td className="cell-currency" style={{ fontWeight: 700, color: "var(--color-success)" }}>{c.totalIngresos.toFixed(2)}</td>
                                    </>}
                                    {verColumnas === "descuentos" && <>
                                        <td className="cell-currency text-danger">{c.afpOnp.toFixed(2)}</td>
                                        <td className="cell-currency text-danger">{c.vidaLey.toFixed(2)}</td>
                                        <td className="cell-currency">{d.ret_jud.toFixed(2)}</td>
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
                            <td colSpan={4} style={{ textAlign: "right" }}>SUBTOTALES ({detallesFiltrados.length} trabajadores — página {paginaSegura + 1}/{totalPaginas})</td>
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

            {/* Paginación */}
            <PaginationControls
                paginaActual={paginaSegura}
                totalPaginas={totalPaginas}
                porPagina={POR_PAGINA}
                totalFiltradas={detallesFiltrados.length}
                setPagina={setPagina}
            />

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
        </div>
    );
}
