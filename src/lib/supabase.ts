// lib/supabase.ts
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL ?? "";
const supabaseKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY ?? "";

export const supabase =
    supabaseUrl && supabaseKey
        ? createClient(supabaseUrl, supabaseKey)
        : null;

// ─── Auth helper ──────────────────────────────────────────────────────────────

export interface TareoLoginResult {
    ok: boolean;
    error?: string;
    id?: string;
    nombre?: string;
    position?: string;
    sede?: string;
    rol?: "admin" | "analista" | "visor";
}

/**
 * Llama a la función RPC `verify_tareo_login` en Supabase.
 * Solo devuelve datos si:
 *   - El DNI y app_password coinciden
 *   - El empleado está activo (is_active = true, termination_date IS NULL)
 *   - El cargo es 'JEFE DE GENTE Y GESTIÓN' o 'ANALISTA DE GENTE Y GESTIÓN'
 */
export async function verifyTareoLogin(
    dni: string,
    password: string
): Promise<TareoLoginResult> {
    if (!supabase) {
        return {
            ok: false,
            error: "Supabase no configurado. Verifica las variables de entorno.",
        };
    }

    const { data, error } = await supabase.rpc("verify_tareo_login", {
        p_dni: dni.trim(),
        p_password: password,
    });

    if (error) {
        console.error("[tareo-auth] RPC error:", error.message);
        return { ok: false, error: "Error de conexión. Intenta de nuevo." };
    }

    return data as TareoLoginResult;
}

// ─── Tipos base de datos ──────────────────────────────────────────────────────

export type AFP = {
    id: number;
    nombre: string;
    codigo: string;
    tasa_flujo: number;
    tasa_mixta: number | null;
    anio: number;
};

export type Empleado = {
    id: string;
    dni: string;
    apellidos_nombres: string;
    cargo: string;
    fecha_ingreso: string;
    fecha_cese: string | null;
    sctr: boolean;
    eps: boolean;
    vida_ley: boolean;
    afp_codigo: string;
    cuenta_haberes: string;
    centro_costo: string;
    sucursal: string;
    estado: "ACTIVO" | "CESADO";
};

export type TareoMes = {
    id: string;
    anio: number;
    mes: number;
    estado: "borrador" | "validado" | "cerrado";
    dias_mes: number;
    horas_dia: number;
    created_at: string;
};

export type TareoDetalle = {
    id: string;
    tareo_mes_id: string;
    empleado_id: string;
    empleado?: Empleado;
    dias_trab: number;
    total_horas: number;
    des_lab: number;
    des_med: number;
    f_est: number;
    perm: number;
    vel: number;
    falt: number;
    vac: number;
    lic_sin_h: number;
    susp: number;
    aus_sin_just: number;
    ret_jud: number;
    sueldo_basico: number;
    asig_familiar: number;
    horas_extra: number;
    bonif_especial: number;
    comisiones: number;
    total_afecto: number;
    movilidad: number;
    total_no_afecto: number;
    total_ingresos: number;
    base_afecta: number;
    desc_afp_onp: number;
    desc_vida_ley: number;
    desc_eps: number;
    desc_adelanto: number;
    desc_prestamo: number;
    total_descuentos: number;
    total_pagar: number;
    essalud_9: number;
    eps_225: number;
    fecha_ini_vac: string | null;
    fecha_fin_vac: string | null;
    tipo_contrato: string;
    situacion_especial: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

export const MESES = [
    "", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

export function mesLabel(mes: number, anio: number) {
    return `${MESES[mes]} ${anio}`;
}
