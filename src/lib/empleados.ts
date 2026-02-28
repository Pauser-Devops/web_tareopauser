/**
 * lib/empleados.ts
 * Capa de datos para empleados: consultas Supabase, Realtime y config tareo.
 * Lee de `employees` (tablaexistente, sin modificarla) y de
 * `tareo_employee_config` (tabla nueva, solo para este sistema).
 */

import { supabase } from "./supabase";
import type { RealtimeChannel } from "@supabase/supabase-js";

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface EmpleadoBase {
    id: string;
    dni: string;
    full_name: string;
    position: string;
    sede: string;
    business_unit: string | null;
    entry_date: string;
    is_active: boolean;
    termination_date: string | null;
    created_at: string;
    updated_at: string;
    employee_type: string;
}

export interface TareoEmployeeConfig {
    id?: string;
    employee_id: string;
    afp_codigo: string;       // PRIMA, PROFUT, INTEGR, HABITAT, ONP
    sueldo_base: number;
    vida_ley: boolean;
    eps: boolean;
    sctr: boolean;
    cuenta_haberes?: string;
    observaciones?: string;
    updated_at?: string;
}

export interface EmpleadoConConfig extends EmpleadoBase {
    config: TareoEmployeeConfig | null;  // null = sin configurar para tareo
}

export interface Indicadores {
    sinConfig: number;   // activos sin tareo_employee_config
    nuevos: number;      // creados después de fechaRef (apertura del tareo)
    bajas: number;       // termination_date >= fechaRef
    cambios: number;     // updated_at >= fechaRef Y cambio detectado
}

// ─── Queries principales ──────────────────────────────────────────────────────

/**
 * Trae todos los empleados activos con su config tareo (si existe).
 * LEFT JOIN implícito: si no tiene config, config = null (sin configurar).
 */
export async function fetchEmpleadosConConfig(): Promise<EmpleadoConConfig[]> {
    if (!supabase) return [];

    // 1. Traer todos los empleados activos (sin modificar ningún trigger)
    const { data: emps, error: errEmps } = await supabase
        .from("employees")
        .select(
            "id, dni, full_name, position, sede, business_unit, entry_date, " +
            "is_active, termination_date, created_at, updated_at, employee_type"
        )
        .eq("is_active", true)
        .is("termination_date", null)
        .order("full_name");

    if (errEmps || !emps) {
        console.error("[empleados] fetchEmpleadosConConfig:", errEmps?.message);
        return [];
    }

    const empsTyped = emps as unknown as EmpleadoBase[];

    // 2. Traer configs tareo de esos empleados
    const ids = empsTyped.map((e) => e.id);
    const { data: configs } = await supabase
        .from("tareo_employee_config")
        .select("*")
        .in("employee_id", ids);

    const configMap = new Map<string, TareoEmployeeConfig>(
        ((configs ?? []) as unknown as TareoEmployeeConfig[]).map((c) => [c.employee_id, c])
    );

    return empsTyped.map((e) => ({
        ...e,
        config: configMap.get(e.id) ?? null,
    }));
}

/**
 * Calcula indicadores para el tareo abierto.
 * fechaApertura: ISO string de cuando se abrió el tareo (inicio del mes).
 */
export async function getIndicadores(fechaApertura: string): Promise<Indicadores> {
    if (!supabase) return { sinConfig: 0, nuevos: 0, bajas: 0, cambios: 0 };

    // Sin config: empleados activos sin entrada en tareo_employee_config
    const r1 = await supabase
        .from("employees")
        .select("id", { count: "exact", head: true })
        .eq("is_active", true)
        .is("termination_date", null);

    const r2 = await supabase
        .from("tareo_employee_config")
        .select("id", { count: "exact", head: true });

    const r3 = await supabase
        .from("employees")
        .select("id", { count: "exact", head: true })
        .gte("created_at", fechaApertura)
        .eq("is_active", true);

    const r4 = await supabase
        .from("employees")
        .select("id", { count: "exact", head: true })
        .gte("termination_date", fechaApertura);

    const r5 = await supabase
        .from("employees")
        .select("id", { count: "exact", head: true })
        .gte("updated_at", fechaApertura)
        .eq("is_active", true)
        .is("termination_date", null);

    const totalActivos = r1.count ?? 0;
    const conConfig = r2.count ?? 0;
    const nuevos = r3.count ?? 0;
    const bajas = r4.count ?? 0;
    const actualizados = r5.count ?? 0;

    return {
        sinConfig: Math.max(0, totalActivos - conConfig),
        nuevos,
        bajas,
        cambios: Math.max(0, actualizados - nuevos),
    };

}

/**
 * Retorna solo el conteo de empleados activos sin config tareo.
 * Usado por el badge del sidebar (query liviana).
 */
export async function countSinConfig(): Promise<number> {
    if (!supabase) return 0;
    try {
        const [{ count: total }, { count: conConfig }] = await Promise.all([
            supabase
                .from("employees")
                .select("id", { count: "exact", head: true })
                .eq("is_active", true)
                .is("termination_date", null),
            supabase
                .from("tareo_employee_config")
                .select("id", { count: "exact", head: true }),
        ]);
        return Math.max(0, (total ?? 0) - (conConfig ?? 0));
    } catch {
        return 0;
    }
}

// ─── Guardar config tareo ─────────────────────────────────────────────────────

export async function saveConfigTareo(
    config: TareoEmployeeConfig
): Promise<{ ok: boolean; error?: string }> {
    if (!supabase) return { ok: false, error: "Supabase no configurado." };

    const { error } = await supabase
        .from("tareo_employee_config")
        .upsert(
            { ...config, updated_at: new Date().toISOString() },
            { onConflict: "employee_id" }
        );

    if (error) {
        console.error("[empleados] saveConfigTareo:", error.message);
        return { ok: false, error: error.message };
    }
    return { ok: true };
}

// ─── Realtime subscription ────────────────────────────────────────────────────

export interface RealtimeCallbacks {
    onNuevoEmpleado?: (emp: EmpleadoBase) => void;
    onBaja?: (emp: EmpleadoBase) => void;
    onCambio?: (emp: EmpleadoBase) => void;
}

let _channel: RealtimeChannel | null = null;

export function subscribeEmpleados(callbacks: RealtimeCallbacks): () => void {
    if (!supabase) return () => { };

    // Limpiar suscripción anterior si existe
    if (_channel) {
        supabase.removeChannel(_channel);
        _channel = null;
    }

    _channel = supabase
        .channel("empleados-realtime")
        .on(
            "postgres_changes",
            { event: "INSERT", schema: "public", table: "employees" },
            (payload) => {
                const emp = payload.new as EmpleadoBase;
                callbacks.onNuevoEmpleado?.(emp);
            }
        )
        .on(
            "postgres_changes",
            { event: "UPDATE", schema: "public", table: "employees" },
            (payload) => {
                const emp = payload.new as EmpleadoBase;
                const old = payload.old as Partial<EmpleadoBase>;
                // Determinar si es baja o cambio
                if (emp.termination_date && !old.termination_date) {
                    callbacks.onBaja?.(emp);
                } else {
                    callbacks.onCambio?.(emp);
                }
            }
        )
        .subscribe();

    // Retorna función de cleanup
    return () => {
        if (_channel && supabase) {
            supabase.removeChannel(_channel);
            _channel = null;
        }
    };
}
