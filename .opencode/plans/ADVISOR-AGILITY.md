# ADVISOR-AGILITY — Regla 80/20 para un Advisor más ágil

> Plan de cambio del agente `advisor` y del `planner`. Origen: sesión de análisis en `pruebq1` (2026-10-22). Complementa `AGENT-PIPELINE.md` (§ Decisiones clave) y el protocolo `pruebq1/.opencode/plans/HARNESS-EVAL-PROTOCOL.md`. **Estado: propuesta, sin implementar.**

## Estado

📝 Diseño. Ninguna fase aplicada. Cada fase se implementa, mide y decide por separado (no se apilan sin medir).

## Objetivo

Reducir saltos entre agentes (latencia, tokens, pérdida de fidelidad por re-transmisión) **sin** agrandar en exceso la ventana del Advisor y **sin** perder la separación coordinador/ejecutor.

**Regla 80/20:** se tocan **permisos y topes**, no el flujo. El desperdicio dominante (hipótesis, no medido) son los saltos innecesarios, no la redacción de cada paso. Tres palancas; todo lo demás queda congelado hasta tener datos.

## 0. Diagnóstico (verificado en el código, no estimado)

| Hecho | Dónde |
|---|---|
| El advisor no puede buscar: `glob`/`grep` deny; `read` sí está permitido | `templates/.opencode/agents/advisor.md:6-9` |
| §0 le prohíbe mirar el repo y empuja a delegar: "Un subagente extra es más barato que ensuciar tu ventana" | `advisor.md:31,33-38` |
| "Ante la duda, delega" + `explore` obligatorio para conocer el repo | `advisor.md:90` |
| Riesgo **bajo** = "delega 1 explore/builder" ⇒ toda tarea con código cuesta ≥1 hoja | `advisor.md:56` |
| Riesgo **medio** = 5 hojas `explore → planner → critic → builder → verifier`; no existe tope de hojas | `advisor.md:57` |
| `planner` con `edit: deny` ⇒ planes largos viajan inline (observado: plan de 160 líneas transmitido 3× planner→advisor→builder) | `templates/.opencode/agents/planner.md:10` |
| Ya existen y NO se tocan: deltas en vez de estado (§3), freno 3 iteraciones (§6) | `advisor.md:111-120,139` |

## 1. Invariantes que restringen el cambio

| Invariante | Dónde | Impacto |
|---|---|---|
| Paridad hash raíz `.opencode/**` ↔ `templates/`; `advisor.md` solo diverge por `{{PROJECT_NAME}}` | `.opencode/scripts/contract-tests.mjs:58-67,168-179` | Todo cambio se replica en **ambas** copias |
| advisor `edit * deny`, `shell * deny` salvo `routine-model.mjs*` | `test/e2e-harness-v2.test.mjs:403-409`; `test/wiring-basic.test.mjs:72-78` | **No se toca** (coordinador puro) |
| advisor `task`: `"*": ask` + 6 allow | `test/wiring-basic.test.mjs:91-97` | No se toca |
| hojas `task: deny`; planner `task` = `{"*":deny, explore:allow}` | `test/wiring-basic.test.mjs:80-89`; e2e `:400-402` | No se toca |
| Conversión a v2 `permissions[]` de lo definido en md/json | `test/e2e-harness-v2.test.mjs:381-387` | Verificar que los permisos nuevos (glob/grep, edit por ruta) sobreviven |
| Docs que repiten "orquestador estricto" | `AGENT-PIPELINE.md:31,33,34,37` (raíz y templates); `README.md:85` | Actualizar en la misma fase |
| `doctor` solo valida `default_agent`, `subagent_depth`, bash del builder | `templates/.opencode/scripts/doctor.mjs:35-37` | Sin cambios necesarios |

**Pendiente de auditar antes de la fase 2:** `templates/.opencode/commands/routine.md` y la sección de routing de `planner.md` (no cubiertos por la exploración inicial) por si codifican el flujo de 5 hojas.

## 2. Fase 0 — Telemetría de línea base (prerrequisito)

Sin esto no se puede atribuir efecto a ninguna palanca.

- **Cambio:** en §7 Cierre (`advisor.md:141-143`, ambas copias) añadir línea obligatoria:
  `Telemetría: ruta=<direct|delegated|spec-lite> · hojas=<n> (<lista>) · consultas_propias=<k> · iter_builder_verifier=<i> · verde=<sí|no>`
- **Recogida:** el usuario o `/record` copia la línea a `SUMMARY.md` con `topic: metrics/advisor-telemetry`. Sin script nuevo.
- **Duración:** ~10 tareas reales con el harness actual.
- **Riesgo:** bajo (texto). **Test:** ninguno obligatorio.
- **Hecho:** ≥10 líneas de telemetría registradas antes de iniciar la fase 1.

## 3. Fase 1 — Consulta acotada en vez de prohibición (palanca 1)

**Qué elimina:** el `explore` usado para "¿dónde está X?" y el resumen-de-segunda-mano consiguiente.

**Cambios (ambas copias de cada archivo):**

1. `advisor.md` frontmatter: `glob: allow`, `grep: allow`. `edit`, `bash`, `webfetch` sin cambios.
2. `advisor.md:31`: "Nunca ejecutas código ni editas archivos. Puedes **consultar** el repo dentro del presupuesto de §0."
3. `advisor.md` §0 (l. 33-38) reescrito:
   - Presupuesto por tarea, **antes** de delegar: ≤3 consultas (`grep`/`glob`/`read`) y ≤150 líneas leídas en total.
   - `read` solo de rangos (`offset`/`limit`) o archivos <100 líneas; para lo demás, `grep` con contexto.
   - Propósito único: **enrutar y redactar deltas precisos** (localizar archivo:línea, confirmar existencia). Nunca leer para implementar ni para "entender un subsistema" ⇒ eso sigue siendo `explore`.
   - Presupuesto agotado ⇒ delega; prohibido ampliarlo "una vez más".
4. `advisor.md:90`: "Ante la duda, consulta acotada (§0); si no basta, `explore`."
5. `AGENT-PIPELINE.md:31` (ambas): "Orquestador estricto" → "Orquestador con consulta acotada: `edit/bash/webfetch: deny`; `glob/grep/read` con presupuesto §0".
6. `README.md:85`: revisar redacción si menciona que el advisor no lee.

**Tests:**
- `wiring-basic.test.mjs`: nueva aserción advisor `glob: allow`, `grep: allow` y que `edit: deny` sigue.
- `e2e-harness-v2.test.mjs`: aserción de que glob/grep allow del advisor llega a v2 `permissions[]`; mantener `:403-409`.
- `contract-tests.mjs` verde (paridad).

**Métrica de decisión (vs fase 0):** `consultas_propias` > 0 en la mayoría de tareas y `hojas` mediana menor; `iter_builder_verifier` mediana no sube.
**Rollback:** revertir frontmatter + §0; los tests nuevos se invierten.

## 4. Fase 2 — Tope de hojas por clase de riesgo (palanca 2)

**Qué elimina:** el pipeline de 5 hojas por costumbre en riesgo medio y la doble hoja en riesgo bajo.

**Cambios (ambas copias):**

1. Tabla §2 (`advisor.md:54-58`):

| Clase | Tope | Composición |
|---|---|---|
| Bajo | **1 hoja** | `builder` con el comando de verificación en su prompt (se autoverifica). `verifier` solo si el builder no pudo ejecutar la verificación |
| Medio | **3 hojas** | `builder` + `verifier` + **una** de (`planner` \| `explore`), no ambas. `critic` no entra salvo señal de riesgo alto |
| Alto | **sin tope** | spec-lite / delegated con `critic` **obligatorio** |

2. Regla de excepción: superar el tope exige una línea visible al usuario: `Tope excedido (<clase>): <motivo>`. Sin línea ⇒ no se delega.
3. §2.2 (l. 82-84): "Explora SIEMPRE" → "Explora solo si la consulta acotada (§0) no bastó"; "Critica" → solo riesgo alto.
4. "Cuándo usar critic" (l. 96-103): quitar ">3 files acoplados" como disparador por sí solo (pasa a riesgo medio sin critic).
5. `AGENT-PIPELINE.md:34,37` (ambas): misma tabla de topes; critic solo alto.
6. Alinear `commands/routine.md` y routing de `planner.md` según la auditoría del §1.

**Tests:** opcional, aserción de texto en `wiring-basic` (`advisor.md` contiene "Tope excedido"). Paridad de contrato verde.
**Métrica de decisión:** `hojas` mediana baja en medio/bajo; `iter_builder_verifier` y regresiones no suben. **Si el re-trabajo sube, esta es la primera palanca en revertirse.**
**Riesgo:** medio (cambia el contrato de routing) ⇒ pasar por `critic` antes de implementar.

## 5. Fase 3 — Paso por referencia, no por copia (palanca 3)

**Qué elimina:** re-transmisión de artefactos largos y su degradación.

**Cambios (ambas copias):**

1. `planner.md` frontmatter: `edit: { "*": deny, ".opencode/plans/**": allow }` (escritura solo de planes/specs).
2. `advisor.md` §3 "Formato de retorno" por defecto para toda hoja: ≤15 líneas, anclas `archivo:línea`; cualquier artefacto >30 líneas se escribe a archivo y se devuelve **la ruta**.
3. `builder.md`: si el prompt trae una ruta de plan/spec, leerla de disco; no esperar el contenido inline.
4. `AGENT-PIPELINE.md`: anotar "artefactos por referencia".

**Verificación previa (bloqueante):** confirmar que opencode acepta `edit` con patrón de ruta en frontmatter de agente **y** que la conversión v2 lo preserva (añadir aserción en `e2e-harness-v2.test.mjs`).
**Fallback si no se soporta:** mantener `planner edit: deny`; el builder recibe el plan inline una vez y lo persiste como primer paso (2 transmisiones en vez de 3).
**Métrica:** tamaño de prompts delegados (inspección manual de 5 sesiones) y ausencia de discrepancias plan↔implementación.

## 6. Congelado (el 80% que no se toca)

- `edit: deny` y `bash` del advisor (separación coordinador/ejecutor).
- Deltas en vez de estado (§3), freno de 3 iteraciones (§6), memoria (§1), comunicación adaptativa (§8).
- Umbrales de clase de riesgo (§2): se cambian los **topes**, no la **clasificación**, para no confundir efectos.
- Modelos por agente, `subagent_depth: 2`, `task` de hojas.

## 7. Orden, criterios y publicación

1. Fase 0 → medir ~10 tareas.
2. Fase 1 → critic → builder → verifier (`npm test`, `contract-tests`) → medir ~10 tareas → decidir (mantener/revertir).
3. Fase 2 → ídem. 4. Fase 3 → ídem (con verificación previa bloqueante).
- **Una fase por release**; nunca dos fases en la misma medición.
- Umbrales de decisión elegidos de antemano (no predicciones): mantener si `hojas` mediana baja ≥1 y `iter_builder_verifier` mediana no sube; revertir en cualquier otro caso.
- Publicación: bump de versión (`version-bump`), entrada en `CHANGELOG/`, decisión en `PROJECT_STATE.md §2` con `topic: architecture/advisor-agility` y `review_after`.
- **Propagación a proyectos:** llega por `npx advisor-harness@latest . --upgrade`. Aviso: `pruebq1` tiene `advisor.md` modificado localmente sin commitear; `--upgrade` lo sobrescribirá — revisar/respaldar antes.

## 8. Riesgos abiertos

| Riesgo | Mitigación |
|---|---|
| El presupuesto de consulta se ignora y la ventana crece | `consultas_propias` en telemetría; si se excede de forma recurrente, bajar a ≤2 consultas o revertir fase 1 |
| Topes demasiado bajos ⇒ más re-trabajo | Revertir fase 2 primero; la línea "Tope excedido" deja rastro de dónde se quedó corto |
| Edit por ruta no soportado por opencode/v2 | Fallback de fase 3 |
| Las tres palancas son hipótesis estructurales, no medidas | Fase 0 + medición por fase; enlazar con `HARNESS-EVAL-PROTOCOL` (H3 tokens, H4 re-trabajo) |
