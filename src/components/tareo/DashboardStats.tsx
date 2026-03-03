import React, { useEffect, useState } from "react";
import { fetchTareoMaestroLive, type TareoFilaLive } from "../../lib/tareoMaestro";
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

export default function DashboardStats({ anio: pAnio, mes: pMes }: { anio: number; mes: number }) {
    const isClient = typeof window !== "undefined";

    const [anio, setAnio] = useState(() => {
        if (isClient) {
            const raw = window.sessionStorage.getItem("pt_periodo");
            if (raw) {
                try { return JSON.parse(raw).anio; } catch (e) { }
            }
        }
        return pAnio;
    });

    const [mes, setMes] = useState(() => {
        if (isClient) {
            const raw = window.sessionStorage.getItem("pt_periodo");
            if (raw) {
                try { return JSON.parse(raw).mes; } catch (e) { }
            }
        }
        return pMes;
    });

    // Escuchar cambios de sessionStorage
    useEffect(() => {
        if (!isClient) return;
        const onStorageChange = () => {
            const raw = window.sessionStorage.getItem("pt_periodo");
            if (raw) {
                try {
                    const pe = JSON.parse(raw);
                    if (pe.anio !== anio) setAnio(pe.anio);
                    if (pe.mes !== mes) setMes(pe.mes);
                } catch (e) { }
            }
        };
        const interval = setInterval(onStorageChange, 500);
        return () => clearInterval(interval);
    }, [anio, mes, isClient]);

    const [loaded, setLoaded] = useState(false);
    const [stats, setStats] = useState({
        totalEmpleados: 0,
        totalBruto: 0,
        totalDescuentos: 0,
        totalNeto: 0,
        essalud: 0,
    });

    useEffect(() => {
        async function loadData() {
            setLoaded(false);
            const dataLive = await fetchTareoMaestroLive(anio, mes);

            let totalB = 0;
            let totalD = 0;
            let totalN = 0;
            let totalE = 0;

            if (dataLive.length > 0 && supabase) {
                const ids = dataLive.map((d) => d.empleado_id);
                const { data: configs } = await supabase
                    .from("tareo_employee_config")
                    .select("*")
                    .in("employee_id", ids);

                const configMap = new Map(
                    ((configs ?? []) as unknown as TareoEmployeeConfig[]).map((c) => [c.employee_id, c])
                );

                dataLive.forEach(d => {
                    const config = configMap.get(d.empleado_id);
                    const sueldoBase = config?.sueldo_base ?? 0;
                    const afp = config?.afp_codigo ?? "ONP";
                    const tieneVidaLey = config?.vida_ley ?? false;

                    const diasTrab = calcDiasTrab(d.dias_habiles, d.vac, d.lic_sin_h, d.susp, d.aus_sin_just);
                    const totalHoras = calcTotalHoras(d.dias_habiles, d.descanso_lab, d.desc_med, d.vel, d.vac, d.lic_sin_h, d.susp, d.aus_sin_just, 0);
                    const sueldoProp = calcSueldoProporcional(sueldoBase, diasTrab, 30);
                    const totalAfecto = round2(sueldoProp);
                    const totalNoAfecto = round2(d.movilidad);
                    const totalIngresos = calcTotalIngresos(totalAfecto, totalNoAfecto);
                    const afpOnp = calcAfpOnpSimple(totalAfecto, afp);
                    const vidaLey = calcVidaLey(totalAfecto, tieneVidaLey);
                    const totalDesc = calcTotalDescuentos({ afp_onp: afpOnp, vida_ley: vidaLey, ret_jud: d.ret_jud });
                    const netoPagar = calcNetoPagar(totalIngresos, totalDesc);
                    const essalud = calcEssalud(totalAfecto);

                    totalB += totalIngresos;
                    totalD += totalDesc;
                    totalN += netoPagar;
                    totalE += essalud;
                });
            }

            setStats({
                totalEmpleados: dataLive.length,
                totalBruto: totalB,
                totalDescuentos: totalD,
                totalNeto: totalN,
                essalud: totalE,
            });
            setLoaded(true);
        }

        const raw = window.sessionStorage.getItem("pt_auth");
        if (raw) {
            loadData();
        }
    }, [anio, mes]);

    if (!loaded) {
        return (
            <div className="stats-grid">
                {[1, 2, 3, 4].map(i => (
                    <div key={i} className="stat-card" style={{ opacity: 0.5 }}>
                        <div className="stat-card__label">Calculando...</div>
                        <div className="stat-card__value" style={{ fontSize: "20px" }}>-</div>
                    </div>
                ))}
            </div>
        );
    }

    return (
        <div className="stats-grid">
            <div className="stat-card">
                <div className="stat-card__label">Trabajadores Activos</div>
                <div className="stat-card__value">{stats.totalEmpleados}</div>
                <div className="stat-card__sub">Planilla {MESES[mes]} {anio}</div>
                <div className="stat-card__icon">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                        <circle cx="9" cy="7" r="4"></circle>
                        <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                        <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                    </svg>
                </div>
            </div>

            <div className="stat-card">
                <div className="stat-card__label">Total Ingresos Brutos</div>
                <div className="stat-card__value" style={{ fontSize: "20px" }}>
                    S/ {stats.totalBruto.toLocaleString("es-PE", { minimumFractionDigits: 2 })}
                </div>
                <div className="stat-card__sub">Afecto + No afecto</div>
                <div className="stat-card__icon" style={{ background: "rgba(52,211,153,0.1)", color: "var(--color-success)" }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="12" y1="1" x2="12" y2="23"></line>
                        <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
                    </svg>
                </div>
            </div>

            <div className="stat-card">
                <div className="stat-card__label">Total Descuentos</div>
                <div className="stat-card__value" style={{ fontSize: "20px", color: "var(--color-danger)" }}>
                    S/ {stats.totalDescuentos.toLocaleString("es-PE", { minimumFractionDigits: 2 })}
                </div>
                <div className="stat-card__sub">AFP/ONP + Vida Ley + otros</div>
                <div className="stat-card__icon" style={{ background: "rgba(248,113,113,0.1)", color: "var(--color-danger)" }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10"></circle>
                        <line x1="8" y1="12" x2="16" y2="12"></line>
                    </svg>
                </div>
            </div>

            <div className="stat-card">
                <div className="stat-card__label">Neto a Pagar</div>
                <div className="stat-card__value" style={{ fontSize: "20px", color: "var(--color-primary)" }}>
                    S/ {stats.totalNeto.toLocaleString("es-PE", { minimumFractionDigits: 2 })}
                </div>
                <div className="stat-card__sub">Importe a depositar</div>
                <div className="stat-card__icon" style={{ background: "rgba(79,142,247,0.1)", color: "var(--color-primary)" }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect>
                        <line x1="1" y1="10" x2="23" y2="10"></line>
                    </svg>
                </div>
            </div>
        </div>
    );
}
