import React from "react";
import type { TareoAnalistaDetalle } from "../../lib/tareoAnalista";
import { type EmpleadoFila, type VistaTab, type TotalesRow, calcularFila, validarDetalle } from "./tareoAnalistaTypes";
import PaginationControls from "./PaginationControls";

const tabs: { key: VistaTab; label: string }[] = [
    { key: "dias", label: "Días Laborados" },
    { key: "ingresos", label: "Ingresos" },
    { key: "descuentos", label: "Descuentos" },
    { key: "totales", label: "Totales" },
];

const ERR_STYLE: React.CSSProperties = {
    borderColor: "var(--color-danger)",
    background: "rgba(248,113,113,0.12)",
};

type Props = {
    filasPagina: EmpleadoFila[];
    totalFiltradas: number;
    paginaActual: number;
    totalPaginas: number;
    porPagina: number;
    setPagina: (p: number) => void;
    verColumnas: VistaTab;
    setVerColumnas: (v: VistaTab) => void;
    esReadonly: boolean;
    updateDetalle: (empId: string, field: keyof TareoAnalistaDetalle, val: number) => void;
    totales: TotalesRow;
    diasMax: number;
};

export default function TareoAnalistaTable({
    filasPagina, totalFiltradas, paginaActual, totalPaginas, porPagina, setPagina,
    verColumnas, setVerColumnas, esReadonly, updateDetalle, totales, diasMax,
}: Props) {
    const offsetInicio = paginaActual * porPagina;
    return (
        <>
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
                                <th className="th-num">Comis.</th>
                                <th className="th-num">Bono<br />Prod.</th>
                                <th className="th-num">Bono<br />Alim.</th>
                                <th className="th-num">Movil.</th>
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
                        {filasPagina.map((emp, idx) => {
                            const c = calcularFila(emp);
                            const v = validarDetalle(emp.detalle, diasMax);
                            return (
                                <tr key={emp.id} style={v.tieneError ? { background: "rgba(248,113,113,0.04)" } : undefined}>
                                    <td className="text-muted mono" style={{ textAlign: "center", color: v.tieneError ? "var(--color-danger)" : undefined }}>
                                        {v.tieneError ? "!" : offsetInicio + idx + 1}
                                    </td>
                                    <td style={{ fontWeight: 600, fontSize: "12px" }}>
                                        {emp.full_name}
                                        <div style={{ fontSize: "11px", color: "var(--color-text-muted)", fontWeight: 400 }}>{emp.dni}</div>
                                    </td>
                                    <td style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>{emp.position}</td>
                                    <td style={{ textAlign: "center" }}>
                                        <span className="badge badge--blue mono" style={{ fontSize: "10px" }}>{c.afp || "—"}</span>
                                    </td>

                                    {verColumnas === "dias" && <>
                                        <td className="cell-num" style={{
                                            fontWeight: 700,
                                            color: v.diasHabilesInvalido
                                                ? "var(--color-danger)"
                                                : c.diasTrab < 30
                                                    ? "var(--color-warning)"
                                                    : "var(--color-text)",
                                            background: v.diasHabilesInvalido ? "rgba(248,113,113,0.12)" : undefined,
                                        }}
                                            title={v.diasHabilesInvalido ? `días_habiles (${emp.detalle.dias_habiles}) fuera de rango [0-${diasMax}]` : undefined}
                                        >
                                            {c.diasTrab}
                                        </td>
                                        <td className="cell-num">{c.totalHoras}</td>
                                        <td className="cell-num">
                                            {esReadonly ? emp.detalle.descanso_lab : (
                                                <input type="number" min={0} max={diasMax} className="cell-input"
                                                    value={emp.detalle.descanso_lab}
                                                    onChange={(e) => updateDetalle(emp.id, "descanso_lab", +e.target.value)} />
                                            )}
                                        </td>
                                        <td className="cell-num">
                                            {esReadonly ? emp.detalle.desc_med : (
                                                <input type="number" min={0} max={diasMax} className="cell-input"
                                                    value={emp.detalle.desc_med}
                                                    onChange={(e) => updateDetalle(emp.id, "desc_med", +e.target.value)} />
                                            )}
                                        </td>
                                        <td className="cell-num">
                                            {esReadonly ? emp.detalle.vac : (
                                                <input type="number" min={0} max={diasMax} className="cell-input"
                                                    style={v.sumaAusenciasExcede ? ERR_STYLE : undefined}
                                                    value={emp.detalle.vac}
                                                    onChange={(e) => updateDetalle(emp.id, "vac", +e.target.value)} />
                                            )}
                                        </td>
                                        <td className="cell-num">
                                            {esReadonly ? emp.detalle.lic_sin_h : (
                                                <input type="number" min={0} max={diasMax} className="cell-input"
                                                    style={v.sumaAusenciasExcede ? ERR_STYLE : undefined}
                                                    value={emp.detalle.lic_sin_h}
                                                    onChange={(e) => updateDetalle(emp.id, "lic_sin_h", +e.target.value)} />
                                            )}
                                        </td>
                                        <td className="cell-num">
                                            {esReadonly ? emp.detalle.susp : (
                                                <input type="number" min={0} max={diasMax} className="cell-input"
                                                    style={v.sumaAusenciasExcede ? ERR_STYLE : undefined}
                                                    value={emp.detalle.susp}
                                                    onChange={(e) => updateDetalle(emp.id, "susp", +e.target.value)} />
                                            )}
                                        </td>
                                        <td className="cell-num">
                                            {esReadonly ? emp.detalle.aus_sin_just : (
                                                <input type="number" min={0} max={diasMax} className="cell-input"
                                                    style={v.sumaAusenciasExcede ? ERR_STYLE : undefined}
                                                    value={emp.detalle.aus_sin_just}
                                                    onChange={(e) => updateDetalle(emp.id, "aus_sin_just", +e.target.value)} />
                                            )}
                                        </td>
                                    </>}

                                    {verColumnas === "ingresos" && <>
                                        <td className="cell-currency">{c.sueldoBase.toFixed(2)}</td>
                                        <td className="cell-currency">{c.sueldoProp.toFixed(2)}</td>
                                        <td className="cell-num">
                                            {esReadonly ? emp.detalle.comision.toFixed(2) : (
                                                <input type="number" min={0} step={10} className="cell-input"
                                                    value={emp.detalle.comision}
                                                    onChange={(e) => updateDetalle(emp.id, "comision", +e.target.value)} />
                                            )}
                                        </td>
                                        <td className="cell-num">
                                            {esReadonly ? emp.detalle.bono_productiv.toFixed(2) : (
                                                <input type="number" min={0} step={10} className="cell-input"
                                                    value={emp.detalle.bono_productiv}
                                                    onChange={(e) => updateDetalle(emp.id, "bono_productiv", +e.target.value)} />
                                            )}
                                        </td>
                                        <td className="cell-num">
                                            {esReadonly ? emp.detalle.bono_alimento.toFixed(2) : (
                                                <input type="number" min={0} step={10} className="cell-input"
                                                    value={emp.detalle.bono_alimento}
                                                    onChange={(e) => updateDetalle(emp.id, "bono_alimento", +e.target.value)} />
                                            )}
                                        </td>
                                        <td className="cell-num">
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
                                SUBTOTALES ({totalFiltradas} trabajadores)
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

            {/* Paginación */}
            <PaginationControls
                paginaActual={paginaActual}
                totalPaginas={totalPaginas}
                porPagina={porPagina}
                totalFiltradas={totalFiltradas}
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
        </>
    );
}
