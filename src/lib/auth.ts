import { verifyTareoLogin } from "./supabase";

export const SESSION_KEY = "pt_auth";
export const SESSION_COOKIE = "pt_session";

// ─── Cookie helpers (cliente) ──────────────────────────────────────────────────

function setSessionCookie(user: SessionUser) {
    if (typeof document === "undefined") return;
    // Guardar cookie para middleware (server-side protection)
    // codificamos doble para evitar problemas con caracteres especiales en JSON
    const val = btoa(unescape(encodeURIComponent(JSON.stringify(user))));
    // 1 día de duración
    document.cookie = `${SESSION_COOKIE}=${val}; path=/; max-age=86400; SameSite=Strict`;
}

function clearSessionCookie() {
    if (typeof document === "undefined") return;
    document.cookie = `${SESSION_COOKIE}=; path=/; max-age=0; SameSite=Strict`;
}

// ─── Rate Limiting (localStorage) ──────────────────────────────────────────────

const RL_KEY = "pt_rl"; // Rate Limit Key

function getBlockedMs(): number {
    if (typeof window === "undefined") return 0;
    try {
        const raw = localStorage.getItem(RL_KEY);
        if (!raw) return 0;
        const data = JSON.parse(raw);
        if (data.blockedUntil && data.blockedUntil > Date.now()) {
            return data.blockedUntil - Date.now();
        }
    } catch {}
    return 0;
}

function registerFailedAttempt() {
    if (typeof window === "undefined") return;
    try {
        const raw = localStorage.getItem(RL_KEY);
        let data = { tries: 0, blockedUntil: 0 };
        if (raw) data = JSON.parse(raw);

        data.tries += 1;
        if (data.tries >= 3) {
            // Bloquear 30 segundos
            data.blockedUntil = Date.now() + 30000;
            data.tries = 0;
        }
        localStorage.setItem(RL_KEY, JSON.stringify(data));
    } catch {}
}

function resetRateLimit() {
    if (typeof window === "undefined") return;
    localStorage.removeItem(RL_KEY);
}

// ─── Tipos ─────────────────────────────────────────────────────────────────────

export interface SessionUser {
    id: string;
    nombre: string;
    position: string;
    sede: string;
    business_unit: string | null;
    rol: "jefe" | "analista";
}

// ─── Login principal ───────────────────────────────────────────────────────────

export async function login(
    dni: string,
    password: string
): Promise<{ ok: boolean; error?: string; blockedMs?: number }> {
    // 1. Verificar rate limit
    const blockedMs = getBlockedMs();
    if (blockedMs > 0) {
        return {
            ok: false,
            error: `Demasiados intentos. Espera ${Math.ceil(blockedMs / 1000)} segundos.`,
            blockedMs,
        };
    }

    // 2. Validación mínima en cliente (no revela información)
    if (!dni.trim() || !password) {
        return { ok: false, error: "Ingresa tu DNI y contraseña." };
    }

    // 3. Llamada a Supabase RPC
    const result = await verifyTareoLogin(dni, password);

    if (!result.ok) {
        registerFailedAttempt();
        // Siempre el mismo mensaje genérico para no dar pistas
        return {
            ok: false,
            error: "Credenciales incorrectas o sin acceso autorizado.",
            blockedMs: getBlockedMs(),
        };
    }

    // 4. Login exitoso — guardar sesión sin contraseña
    // Derivamos el rol desde el cargo (position) para no depender
    // de que la RPC devuelva exactamente "jefe"/"analista".
    const position = (result.position ?? "").toUpperCase();
    const rolDerived: "jefe" | "analista" = position.includes("JEFE")
        ? "jefe"
        : "analista";

    // Debugging para el usuario (se verá en la consola del navegador)
    console.log("[Auth] Login exitoso. Datos recibidos:", {
        nombre: result.nombre,
        position: result.position,
        rol_db: result.rol,
        rol_derivado: rolDerived
    });

    // También aceptamos si la RPC ya devuelve el rol correcto,
    // PERO si el cargo dice JEFE, le damos prioridad (auto-promotion)
    // para corregir casos donde la BD tenga "analista" por defecto.
    let rolFinal: "jefe" | "analista" = "analista";

    if (result.rol === "jefe") {
        rolFinal = "jefe";
    } else if (rolDerived === "jefe") {
        rolFinal = "jefe";
    } else if (result.rol === "analista") {
        rolFinal = "analista";
    } else {
        rolFinal = rolDerived;
    }

    console.log("[Auth] Rol final asignado:", rolFinal);

    const sessionUser: SessionUser = {
        id: result.id!,
        nombre: result.nombre!,
        position: result.position!,
        sede: result.sede!,
        business_unit: result.business_unit ?? null,
        rol: rolFinal,
    };

    sessionStorage.setItem(SESSION_KEY, JSON.stringify(sessionUser));
    setSessionCookie(sessionUser);
    resetRateLimit();
    return { ok: true };
}

// ─── Helpers de sesión ────────────────────────────────────────────────────────

export function isLoggedIn(): boolean {
    if (typeof window === "undefined") return false;
    return !!sessionStorage.getItem(SESSION_KEY);
}

export function getSessionUser(): SessionUser | null {
    if (typeof window === "undefined") return null;
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    try {
        return JSON.parse(raw) as SessionUser;
    } catch {
        return null;
    }
}

export function logout(): void {
    // Limpiar sessionStorage primero
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem("pt_periodo");
    // Navegar al endpoint server-side que borra la cookie via Set-Cookie header.
    // NO usar clearSessionCookie() aquí: el borrado client-side llega tarde y
    // el siguiente request (a /login) todavía lleva la cookie, causando el bucle:
    // 302 /login → 200 / → redirect a /login → ...
    window.location.href = "/api/logout";
}
