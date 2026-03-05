/**
 * columnDetector.ts
 *
 * Detección dinámica de columnas del tareo Excel.
 * En lugar de asumir posiciones fijas (getCell(4), getCell(42), etc.),
 * lee la fila de cabeceras y construye un mapa nombre → índice de columna.
 *
 * Uso:
 *   const colMap = buildColumnMap(worksheet);
 *   const dni = asString(row.getCell(colMap.DNI).value);
 */

import type { Worksheet, Row } from "exceljs";

// ─── Alias aceptados por campo ────────────────────────────────────────────────
// Cada entrada lista los posibles nombres que puede tener esa columna en el
// Excel (en mayúsculas, sin tildes opcionales). El primer match gana.

export const COLUMN_ALIASES: Record<string, string[]> = {
    // Identificación
    DNI: ["DNI"],
    NOMBRE: ["APELLIDOS Y NOMBRES", "NOMBRE"],
    CARGO: ["CARGO"],

    // Asistencia
    DIAS_TRABAJADOS: ["TRAB", "DIAS TRABAJADOS", "DIAS TRAB"],
    TOTAL_HRS: ["TOTAL HRS", "TOTAL HORAS"],
    DES_LAB: ["DES LAB", "DESCANSO LAB", "DESCANSO LABORADO"],
    FERIADO_LAB: ["FER LA", "FERIADO LABORADO", "FERIADO LAB"],
    HE_25: ["H. E. 25%", "HRS EXTRAS 25%", "HORAS EXTRAS 25%"],
    HE_35: ["H. E. 35%", "HRS EXTRAS 35%", "HORAS EXTRAS 35%"],
    FALTAS: ["FALTAS"],
    SUSP_SIN_GOCE: ["SUSP SIN GOCE", "SUSP S/G HABER", "SUSPENSION SIN GOCE"],
    LIC_SIN_GOCE: ["LICENCIA SIN GOCE DE HABER", "LICENCIA SIN GOCE", "LIC SIN GOCE"],
    PERM_CON_GOCE: ["PERM C/G HABER", "PERMISO C/G HABER", "PERM CON GOCE"],
    CERT_MEDICO: ["CERT MEDICO", "CERTIFICADO MEDICO"],
    SUBSIDIO_ENF: ["SUBSIDIO ENFER", "SUBSIDIO ENFERMEDAD"],
    SUBSIDIO_MAT: ["SUBSIDIO MATER", "SUBSIDIO MATERNIDAD"],
    VAC_GOZ: ["VAC. GOZ", "VAC. GOZADAS", "VACACIONES GOZADAS"],
    VAC_COMP: ["VAC. COMP", "VAC. COMPRADAS", "VACACIONES COMPRADAS"],
    LIC_PATER: ["LIC PATER", "LICENCIA POR PATERNIDAD", "LIC PATERNIDAD"],

    // Ingresos computables (sección AFP)
    BASICO_AFECTO: ["BASICO"],           // puede aparecer varias veces; se toma la primera
    ASIG_FAM: ["ASIG. FAM", "ASIGNACION FAMILIAR"],
    SOBRE_TASA_NOC: ["SOBRE TASA NOCTURNA"],
    COMISIONES: ["COM. DE EMP.", "COMISIONES", "COMISION"],
    MOV_ASIST: ["MOV. SUPEDITADA ASIST", "MOV SUPEDITADA ASIST", "ADELANTO DE MOVILIDAD SUPERDITADO A ASISTENCIA"],
    MOV_CONDICION: ["MOV. CONDICION DE TRABAJO", "MOV CONDICION DE TRABAJO"],
    PROVIS: ["PROVIS"],
    VIATICOS: ["VIATICOS"],
    TURB: ["TURBINACIÓN", "TURBINACION"],
    GRATIF: ["GRATIF.", "GRATIFICACION", "GRATIFICACIÓN"],
    CTS: ["CTS"],
    UTILIDADES: ["UTILIDADES 2024", "UTILIDADES"],
    INCENTIVO_DIC: ["INCENTIVO DICIEMBRE"],
    INCENTIVO_NOV: ["INCENTIVO NOVIEMBRE"],
    INCENTIVO_OCT: ["INCENTIVO OCTUBRE"],
    SUELDO_DIFERIDO: ["SUELDO DIFERIDO"],
    BONO_PRODUCT: ["BONO DE PRODUCT", "BONO DE PRODUCTIVIDAD", "BONO PRODUCTIVIDAD"],
    BONO_ALIMENT: ["BONO DE ALIMENTACION", "BONO ALIMENTACION"],
    DESTAQUE: ["DESTAQUE"],
    PRESTAMO_ING: ["PRESTAMO", "DEVOLUCION DCTO EN EXCESO", "DEVOLUCION CORTE MES"],
    REG_AFECTAS: ["REGULARIZACIONES AFECTAS", "REGULARIZACION AFECTA"],
    REG_NO_AFECTAS: ["REGULARIZACIONES NO AFECTOS"],

    // Descuentos
    AFP: ["AFP"],
    PCT_AFP: ["%"],
    DSCTO_AFP: ["DSCTO AFP"],
    DSO: ["DSO"],
    ADELANTO_EPS: ["ADELANTO EPS"],
    DCTO_JUDICIAL: ["DESCUENTO JUDICIAL", "GRATIFICACIÓN DSTO JUDICIAL", "RET JUD"],
    RTA_5TA: ["RTA 5TA"],
    ESS_VIDA: ["ESS VIDA", "VIDA LEY"],
    ADELANTO_MOV: ["ADELANTO DE MOVILIDAD"],
    ADELANTO_PROVIS: ["ADELANTO DE PROVIS"],
    ADELANTO_COMISION: ["ADELANTO COMISION"],
    AUTORIZACION_DCTO: ["AUTORIZACION DE DESCUENTO"],
    CORTE_MES: ["CORTE DE MES"],
    ADELANTO_BONO_PROD: ["ADELANTO DE BONO DE PRODUCTIVIDAD"],
    PAGO_EXCESO: ["PAGO EN EXCESO"],
    DEP_UTILIDADES: ["DEPOSITO UTILIDADES"],
    DCTO_CONTRA_GRATIF: ["DESCUENTO CONTRA GRATIFICACIÓN", "DESCUENTO CONTRA GRATIFICACION"],

    // Banco
    BANCO: ["NOMBRE ENTIDAD", "BANCO"],
    NRO_CUENTA: ["NUMEROS DE CUENTA HABERES", "NUMERO DE CUENTA", "CUENTA BANCARIA"],

    // Otros campos informativos (para evitar advertencias)
    FECHA_INGRESO: ["FECHA DE INGRESO", "FECHA ING"],
    BASICO_FERIADO: ["BASICO FERIADO | DESCANSO LAB", "BASICO FERIADO"],
    TOTAL_GENERICO: ["TOTAL"],
    COMISION_80: ["COMISION AL 80 %", "COMISION 80%"],
    REG_INCENTIVO: ["REGULARIZA INCENTIVO"],
    BONIF_EXTRA: ["BONIF EXTRA GRATIF.", "BONIF EXTRA GRATIF"],
    PREMIO_CERT: ["PREMIO EXTRAORDINARIO DE CERTIFICACIÓN", "PREMIO EXTRAORDINARIO DE CERTIFICACION"],
    CANASTA: ["CANASTA DE NAVIDAD O SIMILARES", "CANASTA"],
    TOTAL_INGRESOS: ["TOTAL INGRESOS"],
    BASE_AFECTA: ["BASE AFECTA"],
    TOTAL_DSCTOS: ["TOTAL DSCTOS", "TOTAL DESCUENTOS"],
    TOTAL_PAGAR: ["TOTAL A PAGAR", "NETO A PAGAR"],
    ESS_9: ["ESS 9%"],
    EPS_2_25: ["EPS 2.25%"],
    EPS: ["EPS"],
    CENTRO_COSTO: ["CENTRO COSTO", "C.C."],
    SUCURSAL: ["SUCURSAL"],
    INI_VAC: ["FECHA DE INICIO VAC", "INICIO VAC"],
    FIN_VAC: ["FECHA DE TERMINO VAC", "FIN VAC", "TERMINO VAC"],
    SITUACION_ESP: ["SITUACION ESPECIAL DEL TRABAJADOR"],
    TIPO_CONTRATO: ["TIPO DE CONTRATO"],
    STAD: ["STAD"],
    CESE: ["CESE"],
    SCTR: ["SCTR"],
    NUMERO_ROW: ["N°", "NRO"],
    MES_TXT: ["MES"],
};

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type ColumnKey = keyof typeof COLUMN_ALIASES;
export type ColumnMap = Partial<Record<ColumnKey, number>>;

export interface ColumnDetectionResult {
    columnMap: ColumnMap;
    headerRowIndex: number;
    unmapped: string[];   // campos de COLUMN_ALIASES que NO se encontraron en el Excel
    unknown: string[];    // cabeceras del Excel que NO matchearon ningún alias
}

// ─── Normalización ────────────────────────────────────────────────────────────

function normalize(text: string): string {
    return text
        .toUpperCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")   // quitar tildes
        .replace(/\s+/g, " ")              // colapsar espacios / saltos de línea
        .trim();
}

// ─── Función principal ────────────────────────────────────────────────────────

/**
 * Recorre las primeras `maxRows` filas buscando la cabecera que contenga "DNI".
 * Devuelve un mapa campo → número de columna (1-based, compatible con ExcelJS).
 */
export function buildColumnMap(
    worksheet: Worksheet,
    maxRows = 25
): ColumnDetectionResult {
    // 1. Encontrar la fila de cabecera
    let headerRowIndex = -1;
    let headerRow: Row | null = null;

    for (let r = 1; r <= maxRows; r++) {
        const row = worksheet.getRow(r);
        let found = false;
        row.eachCell({ includeEmpty: false }, (cell) => {
            if (!found && normalize(String(cell.value ?? "")) === "DNI") {
                found = true;
            }
        });
        if (found) {
            headerRowIndex = r;
            headerRow = row;
            break;
        }
    }

    if (!headerRowIndex || !headerRow) {
        throw new Error(
            `No se encontró la fila de cabeceras (columna "DNI") en las primeras ${maxRows} filas.`
        );
    }

    // 2. Construir mapa inverso: texto_normalizado → ColumnKey
    const aliasLookup = new Map<string, ColumnKey>();
    for (const [key, aliases] of Object.entries(COLUMN_ALIASES) as [ColumnKey, string[]][]) {
        for (const alias of aliases) {
            aliasLookup.set(normalize(alias), key);
        }
    }

    // 3. Recorrer cabeceras y llenar columnMap
    const columnMap: ColumnMap = {};
    const unknown: string[] = [];
    const seenKeys = new Set<ColumnKey>();

    headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        let val = cell.value;
        // Soporte para celdas combinadas: si la celda actual está vacía pero es parte de un merge,
        // tomamos el valor de la celda maestra (top-left).
        if ((val == null || val === "") && cell.isMerged && cell.master) {
            val = cell.master.value;
        }

        const raw = String(val ?? "");
        const norm = normalize(raw);
        const key = aliasLookup.get(norm);

        if (key) {
            // Si hay duplicados (ej. "BASICO" aparece 2 veces), se guarda el primero
            if (!seenKeys.has(key)) {
                columnMap[key] = colNumber;
                seenKeys.add(key);
            }
        } else if (norm.length > 0 && norm !== "0") {
            unknown.push(raw);
        }
    });

    // 4. Detectar campos que no se mapearon
    const unmapped = (Object.keys(COLUMN_ALIASES) as ColumnKey[]).filter(
        (k) => !(k in columnMap)
    );

    return { columnMap, headerRowIndex, unmapped, unknown };
}

// ─── Helper: leer valor con fallback seguro ───────────────────────────────────

/**
 * Lee la celda de una fila dado el campo lógico.
 * Devuelve null si el campo no existe en el mapa.
 */
export function getColValue(
    row: Row,
    columnMap: ColumnMap,
    key: ColumnKey
): unknown {
    const colIndex = columnMap[key];
    if (colIndex == null) return null;
    return row.getCell(colIndex).value;
}