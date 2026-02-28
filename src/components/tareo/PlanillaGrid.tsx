import React, { useState, useCallback } from "react";
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
    formatPEN,
    round2,
} from "../../lib/formulas";

// ─── Tipos locales ────────────────────────────────────────────────────────────
type EmpleadoRow = {
    num: number;
    dni: string;
    nombre: string;
    cargo: string;
    estado: string;
    afp: string;
    tieneVidaLey: boolean;
    tieneEps: boolean;
    sueldoBase: number;
    // Días
    diasHabiles: number;
    descansoLab: number;
    descMed: number;
    vel: number;
    vac: number;
    licSinH: number;
    susp: number;
    ausSinJust: number;
    // Ingresos no afecto
    movilidad: number;
    retJud: number;
};

type FilaCalculada = EmpleadoRow & {
    diasTrab: number;
    totalHoras: number;
    sueldoProp: number;
    totalAfecto: number;
    totalNoAfecto: number;
    totalIngresos: number;
    afpOnp: number;
    vidaLey: number;
    totalDesc: number;
    netoPagar: number;
    essalud: number;
};

// ─── Demo data (mientras se conecta Supabase) ────────────────────────────────
const EMPLEADOS_DEMO: EmpleadoRow[] = [
    { num: 1, dni: "70668669", nombre: "ACERO MAMANI, MILTHON LINO", cargo: "AUXILIAR DE DESPACHO", estado: "ACTIVO", afp: "PROFUT", tieneVidaLey: true, tieneEps: false, sueldoBase: 1300, diasHabiles: 30, descansoLab: 0, descMed: 0, vel: 0, vac: 0, licSinH: 0, susp: 0, ausSinJust: 0, movilidad: 0, retJud: 0 },
    { num: 2, dni: "43886315", nombre: "AGREDA VILLANUEVA, ISMAEL ANDERSON", cargo: "CHOFER", estado: "ACTIVO", afp: "HABITAT", tieneVidaLey: true, tieneEps: false, sueldoBase: 1500, diasHabiles: 30, descansoLab: 0, descMed: 0, vel: 0, vac: 0, licSinH: 0, susp: 0, ausSinJust: 0, movilidad: 0, retJud: 0 },
    { num: 3, dni: "43628466", nombre: "AGUILAR VERGARA, FREDDY ISRAEL", cargo: "AUXILIAR DE DESPACHO", estado: "ACTIVO", afp: "ONP", tieneVidaLey: true, tieneEps: false, sueldoBase: 1300, diasHabiles: 30, descansoLab: 0, descMed: 0, vel: 0, vac: 0, licSinH: 0, susp: 0, ausSinJust: 0, movilidad: 0, retJud: 0 },
    { num: 4, dni: "74289649", nombre: "AHUMADA PALOMINO, VICTOR ANTONIO", cargo: "VENDEDOR TRADICIONAL", estado: "ACTIVO", afp: "PRIMA", tieneVidaLey: true, tieneEps: false, sueldoBase: 1300, diasHabiles: 30, descansoLab: 0, descMed: 0, vel: 0, vac: 0, licSinH: 0, susp: 0, ausSinJust: 0, movilidad: 0, retJud: 0 },
    { num: 5, dni: "48615788", nombre: "ALANGUIA ANCHAPURI, JOSE MIGUEL", cargo: "CONFERENTE", estado: "ACTIVO", afp: "INTEGR", tieneVidaLey: true, tieneEps: false, sueldoBase: 1300, diasHabiles: 30, descansoLab: 0, descMed: 0, vel: 0, vac: 0, licSinH: 0, susp: 0, ausSinJust: 0, movilidad: 0, retJud: 0 },
    { num: 6, dni: "47361639", nombre: "ALANGUIA CATACHURA, EDWIN CRISPIN", cargo: "MONTACARGUISTA", estado: "ACTIVO", afp: "PROFUT", tieneVidaLey: true, tieneEps: false, sueldoBase: 1500, diasHabiles: 30, descansoLab: 0, descMed: 0, vel: 0, vac: 0, licSinH: 0, susp: 0, ausSinJust: 0, movilidad: 0, retJud: 0 },
    { num: 7, dni: "18089834", nombre: "ALCALDE ALCANTARA, ALFREDO ARTHUR", cargo: "SUPERVISOR DE VENTAS", estado: "ACTIVO", afp: "ONP", tieneVidaLey: true, tieneEps: false, sueldoBase: 2500, diasHabiles: 30, descansoLab: 0, descMed: 0, vel: 0, vac: 0, licSinH: 0, susp: 0, ausSinJust: 0, movilidad: 0, retJud: 0 },
    { num: 8, dni: "73341161", nombre: "ARIAS HERRERA, JUAN CARLOS", cargo: "CHOFER", estado: "ACTIVO", afp: "HABITAT", tieneVidaLey: true, tieneEps: false, sueldoBase: 1500, diasHabiles: 30, descansoLab: 0, descMed: 0, vel: 0, vac: 0, licSinH: 0, susp: 0, ausSinJust: 0, movilidad: 0, retJud: 0 },
    { num: 9, dni: "32542255", nombre: "ARTEAGA ANTICONA, ELMER DONAR", cargo: "AUXILIAR DE DESPACHO", estado: "ACTIVO", afp: "PRIMA", tieneVidaLey: true, tieneEps: false, sueldoBase: 1300, diasHabiles: 30, descansoLab: 0, descMed: 0, vel: 0, vac: 0, licSinH: 0, susp: 0, ausSinJust: 0, movilidad: 0, retJud: 0 },
    { num: 10, dni: "77421008", nombre: "AVILA SILVA, JHON KENNEDY", cargo: "AUXILIAR DE DESPACHO", estado: "ACTIVO", afp: "ONP", tieneVidaLey: true, tieneEps: false, sueldoBase: 1300, diasHabiles: 30, descansoLab: 0, descMed: 0, vel: 0, vac: 0, licSinH: 0, susp: 0, ausSinJust: 0, movilidad: 0, retJud: 0 },
];

// ─── Calcular totales por fila ────────────────────────────────────────────────
function calcularFila(e: EmpleadoRow): FilaCalculada {
    const diasTrab = calcDiasTrab(e.diasHabiles, e.vac, e.licSinH, e.susp, e.ausSinJust);
    const totalHoras = calcTotalHoras(e.diasHabiles, e.descansoLab, e.descMed, e.vel, e.vac, e.licSinH, e.susp, e.ausSinJust, 0);
    const sueldoProp = calcSueldoProporcional(e.sueldoBase, diasTrab, 30);
    const totalAfecto = round2(sueldoProp);
    const totalNoAfecto = round2(e.movilidad);
    const totalIngresos = calcTotalIngresos(totalAfecto, totalNoAfecto);
    const baseAfecta = totalAfecto;
    const afpOnp = calcAfpOnpSimple(baseAfecta, e.afp);
    const vidaLey = calcVidaLey(baseAfecta, e.tieneVidaLey);
    const totalDesc = calcTotalDescuentos({ afp_onp: afpOnp, vida_ley: vidaLey, ret_jud: e.retJud });
    const netoPagar = calcNetoPagar(totalIngresos, totalDesc);
    const essalud = calcEssalud(baseAfecta);

    return { ...e, diasTrab, totalHoras, sueldoProp, totalAfecto, totalNoAfecto, totalIngresos, afpOnp, vidaLey, totalDesc, netoPagar, essalud };
}

// ─── Componente principal ─────────────────────────────────────────────────────
type Props = {
    mes: number;
    anio: number;
    mesLabel: string;
};

export default function PlanillaGrid({ mes, anio, mesLabel }: Props) {
    const [empleados, setEmpleados] = useState<EmpleadoRow[]>(EMPLEADOS_DEMO);
    const [buscar, setBuscar] = useState("");
    const [verColumnas, setVerColumnas] = useState<"dias" | "ingresos" | "descuentos" | "totales">("dias");

    const filas = empleados
        .filter(e => {
            const q = buscar.toLowerCase();
            return e.nombre.toLowerCase().includes(q) || e.dni.includes(q) || e.cargo.toLowerCase().includes(q);
        })
        .map(calcularFila);

    // ── Exportar CSV (abre en Excel) ──────────────────────────────────────────
    const exportarExcel = useCallback(() => {
        const sep = ",";
        const encabezado = [
            "N°", "DNI", "Apellidos y Nombres", "Cargo", "AFP",
            "Días Trab", "Total Hrs",
            "Sueldo Base", "S/ Prop.", "Movilidad", "Total Afecto", "Total No Afecto", "Total Ingresos",
            "AFP/ONP", "Vida Ley", "Ret. Judicial", "Total Dsctos",
            "Neto a Pagar", "EsSalud 9%",
        ].join(sep);

        const filas2 = empleados.map(calcularFila);
        const fixt = (n: number) => n.toFixed(2).replace(".", ",");
        const rows = filas2.map(f => [
            f.num, f.dni, `"${f.nombre}"`, `"${f.cargo}"`, f.afp,
            f.diasTrab, f.totalHoras,
            fixt(f.sueldoBase), fixt(f.sueldoProp), fixt(f.movilidad), fixt(f.totalAfecto), fixt(f.totalNoAfecto), fixt(f.totalIngresos),
            fixt(f.afpOnp), fixt(f.vidaLey), fixt(f.retJud), fixt(f.totalDesc),
            fixt(f.netoPagar), fixt(f.essalud),
        ].join(sep)).join("\n");

        const bom = "\uFEFF"; // BOM UTF-8 para que Excel en Windows reconozca tildes
        const blob = new Blob([bom + encabezado + "\n" + rows], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `Tareo_${mesLabel.replace(/ /g, "_")}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    }, [empleados, mesLabel]);

    // ── Imprimir ──────────────────────────────────────────────────────────────
    const imprimir = useCallback(() => {
        const filas2 = empleados.map(calcularFila);
        const fixt = (n: number) => n.toFixed(2);
        const rows = filas2.map(f => `
            <tr>
                <td>${f.num}</td><td>${f.dni}</td>
                <td>${f.nombre}</td><td>${f.cargo}</td><td>${f.afp}</td>
                <td>${f.diasTrab}</td><td>${f.totalHoras}</td>
                <td>${fixt(f.sueldoBase)}</td><td>${fixt(f.sueldoProp)}</td>
                <td>${fixt(f.totalAfecto)}</td><td>${fixt(f.totalNoAfecto)}</td><td>${fixt(f.totalIngresos)}</td>
                <td>${fixt(f.afpOnp)}</td><td>${fixt(f.vidaLey)}</td><td>${fixt(f.retJud)}</td><td>${fixt(f.totalDesc)}</td>
                <td><strong>${fixt(f.netoPagar)}</strong></td><td>${fixt(f.essalud)}</td>
            </tr>`).join("");

        const win = window.open("", "_blank", "width=1200,height=800");
        if (!win) return;
        win.document.write(`<!DOCTYPE html><html><head>
            <meta charset="UTF-8"/>
            <title>Planilla — ${mesLabel}</title>
            <style>
                body{font-family:Arial,sans-serif;font-size:9px;margin:12px}
                h2{font-size:13px;margin-bottom:2px}p{font-size:9px;color:#666;margin:0 0 10px}
                table{border-collapse:collapse;width:100%}
                th,td{border:1px solid #ccc;padding:3px 5px;text-align:center}
                th{background:#1a1d27;color:#fff;font-size:8px;text-transform:uppercase}
                tr:nth-child(even){background:#f5f5f5}
                @media print{body{margin:0}}
            </style>
        </head><body>
            <h2>Planilla Tareo — ${mesLabel}</h2>
            <p>PAUSER DISTRIBUCIONES S.A.C. &nbsp;·&nbsp; RUC: 20600869940</p>
            <table><thead><tr>
                <th>N°</th><th>DNI</th><th>Apellidos y Nombres</th><th>Cargo</th><th>AFP</th>
                <th>Días</th><th>Hrs</th>
                <th>S. Base</th><th>S. Prop</th><th>T. Afecto</th><th>T. NoAfecto</th><th>T. Ingresos</th>
                <th>AFP/ONP</th><th>V. Ley</th><th>Ret. Jud</th><th>T. Dsctos</th>
                <th>Neto Pagar</th><th>EsSalud</th>
            </tr></thead><tbody>${rows}</tbody></table>
        </body></html>`);
        win.document.close();
        win.print();
    }, [empleados, mesLabel]);

    // Totales generales
    const totales = filas.reduce((acc, f) => ({
        diasTrab: acc.diasTrab + f.diasTrab,
        totalHoras: acc.totalHoras + f.totalHoras,
        totalIngresos: acc.totalIngresos + f.totalIngresos,
        afpOnp: acc.afpOnp + f.afpOnp,
        vidaLey: acc.vidaLey + f.vidaLey,
        totalDesc: acc.totalDesc + f.totalDesc,
        netoPagar: acc.netoPagar + f.netoPagar,
        essalud: acc.essalud + f.essalud,
    }), { diasTrab: 0, totalHoras: 0, totalIngresos: 0, afpOnp: 0, vidaLey: 0, totalDesc: 0, netoPagar: 0, essalud: 0 });

    const updateEmpleado = useCallback((idx: number, field: keyof EmpleadoRow, val: number | string | boolean) => {
        setEmpleados(prev => prev.map((e, i) => i === idx ? { ...e, [field]: val } : e));
    }, []);

    const tabs = [
        { key: "dias", label: "Días Laborados" },
        { key: "ingresos", label: "Ingresos" },
        { key: "descuentos", label: "Descuentos" },
        { key: "totales", label: "Totales" },
    ] as const;

    return (
        <div>
            {/* Toolbar */}
            <div style={{ display: "flex", gap: "10px", marginBottom: "16px", flexWrap: "wrap", alignItems: "center" }}>
                <input
                    type="text"
                    placeholder="🔍 Buscar por nombre, DNI o cargo..."
                    className="form-input"
                    style={{ width: "300px" }}
                    value={buscar}
                    onChange={e => setBuscar(e.target.value)}
                />
                <div style={{ display: "flex", gap: "6px", marginLeft: "auto" }}>
                    <button className="btn btn--secondary" style={{ fontSize: "12px" }} onClick={exportarExcel}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                        Exportar Excel
                    </button>
                    <button className="btn btn--ghost" style={{ fontSize: "12px" }} onClick={imprimir}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 6 2 18 2 18 9" /><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><rect x="6" y="14" width="12" height="8" /></svg>
                        Imprimir
                    </button>
                </div>
            </div>

            {/* Tabs de vista */}
            <div style={{ display: "flex", gap: "4px", marginBottom: "14px", borderBottom: "1px solid var(--color-border)", paddingBottom: "1px" }}>
                {tabs.map(t => (
                    <button
                        key={t.key}
                        onClick={() => setVerColumnas(t.key)}
                        className="btn"
                        style={{
                            fontSize: "12px",
                            padding: "6px 14px",
                            borderRadius: "6px 6px 0 0",
                            background: verColumnas === t.key ? "var(--color-primary)" : "transparent",
                            color: verColumnas === t.key ? "#fff" : "var(--color-text-muted)",
                            border: "none",
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
                        {/* Columnas fijas */}
                        <col style={{ width: "44px" }} />      {/* N° */}
                        <col style={{ width: "230px" }} />     {/* Nombre */}
                        <col style={{ width: "160px" }} />     {/* Cargo */}
                        <col style={{ width: "72px" }} />      {/* AFP */}
                        {/* Columnas por vista */}
                        {verColumnas === "dias" && <>
                            <col style={{ width: "60px" }} />  {/* Días Trab */}
                            <col style={{ width: "60px" }} />  {/* Total Hrs */}
                            <col style={{ width: "60px" }} />  {/* Des Lab */}
                            <col style={{ width: "60px" }} />  {/* Des Med */}
                            <col style={{ width: "60px" }} />  {/* Vac */}
                            <col style={{ width: "60px" }} />  {/* Lic S/H */}
                            <col style={{ width: "60px" }} />  {/* Susp */}
                            <col style={{ width: "60px" }} />  {/* Aus S/J */}
                        </>}
                        {verColumnas === "ingresos" && <>
                            <col style={{ width: "88px" }} />  {/* Sueldo Base */}
                            <col style={{ width: "88px" }} />  {/* S/ Prop */}
                            <col style={{ width: "88px" }} />  {/* Movilidad */}
                            <col style={{ width: "96px" }} />  {/* Total Afecto */}
                            <col style={{ width: "96px" }} />  {/* Total No Afecto */}
                            <col style={{ width: "104px" }} /> {/* Total Ingresos */}
                        </>}
                        {verColumnas === "descuentos" && <>
                            <col style={{ width: "96px" }} />  {/* AFP/ONP */}
                            <col style={{ width: "80px" }} />  {/* Vida Ley */}
                            <col style={{ width: "88px" }} />  {/* Ret Judicial */}
                            <col style={{ width: "96px" }} />  {/* Total Dsctos */}
                        </>}
                        {verColumnas === "totales" && <>
                            <col style={{ width: "104px" }} /> {/* Total Ingresos */}
                            <col style={{ width: "100px" }} /> {/* Total Dsctos */}
                            <col style={{ width: "110px" }} /> {/* Neto a Pagar */}
                            <col style={{ width: "96px" }} />  {/* EsSalud */}
                        </>}
                    </colgroup>

                    <thead>
                        <tr>
                            {/* Siempre fijos */}
                            <th style={{ position: "sticky", left: 0, zIndex: 20, background: "var(--color-surface-2)", textAlign: "center" }}>N°</th>
                            <th style={{ position: "sticky", left: "44px", zIndex: 20, background: "var(--color-surface-2)" }}>Apellidos y Nombres</th>
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
                        {filas.map((f, idx) => (
                            <tr key={f.dni}>
                                {/* Fijos */}
                                <td style={{ position: "sticky", left: 0, background: "var(--color-surface)", zIndex: 10 }} className="text-muted mono">{f.num}</td>
                                <td style={{ position: "sticky", left: "44px", background: "var(--color-surface)", zIndex: 10, fontWeight: 600, fontSize: "12px" }}>
                                    {f.nombre}
                                    <div style={{ fontSize: "11px", color: "var(--color-text-muted)", fontWeight: 400 }}>{f.dni}</div>
                                </td>
                                <td style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>{f.cargo}</td>
                                <td style={{ textAlign: "center" }}><span className="badge badge--blue mono" style={{ fontSize: "10px" }}>{f.afp}</span></td>

                                {verColumnas === "dias" && <>
                                    <td className="cell-num" style={{ fontWeight: 700, color: f.diasTrab < 30 ? "var(--color-warning)" : "var(--color-text)" }}>
                                        {f.diasTrab}
                                    </td>
                                    <td className="cell-num">{f.totalHoras}</td>
                                    <td className="cell-num">
                                        <input
                                            type="number" min={0} max={31}
                                            className="cell-input"
                                            value={f.descansoLab}
                                            onChange={e => updateEmpleado(idx, "descansoLab", +e.target.value)}
                                        />
                                    </td>
                                    <td className="cell-num">
                                        <input type="number" min={0} max={31} className="cell-input" value={f.descMed}
                                            onChange={e => updateEmpleado(idx, "descMed", +e.target.value)} />
                                    </td>
                                    <td className="cell-num">
                                        <input type="number" min={0} max={31} className="cell-input" value={f.vac}
                                            onChange={e => updateEmpleado(idx, "vac", +e.target.value)} />
                                    </td>
                                    <td className="cell-num">
                                        <input type="number" min={0} max={31} className="cell-input" value={f.licSinH}
                                            onChange={e => updateEmpleado(idx, "licSinH", +e.target.value)} />
                                    </td>
                                    <td className="cell-num">
                                        <input type="number" min={0} max={31} className="cell-input" value={f.susp}
                                            onChange={e => updateEmpleado(idx, "susp", +e.target.value)} />
                                    </td>
                                    <td className="cell-num">
                                        <input type="number" min={0} max={31} className="cell-input" value={f.ausSinJust}
                                            onChange={e => updateEmpleado(idx, "ausSinJust", +e.target.value)} />
                                    </td>
                                </>}

                                {verColumnas === "ingresos" && <>
                                    <td className="cell-currency">
                                        <input
                                            type="number" min={0} step={50}
                                            className="cell-input"
                                            style={{ width: "70px" }}
                                            value={f.sueldoBase}
                                            onChange={e => updateEmpleado(idx, "sueldoBase", +e.target.value)}
                                        />
                                    </td>
                                    <td className="cell-currency">{f.sueldoProp.toFixed(2)}</td>
                                    <td className="cell-currency">
                                        <input type="number" min={0} step={10} className="cell-input" value={f.movilidad}
                                            onChange={e => updateEmpleado(idx, "movilidad", +e.target.value)} />
                                    </td>
                                    <td className="cell-currency">{f.totalAfecto.toFixed(2)}</td>
                                    <td className="cell-currency">{f.totalNoAfecto.toFixed(2)}</td>
                                    <td className="cell-currency" style={{ fontWeight: 700, color: "var(--color-success)" }}>
                                        {f.totalIngresos.toFixed(2)}
                                    </td>
                                </>}

                                {verColumnas === "descuentos" && <>
                                    <td className="cell-currency text-danger">{f.afpOnp.toFixed(2)}</td>
                                    <td className="cell-currency text-danger">{f.vidaLey.toFixed(2)}</td>
                                    <td className="cell-currency">
                                        <input type="number" min={0} className="cell-input" value={f.retJud}
                                            onChange={e => updateEmpleado(idx, "retJud", +e.target.value)} />
                                    </td>
                                    <td className="cell-currency text-danger" style={{ fontWeight: 700 }}>
                                        {f.totalDesc.toFixed(2)}
                                    </td>
                                </>}

                                {verColumnas === "totales" && <>
                                    <td className="cell-currency">{f.totalIngresos.toFixed(2)}</td>
                                    <td className="cell-currency text-danger">{f.totalDesc.toFixed(2)}</td>
                                    <td className="cell-currency text-primary" style={{ fontWeight: 800 }}>
                                        {f.netoPagar.toFixed(2)}
                                    </td>
                                    <td className="cell-currency" style={{ color: "var(--color-warning)" }}>
                                        {f.essalud.toFixed(2)}
                                    </td>
                                </>}
                            </tr>
                        ))}
                    </tbody>

                    {/* Totales */}
                    <tfoot>
                        <tr>
                            <td colSpan={4} style={{ textAlign: "right" }}>
                                SUBTOTALES ({filas.length} trabajadores)
                            </td>

                            {verColumnas === "dias" && <>
                                <td className="cell-num">{totales.diasTrab}</td>
                                <td className="cell-num">{totales.totalHoras}</td>
                                <td colSpan={6}></td>
                            </>}

                            {verColumnas === "ingresos" && <>
                                <td colSpan={2}></td>
                                <td></td>
                                <td className="cell-currency">{totales.totalIngresos.toFixed(2)}</td>
                                <td></td>
                                <td className="cell-currency" style={{ color: "var(--color-success)" }}>
                                    {totales.totalIngresos.toFixed(2)}
                                </td>
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
                                <td className="cell-currency text-primary" style={{ fontWeight: 800 }}>
                                    {totales.netoPagar.toFixed(2)}
                                </td>
                                <td className="cell-currency" style={{ color: "var(--color-warning)" }}>
                                    {totales.essalud.toFixed(2)}
                                </td>
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
                ].map(s => (
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
