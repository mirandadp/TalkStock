# ✅ CHECKLIST DE REFACTORIZACIÓN

## FASE 1: ESTRUCTURA MODULAR ✓ COMPLETADO

- [x] Crear carpeta `/modules/`
- [x] Crear módulo roles-permisos.js
- [x] Crear módulo db.js
- [x] Crear módulo ui.js
- [x] Crear módulo auth.js
- [x] Crear módulo materiales.js
- [x] Crear módulo ubicaciones.js
- [x] Crear módulo movimientos.js
- [x] Crear módulo pedidos.js
- [x] Crear stubs para fichajes.js, supabase-sync.js, voice.js, wizard.js
- [x] Actualizar index.html con imports en orden correcto
- [x] Crear documentación (README.md, GUIA-COMPLETAR-STUBS.md)

**Estado: 12/12 archivos creados** ✓

---

## FASE 2: COMPLETAR STUBS (⏳ SIGUIENTE)

### fichajes.js
- [ ] Extraer `renderFichaje()`
- [ ] Extraer `initOperarioView()`
- [ ] Extraer `initAdminView()`
- [ ] Extraer `guardarFichaje()`
- [ ] Extraer `renderAdminAhora()`
- [ ] Extraer `renderAdminHistorial()`
- [ ] Extraer `exportFichajesCSV()`
- [ ] Extraer `handleQrFichaje()`
- [ ] Verificar funcionalidad en navegador

### supabase-sync.js
- [ ] Extraer `SETUP_SQL`
- [ ] Extraer `getSBConfig()`
- [ ] Extraer `initSupabase()`
- [ ] Extraer `saveSupabaseConfig()`
- [ ] Extraer `syncNow()`
- [ ] Extraer `pullRemoteData()`
- [ ] Extraer `startRealtime()`
- [ ] Extraer `stopRealtime()`
- [ ] Verificar funcionalidad en navegador

### voice.js
- [ ] Extraer `initVoice()`
- [ ] Extraer `ensureWhisperLoaded()`
- [ ] Extraer `startListening()`
- [ ] Extraer `stopListening()`
- [ ] Extraer `normalizeVoiceTextWithQwen()`
- [ ] Extraer funciones de búsqueda (fuzzyMatch, phonetic, etc)
- [ ] Extraer `parseSpanishNumberWords()`
- [ ] Verificar funcionalidad en navegador

### wizard.js
- [ ] Extraer `WIZ` objeto estado
- [ ] Extraer `FLOW` definiciones
- [ ] Extraer `wizStart()`
- [ ] Extraer `wizRenderStep()`
- [ ] Extraer `wizAcceptValue()`
- [ ] Extraer `wizExecute()`
- [ ] Extraer funciones de búsqueda
- [ ] Verificar funcionalidad en navegador

**Estado: 0/40 completadas** ⏳

---

## FASE 3: LIMPIAR app.js (DESPUÉS DE COMPLETAR STUBS)

- [ ] Eliminar código de auth.js del app.js
- [ ] Eliminar código de materiales.js del app.js
- [ ] Eliminar código de ubicaciones.js del app.js
- [ ] Eliminar código de movimientos.js del app.js
- [ ] Eliminar código de pedidos.js del app.js
- [ ] Eliminar código de fichajes.js del app.js
- [ ] Eliminar código de supabase-sync.js del app.js
- [ ] Eliminar código de voice.js del app.js
- [ ] Eliminar código de wizard.js del app.js
- [ ] Mantener solo inicialización y orquestación
- [ ] Reducir app.js a <100 líneas

**Estado: 0/11 completadas** ⏳

---

## FASE 4: PRUEBAS FINALES

- [ ] Prueba: Cargar app en navegador
- [ ] Prueba: Login funciona
- [ ] Prueba: Panel de inicio de sesión
- [ ] Prueba: Gestión de materiales
- [ ] Prueba: Gestión de ubicaciones
- [ ] Prueba: Registro de movimientos
- [ ] Prueba: Gestión de pedidos
- [ ] Prueba: Fichaje de presencia
- [ ] Prueba: Sincronización Supabase
- [ ] Prueba: Reconocimiento de voz
- [ ] Prueba: Asistente guiado (wizard)
- [ ] Prueba: QR scanner
- [ ] Revisión de consola (sin errores)
- [ ] Revisión de rendimiento

**Estado: 0/14 completadas** ⏳

---

## RESUMEN DE PROGRESO

| Fase | Tareas | Completado | % |
|------|--------|-----------|---|
| 1. Estructura | 12 | ✓ 12 | 100% |
| 2. Stubs | 40 | ⏳ 0 | 0% |
| 3. Limpieza | 11 | ⏳ 0 | 0% |
| 4. Pruebas | 14 | ⏳ 0 | 0% |
| **TOTAL** | **77** | **✓ 12** | **16%** |

---

## PRÓXIMOS PASOS

1. **Inmediato:** Seguir guía GUIA-COMPLETAR-STUBS.md
   - Extraer funciones de app.js para cada stub
   - Actualizar módulos uno a uno

2. **Después:** Limpiar app.js
   - Eliminar código duplicado
   - Convertir app.js en punto de entrada

3. **Finalmente:** Pruebas completas
   - Verificar todas las funcionalidades
   - Validar en consola

---

## Archivos de Referencia

- **README.md** - Documentación de la estructura
- **GUIA-COMPLETAR-STUBS.md** - Instrucciones detalladas de extracción
- **Todos los módulos** - Ubicados en `/modules/`
- **app.js original** - Base para extraer código

---

## Notas Importantes

⚠️ **Mantener el orden de carga de módulos en index.html**
- Los módulos tienen dependencias entre ellos
- El orden actual es óptimo

⚠️ **No eliminar código de app.js** hasta completar todos los stubs
- Necesario para extraer código

⚠️ **Probar después de cada stub completado**
- Verificar funcionalidad antes de continuar

---

## Contacto / Ayuda

Si necesitas ayuda durante la refactorización:
1. Consulta GUIA-COMPLETAR-STUBS.md
2. Verifica el orden de carga en index.html
3. Revisa los imports de cada módulo
4. Abre consola del navegador para errores
