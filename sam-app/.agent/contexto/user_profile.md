---
name: Perfil del usuario (Ivan García)
description: Rol, contexto operacional, herramientas y preferencias de trabajo del usuario que opera el proyecto SAM/AgroMorales
type: user
originSessionId: 1ce18956-632a-4426-8216-5dffcc058ca5
---
**Identidad**

- Email: `ivan.garcia0969@gmail.com`
- Empresa empleadora: Riopaila Agricola / Castilla Agricola (según el path del workspace `OneDrive - Riopaila Agricola - Castilla Agricola/Documentos/CODEX/asm`).
- Cliente al que sirve con la app: **Agroservicios Morales S.A.S** (marca comercial: **AgroMorales**).
- Rol operacional: dueño técnico/operacional del producto SAM en producción. NO es desarrollador full-time; sabe usar SSH, leer SQL y hacer pegados de scripts, pero la implementación pesada la delega.

**Acceso y poderes**

- ✅ SSH root al VPS Hostinger (`ssh root@2.24.89.123`).
- ✅ Hostinger hPanel (`https://hpanel.hostinger.com/vps/1657782/docker-manager`).
- ✅ Push a `main` del repo `juancarloszuluagaranzon-afk/sam` (el pre-push hook valida tsc+build).
- ❌ Panel Vercel: **NO tiene acceso** (el proyecto Vercel está bajo otra cuenta, probablemente Juan Carlos Zuluaga). Puede pushear código → auto-deploy, pero no puede editar env vars ni provocar redeploys manuales.
- (Pendiente) Supabase Studio: en proceso de validar acceso vía `https://supabase.surcoapp.tech`.

**Herramientas que usa día a día**

- SSH terminal (Windows PowerShell o tab de SSH en VS Code) para el VPS.
- Navegador (Chrome/Edge) para probar la app productiva (`agroserviciosmorales.vercel.app`).
- VS Code en su PC con el repo abierto en `c:/Users/Agr338/OneDrive - Riopaila Agricola - Castilla Agricola/Documentos/CODEX/asm/sam`.
- Claude Code (esto) y CODEX como agentes asistentes.

**Preferencias de colaboración (extraídas del histórico)**

- Quiere **acción directa** sobre el contexto confirmado, no re-preguntas a temas ya cerrados.
- Quiere **autonomía operacional**: ser capaz de gestionar la base de datos sin depender del agente para cada operación.
- Valora la **persistencia del contexto**: ha expresado frustración cuando un agente "olvida" panorama operativo entre sesiones.
- **Comunica en español** y prefiere respuestas en español.
- **Pega credenciales por descuido** (vimos `SERVICE_ROLE_KEY` y `POSTGRES_PASSWORD` filtradas). Si pasa, mencionar UNA VEZ y seguir; no insistir si el usuario dice que no le importa por ahora.

**Lo que le importa en producción**

- +50 usuarios activos entre operadores móvil y supervisores PC.
- Que todos los dispositivos converjan a la misma información en tiempo real.
- Que cada cambio en `main` llegue a todos los dispositivos en menos de 3 minutos sin acción manual.
- Que el cliente (AgroMorales) pueda reportar lo que se ejecutó en una quincena correctamente.

**How to apply**

- Cuando me presenta una operación: asumir que ya pensó el contexto. No pedirle que repita lo que ya dijo en mensajes anteriores; revisar memoria primero.
- Cuando propone un cambio: implementar con criterio, no abrir 5 disyuntivas. Una recomendación + tradeoff principal.
- Cuando se queja de que "olvidé": no defenderme — revisar memoria, actualizar lo que falte, seguir adelante.
- Cuando me pregunta cómo hacer X él mismo: privilegiar herramientas existentes (Studio, psql vía SSH, scripts en `/root/scripts/`) sobre código nuevo.
- Si toca seguridad/Vercel/JWT: respetar que NO es prioridad suya ahora salvo que él lo levante.
