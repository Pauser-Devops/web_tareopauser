/**
 * lib/exportUtils.ts
 * Funciones reutilizables de exportación a PDF y Excel para planillas de tareo.
 */

import type { TareoEmployeeConfig } from "./empleados";
import {
    calcDiasTrab,
    calcSueldoProporcional,
    calcAfpOnpSimple,
    calcEssalud,
    calcVidaLey,
    calcTotalIngresos,
    calcTotalDescuentos,
    calcNetoPagar,
    round2,
} from "./formulas";

// ─── Tipo de fila de planilla ─────────────────────────────────────────────────

export interface FilaPlanilla {
    nro: number;
    dni: string;
    nombre: string;
    cargo: string;
    afp: string;
    diasTrab: number;
    sueldoBase: number;
    sueldoProp: number;
    comision: number;
    bonoProductiv: number;
    bonoAlimento: number;
    movilidad: number;
    totalIngresos: number;
    afpOnp: number;
    vidaLey: number;
    retJud: number;
    totalDesc: number;
    netoPagar: number;
    essalud: number;
}

// ─── Helper: construir filas de planilla ──────────────────────────────────────

export interface FilaRaw {
    nombre: string;
    dni: string;
    cargo?: string;
    afpCodigo?: string;
    sueldoBase: number;
    tieneVidaLey: boolean;
    diasHabiles: number;
    vac: number;
    licSinH: number;
    susp: number;
    ausSinJust: number;
    movilidad: number;
    comision: number;
    bonoProductiv: number;
    bonoAlimento: number;
    retJud: number;
}

export function construirFilas(rawFilas: FilaRaw[]): FilaPlanilla[] {
    return rawFilas.map((r, idx) => {
        const diasTrab = calcDiasTrab(r.diasHabiles, r.vac, r.licSinH, r.susp, r.ausSinJust);
        const sueldoProp = calcSueldoProporcional(r.sueldoBase, diasTrab, 30);
        const totalAfecto = round2(sueldoProp + (r.comision || 0) + (r.bonoProductiv || 0));
        const totalNoAfecto = round2((r.movilidad || 0) + (r.bonoAlimento || 0));
        const totalIngresos = calcTotalIngresos(totalAfecto, totalNoAfecto);
        const afpOnp = calcAfpOnpSimple(totalAfecto, r.afpCodigo ?? "ONP");
        const vidaLey = calcVidaLey(totalAfecto, r.tieneVidaLey);
        const totalDesc = calcTotalDescuentos({ afp_onp: afpOnp, vida_ley: vidaLey, ret_jud: r.retJud });
        const netoPagar = calcNetoPagar(totalIngresos, totalDesc);
        const essalud = calcEssalud(totalAfecto);

        return {
            nro: idx + 1,
            dni: r.dni,
            nombre: r.nombre,
            cargo: r.cargo ?? "",
            afp: r.afpCodigo ?? "ONP",
            diasTrab,
            sueldoBase: r.sueldoBase,
            sueldoProp,
            comision: r.comision,
            bonoProductiv: r.bonoProductiv,
            bonoAlimento: r.bonoAlimento,
            movilidad: r.movilidad,
            totalIngresos,
            afpOnp,
            vidaLey,
            retJud: r.retJud,
            totalDesc,
            netoPagar,
            essalud,
        };
    });
}

// ─── Headers de tabla ─────────────────────────────────────────────────────────

const HEADERS = [
    "N°", "DNI", "Apellidos y Nombres", "Cargo", "AFP",
    "Días Trab.", "Sueldo Base", "S/ Prop.", "Comisión", "Bono Prod.", "Bono Alim.",
    "Movilidad", "Total Ingresos", "AFP/ONP", "Vida Ley", "Ret. Jud.",
    "Total Desc.", "Neto a Pagar", "EsSalud",
];

function filaAArray(f: FilaPlanilla): (string | number)[] {
    const s = (n: number) => n.toFixed(2);
    return [
        f.nro, f.dni, f.nombre, f.cargo, f.afp,
        f.diasTrab, s(f.sueldoBase), s(f.sueldoProp), s(f.comision), s(f.bonoProductiv), s(f.bonoAlimento),
        s(f.movilidad), s(f.totalIngresos), s(f.afpOnp), s(f.vidaLey), s(f.retJud),
        s(f.totalDesc), s(f.netoPagar), s(f.essalud),
    ];
}

// ─── Exportar PDF ─────────────────────────────────────────────────────────────

export async function exportarPDF(
    filas: FilaPlanilla[],
    mesLabel: string,
    titulo: string
): Promise<void> {
    // Importación dinámica para evitar SSR issues
    const { default: jsPDF } = await import("jspdf");
    const { default: autoTable } = await import("jspdf-autotable");

    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a3" });

    doc.setFontSize(14);
    doc.text(titulo, 14, 14);
    doc.setFontSize(10);
    doc.text(`Período: ${mesLabel}`, 14, 21);

    autoTable(doc, {
        head: [HEADERS],
        body: filas.map(filaAArray),
        startY: 26,
        styles: { fontSize: 7, cellPadding: 1.5 },
        headStyles: { fillColor: [30, 61, 89], textColor: 255, fontStyle: "bold", fontSize: 7 },
        columnStyles: {
            0: { halign: "center", cellWidth: 8 },
            1: { cellWidth: 20 },
            2: { cellWidth: 40 },
            4: { halign: "center", cellWidth: 12 },
            5: { halign: "center", cellWidth: 14 },
        },
        alternateRowStyles: { fillColor: [245, 247, 250] },
        foot: [[
            "", "", `TOTALES (${filas.length})`, "", "",
            filas.reduce((s, f) => s + f.diasTrab, 0).toString(),
            "",
            filas.reduce((s, f) => s + f.sueldoProp, 0).toFixed(2),
            filas.reduce((s, f) => s + f.comision, 0).toFixed(2),
            filas.reduce((s, f) => s + f.bonoProductiv, 0).toFixed(2),
            filas.reduce((s, f) => s + f.bonoAlimento, 0).toFixed(2),
            filas.reduce((s, f) => s + f.movilidad, 0).toFixed(2),
            filas.reduce((s, f) => s + f.totalIngresos, 0).toFixed(2),
            filas.reduce((s, f) => s + f.afpOnp, 0).toFixed(2),
            filas.reduce((s, f) => s + f.vidaLey, 0).toFixed(2),
            filas.reduce((s, f) => s + f.retJud, 0).toFixed(2),
            filas.reduce((s, f) => s + f.totalDesc, 0).toFixed(2),
            filas.reduce((s, f) => s + f.netoPagar, 0).toFixed(2),
            filas.reduce((s, f) => s + f.essalud, 0).toFixed(2),
        ]],
        footStyles: { fillColor: [220, 230, 240], fontStyle: "bold", fontSize: 7 },
    });

    // Pie de página
    const pageCount = (doc as any).internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(7);
        doc.setTextColor(150);
        doc.text(
            `PAUSER DISTRIBUCIONES S.A.C. — ${titulo} — ${mesLabel}  (Pág. ${i}/${pageCount})`,
            14,
            doc.internal.pageSize.getHeight() - 5
        );
    }

    const filename = `${titulo.replace(/\s+/g, "_")}_${mesLabel.replace(/\s+/g, "_")}.pdf`;
    doc.save(filename);
}

// ─── Exportar Excel ───────────────────────────────────────────────────────────

export async function exportarExcel(
    filas: FilaPlanilla[],
    mesLabel: string,
    titulo: string
): Promise<void> {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    wb.creator = "PAUSER DISTRIBUCIONES S.A.C.";

    const ws = wb.addWorksheet("Planilla", { pageSetup: { orientation: "landscape" } });

    // Título
    ws.mergeCells("A1:S1");
    const titleCell = ws.getCell("A1");
    titleCell.value = `${titulo} — ${mesLabel}`;
    titleCell.font = { bold: true, size: 13 };
    titleCell.alignment = { horizontal: "center" };

    // Empresa
    ws.mergeCells("A2:S2");
    const empCell = ws.getCell("A2");
    empCell.value = "PAUSER DISTRIBUCIONES S.A.C.";
    empCell.font = { size: 10, color: { argb: "FF666666" } };
    empCell.alignment = { horizontal: "center" };

    ws.addRow([]); // blank row

    // Headers
    const headerRow = ws.addRow(HEADERS);
    headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
    headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3D59" } };
    headerRow.alignment = { horizontal: "center", vertical: "middle" };
    headerRow.height = 22;

    // Datos
    filas.forEach((f, i) => {
        const row = ws.addRow(filaAArray(f));
        if (i % 2 === 1) {
            row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5F7FA" } };
        }
        // Resaltar Neto a Pagar (col 18)
        const netoCell = row.getCell(18);
        netoCell.font = { bold: true, color: { argb: "FF1E3D59" } };
    });

    // Fila de totales
    const totalRow = ws.addRow([
        "", "", `TOTALES (${filas.length})`, "", "",
        filas.reduce((s, f) => s + f.diasTrab, 0),
        "",
        filas.reduce((s, f) => s + f.sueldoProp, 0).toFixed(2),
        filas.reduce((s, f) => s + f.comision, 0).toFixed(2),
        filas.reduce((s, f) => s + f.bonoProductiv, 0).toFixed(2),
        filas.reduce((s, f) => s + f.bonoAlimento, 0).toFixed(2),
        filas.reduce((s, f) => s + f.movilidad, 0).toFixed(2),
        filas.reduce((s, f) => s + f.totalIngresos, 0).toFixed(2),
        filas.reduce((s, f) => s + f.afpOnp, 0).toFixed(2),
        filas.reduce((s, f) => s + f.vidaLey, 0).toFixed(2),
        filas.reduce((s, f) => s + f.retJud, 0).toFixed(2),
        filas.reduce((s, f) => s + f.totalDesc, 0).toFixed(2),
        filas.reduce((s, f) => s + f.netoPagar, 0).toFixed(2),
        filas.reduce((s, f) => s + f.essalud, 0).toFixed(2),
    ]);
    totalRow.font = { bold: true };
    totalRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDCE6F0" } };

    // Anchos de columna
    ws.columns = [
        { width: 6 }, { width: 12 }, { width: 32 }, { width: 22 }, { width: 6 },
        { width: 9 }, { width: 11 }, { width: 11 }, { width: 11 }, { width: 11 }, { width: 11 },
        { width: 11 }, { width: 13 }, { width: 11 }, { width: 9 }, { width: 10 },
        { width: 11 }, { width: 13 }, { width: 11 },
    ];

    // Descargar
    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${titulo.replace(/\s+/g, "_")}_${mesLabel.replace(/\s+/g, "_")}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
}
