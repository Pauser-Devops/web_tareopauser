// lib/formulas.ts
// Fórmulas extraídas directamente del Excel real:
// "1. OK TAREO 2601 - PAUSER DISTRIBUCIONES SAC (3).xlsx" — hoja 2411
// Columnas de referencia (hoja 2411):
//   M  = TRAB (días trabajados)
//   N  = TOTAL HRS
//   O  = DES LAB (descanso laborado)
//   P  = FER LA (feriado laborado)
//   Q  = H.E. 25%   R = H.E. 35%
//   S  = SUSP SIN GOCE   T = LICENCIA SIN GOCE
//   U  = PERM C/G HABER  V = CERT MEDICO
//   W  = FALTAS          X = SUBSIDIO
//   Y  = VAC.            Z = LIC PATER
//   AA = BÁSICO (sueldo base)
//   AB = BÁSICO FERIADO / DESCANSO LAB
//   AC = ASIG. FAM
//   AD = SOBRE TASA NOCTURNA
//   AE = COMISIONES
//   AF = MOV. SUPEDITADA ASIST
//   AG = MOV. CONDICION DE TRABAJO
//   AH = PROVIS
//   AI = VIATICOS
//   BZ = BASE AFECTA
//   CB = TASA AFP (decimal)
//   CC = DSCTO AFP
//   DB = TOTAL DSCTOS
//   DC = TOTAL A PAGAR (neto)
//   DD = ESS 9%
//   DE = EPS 2.25%

// ─── Tasas ────────────────────────────────────────────────────────────────────

export const TASAS_AFP: Record<string, number> = {
    // Flujo (tasas reales extraídas de hoja AFP del Excel)
    PRIMA: 0.1297,
    PROFUT: 0.1306,
    INTEGR: 0.1292,
    HABITAT: 0.1284,
    // Mixtas
    "X-PRIM": 0.1137,
    "X-PROF": 0.1137,
    "X-INTE": 0.1137,
    "X-HAB": 0.1137,
    // SNP
    ONP: 0.1300,
};

export const TASA_ESSALUD = 0.09;    // 9%  — cargo empleador (DD)
export const TASA_EPS = 0.0225;  // 2.25% — cargo empleador (DE)
export const TASA_VIDA_LEY = 0.0053;  // 0.53% — cargo trabajador (CN ESS VIDA)

// ─── Días / horas ─────────────────────────────────────────────────────────────

/**
 * TRAB — días efectivamente remunerados
 * Fórmula M12: =$N$4-(U12+V12+X12+Y12+Z12)
 *   diasMes = días hábiles configurados (normalmente 30 ó 25)
 *   Se restan: permisoCG, certMed, subsidio, vacaciones, licPaternidad
 *
 * @param diasMes     Días hábiles del mes (fijo, ej. 30)
 * @param permCG      Permiso con goce de haber (U)
 * @param certMedico  Certificado médico (V)
 * @param subsidio    Subsidio (X — no remunerado por empresa, lo paga EsSalud)
 * @param vac         Vacaciones gozadas (Y)
 * @param licPater    Licencia por paternidad (Z)
 */
export function calcDiasTrab(
    diasMes: number,
    permCG: number = 0,
    certMedico: number = 0,
    subsidio: number = 0,
    vac: number = 0,
    licPater: number = 0,
): number {
    return Math.max(0, diasMes - permCG - certMedico - subsidio - vac - licPater);
}

/**
 * TOTAL HRS
 * Fórmula N12: =(25+O12+P12-S12-U12-V12-W12-X12-Y12-Z12)*8
 *   Base 25 días (ajustar según mes) + descansos laborados - suspensiones - permisos - faltas...
 *
 * @param diasBase    Días base del mes (25 en el Excel, puede variar)
 * @param desLab      Descanso laborado (O)
 * @param ferLab      Feriado laborado (P)
 * @param susp        Suspensión sin goce (S)
 * @param permCG      Permiso con goce (U)
 * @param certMedico  Certificado médico (V)
 * @param faltas      Faltas (W)
 * @param subsidio    Subsidio (X)
 * @param vac         Vacaciones (Y)
 * @param licPater    Licencia paternidad (Z)
 */
export function calcTotalHoras(
    diasBase: number,
    desLab: number = 0,
    ferLab: number = 0,
    susp: number = 0,
    permCG: number = 0,
    certMedico: number = 0,
    faltas: number = 0,
    subsidio: number = 0,
    vac: number = 0,
    licPater: number = 0,
): number {
    const dias = diasBase + desLab + ferLab - susp - permCG - certMedico - faltas - subsidio - vac - licPater;
    return Math.max(0, dias) * 8;
}

// ─── Ingresos afectos ─────────────────────────────────────────────────────────

/**
 * BÁSICO proporcional (AK)
 * Fórmula AK12: =+(AA12/30*(M12))
 *   sueldoBase / 30 * diasTrab
 */
export function calcBasicoProporcional(
    sueldoBase: number,
    diasTrab: number,
    diasMes: number = 30,
): number {
    if (diasMes <= 0) return 0;
    return round2((sueldoBase / diasMes) * diasTrab);
}

/** Alias para compatibilidad */
export const calcSueldoProporcional = calcBasicoProporcional;

/**
 * ASIG. FAMILIAR — solo si tiene asignación (AL)
 * Fórmula AL12: =IF(M12=0,0,AC12)
 *   Cobra su asignación completa si trabajó al menos 1 día
 */
export function calcAsigFamiliar(
    asigBase: number,
    diasTrab: number,
): number {
    return diasTrab > 0 ? asigBase : 0;
}

/**
 * DESCANSO LABORADO (BA) — pago doble del día de descanso trabajado
 * Fórmula BA12: =((AB12+AC12+AD12)/30)*200%*O12
 *   (sueldo básico feriado + asig.fam + nocturna) / 30 * 2 * diasDescansoLaborado
 */
export function calcDescansoLaborado(
    sueldoFeriadoBase: number,  // AB — básico feriado/descanso
    asigFam: number,  // AC
    sobreTasaNoc: number,  // AD
    diasDesLab: number,  // O
    diasMes: number = 30,
): number {
    return round2(((sueldoFeriadoBase + asigFam + sobreTasaNoc) / diasMes) * 2 * diasDesLab);
}

/**
 * FERIADO LABORADO (BB)
 * Fórmula BB12: =((AB12+AC12+AD12)/30)*200%*P12
 */
export function calcFeriadoLaborado(
    sueldoFeriadoBase: number,  // AB
    asigFam: number,  // AC
    sobreTasaNoc: number,  // AD
    diasFerLab: number,  // P
    diasMes: number = 30,
): number {
    return round2(((sueldoFeriadoBase + asigFam + sobreTasaNoc) / diasMes) * 2 * diasFerLab);
}

/**
 * HORAS EXTRAS 25% (AY)
 * Fórmula AY12: =IF(Q12=0,0,((AA12+AC12)/30/8)*(Q12*1.25))
 */
export function calcHorasExtras25(
    sueldoBase: number,   // AA
    asigFam: number,   // AC
    horas25: number,   // Q
    diasMes: number = 30,
): number {
    if (horas25 === 0) return 0;
    const valorHora = (sueldoBase + asigFam) / diasMes / 8;
    return round2(valorHora * horas25 * 1.25);
}

/**
 * HORAS EXTRAS 35% (AZ)
 * Fórmula AZ12: =IF(R12=0,0,((AB12+AC12)/30/8)*(R12*1.35))
 */
export function calcHorasExtras35(
    sueldoFerBase: number,  // AB
    asigFam: number,  // AC
    horas35: number,  // R
    diasMes: number = 30,
): number {
    if (horas35 === 0) return 0;
    const valorHora = (sueldoFerBase + asigFam) / diasMes / 8;
    return round2(valorHora * horas35 * 1.35);
}

/**
 * PERMISO C/G HABER (AQ)
 * Fórmula AQ12: =+(AA12+AD12)/30*(U12)
 */
export function calcPermisoCGHaber(
    sueldoBase: number,  // AA
    sobreTasaNoc: number,  // AD
    diasPermCG: number,  // U
    diasMes: number = 30,
): number {
    return round2((sueldoBase + sobreTasaNoc) / diasMes * diasPermCG);
}

/**
 * CERTIFICADO MÉDICO (AR)
 * Fórmula AR12: =+(AA12)/30*(V12)
 */
export function calcCertMedico(
    sueldoBase: number,  // AA
    diasCertMed: number,  // V
    diasMes: number = 30,
): number {
    return round2(sueldoBase / diasMes * diasCertMed);
}

/**
 * LICENCIA POR PATERNIDAD (AS)
 * Fórmula AS12: =+AA12/30*Z12
 */
export function calcLicenciaPaternidad(
    sueldoBase: number,  // AA
    diasLicPat: number,  // Z
    diasMes: number = 30,
): number {
    return round2(sueldoBase / diasMes * diasLicPat);
}

// ─── Base Afecta y Descuentos ─────────────────────────────────────────────────

/**
 * BASE AFECTA (BZ) — base sobre la que se calculan AFP, RTA 5TA, EsSalud
 * Fórmula BZ12: =+AK+AL+AM+AN+AO+AP+AQ+AR+AS+AT+AU+AV+AW+AX+AY+AZ+BA+BB+BC+BD+BE
 *   (todos los conceptos remunerativos afectos a descuentos)
 */
export function calcBaseAfecta(ingresoAfecto: number): number {
    return round2(ingresoAfecto);
}

/**
 * DESCUENTO AFP / ONP (CC)
 * Fórmula CC12: =(BZ12-CD12-CE12-CF12-CG12)*CB12
 *   CB = tasa AFP
 *   Se descuenta antes de aplicar: faltas (CD), DSO (CE), susp (CF), lic s/g (CG)
 */
export function calcAfpOnp(
    baseAfecta: number,   // BZ
    tasaAfp: number,   // CB (ya en decimal: 0.1297 etc.)
    descFaltas: number = 0,  // CD
    descDso: number = 0,  // CE
    descSusp: number = 0,  // CF
    descLicSinGoce: number = 0,  // CG
): number {
    const base = baseAfecta - descFaltas - descDso - descSusp - descLicSinGoce;
    return round2(Math.max(0, base) * tasaAfp);
}

/** Atajo simple cuando no hay descuentos previos (uso común) */
export function calcAfpOnpSimple(baseAfecta: number, codigoAfp: string): number {
    const tasa = TASAS_AFP[codigoAfp] ?? TASAS_AFP.ONP;
    return round2(baseAfecta * tasa);
}

/**
 * DESCUENTO POR FALTAS (CD)
 * Fórmula CD12: =(AA12+AD12)/30*W12
 */
export function calcDescFaltas(
    sueldoBase: number,  // AA
    sobreTasaNoc: number,  // AD
    faltas: number,  // W
    diasMes: number = 30,
): number {
    return round2((sueldoBase + sobreTasaNoc) / diasMes * faltas);
}

/**
 * DSO = Descuento sin objeto (CE) — proporcional a faltas + suspensión
 * Fórmula CE12: =+(CD12+CF12)/30
 */
export function calcDso(
    descFaltas: number,   // CD
    descSusp: number,   // CF
    diasMes: number = 30,
): number {
    return round2((descFaltas + descSusp) / diasMes);
}

/**
 * SUSPENSIÓN SIN GOCE (CF)
 * Fórmula CF12: =(AA12+AD12)/30*S12
 */
export function calcDescSusp(
    sueldoBase: number,  // AA
    sobreTasaNoc: number,  // AD
    diasSusp: number,  // S
    diasMes: number = 30,
): number {
    return round2((sueldoBase + sobreTasaNoc) / diasMes * diasSusp);
}

/**
 * LICENCIA SIN GOCE (CG)
 * Fórmula CG12: =(AA12+AD12)/30*T12
 */
export function calcDescLicSinGoce(
    sueldoBase: number,  // AA
    sobreTasaNoc: number,  // AD
    diasLicSinG: number,  // T
    diasMes: number = 30,
): number {
    return round2((sueldoBase + sobreTasaNoc) / diasMes * diasLicSinG);
}

/**
 * VIDA LEY / ESS VIDA (CN)
 * El Excel lo tiene como CN = 0 en la muestra (se llama ESS VIDA).
 * Valor estándar 0.53% sobre base afecta cuando aplica.
 */
export function calcVidaLey(baseAfecta: number, tieneVidaLey: boolean): number {
    if (!tieneVidaLey) return 0;
    return round2(baseAfecta * TASA_VIDA_LEY);
}

/**
 * ESSALUD 9% (DD) — cargo empleador
 * Fórmula DD12: =(+AK+AL+AM+AN+AO+AQ+AR+AS+AT+AU+AV+AY+AZ+BA+BB+BC+BD+BE)*9%
 *   Sobre la base remunerativa afecta (excluyendo no-remunerativos)
 */
export function calcEssalud(baseAfecta: number): number {
    return round2(baseAfecta * TASA_ESSALUD);
}

/**
 * EPS 2.25% (DE) — cargo empleador
 * Fórmula DE12: =IF(J12="NO",0,AB12*2.25%)
 *   Solo si el trabajador tiene EPS, se aplica sobre sueldo básico feriado (AB)
 */
export function calcEpsEmpleador(
    sueldoFerBase: number,  // AB — básico feriado/descanso
    tieneEps: boolean,
): number {
    if (!tieneEps) return 0;
    return round2(sueldoFerBase * TASA_EPS);
}

// ─── Totales ──────────────────────────────────────────────────────────────────

/**
 * TOTAL INGRESOS (BY)
 * Fórmula BY12: =SUM(AK12:BX12)  — suma de todos los conceptos
 */
export function calcTotalIngresos(afecto: number, noAfecto: number): number {
    return round2(afecto + noAfecto);
}

/**
 * TOTAL DESCUENTOS (DB)
 * Fórmula DB12: =SUM(CC12:DA12)
 */
export function calcTotalDescuentos(descuentos: {
    afp_onp: number;
    vida_ley?: number;
    eps_trabajador?: number;
    faltas?: number;
    dso?: number;
    susp?: number;
    lic_sin_goce?: number;
    adelanto?: number;
    prestamo?: number;
    ret_jud?: number;
    otros?: number;
}): number {
    return round2(
        (descuentos.afp_onp || 0) +
        (descuentos.vida_ley || 0) +
        (descuentos.eps_trabajador || 0) +
        (descuentos.faltas || 0) +
        (descuentos.dso || 0) +
        (descuentos.susp || 0) +
        (descuentos.lic_sin_goce || 0) +
        (descuentos.adelanto || 0) +
        (descuentos.prestamo || 0) +
        (descuentos.ret_jud || 0) +
        (descuentos.otros || 0)
    );
}

/**
 * NETO A PAGAR (DC)
 * Fórmula DC12: =+BY12-DB12
 */
export function calcNetoPagar(totalIngresos: number, totalDescuentos: number): number {
    return round2(totalIngresos - totalDescuentos);
}

// ─── Utilities ────────────────────────────────────────────────────────────────

/** Redondear a 2 decimales (igual que Excel ROUND(x,2)) */
export function round2(n: number): number {
    return Math.round(n * 100) / 100;
}

/** Formato moneda PEN */
export function formatPEN(n: number): string {
    return new Intl.NumberFormat("es-PE", {
        style: "currency",
        currency: "PEN",
        minimumFractionDigits: 2,
    }).format(n);
}

/** Formato número 2 decimales */
export function formatNum(n: number): string {
    return new Intl.NumberFormat("es-PE", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(n);
}
