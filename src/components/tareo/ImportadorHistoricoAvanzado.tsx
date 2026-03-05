import React, { useState, useRef } from "react";
import * as ExcelJS from "exceljs";
import { supabase } from "../../lib/supabase";
import { upsertDetallesLote, fetchDetallesAnalista, type TareoAnalistaDetalle } from "../../lib/tareoAnalista";
import { upsertConfigsLote } from "../../lib/empleados";
import { buildColumnMap, getColValue } from "../../lib/columnDetector";

interface Props {
    tareoAnalistaId: string;
    onImportComplete?: () => void;
}

interface FilaValidada {
    idLocal: number;
    numeroFilaExcel: number;
    dni: string;
    empleadoId?: string;
    nombreEmpleado?: string;
    // tareos_analista_detalle
    diasTrabajados: number;
    descansoLab: number;
    descMed: number;
    vac: number;
    licSinH: number;
    susp: number;
    ausSinJust: number;
    movilidad: number;
    comisiones: number;
    bonoProductividad: number;
    bonoAlimentacion: number;
    retJud: number;
    // tareo_employee_config
    sueldoBase: number;
    afpCodigo: string;
    vidaLey: boolean;
    eps: boolean;
    cuentaHaberes?: string;
    banco?: string;
    //
    esValido: boolean;
    observacion?: string;
}

// AFP codes válidos en el sistema
const AFP_VALIDOS = ["PRIMA", "PROFUTURO", "INTEGRA", "HABITAT", "ONP", "PROFUT", "INTEGR"];
const normalizeAfp = (val: string): string => {
    const v = val.toUpperCase().trim();
    if (v.includes("PRIMA")) return "PRIMA";
    if (v.includes("PROFUT")) return "PROFUTURO";
    if (v.includes("INTEG")) return "INTEGRA";
    if (v.includes("HABIT")) return "HABITAT";
    if (v.includes("ONP")) return "ONP";
    return v || "ONP";
};

export default function ImportadorHistoricoAvanzado({ tareoAnalistaId, onImportComplete }: Props) {
    const [status, setStatus] = useState<"idle" | "loading" | "preview" | "importing" | "success" | "error">("idle");
    const [message, setMessage] = useState("");
    const [registrosValidos, setRegistrosValidos] = useState<FilaValidada[]>([]);
    const [registrosObservados, setRegistrosObservados] = useState<FilaValidada[]>([]);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setStatus("loading");
        setMessage("Leyendo archivo Excel e identificando empleados...");
        setRegistrosValidos([]);
        setRegistrosObservados([]);

        try {
            const workbook = new ExcelJS.Workbook();
            const arrayBuffer = await file.arrayBuffer();
            await workbook.xlsx.load(arrayBuffer);

            let worksheet = workbook.getWorksheet("2601");
            if (!worksheet) worksheet = workbook.worksheets[0];
            if (!worksheet) throw new Error("No se encontró ninguna hoja válida en el Excel.");

            const { columnMap, headerRowIndex, unmapped, unknown } = buildColumnMap(worksheet);
            if (unmapped.length > 0) console.warn("[Importador] Sin columna detectada:", unmapped);
            if (unknown.length > 0) console.warn("[Importador] Cabeceras no reconocidas:", unknown);

            const obligatorios = ["DNI", "DIAS_TRABAJADOS"] as const;
            const faltantes = obligatorios.filter(k => columnMap[k] == null);
            if (faltantes.length > 0) {
                throw new Error(`El Excel no contiene las columnas requeridas: ${faltantes.join(", ")}`);
            }

            if (!supabase) throw new Error("Supabase no está configurado.");

            const { data: empleadosBd, error: errorEmp } = await supabase
                .from("employees")
                .select("id, dni, full_name")
                .eq("is_active", true)
                .is("termination_date", null);

            if (errorEmp) throw new Error("Error obteniendo empleados de la BD: " + errorEmp.message);

            const mapEmpleados = new Map<string, { id: string, nombre: string }>();
            empleadosBd?.forEach(emp => {
                if (emp.dni) mapEmpleados.set(emp.dni.trim(), { id: emp.id, nombre: emp.full_name });
            });

            const asString = (val: unknown): string => {
                if (val === null || val === undefined) return "";
                if (typeof val === "object" && "result" in (val as any)) return String((val as any).result).trim();
                return String(val).trim();
            };

            const parseNum = (val: unknown): number => {
                if (val === null || val === undefined) return 0;
                if (typeof val === "number") return val;
                if (typeof val === "object" && "result" in (val as any)) return parseNum((val as any).result);
                const parsed = parseFloat(String(val).replace(/,/g, ""));
                return isNaN(parsed) ? 0 : Math.abs(parsed);
            };

            const filasProcesadas: FilaValidada[] = [];
            let idCounter = 1;

            for (let rowNumber = headerRowIndex + 1; rowNumber <= worksheet.rowCount; rowNumber++) {
                const row = worksheet.getRow(rowNumber);
                const dni = asString(getColValue(row, columnMap, "DNI"));
                if (!dni) continue;
                const nombre = asString(getColValue(row, columnMap, "NOMBRE"));
                if (/^(total|subtotal)/i.test(nombre)) continue;

                // ── Detalle (tareos_analista_detalle) ──────────────────────────
                const diasTrabajados = parseNum(getColValue(row, columnMap, "DIAS_TRABAJADOS"));
                const descansoLab = parseNum(getColValue(row, columnMap, "DES_LAB"));
                const descMed = parseNum(getColValue(row, columnMap, "CERT_MEDICO"));
                const vac = parseNum(getColValue(row, columnMap, "VAC_GOZ"));
                const licSinH = parseNum(getColValue(row, columnMap, "LIC_SIN_GOCE"));
                const susp = parseNum(getColValue(row, columnMap, "SUSP_SIN_GOCE"));
                const ausSinJust = parseNum(getColValue(row, columnMap, "FALTAS"));
                const movilidad = parseNum(getColValue(row, columnMap, "MOV_ASIST"));
                const comisiones = parseNum(getColValue(row, columnMap, "COMISIONES"));
                const bonoProductividad = parseNum(getColValue(row, columnMap, "BONO_PRODUCT"));
                const bonoAlimentacion = parseNum(getColValue(row, columnMap, "BONO_ALIMENT"));
                const retJud = parseNum(getColValue(row, columnMap, "DCTO_JUDICIAL"));

                // ── Config (tareo_employee_config) ────────────────────────────
                const sueldoBase = parseNum(getColValue(row, columnMap, "BASICO_AFECTO"));
                const afpRaw = asString(getColValue(row, columnMap, "AFP"));
                const afpCodigo = afpRaw ? normalizeAfp(afpRaw) : "";
                const essVidaVal = parseNum(getColValue(row, columnMap, "ESS_VIDA"));
                const vidaLey = essVidaVal > 0;
                
                // EPS (si hay valor > 0, es true)
                const epsVal = parseNum(getColValue(row, columnMap, "EPS"));
                const eps = epsVal > 0;

                // Nuevos campos solicitados: Banco y Cuenta
                const cuentaHaberes = asString(getColValue(row, columnMap, "NRO_CUENTA"));
                const banco = asString(getColValue(row, columnMap, "BANCO"));

                let matchBd = mapEmpleados.get(dni);
                let dniFinal = dni;
                if (!matchBd && /^\d+$/.test(dni) && dni.length < 8) {
                    const paddedDni = dni.padStart(8, "0");
                    matchBd = mapEmpleados.get(paddedDni);
                    if (matchBd) dniFinal = paddedDni;
                }

                filasProcesadas.push({
                    idLocal: idCounter++,
                    numeroFilaExcel: rowNumber,
                    dni: dniFinal,
                    empleadoId: matchBd?.id,
                    nombreEmpleado: matchBd?.nombre,
                    diasTrabajados, descansoLab, descMed, vac, licSinH,
                    susp, ausSinJust, movilidad, comisiones,
                    bonoProductividad, bonoAlimentacion, retJud,
                    sueldoBase, afpCodigo, vidaLey, eps,
                    cuentaHaberes, banco,
                    esValido: !!matchBd,
                    observacion: matchBd ? undefined : "DNI no encontrado en la base de datos",
                });
            }

            setRegistrosValidos(filasProcesadas.filter(f => f.esValido));
            setRegistrosObservados(filasProcesadas.filter(f => !f.esValido));
            setStatus("preview");
            setMessage("Análisis completado. Revisa los resultados antes de confirmar.");

        } catch (error: any) {
            console.error("Error importando excel:", error);
            setStatus("error");
            setMessage(error.message || "Error desconocido al procesar el archivo.");
        } finally {
            if (fileInputRef.current) fileInputRef.current.value = "";
        }
    };

    const handleConfirmImport = async () => {
        if (registrosValidos.length === 0 && registrosObservados.length === 0) return;
        setStatus("importing");
        setMessage("Guardando en base de datos...");

        try {
            const detallesActuales = await fetchDetallesAnalista(tareoAnalistaId);
            const mapActuales = new Map(detallesActuales.map(d => [d.empleado_id, d]));

            if (registrosValidos.length > 0) {
                // 1. Guardar tareos_analista_detalle
                const detalles: TareoAnalistaDetalle[] = registrosValidos.map(reg => {
                    const actual = mapActuales.get(reg.empleadoId!);
                    return {
                        tareo_analista_id: tareoAnalistaId,
                        empleado_id: reg.empleadoId!,
                        dias_habiles: reg.diasTrabajados,
                        descanso_lab: reg.descansoLab || actual?.descanso_lab || 0,
                        desc_med: reg.descMed || actual?.desc_med || 0,
                        vel: actual?.vel ?? 0,
                        vac: reg.vac || actual?.vac || 0,
                        lic_sin_h: reg.licSinH || actual?.lic_sin_h || 0,
                        susp: reg.susp || actual?.susp || 0,
                        aus_sin_just: reg.ausSinJust || actual?.aus_sin_just || 0,
                        movilidad: reg.movilidad || actual?.movilidad || 0,
                        comision: reg.comisiones || actual?.comision || 0,
                        bono_productiv: reg.bonoProductividad || actual?.bono_productiv || 0,
                        bono_alimento: reg.bonoAlimentacion || actual?.bono_alimento || 0,
                        ret_jud: reg.retJud || actual?.ret_jud || 0,
                    };
                });

                const { ok, error, savedCount } = await upsertDetallesLote(detalles);
                if (!ok) throw new Error("Fallo al insertar detalles válidos: " + error);
                if (savedCount === 0) {
                    throw new Error(
                        `El upsert no guardó ninguna fila (0 de ${detalles.length} empleados). ` +
                        "Posible bloqueo por RLS en Supabase. Verifica las políticas de la tabla tareos_analista_detalle."
                    );
                }

                // 2. Guardar tareo_employee_config (solo para filas con datos de config)
                const configs = registrosValidos
                    .filter(reg => reg.sueldoBase > 0 || reg.afpCodigo || reg.cuentaHaberes || reg.banco || reg.eps)
                    .map(reg => ({
                        employee_id: reg.empleadoId!,
                        sueldo_base: reg.sueldoBase || undefined,
                        afp_codigo: reg.afpCodigo || undefined,
                        vida_ley: reg.vidaLey,
                        eps: reg.eps,
                        cuenta_haberes: reg.cuentaHaberes || undefined,
                        banco: reg.banco || undefined,
                    }));

                if (configs.length > 0) {
                    const cfgResult = await upsertConfigsLote(configs);
                    if (!cfgResult.ok) {
                        console.warn("[Importador] Advertencia al guardar configs:", cfgResult.error);
                    }
                }
            }

            if (registrosObservados.length > 0) {
                const obsAInsertar = registrosObservados.map(obs => ({
                    tareo_analista_id: tareoAnalistaId,
                    dni_erroneo: obs.dni,
                    fila_excel: obs.numeroFilaExcel,
                    detalles_json: {
                        dias_trabajados: obs.diasTrabajados,
                        comisiones: obs.comisiones,
                        bono_productividad: obs.bonoProductividad,
                        bono_alimentacion: obs.bonoAlimentacion,
                        sueldo_base: obs.sueldoBase,
                    },
                    estado: "Pendiente"
                }));

                if (!supabase) throw new Error("Supabase null");
                const { error: obsError } = await supabase
                    .from("observaciones_importacion")
                    .insert(obsAInsertar);
                if (obsError) console.warn("Advertencia al guardar observaciones (¿existe la tabla?):", obsError);
            }

            setStatus("success");
            const savedMsg = registrosValidos.length > 0
                ? `${registrosValidos.length} empleado(s) importados correctamente.`
                : "";
            const obsMsg = registrosObservados.length > 0
                ? ` ${registrosObservados.length} fila(s) con DNI no encontrado quedaron pendientes.`
                : "";
            setMessage("✅ Importación completada: " + savedMsg + obsMsg);
            if (onImportComplete) onImportComplete();

        } catch (error: any) {
            console.error("Error al guardar la importación:", error);
            setStatus("error");
            setMessage(error.message || "Fallo al guardar en la base de datos.");
        }
    };

    const fmt = (n: number) => n > 0 ? n.toLocaleString("es-PE") : "—";
    const fmtS = (n: number) => n > 0 ? `S/ ${n.toLocaleString("es-PE", { minimumFractionDigits: 2 })}` : "—";

    return (
        <div className="card" style={{ marginBottom: "20px" }}>
            <div className="card__header">
                <div className="card__title">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 18, height: 18, marginRight: 8, display: "inline-block", verticalAlign: "middle" }}>
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="17 8 12 3 7 8" />
                        <line x1="12" y1="3" x2="12" y2="15" />
                    </svg>
                    Importador Histórico
                </div>
                <div className="card__actions">
                    {(status === "idle" || status === "error" || status === "success") && (
                        <label className="btn btn--secondary" style={{ cursor: "pointer", fontSize: "13px" }}>
                            Subir archivo .xlsx
                            <input
                                type="file"
                                accept=".xlsx"
                                style={{ display: "none" }}
                                onChange={handleFileUpload}
                                ref={fileInputRef}
                            />
                        </label>
                    )}
                    {status === "preview" && (
                        <button className="btn btn--primary" onClick={handleConfirmImport} style={{ fontSize: "13px" }}>
                            Confirmar Importación
                        </button>
                    )}
                </div>
            </div>

            <div style={{ padding: "16px" }}>
                {(status === "loading" || status === "importing") && (
                    <div style={{ padding: "30px", textAlign: "center", color: "var(--color-text-muted)" }}>
                        <div className="spinner" style={{ margin: "0 auto 12px", width: 30, height: 30, border: "3px solid transparent", borderTopColor: "var(--color-primary)", borderRadius: "50%", animation: "spin 1s linear infinite" }} />
                        <span>{message}</span>
                        <style>{`@keyframes spin { 100% { transform: rotate(360deg); } }`}</style>
                    </div>
                )}

                {status === "error" && (
                    <div style={{ padding: "12px", background: "rgba(248,113,113,0.1)", color: "var(--color-danger)", borderRadius: "6px", fontSize: "14px", border: "1px solid rgba(248,113,113,0.3)" }}>
                        ⚠️ {message}
                    </div>
                )}

                {status === "success" && (
                    <div style={{ padding: "12px", background: "rgba(52,211,153,0.1)", color: "var(--color-success)", borderRadius: "6px", fontSize: "14px", border: "1px solid rgba(52,211,153,0.3)" }}>
                        ✅ {message}
                    </div>
                )}

                {status === "preview" && (
                    <div>
                        <p style={{ fontSize: "14px", color: "var(--color-text-muted)", marginBottom: "16px" }}>{message}</p>

                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
                            {/* Panel Válidos */}
                            <div style={{ background: "#fff", border: "1px solid var(--color-border)", borderRadius: "8px", overflow: "hidden" }}>
                                <div style={{ background: "rgba(52,211,153,0.1)", borderBottom: "1px solid var(--color-border)", padding: "10px 14px", fontWeight: 600, color: "var(--color-success)", display: "flex", justifyContent: "space-between" }}>
                                    <span>Listos para importar</span>
                                    <span style={{ background: "var(--color-success)", color: "#fff", padding: "2px 8px", borderRadius: "12px", fontSize: "12px" }}>{registrosValidos.length}</span>
                                </div>
                                <div style={{ maxHeight: "320px", overflowY: "auto", overflowX: "auto" }}>
                                    {registrosValidos.length === 0 ? (
                                        <div style={{ padding: "20px", textAlign: "center", color: "var(--color-text-muted)", fontSize: "13px" }}>No hay registros válidos.</div>
                                    ) : (
                                        <table style={{ width: "100%", fontSize: "11px", borderCollapse: "collapse" }}>
                                            <thead style={{ background: "var(--color-bg)", borderBottom: "1px solid var(--color-border)" }}>
                                                <tr>
                                                    <th style={{ padding: "5px 8px", textAlign: "left" }}>DNI</th>
                                                    <th style={{ padding: "5px 8px", textAlign: "left" }}>Nombre</th>
                                                    <th style={{ padding: "5px 4px", textAlign: "center" }}>Días</th>
                                                    <th style={{ padding: "5px 4px", textAlign: "center" }}>Vac</th>
                                                    <th style={{ padding: "5px 4px", textAlign: "center" }}>Susp</th>
                                                    <th style={{ padding: "5px 4px", textAlign: "center" }}>Falt</th>
                                                    <th style={{ padding: "5px 4px", textAlign: "right" }}>Sueldo</th>
                                                    <th style={{ padding: "5px 4px", textAlign: "center" }}>AFP</th>
                                                    <th style={{ padding: "5px 4px", textAlign: "center" }}>VL</th>
                                                    <th style={{ padding: "5px 4px", textAlign: "center" }}>EPS</th>
                                                    <th style={{ padding: "5px 4px", textAlign: "left" }}>Banco</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {registrosValidos.map(r => (
                                                    <tr key={r.idLocal} style={{ borderBottom: "1px solid var(--color-border)" }}>
                                                        <td style={{ padding: "5px 8px" }}>{r.dni}</td>
                                                        <td style={{ padding: "5px 8px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "110px" }}>{r.nombreEmpleado}</td>
                                                        <td style={{ padding: "5px 4px", textAlign: "center", fontWeight: 600 }}>{r.diasTrabajados}</td>
                                                        <td style={{ padding: "5px 4px", textAlign: "center", color: r.vac > 0 ? "var(--color-primary)" : "var(--color-text-muted)" }}>{fmt(r.vac)}</td>
                                                        <td style={{ padding: "5px 4px", textAlign: "center", color: r.susp > 0 ? "var(--color-danger)" : "var(--color-text-muted)" }}>{fmt(r.susp)}</td>
                                                        <td style={{ padding: "5px 4px", textAlign: "center", color: r.ausSinJust > 0 ? "var(--color-danger)" : "var(--color-text-muted)" }}>{fmt(r.ausSinJust)}</td>
                                                        <td style={{ padding: "5px 4px", textAlign: "right", fontWeight: 600, color: r.sueldoBase > 0 ? "var(--color-text)" : "var(--color-text-muted)" }}>{fmtS(r.sueldoBase)}</td>
                                                        <td style={{ padding: "5px 4px", textAlign: "center", fontSize: "10px", color: r.afpCodigo ? "var(--color-primary)" : "var(--color-text-muted)" }}>{r.afpCodigo || "—"}</td>
                                                        <td style={{ padding: "5px 4px", textAlign: "center" }}>{r.vidaLey ? "✓" : "—"}</td>
                                                        <td style={{ padding: "5px 4px", textAlign: "center" }}>{r.eps ? "✓" : "—"}</td>
                                                        <td style={{ padding: "5px 4px", textAlign: "left", fontSize: "10px", color: "var(--color-text-muted)" }}>
                                                            {r.banco ? `${r.banco} ${r.cuentaHaberes ? `(${r.cuentaHaberes})` : ""}` : "—"}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    )}
                                </div>
                            </div>

                            {/* Panel Observados */}
                            <div style={{ background: "#fff", border: "1px solid var(--color-border)", borderRadius: "8px", overflow: "hidden" }}>
                                <div style={{ background: "rgba(248,113,113,0.1)", borderBottom: "1px solid var(--color-border)", padding: "10px 14px", fontWeight: 600, color: "var(--color-danger)", display: "flex", justifyContent: "space-between" }}>
                                    <span>Observaciones (No hallados en BD)</span>
                                    <span style={{ background: "var(--color-danger)", color: "#fff", padding: "2px 8px", borderRadius: "12px", fontSize: "12px" }}>{registrosObservados.length}</span>
                                </div>
                                <div style={{ maxHeight: "320px", overflowY: "auto" }}>
                                    {registrosObservados.length === 0 ? (
                                        <div style={{ padding: "20px", textAlign: "center", color: "var(--color-text-muted)", fontSize: "13px" }}>No hay observaciones. ¡Todo perfecto!</div>
                                    ) : (
                                        <table style={{ width: "100%", fontSize: "11px", borderCollapse: "collapse" }}>
                                            <thead style={{ background: "var(--color-bg)", borderBottom: "1px solid var(--color-border)" }}>
                                                <tr>
                                                    <th style={{ padding: "5px 8px", textAlign: "left" }}>Fila</th>
                                                    <th style={{ padding: "5px 8px", textAlign: "left" }}>DNI</th>
                                                    <th style={{ padding: "5px 4px", textAlign: "center" }}>Días</th>
                                                    <th style={{ padding: "5px 4px", textAlign: "right" }}>Sueldo</th>
                                                    <th style={{ padding: "5px 4px", textAlign: "center" }}>AFP</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {registrosObservados.map(r => (
                                                    <tr key={r.idLocal} style={{ borderBottom: "1px solid var(--color-border)" }}>
                                                        <td style={{ padding: "5px 8px" }}>#{r.numeroFilaExcel}</td>
                                                        <td style={{ padding: "5px 8px", color: "var(--color-danger)", fontWeight: 600 }}>{r.dni}</td>
                                                        <td style={{ padding: "5px 4px", textAlign: "center" }}>{r.diasTrabajados}</td>
                                                        <td style={{ padding: "5px 4px", textAlign: "right" }}>{fmtS(r.sueldoBase)}</td>
                                                        <td style={{ padding: "5px 4px", textAlign: "center", fontSize: "10px" }}>{r.afpCodigo || "—"}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Leyenda de campos importados */}
                        <div style={{ marginTop: "12px", padding: "10px 14px", background: "var(--color-bg)", borderRadius: "6px", fontSize: "11px", color: "var(--color-text-muted)", display: "flex", flexWrap: "wrap", gap: "8px" }}>
                            <span style={{ fontWeight: 600, color: "var(--color-text)" }}>Campos que se actualizarán:</span>
                            <span>📅 Días trabajados</span>
                            <span>🏖 Vacaciones</span>
                            <span>⚕️ Desc. médico</span>
                            <span>🚫 Suspensión</span>
                            <span>❌ Faltas</span>
                            <span>🚐 Movilidad</span>
                            <span>💰 Comisiones</span>
                            <span>🎁 Bonos</span>
                            <span>⚖ Ret. judicial</span>
                            <span style={{ color: "var(--color-primary)", fontWeight: 600 }}>💼 Sueldo base</span>
                            <span style={{ color: "var(--color-primary)", fontWeight: 600 }}>🏦 AFP</span>
                            <span style={{ color: "var(--color-primary)", fontWeight: 600 }}>🛡 Vida ley</span>
                            <span style={{ color: "var(--color-primary)", fontWeight: 600 }}>🏥 EPS</span>
                            <span style={{ color: "var(--color-primary)", fontWeight: 600 }}>🏛 Banco/Cta</span>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}