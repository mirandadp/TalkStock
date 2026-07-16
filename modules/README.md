# Refactorización de TalkStock - Módulos Independientes

## Estructura Actual

Se ha dividido `app.js` en módulos independientes ubicados en la carpeta `modules/`:

```
TalkStock/
├── app.js (ahora importa todos los módulos)
├── index.html
├── app.css
├── modules/
│   ├── roles-permisos.js    ✓ Completo - Gestión de roles y permisos
│   ├── db.js                ✓ Completo - Base de datos local (IndexedDB)
│   ├── ui.js                ✓ Completo - Componentes UI comunes
│   ├── auth.js              ✓ Completo - Login y autenticación
│   ├── materiales.js        ✓ Completo - CRUD de materiales
│   ├── ubicaciones.js       ✓ Completo - CRUD de ubicaciones
│   ├── movimientos.js       ✓ Completo - Registro de movimientos
│   ├── pedidos.js           ✓ Completo - Gestión de pedidos
│   ├── fichajes.js          ⚠️ Stub - Fichaje de presencia
│   ├── supabase-sync.js     ⚠️ Stub - Sincronización en la nube
│   ├── voice.js             ⚠️ Stub - Reconocimiento de voz
│   └── wizard.js            ⚠️ Stub - Asistente guiado
└── [otros archivos]
```

## Estado de los Módulos

### ✓ Módulos Completos
- `roles-permisos.js` - Definición de roles, permisos, y auditoría
- `db.js` - Operaciones IndexedDB (CRUD)
- `ui.js` - Componentes UI comunes (modales, toast, pantallas)
- `auth.js` - Sistema de login con PIN
- `materiales.js` - Gestión de materiales (crear, editar, eliminar)
- `ubicaciones.js` - Gestión de ubicaciones/almacenes
- `movimientos.js` - Registro de movimientos de stock
- `pedidos.js` - Gestión de pedidos a proveedores

### ⚠️ Módulos Stub (requieren completarse)
- `fichajes.js` - Necesita extraer toda la lógica de presencia del app.js original
- `supabase-sync.js` - Necesita extraer sincronización y realtime
- `voice.js` - Necesita extraer Whisper y procesamiento de voz
- `wizard.js` - Necesita extraer asistente guiado completo

## Próximos Pasos

### 1. Completar los módulos stub
Para cada módulo stub, copie el código correspondiente del `app.js` original:

#### `fichajes.js`
Buscar en app.js:
- `renderFichaje()`
- `initOperarioView()`
- `initAdminView()`
- `guardarFichaje()`
- `renderAdminAhora()`
- `renderAdminHistorial()`
- Etc.

#### `supabase-sync.js`
Buscar en app.js:
- `syncNow()`
- `pullRemoteData()`
- `startRealtime()`
- `stopRealtime()`
- `SETUP_SQL`
- Funciones de sincronización

#### `voice.js`
Buscar en app.js:
- `ensureWhisperLoaded()`
- `startListening()`
- `stopListening()`
- `finishRecording()`
- `normalizeVoiceTextWithQwen()`
- `blobToWhisperInput()`

#### `wizard.js`
Buscar en app.js:
- `wizStart()`
- `wizRenderStep()`
- `wizProcessSpeech()`
- `wizExecute()`
- Todo el sistema de pasos

### 2. Importar módulos en app.js
Actualizar `app.js` para importar todos los módulos al inicio:

```javascript
// ══════════════════════════════════════════════
// IMPORTAR MÓDULOS
// ══════════════════════════════════════════════
// [importar cada módulo con <script> tags]
```

### 3. Limpiar app.js
Una vez importados los módulos, eliminar del app.js todo el código duplicado que ahora está en los módulos.

### 4. Probar funcionamiento
Asegurar que toda la aplicación funciona correctamente después de la refactorización.

## Beneficios de la Refactorización

✓ **Código más organizado** - Cada funcionalidad en su propio módulo
✓ **Más mantenible** - Cambios localizados sin efectos secundarios
✓ **Reutilizable** - Los módulos pueden usarse en otros proyectos
✓ **Más testeable** - Funciones independientes más fáciles de probar
✓ **Mejor rendimiento** - Posibilidad de cargar módulos bajo demanda

## Notas

- Los módulos NO están envueltos en closures para permitir el acceso global a funciones
- Las funciones se cargan en el scope global del navegador
- Los módulos con dependencias deben cargarse en el orden correcto

## Orden de Carga Recomendado

1. roles-permisos.js
2. db.js
3. ui.js
4. auth.js
5. supabase-sync.js
6. voice.js
7. wizard.js
8. materiales.js
9. ubicaciones.js
10. movimientos.js
11. pedidos.js
12. fichajes.js

Luego actualizar index.html para importar en este orden.
