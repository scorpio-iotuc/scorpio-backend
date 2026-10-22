# Changelog

## [Unreleased] — Cola de jobs extensible (2026-10-22)

- Se define `JobInterface` para programación, inicio opcional, recuperación, consulta de pendientes/ejecuciones activas, reclamación y ejecución. `SatelliteUpsertJob` y `CreateStationPassesJob` encapsulan sus modelos Prisma, configuración y reglas específicas.
- `JobQueue` recorre los jobs registrados sin conocer sus tablas ni distinguir tipos concretos. Reclama el pendiente más antiguo; en caso de empate, usa el orden de registro. Si cualquier job registrado está ejecutándose, los demás permanecen `queued`.
- `registry.ts` centraliza la composición de dependencias. `main.ts` ejecuta el contrato común, conservando el lock PostgreSQL entre réplicas, la programación durante una ejecución, los logs de espera y las notificaciones. Un nuevo tipo se implementa y registra sin modificar la cola ni el coordinador.
- Se conservan los horarios UTC, `RUN_ON_START`, la ventana de predicción calculada al reclamar, la recuperación transaccional y la limpieza de generaciones fallidas. La ejecución se inicia después de confirmar la transacción de reclamación. No requiere migraciones.
- Las pruebas cubren un tercer tipo de job, exclusión, orden y desempates, ejecución fuera de transacción, errores, recuperación, inicio opcional y despacho de los jobs existentes.

## [Unreleased] — Uso directo de ThreadClient en CreatePasses (2026-10-22)

- `CreatePasses` instancia directamente `ThreadClient` y conserva la inyección mediante `ThreadClientContract`. Se elimina la factory `createPredictionPool` y el directorio `passes/workers`.
- `ThreadClient` centraliza los defaults (4 threads, cola de 100, heap de 128 MB) y la resolución TS/JS con carga automática de ts-node solo para workers TypeScript. Los consumidores indican proveedor y ruta del worker; pueden sobrescribir los límites.
- El entrypoint de predicción pasa a `helpers/predictWorker.ts` y los tipos de tarea/resultado a `dto/PredictionDTO.ts`. La implementación Piscina sigue encapsulada en el cliente de infraestructura.

## [Unreleased] — Adaptador genérico de threads (2026-10-22)

- Se extrae Piscina a `src/lib/thread-client/`, siguiendo la separación de fachada, contrato, tipos y clientes. `ThreadClient.ts` selecciona el proveedor, `ThreadClientContract.ts` define `run`/`destroy`, `types/ThreadClientTypes.ts` define configuración independiente de Piscina y `main.ts` expone la API pública.
- `clients/PiscinaClient.ts` encapsula la dependencia, traduce las opciones y administra el pool. Las tareas y resultados son genéricos y serializables entre threads. Para incorporar otro proveedor se implementa el contrato y se registra su constructor en la fachada; no cambia `CreatePasses`.
- El módulo de pasadas conserva el worker y una factory `createPredictionPool` con la ruta TS/JS, cuatro threads, cola de 100 y heap de 128 MB por worker. Se elimina `PiscinaPredictionPool`; `PredictionPool` pasa a ser un alias del contrato genérico.
- `destroy` es idempotente, comparte la promesa de cierre y rechaza nuevas tareas una vez cerrado. Se prueban tareas genéricas, errores, datos estructurados, cierre, validación y la predicción real mediante el adaptador.

## [Unreleased] — Predicción por lotes con Piscina (2026-10-22)

- El job obtiene cada lote de 100 satélites una sola vez mediante el cursor de `findAll`, y lo reutiliza para todas las estaciones antes de obtener el siguiente lote. Las estaciones se leen una vez por job en páginas de 100 y se mantienen sus snapshots/generaciones en memoria; no se acumula el catálogo completo ni el producto de estaciones y satélites.
- `CreatePasses` recibe el lote y la generación de una estación. Un único pool Piscina de cuatro threads por job se reutiliza entre estaciones/lotes; cada tarea calcula un satélite y no accede a Prisma. Se conserva el filtrado de órbitas inválidas y el cálculo desde el horizonte. El coordinador espera todos los resultados, incluso si falla una tarea, antes de propagar un error.
- `createBatch` combina las predicciones de varios satélites en escrituras Prisma de hasta 500 filas y espera cada escritura. Solo después de persistir todas las predicciones de la estación se avanza a la siguiente; después de la última estación se obtiene el próximo lote. La publicación atómica, limpieza, notificaciones y exclusión entre jobs se conservan.
- Se agrega Piscina 5 (compatible con Node 22), workers TypeScript para ejecución local y JavaScript compilado para Docker, sin necesitar ts-node en producción. El pool limita la cola a 100 tareas y el heap antiguo de cada thread a 128 MB; se libera al terminar o fallar el job. Estos límites no equivalen a una medición de RSS total.
- El servicio `jobs` de `docker-compose.dev.yml` queda limitado a 4 CPUs y 1 GB de memoria. Aplicar con `docker compose --env-file dev.env -f docker-compose.dev.yml up -d --build jobs`. No cambia el calendario ni requiere migraciones.
- Pruebas cubren orden lote→estación, una lectura de cada lote, backpressure de predicciones y escrituras, fallo sin persistencia parcial, liberación del pool y equivalencia numérica entre predicción serial y cuatro threads reales. No se realizó una prueba de carga con 80k satélites.

## [Unreleased] — Paginación de pasadas (2026-10-21)

- `GET /api/passes` acepta `page` (por defecto 1) y `limit` (por defecto 20, máximo 100). El controlador rechaza valores vacíos, repetidos, no enteros, fuera de rango y offsets mayores que el máximo entero de 32 bits.
- La paginación se aplica en PostgreSQL después de filtrar las pasadas y ordenarlas globalmente por AOS, NORAD e ID; no limita los satélites usados por el job. El conteo y la página comparten una transacción `RepeatableRead`.
- La respuesta mantiene `stationUuid`, `windowHours` y `passes`, y agrega `pagination: { page, limit, total, totalPages }`. Sin coincidencias devuelve total y totalPages en cero. Una página fuera del rango devuelve `passes: []` con los totales correspondientes.
- La trayectoria conserva `GET /api/passes/:passId/trajectory?stepSeconds=10`, usando el `passId` recibido en el listado. No requiere migración. Cada solicitud del listado evalúa la ventana desde su hora actual; páginas solicitadas en momentos distintos pueden reflejar el avance del tiempo o una generación recién publicada.

## [Unreleased] — Logs de pasadas y transiciones de jobs (2026-10-21)

- `CreatePasses` registra el inicio por estación y el progreso tras cada lote de satélites: job, estación, generación, cursor, cantidad procesada, pasadas generadas, omisiones y tiempos por lote/acumulado. Los contadores se registran después de esperar las escrituras, sin emitir una línea por satélite.
- `PassesAPI` registra solicitudes `ListPasses` y `GetPassTrajectory` con ID de correlación, identificadores/parámetros escalares acotados, estado HTTP y duración. Incluye rechazos de validación y errores inesperados; no registra headers, cuerpos ni los arrays de pasadas/puntos.
- El worker registra encolado, reclamación, recuperación tras reinicio y adquisición/espera del lock. Para cada tipo de job, registra la cabecera de cola esperando otro job solo cuando cambia el job pendiente o el bloqueo; no repite el mensaje en cada poll.
- La limpieza de pasadas registra inicio y fin, fase, fecha de corte, filas eliminadas y duración. La finalización del job incluye el total eliminado en ambas limpiezas y el tiempo total.
- Los logs usan el `Logger` existente y salen por stdout/stderr: `docker compose logs -f jobs` para predicciones/cola y `docker compose logs -f api` para solicitudes. Las notificaciones de Discord conservan su comportamiento.

## [Unreleased] — Pasadas persistidas por estación y worker compartido (2026-10-21)

### Predicción y almacenamiento

- Se agrega `SatellitePass`, con UUID persistido, relaciones a estación y satélite, AOS, LOS, elevación máxima y su instante, nombre/NORAD de la predicción, fecha de creación y snapshot de los elementos orbitales. `satellite_id` es la clave interna; `satelliteId` en la respuesta pública sigue siendo el número NORAD.
- `StationPassJob` guarda estado, clave diaria única, ventana (`window_start`, `window_end`, `window_hours`), tiempos, contadores y errores. `StationPassGeneration` guarda las coordenadas usadas para cada estación, incluso si no se encuentran pasadas. Los snapshots permiten reproducir la trayectoria aunque cambie el catálogo o la estación.
- Los lotes se guardan como resultados pendientes. Solo el cambio del job a `completed` publica todas sus generaciones; un fallo conserva las últimas predicciones publicadas y elimina los resultados parciales. Las generaciones anteriores siguen disponibles por ID hasta que sus pasadas expiran.
- Cada ejecución elimina registros de `SatellitePass` con `los < ahora`, al iniciar y antes de publicar. Conserva las pasadas en curso y futuras; una pasada eliminada ya no tiene trayectoria consultable. Los metadatos de jobs y generaciones se mantienen como historial.

### Create Station Passes

- Se incorpora `src/jobs/create-station-passes/execute-job.ts`, programado todos los días a las **12:00 UTC**. El worker compartido `src/jobs/main.ts` coordina esta tarea y la importación de satélites con el mismo lock de sesión PostgreSQL. Solo reclama un job cuando ninguno de los dos tipos está ejecutándose; los demás permanecen `queued`.
- El scheduler sigue revisando el calendario mientras se ejecuta un job. Las claves diarias evitan duplicados; tras un reinicio se marcan como fallidas las ejecuciones interrumpidas y se descartan sus resultados pendientes. Si el proceso inicia después de las 12:00 UTC, encola la ejecución del día si falta. `RUN_ON_START` conserva su efecto anterior sobre la importación de satélites.
- Se reutilizan las notificaciones de Discord para `queued`, `running`, `completed`, `failed` y recuperación de ejecuciones interrumpidas. Los fallos de entrega no cambian el estado del job.
- `CreatePasses` calcula para todas las estaciones y satélites. Las estaciones se leen en páginas de 100 y los satélites mediante `findAll({ afterId, limit: 100 })`, con cursor por ID para evitar desplazamientos de página por nuevas inserciones. Se elimina `findAllForPassPrediction`. La paginación HTTP existente del catálogo conserva `page` y `limit`.
- Se espera cada predicción/escritura antes de continuar: la memoria queda acotada al lote y a las pasadas de un satélite. El recorrido no acumula todo el catálogo ni todas las predicciones. El cálculo sigue siendo costoso para 80k satélites y múltiples estaciones: no se ha validado ese volumen en producción.
- La ventana comienza al reclamar el job, no al encolarlo. `STATION_PASSES_WINDOW_HOURS` vale **72** por defecto (entero entre 48 y 240), dando margen al refresco diario y a la vista de próximas 24 horas. Un job que termina sin cobertura para las próximas 24 horas falla en vez de publicar resultados insuficientes.
- Los helpers `orbit.ts`, `predict.ts` y `scan.ts` quedan separados en `src/modules/passes/helpers/`, conservando los comentarios del cálculo. Se calculan pasadas desde el horizonte, sin aplicar el filtro del usuario durante la generación. Se omiten elementos orbitales inválidos, contabilizándolos por par satélite/estación; errores inesperados abortan el job.

### API de pasadas y trayectoria

- `GET /api/passes?stationUuid=<uuid>&hours=24&minElevation=10&noradid=28492` consulta únicamente la última generación completada de esa estación, sin propagar órbitas ni paginar la respuesta. Omitir `noradid` consulta todas las pasadas. `satelliteNoradId` sigue disponible como alias; no se permiten ambos a la vez.
- La validación de parámetros permanece en el controlador: estación obligatoria, `hours` mayor que 0 y hasta 168, `minElevation` entre 0 y 90, NORAD entero positivo de 32 bits. La consulta filtra AOS en `[ahora, ahora + hours)`, elevación máxima y NORAD, y ordena globalmente por AOS. Las pasadas ya iniciadas no aparecen en este listado de próximas pasadas.
- Si no existe generación publicada, cambiaron las coordenadas o la ventana solicitada excede la cobertura disponible, responde **503** con un mensaje explícito. No devuelve una lista vacía como si hubiera cobertura completa. Una estación o satélite explícito inexistente devuelve **404**.
- Se agrega `GET /api/passes/:passId/trajectory?stepSeconds=10`, y el alias `GET /api/passes/trajectory?passId=<uuid>&stationUuid=<uuid>&stepSeconds=10`. `passId` identifica la pasada; `stationUuid` es una comprobación opcional. El controlador acepta pasos enteros entre 1 y 300 segundos. Se usan los snapshots, se incluyen AOS y LOS exactos y se limita la respuesta a 10000 puntos (**422** si requiere un paso mayor). Un ID inexistente, pendiente o eliminado devuelve **404**.
- El escaneo mantiene pasos de 10 segundos y refinamiento de cruces/pico a intervalos de 100 ms. Puede omitir pasadas rasantes más cortas que el paso; esa tolerancia numérica no garantiza precisión física. La altitud de estación se interpreta en metros. No se corrigen refracción ni obstrucciones del terreno y la calidad depende de la vigencia de los elementos orbitales.

### Migración y ejecución

- La migración `20261021190000_station_pass_predictions` crea las tres tablas, índices y claves foráneas; no modifica ni borra los datos existentes. Aplicar con `npx prisma migrate deploy` y regenerar el cliente con `npx prisma generate` antes de ejecutar el nuevo código. El entrypoint de la API ya aplica migraciones y Compose espera su healthcheck antes de iniciar `jobs`.
- `npm run worker` y `npm run worker:prod` ejecutan el coordinador compartido. Se mantienen los entrypoints de compatibilidad de ambos tipos de job; cualquier réplica usa el mismo lock. Se documenta `STATION_PASSES_WINDOW_HOURS` en `.env.example` y en ambos Compose. No se requieren dos servicios worker.
- Verificación: `npm run build`, las 47 pruebas unitarias y la prueba de integración PostgreSQL pasan. Se aplicaron todas las migraciones en una base desechable, verificando exclusión de jobs, publicación, filtros, snapshots, claves foráneas y limpieza; no se migró la base de la aplicación.
- Se reemplaza `docs/passes.md` por esta entrada. Pruebas unitarias cubren filtros, cursor/backpressure, horario UTC, exclusión de jobs, publicación, fallos, notificaciones y trayectorias. La prueba PostgreSQL optativa se ejecuta con `PASSES_TEST_DATABASE_URL=<base-desechable-migrada> npm run test:passes:integration`; no debe apuntar a la base de la aplicación.

## [Unreleased] — Notificaciones de jobs por Discord (2026-10-13)

### Notificaciones y alertas

- Se incorpora `NotifyClient` en `src/jobs/notify/`, con una interfaz asíncrona común para `notify` y `alert`. El cliente registrado como `discord-bot` envía mensajes mediante un webhook de Discord.
- El worker notifica cuando crea un job al iniciar o por calendario (`status=queued`), cuando comienza la importación (`status=running`) y después de guardar su finalización (`status=completed`). Cada mensaje incluye el ID del job. Los jobs encolados desde la API reciben su primera notificación al comenzar la ejecución.
- Si una importación falla, se envía una alerta con el ID, `status=failed` y el mensaje del error después de persistir el estado. La recuperación tras un reinicio alerta sobre la cantidad de jobs interrumpidos marcados como fallidos; el manejador de errores fatales del worker también envía una alerta.
- `safeNotify` aísla los errores de entrega para que no alteren el resultado del job y registra el fallo sin incluir la URL secreta del webhook. Recorta los mensajes a 1900 caracteres para reservar espacio al prefijo de alerta. El cliente valida el límite de 2000 caracteres, desactiva menciones y aplica un timeout de 10 segundos, sin reintentos automáticos. La entrega es de mejor esfuerzo y puede perderse ante una terminación abrupta.

### Configuración y despliegue

- Se documenta `DISCORD_WEBHOOK_URL` en `.env.example` y README. Se configura en `dev.env` para desarrollo y en `.env` para producción; si falta o está vacía, el worker continúa con las notificaciones deshabilitadas. No requiere token de bot ni ID de canal separados.
- La URL debe añadirse también al archivo `/opt/SCORPIO/scorpio-backend/.env` de la VM: los archivos de entorno locales no se suben mediante Git. El despliegue actual reconstruye y levanta el stack completo, incluido `jobs`, que carga la configuración mediante `env_file`. Para aplicar cambios de entorno fuera de un despliegue, recrear el contenedor `jobs`; un simple reinicio no recarga sus variables.

### Pruebas

- Se agregan pruebas del envío por webhook, configuración obligatoria del cliente, límites de longitud y propagación de errores HTTP/red. Las pruebas del worker cubren el orden de las notificaciones, las alertas después de persistir un fallo, el aislamiento de errores de Discord y el recorte de mensajes largos, usando dobles de prueba sin enviar mensajes reales.

## [Unreleased] — Catálogo CSV con backpressure y consulta de jobs (2026-10-08)

### Importación CSV

- El worker se organiza en `src/jobs/upsert-satellite/main.ts`, con el cliente CelesTrak en `clients/` y helpers de mapeo y ejecución. Se actualizan los comandos npm y el entrypoint Docker.
- El cliente solicita `FORMAT=CSV` y consume el cuerpo HTTP mediante streams y `csv-parse`, sin crear un string/array de todo el catálogo. Valida encabezados, filas, números finitos, identificadores y fechas UTC.
- Cada lote de 100 satélites se persiste secuencialmente. Esperar la escritura aplica backpressure al parser y al stream HTTP, manteniendo buffers acotados. `UpsertSatellites` recibe únicamente un lote y se enfoca en persistirlo; no descarga ni interpreta formatos externos.
- `downloaded=true` se registra después de consumir y validar todas las filas. Puede quedar pendiente el último lote parcial; el estado `completed` solo se registra después de todas las escrituras. Una interrupción anterior puede dejar lotes persistidos con `downloaded=false`.
- Se cancela el pipeline ante fallos de red, parsing o escritura. Los lotes confirmados se conservan y una nueva ejecución puede sincronizarlos. El aborto del stream no cancela una consulta SQL ya enviada.
- El plazo del stream cambia de dos a treinta minutos porque incluye esperas por backpressure. No es un límite de ejecución de consultas PostgreSQL. Se mantiene el calendario diario y el aislamiento del worker.
- Pruebas nuevas verifican CSV fragmentado/comillas, lotes y backpressure con una escritura bloqueada, errores, aborto, formato solicitado y separación del caso de uso.


### Listado y filtros de jobs

- Se incorpora `GET /api/satellites/upsert/jobs`, protegido con Bearer token de administrador, mediante controlador, caso de uso `ListSatelliteUpsertJobs`, DTO y repositorio Prisma.
- Permite paginar con `page` (por defecto 1) y `limit` (por defecto 20, máximo 100), y filtrar por `status` (`queued`, `running`, `completed`, `failed`) y `downloaded`.
- `downloaded=true` y `downloaded=false` se convierten explícitamente a booleanos; omitir el parámetro no aplica filtro. Valores inválidos, repetidos o estructurados devuelven **400**. Se corrige así el error TS2345 al pasar directamente `req.query.downloaded` al DTO.
- Se inicializa el caso de uso en el constructor del controlador. La paginación rechaza números fraccionarios/no finitos y se reutiliza el tipo compartido de estado del job.
- Los filtros se aplican antes de paginar; se ordena por `created` descendente y luego `id` descendente. La respuesta es un array sin totales: una página fuera del rango devuelve **200** con `[]`.
- Se corrigen mensajes y comentarios, incluido `noraId` → `noradId`.

### Validación y despliegue

- `npm run build` y las 21 pruebas de `npm test` pasan, incluidas pruebas de streaming, backpressure, filtros booleanos y validación del controlador.
- Esta validación no incluye una importación real ni una prueba de carga en producción. Reconstruir y recrear `api` y `jobs` para aplicar los cambios de código y la nueva ruta del worker. Esta entrega no agrega migraciones de base de datos.


## [Unreleased] — Worker de satélites y logs (2026-10-07)

### Cola persistente y servicio Jobs

- Se incorpora el servicio `jobs` en `docker-compose.yml` y `docker-compose.dev.yml`. Usa el mismo Dockerfile que la API, pero ejecuta un proceso independiente; la importación ya no ocupa el event loop de la API.
- La tarea TypeScript `src/jobs/upsert-satellite/main.ts` reemplaza los scripts Python y el despliegue del directorio raíz `jobs/`. Reutiliza `UpsertSatellites`, los repositorios y Prisma para extraer y guardar datos de CelesTrak.
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

Satellite automation is implemented in `src/jobs/upsert-satellite/main.ts`.
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
