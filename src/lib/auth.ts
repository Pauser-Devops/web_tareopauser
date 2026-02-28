/**
 * auth.ts — Módulo de autenticación para PAUSER TAREO
 *
 * Flujo:
 *   1. El usuario ingresa su DNI + app_password en el login.
 *   2. Se llama a verifyTareoLogin() que ejecuta la RPC en Supabase.
 *   3. Si las credenciales son válidas Y el cargo es permitido, se guarda
 *      la sesión en sessionStorage (se borra al cerrar el navegador).
 *   4. Layout.astro verifica la sesión en cada página y redirige a /login si no hay.
 *
 * Seguridad:
 *   - La contraseña NUNCA se guarda en sessionStorage.
 *   - Rate limiting: 3 intentos fallidos → 30 s de bloqueo (en localStorage).
 *   - La RPC en Supabase usa SECURITY DEFINER: el anon key no puede leer
 *     la tabla employees directamente.
 *   - sessionStorage se borra automáticamente al cerrar la pestaña.
 */

import { verifyTareoLogin } from "./supabase";

export const SESSION_KEY = "pt_auth";

// ─── Rate limiting ────────────────────────────────────────────────────────────

const RL_KEY = "pt_rl";          // localStorage key
const MAX_TRIES = 3;
const BLOCK_MS = 30_000;           // 30 segundos

interface RLState { tries: number; blockedUntil: number }

function getRLState(): RLState {
    try {
        const raw = localStorage.getItem(RL_KEY);
        return raw ? JSON.parse(raw) : { tries: 0, blockedUntil: 0 };
    } catch {
        return { tries: 0, blockedUntil: 0 };
    }
}

function saveRLState(state: RLState) {
    localStorage.setItem(RL_KEY, JSON.stringify(state));
}

/** Devuelve los ms restantes de bloqueo (0 = no bloqueado) */
export function getBlockedMs(): number {
    const st = getRLState();
    const remaining = st.blockedUntil - Date.now();
    return remaining > 0 ? remaining : 0;
}

function registerFailedAttempt(): void {
    const st = getRLState();
    st.tries += 1;
    if (st.tries >= MAX_TRIES) {
        st.blockedUntil = Date.now() + BLOCK_MS;
        st.tries = 0;
    }
    saveRLState(st);
}

function resetRateLimit(): void {
    localStorage.removeItem(RL_KEY);
}

// ─── Tipos de sesión ──────────────────────────────────────────────────────────

export interface SessionUser {
    id: string;
    nombre: string;
    position: string;
    sede: string;
    rol: "admin" | "analista" | "visor";
}

// ─── Login ────────────────────────────────────────────────────────────────────

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
    const sessionUser: SessionUser = {
        id: result.id!,
        nombre: result.nombre!,
        position: result.position!,
        sede: result.sede!,
        rol: result.rol!,
    };

    sessionStorage.setItem(SESSION_KEY, JSON.stringify(sessionUser));
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
    sessionStorage.removeItem(SESSION_KEY);
    window.location.href = "/login";
}
