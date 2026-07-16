# Guía para Completar los Módulos Stub

Este documento proporciona instrucciones detalladas para completar los 4 módulos stub extrayendo código del `app.js` original.

## 1. Completar `fichajes.js`

### Funciones a extraer:
```bash
grep -n "function renderFichaje\|function initOperarioView\|function initAdminView\|function guardarFichaje\|function renderAdminAhora\|function renderAdminHistorial\|function exportFichajesCSV\|function handleQrFichaje" app.js
```

### Contenido a incluir:
- `renderFichaje()` - Función principal
- `initOperarioView()` - Vista simple para operarios
- `initAdminView()` - Vista con análisis para administrador
- `guardarFichaje()` - Guardar entrada/salida
- `renderAdminAhora()` - Quién está presente ahora
- `renderAdminHistorial()` - Historial de fichajes
- `exportFichajesCSV()` - Exportar CSV
- `handleQrFichaje()` - Procesar QR para fichaje
- Variables globales: `fichajeEstado`, `fichajeUserSelect`, etc.
- Constantes de tiempo de jornada

### Dependencias:
- db.js (dbGetAll, dbAdd, dbPut)
- roles-permisos.js (hasPermiso, currentUser)
- supabase-sync.js (realtime updates)

---

## 2. Completar `supabase-sync.js`

### Funciones a extraer:
```bash
grep -n "function syncNow\|function pullRemoteData\|function startRealtime\|function stopRealtime\|const SETUP_SQL\|function getSBConfig\|function initSupabase\|function saveSupabaseConfig" app.js
```

### Contenido a incluir:
- `SETUP_SQL` - Definición de tablas SQL
- `getSBConfig()` - Leer configuración guardada
- `initSupabase()` - Inicializar cliente Supabase
- `saveSupabaseConfig()` - Guardar credenciales
- `clearSupabaseConfig()` - Borrar configuración
- `syncNow()` - Sincronizar todos los datos
- `pullRemoteData()` - Descargar datos remotos
- `startRealtime()` - Conectar canal realtime
- `stopRealtime()` - Desconectar realtime
- `renderSyncScreen()` - UI para configuración
- Variables: `SB`, `rtChannel`, `syncBusy`, `syncTimer`

### Lógica de sincronización:
- Subir cambios locales (rows con synced=0)
- Descargar nuevos datos remotos
- Manejar conflictos de sincronización
- Actualizar timestamps de sincronización

---

## 3. Completar `voice.js`

### Funciones a extraer:
```bash
grep -n "function ensureWhisperLoaded\|function startListening\|function stopListening\|function finishRecording\|function normalizeVoiceTextWithQwen\|function blobToWhisperInput\|function startSilenceDetection" app.js
```

### Contenido a incluir:
- `initVoice()` - Inicializar sistema de voz
- `ensureWhisperLoaded()` - Cargar modelo Whisper
- `loadTransformersLibrary()` - Cargar transformers.js
- `ensureQwenVoiceModel()` - Cargar modelo Qwen (opcional)
- `startListening()` - Iniciar grabación
- `stopListening()` - Detener grabación
- `finishRecording()` - Procesar audio grabado
- `blobToWhisperInput()` - Convertir blob a tensor
- `normalizeVoiceTextWithQwen()` - Normalizar texto con Qwen
- `speak()` - Text-to-speech español
- `phoneticKey()` - Clave fonética
- `levenshtein()` - Distancia Levenshtein
- `fuzzyMatch()` - Búsqueda difusa
- `fuzzyScore()` - Puntuación similitud
- `parseSpanishNumberWords()` - Convertir "cuarenta y cinco" → 45
- Variables: `isRecording`, `whisperPipeline`, `whisperLoading`, `whisperReady`, `mediaRecorder`, `vadContext`

### Técnicas de audio:
- MediaRecorder API para captura
- Silence detection (RMS < 0.015, duración > 1100ms)
- Web Audio API para procesamiento

---

## 4. Completar `wizard.js`

### Funciones a extraer:
```bash
grep -n "const WIZ\|const FLOW\|function wizStart\|function wizRenderStep\|function wizProcessSpeech\|function wizExecute\|function buscarMaterialesFuzzy\|function buscarUbicacionesFuzzy" app.js
```

### Contenido a incluir:
- `WIZ` - Objeto estado del asistente
  - `tipo` - Tipo de operación (entrada, salida, etc)
  - `steps` - Array de pasos
  - `stepIdx` - Índice paso actual
  - `data` - Datos acumulados
  - `mats` - Materiales cached
  - `ubics` - Ubicaciones cached
  
- `FLOW` - Definición de flujos para cada operación:
  ```javascript
  FLOW = {
    entrada: [...],    // steps para entrada
    salida: [...],     // steps para salida
    mover: [...],      // steps para mover stock
    buscar: [...],     // steps para buscar
    pedir: [...]       // steps para pedir
  }
  ```

- Funciones principales:
  - `wizStart(tipo)` - Iniciar asistente con tipo
  - `wizRenderStep()` - Renderizar paso actual
  - `wizAcceptValue(valor)` - Procesar respuesta usuario
  - `wizSkipStep()` - Saltar paso si es skippable
  - `wizProcessSpeech(texto)` - Procesar entrada de voz
  - `wizProcessMaterial(texto)` - Buscar material
  - `wizProcessUbicacion(texto)` - Buscar ubicación
  - `wizExecute()` - Ejecutar operación final
  - `wizDoMovement()` - Registrar movimiento
  - `wizDoSearch()` - Ejecutar búsqueda
  - `wizDoPedido()` - Crear pedido
  - `wizCancel()` - Cancelar asistente
  - `wizReset()` - Resetear estado
  - `buscarMaterialesFuzzy(texto)` - Buscar materiales
  - `buscarUbicacionesFuzzy(texto)` - Buscar ubicaciones

### Dependencias:
- voice.js (startListening, stopListening, speak)
- db.js (dbGetAll, dbPut)
- materiales.js (para operaciones)
- movimientos.js (registerMovement)
- pedidos.js (savePedido)

---

## Instrucciones de Extracción

### Para cada módulo:

1. **Abrir app.js y buscar funciones:**
   ```bash
   grep -n "function nombreFuncion" /mnt/Downloads/Desarrollo/TalkStock/TalkStock/app.js
   ```

2. **Leer líneas del archivo:**
   ```bash
   sed -n '100,200p' /mnt/Downloads/Desarrollo/TalkStock/TalkStock/app.js
   ```

3. **Copiar función completa (incluir llaves):**
   - Desde `function nombre() {`
   - Hasta la llave de cierre `}`

4. **Pegar en el módulo stub:**
   - Reemplazar código existente del stub
   - Mantener comentarios de encabezado

5. **Verificar imports:**
   - Asegurar que todas las dependencias estén disponibles
   - Añadir comentarios sobre dependencias

6. **Probar módulo:**
   - Abrir navegador
   - Verificar que funciones están disponibles en consola

---

## Validación Final

Después de completar todos los stubs, verificar:

```javascript
// En consola del navegador:

// Roles y permisos
typeof hasPermiso === 'function' // true
Object.keys(ROLES).length > 0 // true

// Base de datos
typeof dbGetAll === 'function' // true

// UI
typeof showScreen === 'function' // true

// Auth
typeof doLogin === 'function' // true

// Supabase
typeof syncNow === 'function' // true

// Voz
typeof initVoice === 'function' // true

// Wizard
typeof wizStart === 'function' // true
Object.keys(FLOW).length > 0 // true

// Datos
typeof addMaterial === 'function' // true
typeof addUbicacion === 'function' // true
typeof registerMovement === 'function' // true
typeof savePedido === 'function' // true
typeof renderFichaje === 'function' // true
```

Si todo retorna `true`, ¡la refactorización está completa!

---

## Limpieza Final de app.js

Una vez todos los módulos estén completos:

1. Eliminar código duplicado del app.js
2. Mantener solo:
   - Imports de módulos (ya están en index.html)
   - Inicialización global
   - Event listeners principales
   - Orquestación de inicio

3. El app.js final debe tener <100 líneas
