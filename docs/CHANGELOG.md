# Changelog

## [Unreleased] — Worker de satélites y logs (2026-10-07)

### Cola persistente y servicio Jobs

- Se incorpora el servicio `jobs` en `docker-compose.yml` y `docker-compose.dev.yml`. Usa el mismo Dockerfile que la API, pero ejecuta un proceso independiente; la importación ya no ocupa el event loop de la API.
- La tarea TypeScript `src/jobs/upsert_satellites_points.ts` reemplaza los scripts Python y el despliegue del directorio raíz `jobs/`. Reutiliza `UpsertSatellites`, los repositorios y Prisma para extraer y guardar datos de CelesTrak.
- Se agregan las tareas npm `npm run worker` (TypeScript local) y `npm run worker:prod` (JavaScript compilado). En Compose, `command: ["worker"]` selecciona el proceso correspondiente.
- `POST /api/satellites/upsert` solo registra un job `queued` y responde **202**; devuelve **409** si ya existe un job activo. `GET /api/satellites/upsert` solo consulta el último registro: no modifica jobs ni ejecuta la importación. Ambos mantienen la autorización de administrador.
- Las migraciones `20261008010000_satellite_job_queue` y `20261008010100_satellite_job_queue_index` incorporan `queued`, una clave diaria única y la restricción de un único job entre `queued` y `running`.
- El worker reclama jobs, ejecuta la descarga y persistencia, y registra `completed` o `failed`. Un lock de sesión PostgreSQL permite un solo worker activo; su sucesor marca como fallidas las ejecuciones interrumpidas.
- Las inserciones se dividen en lotes de 500 filas y la descarga tiene un plazo de dos minutos. El dataset completo aún se mantiene en memoria; esto no garantiza ausencia de contención en el host o PostgreSQL.
- Se agregan pruebas de encolado, estados de éxito/error y horario UTC. Ejecutar `npm test` desde la raíz; son pruebas unitarias sin descargas ni conexión a PostgreSQL.

### Logs centralizados

- Se agrega `src/lib/Logger.ts` con métodos `info`, `warn`, `error` y `debug`, un servicio definido al crear el logger y fecha ISO 8601 en UTC por evento.
- API, controladores, casos de uso de satélites y worker reemplazan sus llamadas directas a consola. Se conservan los logs de los casos de uso y se registra el resultado de encolar una importación.
- Cada evento ocupa una línea; el contexto conserva objetos y detalles de errores, incluidos stacks. Los errores y advertencias van a stderr; info/debug a stdout. No requiere `docker compose logs --timestamps` ni agrega logging de cuerpos HTTP o credenciales.

```text
[2026-10-08T00:00:00.000Z] [INFO] [Satellites] Import queued { jobId: '...' }
```

### Configuración, ejecución y despliegue del worker

Satellite automation is implemented in `src/jobs/upsert_satellites_points.ts`.
The `api` and `jobs` services build the same Dockerfile but start separate processes.
The root Python `jobs/` deployment and Python API-calling script are retired.
No automation user/password or separate Python image is required.

#### Development

```bash
docker compose --env-file dev.env -f docker-compose.dev.yml up -d --build api jobs
docker compose --env-file dev.env -f docker-compose.dev.yml logs -f jobs
```

Configure `UPSERT_SATELLITES_TRIGGER_TIME=00:00` (HH:MM UTC) and
`RUN_ON_START=false` in the Compose interpolation environment (`dev.env` for the
command above; `.env` in production). The worker checks every two seconds while
idle and executes one import at a time. Daily scheduling catches up today's run
when started after its trigger time, even with RUN_ON_START=false. A unique daily
key prevents the same scheduled run from being enqueued again after a restart.
A failed daily run is not automatically retried that day; use the admin POST to
retry. RUN_ON_START=true additionally requests an unscheduled import unless the
latest job finished within the past hour. An active job prevents duplicates.

POST /api/satellites/upsert now returns 202 with status `queued`; GET on the same
path returns its status. Clients must treat both `queued` and `running` as pending.
The worker changes started_at when execution actually begins. The single-active
job index applies to both statuses. When no worker is available, jobs stay queued.

#### Production rollout

Stop the old API and any Python/systemd automation before migration: old API
processes must not keep executing imports alongside the new worker. Then rebuild
and recreate `api` and `jobs` with production Compose. The API applies migrations;
the worker waits for API health and does not run migrations itself. Stop rather
than delete the database service/data. Reload frontend Nginx after API replacement
so it resolves the current API container address.

Only the worker holding a PostgreSQL session advisory lock executes jobs. On
startup it marks pre-existing running jobs failed; it never silently retries them.
The lock is released on connection closure. On shutdown during an import the worker
exits and leaves the job for that recovery step. Inserts/updates already committed
remain and can be upserted on the next manual run. A worker fatal database error
exits for Docker to restart it. This is not an overall import deadline or a full
worker readiness monitor: inspect worker logs and pending job age.

The worker has no HTTP server, so the API image's HTTP healthcheck is disabled for
that service. Production caps worker CPU at 0.5 and memory at 512 MiB; these are
additional container limits, not a shared 512 MiB budget. Confirm host capacity
before deploying. The API and database retain their existing limits. Import
inserts are batched at 500 rows and the CelesTrak download has a two-minute deadline.
The complete download/parsed dataset is still held in memory; profile resource
usage on the real dataset. Separating execution does not resolve all shared-host
or database contention.


## [Unreleased] Release: CI y jobs de satélites (2026-10-02)

> El diseño de ejecución en el proceso de la API descrito aquí queda reemplazado por el worker y la cola de la entrada 2026-10-07.

### Integración continua

- Se incorpora `.github/workflows/ci.yml`, ejecutado solo en pull requests hacia `development` o `main`. Solo valida cambios; no despliega ni requiere secretos de producción.
- El job **Validate and test** instala dependencias con `npm ci`, ejecuta `prisma validate` y `prisma generate`, compila API y seed, y ejecuta las pruebas unitarias con `npm test`. Su `DATABASE_URL` es ficticia y no se utiliza para conectarse a una base.
- El job **Docker startup and migrations** depende del anterior: construye el Dockerfile real y levanta PostgreSQL y la API. El entrypoint aplica las migraciones sobre una base vacía; CI espera los healthchecks, consulta `/health` y `/api/health` por el puerto publicado y verifica `prisma migrate status`.
- Ante fallos se imprimen el estado y los logs de los contenedores. La limpieza se ejecuta independientemente del resultado.
- `docker-compose.ci.yml` es independiente: usa almacenamiento temporal, credenciales de prueba y un puerto dinámico, sin archivos de entorno locales, volúmenes productivos ni redes externas. El seed se compila pero no se ejecuta; no se llama a CelesTrak.
- Se mantienen alineadas las versiones de Node.js del workflow y Dockerfile. Se excluyen archivos de entorno y `.venv` del contexto Docker.
- Las comprobaciones no reemplazan pruebas de integración de endpoints ni pruebas de migración sobre datos existentes.
- Instrucciones para reproducir los checks, revisar logs, limpiar el entorno y activar los checks requeridos en GitHub: [Test CI workflow](DEVELOPMENT.md#test-ci-workflow).

### Despliegue continuo
- Se incorpora `.github/workflows/cd.yml`, ejecutado solo cuando se mergea un PR en `main` (`pull_request_target` `closed` con `merged == true`; usa el `cd.yml` de la rama predeterminada `main`, así un PR no puede alterar los pasos de despliegue; el workflow debe estar en `main` para dispararse). Corre en el runner self-hosted `scorpio-backend` de la VM: hace checkout del SHA del merge en `/opt/SCORPIO/scorpio-backend`, ejecuta `docker compose up -d --build --wait` y verifica `/health`, `/api/health` y `prisma migrate status`. Falla sin tocar nada si el directorio tiene cambios sin commitear.

### Actualización de satélites en segundo plano

- Ambos endpoints requieren un Bearer token de administrador.
- `POST /api/satellites/upsert` registra un job `running` y responde **202 Accepted** con su registro. La descarga y actualización continúan en el mismo proceso Node.js. Responde **409 Conflict** si ya existe una ejecución activa.
- `GET /api/satellites/upsert` devuelve la última ejecución, incluso si falló, o **404** si no existe ninguna. Consultar el estado no inicia una descarga y no equivale a consultar la última ejecución exitosa.
- El modelo `SatelliteUpsertJob` persiste los estados enum `running`, `completed` y `failed`. `downloaded` pasa a `true` al finalizar la descarga HTTP; no garantiza datos válidos ni una actualización exitosa de la base.
- `created` y `updated` son fechas del job, no cantidades de satélites. `finished_at` y `error_message` admiten `null`.
- La migración `20261002180000_satellite_upsert_jobs` incluye un índice único parcial para permitir un solo job activo, incluso entre varias instancias de la API.

### Migración y operación

- Generar el cliente con `npx prisma generate` y aplicar `npx prisma migrate deploy` antes de ejecutar la nueva API. El segundo comando requiere una `DATABASE_URL` válida; el entrypoint Docker ya ejecuta las migraciones con la conexión configurada en Compose.
- Los consumidores del POST deben tratar **202** como aceptación, no como actualización terminada. Las automatizaciones deben consultar GET hasta un estado terminal y comprobar que el ID corresponda al devuelto por POST.
- La tarea corre dentro del proceso; no es una cola persistente. Un reinicio del contenedor interrumpe la ejecución y puede dejar el registro `running`, bloqueando nuevos jobs. Tras confirmar que ningún proceso sigue ejecutándolo, un operador debe marcarlo `failed` con fecha de finalización antes de reintentar.
- No limpiar automáticamente los jobs activos al arrancar si puede haber otras instancias ejecutándolos. Para recuperación automática se necesita un worker con asignación persistente de trabajos y recuperación de ejecuciones interrumpidas.
- Un fallo o reinicio puede dejar actualizaciones parciales de satélites. Una nueva ejecución puede sincronizarlas de nuevo. Antes de reintentar un POST tras un error de conexión, consultar el estado para evitar iniciar trabajos duplicados.



## [Unreleased] — Preparación para producción (2026-09-24)

Cambios para servir el backend públicamente en `scorpio.cpsrtc.cl`, con la cadena
**CloudFront (+WAF) → AWS ELB → nginx (frontend) → api**.

### ⚠️ Cambios incompatibles (breaking)

- **Todas las rutas quedan bajo el prefijo `/api`** (`/api/users`, `/api/auth/login`, `/api/packets`, etc.).
  Las únicas que siguen en la raíz son `/` y `/health`.
- **Socket.IO se sirve en `/api/socket.io`** (configurable con `SOCKET_PATH`). Los clientes tienen que indicar `path`.
- **`POST /api/users` y `GET /api/users` requieren un token de admin.** `GET /api/users/:id` solo lo puede usar el
  propio usuario o un admin.
- **El registro público está deshabilitado por defecto** (`SIGNUP_MODE=admin`): `POST /api/auth/signup` responde 403
  hasta que se configure `SIGNUP_MODE=public`.
- **El login responde siempre `Invalid email or password.`**: ya no distingue entre email inexistente y contraseña incorrecta.
- **Hay variables de entorno nuevas y obligatorias**: `POSTGRES_PASSWORD` (el compose no levanta sin ella).
  `DATABASE_URL` ahora la arma el compose, así que ya no va en `.env`.
- **Postgres ya no se publica en el host** (antes quedaba en `0.0.0.0:5432`).
  Para entrar a la base usa `docker compose exec db psql -U postgres -d postgres`.
- **Rotar `JWT_SECRET` invalida todas las sesiones activas.**

### Seguridad

- **Escalada de privilegios corregida:** cualquiera podía crear un usuario admin con `POST /users` enviando `type: "admin"`.
  Ahora ese endpoint es solo para admins, valida `type`, y el signup público siempre crea usuarios `normal`.
- **Contraseñas en texto plano:** al actualizar un usuario (`PATCH /users/:id`), la contraseña se guardaba sin hashear.
  Ahora se hashea con bcrypt (12 rondas).
- **Fuga del hash:** las respuestas de crear y actualizar usuario incluían el hash bcrypt. Ahora siempre devuelven el usuario público.
- **Borrado de estaciones:** cualquier usuario autenticado podía borrar los paquetes de cualquier estación, porque
  el borrado ocurría antes de revisar si la estación era suya. Ahora la autorización se revisa antes de tocar cualquier dato.
- **Datos personales:** la lista de usuarios con sus emails era pública. Ahora es solo para admins.
- **Enumeración de usuarios:** el login tenía mensajes distintos y tiempos de respuesta distintos según si el email existía.
  Ahora el mensaje es único y siempre se hace una comparación bcrypt (contra un hash de relleno si el email no existe).
- **Claves de estación:** se comparan con `crypto.timingSafeEqual` en vez de `!==`.
- **Errores:** los mensajes internos (por ejemplo, de Prisma) ya no llegan al cliente. Hay un manejador de errores
  final que responde JSON genérico, además de respuestas 400 para JSON mal formado y 413 para body demasiado grande.
- **Cambio de rol:** `PATCH /api/users/:id` con `type` solo lo acepta un admin sobre **otro** usuario. Si no es
  admin, o si el admin intenta cambiar su propio rol, responde 400. Antes el cambio de `type` estaba bloqueado para
  todos y, además, el repositorio nunca escribía ese campo.
- **Validación de entrada** en crear y actualizar usuario y estación: tipos, números finitos y `decoderConfig` como bytes 0–255.
- **Hardening HTTP:**
  - `helmet`, sin HSTS (lo pone CloudFront) y sin CSP (es una API).
  - `x-powered-by` deshabilitado.
  - `express.json({ limit: '100kb' })`.
- **Límite de intentos** en `/api/auth/*`: 20 por minuto por IP, como defensa en profundidad. La protección
  principal son las reglas rate-based del WAF. `POST /api/packets` no se limita en la app porque varias estaciones
  pueden compartir IP (NAT).
- **`trust proxy`** configurable con `TRUST_PROXY_HOPS` (por defecto 3: CloudFront → ELB → nginx), para que `req.ip`
  sea la IP real del cliente.
- **Seed:** ya no resetea la contraseña del admin en cada reinicio (solo lo crea si no existe), y solo corre si
  `SEED_ON_START=true`.

### Infraestructura / Docker

- **`Dockerfile` multi-stage:** compila en una etapa de build y la imagen final:
  - lleva solo dependencias de producción, sin `ts-node` ni `typescript`;
  - corre como `USER node` (antes era root);
  - usa `NODE_ENV=production`;
  - tiene un `HEALTHCHECK` contra `/health`.
- **Seed compilado** con `tsconfig.seed.json` (`npm run build:seed`) y ejecutado con `node dist-seed/prisma/seed.js`.
- **`docker-entrypoint.sh`:** corre `prisma migrate deploy`, luego el seed si corresponde, y finalmente arranca el servidor.
- **`docker-compose.yml`:**
  - `db` sin puertos publicados y solo en la red `internal`; credenciales desde `.env`.
  - `api` publicada solo en `127.0.0.1:3000` (para depurar); el tráfico público entra por el nginx del frontend a
    través de la red externa `scorpio-net`.
  - `DATABASE_URL` construida a partir de `POSTGRES_USER`, `POSTGRES_PASSWORD` y `POSTGRES_DB`.
- **`.dockerignore` nuevo** (excluye `.env`, `db_data`, `node_modules`, `.git`, etc.).
- **`.gitignore`:** agrega `db_data/` y `dist-seed/`, y separa una regla `data/` que estaba mal concatenada.

### Operación

- **Endpoints nuevos:**
  - `GET /health` y `GET /api/health`: hacen ping a la base y responden 200 o 503.
  - `GET /api/auth/config`: devuelve `{ signupMode: 'public' | 'admin' }`, para que el frontend muestre u oculte el registro.
- **Cierre ordenado** con `SIGTERM`/`SIGINT`: cierra Socket.IO y HTTP y desconecta Prisma (con un tope de 10 s).
- **Respuesta 404 en JSON** para rutas inexistentes.

### Dependencias

- Se agregan `helmet`, `express-rate-limit` y `dotenv` (`prisma.config.ts` lo importa y antes no estaba declarado).
- `express`, `@prisma/client`, `@prisma/adapter-pg` y `prisma` pasan de `devDependencies` a `dependencies`,
  porque se necesitan en producción (`prisma migrate deploy` corre al arrancar).

### Variables de entorno (`.env`)

| Variable | Obligatoria | Default | Descripción |
|---|---|---|---|
| `POSTGRES_PASSWORD` | sí | — | Contraseña de Postgres. Usa caracteres seguros para URL (`openssl rand -hex 24`). |
| `POSTGRES_USER` / `POSTGRES_DB` | no | `postgres` | Usuario y base. |
| `JWT_SECRET` | sí | — | Mínimo 32 bytes aleatorios (`openssl rand -base64 48`). |
| `ADMIN_PWD` | sí, si hay seed | — | Contraseña inicial del admin (solo se usa al crearlo). |
| `FRONTEND_URL` | sí | `http://localhost:3000` | Origen permitido por CORS y Socket.IO. |
| `SIGNUP_MODE` | no | `admin` | `public` = registro abierto (usuarios normales); `admin` = solo admins crean usuarios. |
| `TRUST_PROXY_HOPS` | no | `3` | Cantidad de proxies delante de la API. |
| `SEED_ON_START` | no | — | `true` para crear el admin si no existe al arrancar. |
| `SOCKET_PATH` | no | `/api/socket.io` | Path de Socket.IO. |

### Pasos de despliegue

1. **Rotar la contraseña de Postgres**, que estuvo expuesta con `postgres/postgres`:
   `docker exec scorpio-backend-db-1 psql -U postgres -c "ALTER USER postgres PASSWORD '<nueva>';"`
2. **Actualizar `.env`** con las variables de la tabla: `POSTGRES_PASSWORD`, un `JWT_SECRET` nuevo y fuerte, y
   `FRONTEND_URL=https://scorpio.cpsrtc.cl`. Quitar `DATABASE_URL`.
3. **Crear la red compartida** si no existe: `docker network create scorpio-net`.
4. **Levantar:** `docker compose up -d --build`.
5. **Verificar:**
   - `curl http://127.0.0.1:3000/health` responde `{"status":"ok"}`;
   - `ss -tlnp` ya no muestra `5432` en `0.0.0.0`;
   - `docker compose exec api id` muestra el usuario `node`.

### Requisitos de infraestructura (fuera del repo)

- **ELB:** el target group tiene que apuntar al puerto **8080** (nginx del frontend), con health check en `/healthz`.
- **CloudFront:**
  - reenviar el header `Authorization` y todos los métodos HTTP;
  - no guardar en caché `/api/*`;
  - permitir WebSocket;
  - enviar el header de origen `X-Origin-Verify` con el mismo valor que `ORIGIN_SECRET` del frontend.
- **Security group del ELB:** limitarlo a la prefix list administrada de CloudFront, para que nadie pueda saltarse el WAF.
- **Firewall del host:** Docker se salta `ufw` para los puertos publicados. Por eso importa publicar solo lo necesario.
- **Backups:** hacer un `pg_dump` periódico de la base.

### Pendiente / conocido

- En `PATCH /api/stations/:uuid`, mandar `decoderConfig: null` no borra el valor guardado (bug previo, no es de seguridad).
- Los JWT duran 24 h y no se pueden revocar antes de que expiren.
- Los cambios del frontend (proxy `/api`, `socket.js`, ocultar el registro según `/api/auth/config`) se coordinan
  en el repo `scorpio-frontend`.
